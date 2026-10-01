const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { readOwnedAttachment } = require('./attach-command');
const { buildStaticGraph, joinLedger } = require('./architecture/graph');
const { computeAllMetrics } = require('./architecture/metrics');
const { evaluateFindings } = require('./architecture/findings');
const { buildReport, renderMarkdown, writeReport } = require('./architecture/report');
const { loadExperiments, writeViews } = require('./architecture/views');
const { readSessionSpanRows } = require('./copilot/session-span-export');
const { readSessionOutbox } = require('./copilot/session-delivery-outbox');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readJsonSafe(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonlSafe(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 32 * 1024 * 1024) return { rows: [], invalid: 1 };
    const rows = [];
    let invalid = 0;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const value = JSON.parse(line);
        if (value && typeof value === 'object' && !Array.isArray(value)) rows.push(value);
        else invalid += 1;
      } catch {
        invalid += 1;
      }
    }
    return { rows, invalid };
  } catch (error) {
    return { rows: [], invalid: error.code === 'ENOENT' ? 0 : 1 };
  }
}

// Locates the attachment manifest. Two layouts are supported:
//   1. Fixture-only layout (Task 6's test suite): <ledgerDir>/attachment.json,
//      holding `{ architecture }` directly.
//   2. The REAL recorder's layout (attach-command.js / session-run-delivery.js):
//      the manifest lives at the REPO ROOT under .agentops/attachment.json,
//      not inside the ledger/runs directory. `--ledger` typically points at
//      <agentopsHome>/runs, which is unrelated to the repo root, so this is
//      read via readOwnedAttachment(repoRoot) — the same ownership-verified
//      helper attach-command.js's own coverage command reuses — rather than
//      re-implementing manifest parsing here.
// The fixture layout is tried first so existing ledger fixtures keep working
// unchanged; the repo-root attachment is the fallback used by real runs.
function loadAttachmentManifest(ledgerDir, repoRoot) {
  const fixturePath = path.join(ledgerDir, 'attachment.json');
  const fixtureAttachment = readJsonSafe(fixturePath);
  if (fixtureAttachment && fixtureAttachment.architecture) {
    return { attachment: fixtureAttachment, path: fixturePath };
  }
  const owned = readOwnedAttachment(repoRoot);
  if (owned.ok && owned.manifest && owned.manifest.architecture) {
    return { attachment: owned.manifest, path: owned.paths.manifest };
  }
  return { attachment: null, path: fixturePath, error: owned.error };
}

// Reads per-run context. The real recorder writes `run-context.json`
// (session-run-delivery.js); Task 6's fixtures write `context.json`. Its real
// fields are `{managedBy, schemaVersion, runId, sessionId, repositoryRootHash,
// attachmentManifestSha256, createdAt}` — none of which are
// architectureVersion/taskContract/outcomeFailed/compactionObserved, so those
// are treated as genuinely absent (not pre-stamped) rather than required.
function readRunContext(runDir) {
  return readJsonSafe(path.join(runDir, 'run-context.json')) || readJsonSafe(path.join(runDir, 'context.json')) || {};
}

// Reads per-run events. The real recorder writes `AgentOpsEvents_CL.jsonl`
// (session-event-export.js); Task 6's fixtures write `events.jsonl`.
function readRunEvents(runDir) {
  const realPath = path.join(runDir, 'AgentOpsEvents_CL.jsonl');
  const fixturePath = path.join(runDir, 'events.jsonl');
  const result = readJsonlSafe(fs.existsSync(realPath) ? realPath : fixturePath);
  const rows = result.rows.filter(row => typeof (row.EventName || row.event_name) === 'string' && (row.EventName || row.event_name).trim());
  return { rows, invalid: result.invalid + result.rows.length - rows.length };
}

function loadLedgerFromDirectory(ledgerDir, options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const located = loadAttachmentManifest(ledgerDir, repoRoot);
  if (!located.attachment) {
    throw new Error(`architecture requires an attachment manifest at ${located.path} (fixture ledger) or a real AgentOps attachment at the repo root .agentops/attachment.json under ${repoRoot} (${located.error || 'not found'}); detected missing or malformed inventory`);
  }
  const attachment = located.attachment;
  const runs = [];
  let invalidTotal = 0;
  let entries;
  try {
    entries = fs.readdirSync(ledgerDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(entry.name)) continue;
    const runDir = path.join(ledgerDir, entry.name);
    const context = readRunContext(runDir);
    const { rows: events, invalid } = readRunEvents(runDir);
    invalidTotal += invalid;
    // Older contexts have unknown coverage. Partial or malformed capture cannot
    // establish absence, even when an older writer stamped evidenceComplete.
    const explicitEvidenceComplete = typeof context.evidenceComplete === 'boolean' ? context.evidenceComplete : null;
    const coverage = context.coverage || {};
    const componentsComplete = ['agents', 'skills', 'references', 'scripts', 'tools', 'models']
      .every(component => coverage[component] === 'complete');
    const evidenceComplete = explicitEvidenceComplete !== false && invalid === 0 && events.length > 0
      && componentsComplete
      && !Object.values(coverage).some(value => value !== 'complete');
    runs.push({
      runId: entry.name,
      sessionId: context.sessionId || '',
      architectureVersion: context.architectureVersion || 'unknown',
      evidenceTier: context.evidenceTier || 'unknown',
      evidenceComplete,
      coverage,
      lifecycle: context.lifecycle || { collector: 'unknown', process: 'unknown' },
      taskContract: context.taskContract || null,
      outcomeFailed: Boolean(context.outcomeFailed),
      compactionObserved: Boolean(context.compactionObserved),
      events
    });
    const run = runs[runs.length - 1];
    try { run.deliveryStatus = readSessionOutbox(runDir); } catch { run.deliveryStatus = null; }
    if (options.copilotHome && /^[A-Za-z0-9-]{1,100}$/.test(run.sessionId)) {
      const native = readJsonlSafe(path.join(options.copilotHome, 'session-state', run.sessionId, 'events.jsonl'));
      if (native.invalid === 0 && native.rows.find(row => row.type === 'session.start')?.data?.sessionId === run.sessionId) {
        run.nativeEvents = native.rows;
        try { run.nativeSpans = readSessionSpanRows(runDir, run.runId, run.sessionId).spans; } catch { run.nativeSpans = []; }
      }
    }
  }
  return { attachment, runs, invalidLedgerRows: invalidTotal };
}

