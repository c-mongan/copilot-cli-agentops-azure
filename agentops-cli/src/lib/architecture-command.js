const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { buildStaticGraph, joinLedger } = require('./architecture/graph');
const { computeAllMetrics } = require('./architecture/metrics');
const { evaluateFindings } = require('./architecture/findings');
const { buildReport, renderMarkdown, writeReport } = require('./architecture/report');

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

function loadLedgerFromDirectory(ledgerDir) {
  const attachmentPath = path.join(ledgerDir, 'attachment.json');
  const attachment = readJsonSafe(attachmentPath);
  if (!attachment || !attachment.architecture) {
    throw new Error(`architecture requires an attachment manifest at ${attachmentPath}; detected missing or malformed inventory`);
  }
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
    const context = readJsonSafe(path.join(runDir, 'context.json')) || {};
    const { rows: events, invalid } = readJsonlSafe(path.join(runDir, 'events.jsonl'));
    invalidTotal += invalid;
    runs.push({
      runId: entry.name,
      architectureVersion: context.architectureVersion || null,
      evidenceComplete: context.evidenceComplete !== false,
      taskContract: context.taskContract || null,
      outcomeFailed: Boolean(context.outcomeFailed),
      compactionObserved: Boolean(context.compactionObserved),
      events
    });
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
  stdout.write('agentops architecture [--ledger <dir>] [--json] [--out <dir>] [--upload]\n');
  stdout.write('Reads a run ledger (default: current attachment under ~/.agentops/runs), joins it with the static architecture inventory, and emits the deterministic metrics plus hypothesis cards for the 5 in-scope rules. --upload previews the Azure Logs Ingestion row set only; it does not upload until an operator wires the live DCR path.\n');
}

function architectureCommand(args = [], dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp(stdout);
    return { ok: true, action: 'help' };
  }
  const ledgerDir = optionValue(args, '--ledger');
  if (!ledgerDir) throw new Error('architecture requires --ledger <dir> pointing to a run ledger with attachment.json plus per-run subdirectories (events.jsonl, context.json)');
  const resolvedLedger = path.resolve(ledgerDir);
  const { attachment, runs, invalidLedgerRows } = loadLedgerFromDirectory(resolvedLedger);
  const outDir = optionValue(args, '--out');
  const result = computeArchitecture({ attachment, runs, options: { invalidLedgerRows } });
  let written = null;
  if (outDir) {
    const resolvedOutDir = path.resolve(outDir);
    written = writeReport(result.report, result.azureRows, resolvedOutDir);
  }
  const upload = hasFlag(args, '--upload');
  const payload = {
    ok: true,
    action: 'architecture',
    ledger: resolvedLedger,
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
