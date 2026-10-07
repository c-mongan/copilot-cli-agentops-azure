const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Copilot CLI 1.0.93 is the first release verified to emit native OTel spans
// that the per-run AgentOps Collector receives (see docs/doctor.md).
const MIN_NATIVE_OTEL_COPILOT = '1.0.93';
const LAUNCH_HINT = 'agentops copilot-session launch -- -p "hello"';
const STATUS = Object.freeze({ ready: 'ready', warn: 'warn', fail: 'fail', skipped: 'skipped' });
const GLYPH = Object.freeze({ ready: '✓', warn: '!', fail: '✗', skipped: '–' });
const WORD = Object.freeze({ ready: 'ready', warn: 'check', fail: 'broken', skipped: 'skipped' });
const ANSI = Object.freeze({ ready: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m', skipped: '\u001b[90m', bold: '\u001b[1m', dim: '\u001b[2m', reset: '\u001b[0m' });
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function stage(id, title, status, reason, fix = null, extra = {}) {
  return { id, title, status, optional: false, reason, fix, ...extra };
}

function parseVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function copilotStage({ resolved, versionText } = {}) {
  const title = 'Copilot CLI';
  if (!resolved?.ok) {
    const shimOnly = Array.isArray(resolved?.candidates) && resolved.candidates.length > 0;
    return stage('copilot', title, STATUS.fail,
      shimOnly ? 'only AgentOps shims are on PATH, not the real Copilot CLI' : 'GitHub Copilot CLI was not found on PATH',
      shimOnly ? 'export COPILOT_CLI_BIN=/path/to/real/copilot' : 'npm install -g @github/copilot');
  }
  const version = parseVersion(versionText);
  if (!version) {
    return stage('copilot', title, STATUS.warn, 'found, but `copilot --version` did not report a version', 'copilot update', { version: null });
  }
  const label = version.join('.');
  if (compareVersions(version, parseVersion(MIN_NATIVE_OTEL_COPILOT)) < 0) {
    return stage('copilot', title, STATUS.warn, `v${label} is older than ${MIN_NATIVE_OTEL_COPILOT}, the first version verified for native OTel`, 'copilot update', { version: label });
  }
  return stage('copilot', title, STATUS.ready, `v${label} (native OTel needs ≥ ${MIN_NATIVE_OTEL_COPILOT})`, null, { version: label });
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function otelStage({ env = {}, ledger = null } = {}) {
  const title = 'Native OTel capture';
  const contentVars = ['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', 'COPILOT_OTEL_CAPTURE_CONTENT'].filter(key => truthy(env[key]));
  // The copilot-observe wrapper only enables capture when both of these are set.
  if (truthy(env.AGENTOPS_CAPTURE_CONTENT) && truthy(env.AGENTOPS_ALLOW_CONTENT_CAPTURE)) contentVars.push('AGENTOPS_CAPTURE_CONTENT', 'AGENTOPS_ALLOW_CONTENT_CAPTURE');
  if (contentVars.length) {
    return stage('otel', title, STATUS.fail, `content capture is ON via ${contentVars.join(', ')}; prompts and code could be recorded`, `unset ${contentVars.join(' ')}`, { contentCapture: true });
  }
  const latest = ledger?.latest;
  const base = 'set per run by copilot-session launch · content capture off';
  if (!latest) return stage('otel', title, STATUS.ready, `${base} · not yet observed`, null, { contentCapture: false, observedSpans: null });
  if (latest.spans > 0) {
    return stage('otel', title, STATUS.ready, `${base} · ${latest.spans} native spans in latest run`, null, { contentCapture: false, observedSpans: latest.spans });
  }
  return stage('otel', title, STATUS.warn, 'latest run recorded no native OTel spans (old Copilot CLI or a run outside launch)', `copilot update && ${LAUNCH_HINT}`, { contentCapture: false, observedSpans: 0 });
}

function collectorStage({ status = null, loopback = { ok: true } } = {}) {
  const title = 'Local Collector';
  if (!status) return stage('collector', title, STATUS.fail, 'Collector status could not be read', 'agentops collector status');
  if (!status.binary?.ok) {
    return stage('collector', title, STATUS.fail, 'otelcol-contrib binary not installed; launch needs it for the per-run loopback Collector', 'agentops collector install-binary', { binary: false });
  }
  if (!status.safeLocalhostBinding) {
    return stage('collector', title, STATUS.fail, 'Collector config is not bound to 127.0.0.1', 'git checkout -- collector/', { binary: true });
  }
  if (!loopback.ok) {
    return stage('collector', title, STATUS.fail, `cannot open a loopback port (${loopback.error || 'unknown error'})`, 'agentops collector status', { binary: true, loopback: false });
  }
  const shared = status.running ? 'shared Collector running on 127.0.0.1:4318' : 'starts a private loopback Collector per run';
  return stage('collector', title, STATUS.ready, `binary installed · ${shared}`, null, { binary: true, loopback: true, running: Boolean(status.running) });
}

function ledgerStage({ ledger = null, now = Date.now() } = {}) {
  const title = 'Local ledger';
  if (!ledger || ledger.error) {
    return stage('ledger', title, STATUS.fail, `ledger could not be read${ledger?.error ? `: ${ledger.error}` : ''}`, 'ls -la ~/.agentops/runs');
  }
  if (!ledger.count) {
    return stage('ledger', title, STATUS.warn, 'no runs yet', LAUNCH_HINT, { runs: 0 });
  }
  const latest = ledger.latest;
  const age = latest?.updatedAt ? formatAge(now - Date.parse(latest.updatedAt)) : 'unknown age';
  return stage('ledger', title, STATUS.ready, `${ledger.count} run${ledger.count === 1 ? '' : 's'} · latest ${age}`, null, {
    runs: ledger.count,
    latestRunId: latest?.runId || null,
    latestAt: latest?.updatedAt || null
  });
}

function reportStage({ result = null } = {}) {
  const title = 'Local report renders';
  if (!result || result.state === 'no_runs') {
    return stage('report', title, STATUS.warn, 'nothing to render until the first run', LAUNCH_HINT, { selfTest: false });
  }
  if (result.state === 'no_session') {
    return stage('report', title, STATUS.warn, 'no recent run has a Copilot session file on this machine', LAUNCH_HINT, { selfTest: false });
  }
  if (!result.ok) {
    return stage('report', title, STATUS.fail, `self-test render failed: ${result.error}`,
      `agentops copilot-session view ${result.sessionId} --run-id ${result.runId} --output session.html`, { selfTest: true, sessionId: result.sessionId });
  }
  return stage('report', title, STATUS.ready, `rendered latest session (${result.events} events, ${Math.round(result.bytes / 1024)} KB) in ${result.durationMs} ms`, null, {
    selfTest: true,
    sessionId: result.sessionId,
    runId: result.runId,
    open: `agentops copilot-session view ${result.sessionId} --run-id ${result.runId} --output session.html`
  });
}

function azureStage({ cloud = {}, publishCap = 0, outbox = null, readback = null } = {}) {
  const title = 'Azure publishing';
  const optional = { optional: true };
  const missing = ['subscriptionId', 'logsIngestionEndpoint', 'dcrImmutableId'].filter(key => !cloud[key]);
  const anything = ['subscriptionId', 'logsIngestionEndpoint', 'dcrImmutableId', 'workspaceId'].some(key => cloud[key]);
  if (!anything) {
    return stage('azure', title, STATUS.skipped, 'optional · not configured, everything stays local', null, { ...optional, configured: false });
  }
  if (missing.length) {
    const flags = { subscriptionId: '--subscription-id <id>', logsIngestionEndpoint: '--logs-ingestion-endpoint <url>', dcrImmutableId: '--dcr-immutable-id <id>' };
    return stage('azure', title, STATUS.warn, `optional · target incomplete (missing ${missing.join(', ')})`, `agentops configure set ${missing.map(key => flags[key]).join(' ')}`, { ...optional, configured: false });
  }
  const pending = outbox?.pending || 0;
  const accepted = outbox?.accepted || 0;
  const extra = { ...optional, configured: true, publishCap, pending, accepted, readback };
  let cloudText = '';
  if (readback?.ok) cloudText = ` · cloud: ${readback.rows} AgentOps rows in last 24h`;
  else if (readback) cloudText = ` · cloud readback failed: ${readback.error}`;
  if (readback && !readback.ok) {
    const fix = readback.reason === 'no_tables'
      ? 'agentops configure set --workspace-id <Log Analytics workspace your DCR writes to>'
      : 'az login && agentops doctor --cloud';
    return stage('azure', title, STATUS.warn, `optional${cloudText}`, fix, extra);
  }
  if (!(publishCap > 0)) {
    return stage('azure', title, STATUS.warn, `optional · target set, but the publish allowance is 0 bytes/day so nothing uploads${cloudText}`, 'export AGENTOPS_MAX_PUBLISH_BYTES_PER_DAY=1048576', extra);
  }
  const cap = `cap ${Math.round(publishCap / 1024)} KB/day`;
  if (pending > 0) {
    return stage('azure', title, STATUS.warn, `optional · ${cap} · ${pending} stream batch(es) waiting to publish${cloudText}`, 'agentops delivery drain --yes', extra);
  }
  const lastText = accepted > 0 ? `${accepted} stream batch(es) accepted by Azure` : 'nothing published yet';
  return stage('azure', title, STATUS.ready, `optional · ${cap} · ${lastText}${cloudText}`, null, extra);
}

function summarizePipeline(stages) {
  const counted = stages.filter(item => item.status !== STATUS.skipped);
  const ready = counted.filter(item => item.status === STATUS.ready).length;
  const blocker = stages.find(item => item.status === STATUS.fail && !item.optional)
    || stages.find(item => item.status === STATUS.warn && !item.optional)
    || stages.find(item => item.status !== STATUS.ready && item.status !== STATUS.skipped);
  return {
    ready,
    total: counted.length,
    allReady: ready === counted.length,
    next: blocker ? { stage: blocker.id, fix: blocker.fix, reason: blocker.reason } : null
  };
}

function useColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}

function renderPipeline(pipeline, options = {}) {
  const color = Boolean(options.color);
  const paint = (code, text) => (color ? `${code}${text}${ANSI.reset}` : text);
  const lines = [paint(ANSI.bold, 'AgentOps doctor — is my setup working?'), ''];
  pipeline.stages.forEach((item, index) => {
    const mark = paint(ANSI[item.status], `${GLYPH[item.status]} ${WORD[item.status].padEnd(7)}`);
    lines.push(`  ${mark} ${index + 1}. ${item.title.padEnd(21)} ${item.reason}`);
    if (item.fix) lines.push(`              ${paint(ANSI.dim, 'fix:')} ${item.fix}`);
  });
  const summary = pipeline.summary;
  const head = `${summary.ready}/${summary.total} ready`;
  const skipped = pipeline.stages.filter(item => item.status === STATUS.skipped).map(item => item.title);
  const skippedText = skipped.length ? ` (${skipped.join(', ')}: skipped, optional)` : '';
  lines.push('');
  if (summary.next) {
    lines.push(`${paint(ANSI.bold, head)}${skippedText} — next: ${summary.next.fix || summary.next.reason}`);
  } else {
    lines.push(`${paint(ANSI[STATUS.ready], `${head}`)}${skippedText} — all set. See your latest run: agentops open latest`);
  }
  if (!options.verbose) lines.push(paint(ANSI.dim, 'Details: agentops doctor --verbose · machine-readable: agentops doctor --json'));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Fact gathering (local only; no network unless options.cloud is set)
// ---------------------------------------------------------------------------

function readSmallJson(file, maxBytes = 256 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('unexpected delivery file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readLedger(agentopsHome) {
  const runsDir = path.join(agentopsHome, 'runs');
  if (!fs.existsSync(runsDir)) return { count: 0, latest: null, runs: [] };
  try {
    const runs = [];
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !SAFE_ID.test(entry.name)) continue;
      const directory = path.join(runsDir, entry.name);
      let state = null;
      try { state = readSmallJson(path.join(directory, 'session-delivery.json')); } catch {}
      let updatedAt = state?.updatedAt || state?.createdAt || null;
      if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
        try { updatedAt = fs.statSync(directory).mtime.toISOString(); } catch { updatedAt = null; }
      }
      const spans = Number(state?.streams?.spans?.rows) || 0;
      runs.push({
        runId: entry.name,
        sessionId: typeof state?.sessionId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(state.sessionId) ? state.sessionId : null,
        updatedAt,
        spans: state?.streams?.spans?.status === 'not_observed' ? 0 : spans,
        directory
      });
    }
    const time = run => Date.parse(run.updatedAt) || 0;
    runs.sort((left, right) => time(right) - time(left));
    return { count: runs.length, latest: runs[0] || null, runs };
  } catch (error) {
    return { count: 0, latest: null, runs: [], error: error.message };
  }
}

function copilotVersion(resolved, spawnSync = childProcess.spawnSync) {
  if (!resolved?.ok) return null;
  const result = spawnSync(resolved.path, ['--version'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/)[0].trim();
}

function probeLoopback() {
  return new Promise(resolve => {
    const server = net.createServer();
    const timer = setTimeout(() => { server.close(); resolve({ ok: false, error: 'timed out' }); }, 1500);
    server.once('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.code || error.message }); });
    server.listen(0, '127.0.0.1', () => {
      clearTimeout(timer);
      server.close(() => resolve({ ok: true }));
    });
  });
}

function renderSelfTest(ledger, options = {}) {
  if (!ledger?.count) return { state: 'no_runs' };
  const { readCopilotSessionEvents, defaultSessionEventsPath } = require('./copilot/session-enricher');
  const { writeSessionWaterfall } = require('./copilot/session-waterfall');
  const { enrichSpansWithSessionToolContext, readSessionSpanRows } = require('./copilot/session-span-export');
  const { readSessionOutbox } = require('./copilot/session-delivery-outbox');
  const candidate = ledger.runs.slice(0, 10).find(run => {
    if (!run.sessionId) return false;
    try { return fs.existsSync(defaultSessionEventsPath(run.sessionId, options.homeDir)); } catch { return false; }
  });
  if (!candidate) return { state: 'no_session' };
  const started = Date.now();
  const output = path.join(options.agentopsHome, `.doctor-selftest-${process.pid}-${started}.html`);
  try {
    const events = readCopilotSessionEvents(defaultSessionEventsPath(candidate.sessionId, options.homeDir));
    const spans = readSessionSpanRows(candidate.directory, candidate.runId, candidate.sessionId).spans;
    let deliveryStatus = null;
    try { deliveryStatus = readSessionOutbox(candidate.directory); } catch {}
    writeSessionWaterfall(events, candidate.sessionId, output, {
      nativeSpans: enrichSpansWithSessionToolContext(spans, events),
      deliveryStatus,
      metadataOnly: true
    });
    const html = fs.readFileSync(output, 'utf8');
    if (!/<html/i.test(html) || !html.includes(candidate.sessionId)) throw new Error('rendered file is missing the session view');
    return { state: 'rendered', ok: true, sessionId: candidate.sessionId, runId: candidate.runId, events: events.length, bytes: Buffer.byteLength(html), durationMs: Date.now() - started };
  } catch (error) {
    return { state: 'failed', ok: false, sessionId: candidate.sessionId, runId: candidate.runId, error: error.message };
  } finally {
    fs.rmSync(output, { force: true });
  }
}

function cloudReadback(cloud, spawnSync = childProcess.spawnSync) {
  if (!cloud.workspaceId) return { ok: false, rows: null, error: 'workspaceId is not configured (agentops configure set --workspace-id <id>)' };
  const query = 'union isfuzzy=true AgentOpsEvents_CL, AgentOpsSpans_CL | where TimeGenerated > ago(24h) | count';
  const result = spawnSync('az', ['monitor', 'log-analytics', 'query', '--workspace', cloud.workspaceId, '--analytics-query', query, '-o', 'json'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024
  });
  if (result.error) return { ok: false, rows: null, error: result.error.code === 'ENOENT' ? 'az CLI not found' : result.error.message };
  if (result.status !== 0) {
    const stderr = String(result.stderr || '');
    if (/Failed to resolve table|SEM0100|SEM0529|at least one operand/i.test(stderr)) {
      return { ok: false, rows: null, reason: 'no_tables', error: 'workspace has no AgentOps tables (wrong workspace, or nothing published yet)' };
    }
    if (/az login|AADSTS|credentials/i.test(stderr)) return { ok: false, rows: null, reason: 'auth', error: 'az CLI is not signed in' };
    const firstLine = stderr.trim().split(/\r?\n/)[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
    return { ok: false, rows: null, error: firstLine.slice(0, 160) || 'az query failed' };
  }
  try {
    const rows = JSON.parse(result.stdout || '[]');
    return { ok: true, rows: Number(rows[0]?.Count ?? rows[0]?.count ?? 0), query, error: null };
  } catch (error) {
    return { ok: false, rows: null, error: `could not parse az output: ${error.message}` };
  }
}

async function doctorPipeline(options = {}) {
  const started = Date.now();
  const env = options.env || process.env;
  const homeDir = options.homeDir;
  const agentopsHome = options.agentopsHome || require('./paths').agentopsHome;
  const resolved = options.copilot || require('./copilot-resolver').resolveCopilotBinary({ env });
  const versionText = Object.prototype.hasOwnProperty.call(options, 'copilotVersionText')
    ? options.copilotVersionText
    : copilotVersion(resolved, options.spawnSync);
  const collectorStatus = options.collectorStatus || await require('./collector-manager').status({ mode: options.mode || 'auto' });
  const loopback = options.loopback || await probeLoopback();
  const ledger = options.ledger || readLedger(agentopsHome);
  const render = options.renderResult || renderSelfTest(ledger, { agentopsHome, homeDir });
  const { configuredCloudValues } = require('./agentops-config');
  const cloud = options.cloudValues || configuredCloudValues({ env });
  let publishCap = 0;
  try { publishCap = require('./copilot/delivery-limits').configuredDeliveryLimits({ env }).maxPublishBytesPerDay; } catch {}
  let outbox = null;
  try { outbox = require('./copilot/session-delivery-outbox').sessionOutboxStatus({ agentopsHome }); } catch {}
  const readback = options.cloud ? (options.readback || cloudReadback(cloud, options.cloudSpawnSync)) : null;

  const stages = [
    copilotStage({ resolved, versionText }),
    otelStage({ env, ledger }),
    collectorStage({ status: collectorStatus, loopback }),
    ledgerStage({ ledger, now: options.now }),
    reportStage({ result: render }),
    azureStage({ cloud, publishCap, outbox, readback })
  ];
  return {
    stages,
    summary: summarizePipeline(stages),
    cloudReadback: Boolean(options.cloud),
    durationMs: Date.now() - started
  };
}

module.exports = {
  LAUNCH_HINT,
  MIN_NATIVE_OTEL_COPILOT,
  azureStage,
  cloudReadback,
  collectorStage,
  compareVersions,
  copilotStage,
  doctorPipeline,
  formatAge,
  ledgerStage,
  otelStage,
  parseVersion,
  readLedger,
  renderPipeline,
  renderSelfTest,
  reportStage,
  summarizePipeline,
  useColor
};