function computeArchitecture({ attachment, runs, options = {} }) {
  const graph = buildStaticGraph(attachment.architecture);
  const normalisedRuns = runs.map(run => ({
    ...run,
    architectureVersion: run.architectureVersion || graph.architectureVersion
  }));
  const { joined, invalid } = joinLedger(graph, normalisedRuns);
  const metrics = computeAllMetrics(graph, joined, options);
  const findings = evaluateFindings(graph, joined, { metrics });
  const { report, azureRows } = buildReport({
    graph,
    findings,
    invalidLedgerRows: (options.invalidLedgerRows || 0) + invalid.length
  });
  return { graph, joined, findings, report, azureRows };
}

function renderText(report) {
  const lines = [];
  lines.push(`AgentOps architecture report (version ${report.architectureVersion.slice(0, 12)}…)`);
  lines.push(`Covered runs: ${report.coverageRuns}${report.insufficientEvidence ? ' (insufficient evidence — no cards emitted)' : ''}`);
  lines.push(`Inventory: ${report.inventory.agents} agents · ${report.inventory.skills} skills · ${report.inventory.references} references · ${report.inventory.scripts} scripts`);
  lines.push(`Cards: ${report.cards.length}`);
  for (const card of report.cards) {
    lines.push(`- ${card.rule}${card.subStatus ? ` [${card.subStatus}]` : ''}: ${card.summary || card.title}`);
  }
  lines.push(`Deferred rules (metrics only): ${report.deferredRules.join(', ')}`);
  lines.push('Not a verdict. Each card is a hypothesis. Use agentops experiment to run a single-change Vally test.');
  return lines.join('\n') + '\n';
}

function printHelp(stdout) {
  stdout.write('agentops architecture [--ledger <dir>] [--repo <dir>] [--json] [--out <dir>] [--experiments <dir>] [--copilot-home <dir>] [--upload]\n');
  stdout.write('Reads a run ledger (default: current attachment under ~/.agentops/runs), joins it with the static architecture inventory, and emits the deterministic metrics plus hypothesis cards for the 5 in-scope rules. The ledger\'s attachment manifest is read from <dir>/attachment.json if present, otherwise from the real AgentOps attachment at the repo root (.agentops/attachment.json under --repo, default: current directory). Per-run data accepts both the real recorder\'s run-context.json/AgentOpsEvents_CL.jsonl and the fixture context.json/events.jsonl layout. --upload previews the Azure Logs Ingestion row set only; it does not upload until an operator wires the live DCR path.\n');
}

function architectureCommand(args = [], dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp(stdout);
    return { ok: true, action: 'help' };
  }
  const ledgerDir = optionValue(args, '--ledger');
  if (!ledgerDir) throw new Error('architecture requires --ledger <dir> pointing to a run ledger (either a fixture ledger with attachment.json plus per-run events.jsonl/context.json, or the real recorder\'s <agentopsHome>/runs directory with per-run run-context.json/AgentOpsEvents_CL.jsonl)');
  const resolvedLedger = path.resolve(ledgerDir);
  const repoRoot = path.resolve(optionValue(args, '--repo') || process.cwd());
  const { attachment, runs, invalidLedgerRows } = loadLedgerFromDirectory(resolvedLedger, { repoRoot, copilotHome: optionValue(args, '--copilot-home') });
  const outDir = optionValue(args, '--out');
  const result = computeArchitecture({ attachment, runs, options: { invalidLedgerRows } });
  let written = null;
  if (outDir) {
    const resolvedOutDir = path.resolve(outDir);
    written = writeReport(result.report, result.azureRows, resolvedOutDir);
    written.views = writeViews(result.report, runs, loadExperiments(optionValue(args, '--experiments')), resolvedOutDir, { repoRoot });
  }
  const upload = hasFlag(args, '--upload');
  const payload = {
    ok: true,
    action: 'architecture',
    ledger: resolvedLedger,
    repo: repoRoot,
    out_dir: written ? path.dirname(written.jsonPath) : null,
    files: written,
    architecture_version: result.report.architectureVersion,
    coverage_runs: result.report.coverageRuns,
    insufficient_evidence: result.report.insufficientEvidence,
    card_count: result.report.cards.length,
    cards: result.report.cards,
    azure_rows: result.azureRows,
    azure_rows_preview_only: upload,
    upload_note: upload
      ? 'Preview only. --upload prints the row set that would be sent to Custom-AgentOpsInsights_CL via the existing Logs Ingestion path. Live DCR upload is gated on master-plan capture gates passing.'
      : 'Pass --upload to print the Azure Logs Ingestion preview that would be sent to Custom-AgentOpsInsights_CL (no network call is made in this release).',
    report: result.report,
    deferred_rules: result.report.deferredRules
  };
  writeJsonOrRender(payload, hasFlag(args, '--json'), value => renderText(value.report), stdout);
  return payload;
}

module.exports = {
  architectureCommand,
  computeArchitecture,
  loadLedgerFromDirectory,
  renderMarkdown,
  renderText
};
