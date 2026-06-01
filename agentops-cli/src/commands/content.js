const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { buildAzureIngestPlan } = require('../lib/azure/v2-ingest-plan');
const { latestByTime } = require('../lib/explain/v2-explain');
const { v2OpenLinksForRun } = require('./open');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function captureModeSummary(rows) {
  const modes = new Map();
  for (const row of rows) {
    const mode = row.CaptureMode || 'unknown';
    modes.set(mode, (modes.get(mode) || 0) + 1);
  }
  return Object.fromEntries([...modes.entries()].sort());
}

function buildContentStatus({
  dir = path.join(repoRoot, '.agentops', 'demo', 'latest'),
  runsFile = '',
  allowContent = false
} = {}) {
  const absoluteDir = path.resolve(dir);
  const contentFile = path.join(absoluteDir, 'AgentOpsContent_CL.jsonl');
  const runFile = runsFile || path.join(absoluteDir, 'AgentOpsRunSummary_CL.jsonl');
  const contentRows = readJsonl(contentFile);
  const runs = readJsonl(runFile);
  const latestRun = latestByTime(runs);
  const plan = buildAzureIngestPlan({ dir: absoluteDir, allowContent });
  const openLinks = latestRun ? v2OpenLinksForRun(latestRun) : { ok: false, links: {} };
  const contentKinds = [...new Set(contentRows.map(row => row.ContentKind || 'unknown'))].sort();
  const redactionStates = [...new Set(contentRows.map(row => row.RedactionStatus || 'unknown'))].sort();
  const hasFullContent = contentRows.some(row => row.CaptureMode === 'full');

  return {
    ok: plan.content_capture.rows === 0 || allowContent,
    dir: absoluteDir,
    content_file: contentFile,
    run_file: runFile,
    content_rows: contentRows.length,
    allowed_for_ingest: allowContent,
    capture_modes: captureModeSummary(contentRows),
    content_kinds: contentKinds,
    redaction_states: redactionStates,
    has_full_content: hasFullContent,
    status: contentRows.length === 0
      ? 'strict metadata only'
      : allowContent
        ? 'explicit content opt-in acknowledged'
        : 'content rows present but blocked until --allow-content',
    safety_note: contentRows.length === 0
      ? 'Strict mode is not storing prompt or response text.'
      : 'Prompt/response rows may contain sensitive text. Use a restricted workspace/dashboard and pass --allow-content only after review.',
    latest_run_id: latestRun?.RunId || '',
    transcript_viewer_url: openLinks.links?.content_viewer || '',
    ingest_ready: plan.ok,
    ingest_errors: plan.errors,
    next: contentRows.length === 0
      ? [
        'Keep AGENTOPS_CAPTURE_CONTENT=false for shared/default telemetry.',
        'Use agentops demo generate --with-content only for redacted demo transcript UX.',
        'For real prompt/response capture, use a restricted workspace and rerun agentops content opt-in for the review checklist.'
      ]
      : [
        `agentops content status --dir ${absoluteDir} --allow-content`,
        `agentops azure-ingest plan --dir ${absoluteDir} --allow-content`,
        'Open the Prompt/response viewer link only in a restricted Grafana workspace.'
      ]
  };
}

function renderContentStatus(status) {
  const lines = ['AgentOps content capture status', ''];
  lines.push(`Status: ${status.status}`);
  lines.push(`Content rows: ${status.content_rows}`);
  lines.push(`Allowed for ingest: ${status.allowed_for_ingest ? 'yes' : 'no'}`);
  lines.push(`Ingest ready: ${status.ingest_ready ? 'yes' : 'no'}`);
  lines.push(`Capture modes: ${JSON.stringify(status.capture_modes)}`);
  lines.push(`Content kinds: ${status.content_kinds.join(', ') || 'none'}`);
  lines.push(`Safety: ${status.safety_note}`);
  if (status.transcript_viewer_url) lines.push(`Prompt/response viewer: ${status.transcript_viewer_url}`);
  if (status.ingest_errors.length > 0) {
    lines.push('');
    lines.push('Ingest blockers:');
    for (const error of status.ingest_errors) lines.push(`- ${error}`);
  }
  lines.push('');
  lines.push('Next:');
  for (const step of status.next) lines.push(`- ${step}`);
  return `${lines.join('\n')}\n`;
}

function renderOptInGuide() {
  return [
    'AgentOps prompt/response opt-in checklist',
    '',
    'Default: keep AGENTOPS_PRIVACY_MODE=strict and AGENTOPS_CAPTURE_CONTENT=false.',
    '',
    'Use raw or redacted prompt/response capture only when all are true:',
    '- the workspace is restricted to approved viewers',
    '- the run does not include secrets, private source, customer data, or regulated data',
    '- the team accepts that AgentOpsContent_CL can contain sensitive text',
    '- ingestion is reviewed with agentops azure-ingest plan --allow-content',
    '',
    'Safe demo path:',
    '- agentops demo generate --with-content --out .agentops/demo/content-demo',
    '- agentops content status --dir .agentops/demo/content-demo --allow-content',
    '- agentops azure-ingest plan --dir .agentops/demo/content-demo --allow-content',
    '',
    'Real capture remains explicit and environment-specific. Do not enable it in shared defaults.'
  ].join('\n') + '\n';
}

function contentCommand(args = []) {
  const [subcommand = 'status'] = args;
  if (!['status', 'opt-in'].includes(subcommand)) throw new Error('content supports: status|opt-in');

  if (subcommand === 'opt-in') {
    const guide = { ok: true, default_capture: 'off', mode: 'explicit_opt_in', checklist: renderOptInGuide().trim().split(/\n/) };
    process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(guide, null, 2)}\n` : renderOptInGuide());
    return;
  }

  const status = buildContentStatus({
    dir: optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest')),
    runsFile: optionValue(args, '--runs', ''),
    allowContent: hasFlag(args, '--allow-content')
  });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(status, null, 2)}\n` : renderContentStatus(status));
  if (!status.ok) process.exitCode = 1;
}

module.exports = {
  buildContentStatus,
  captureModeSummary,
  contentCommand,
  renderContentStatus,
  renderOptInGuide
};
