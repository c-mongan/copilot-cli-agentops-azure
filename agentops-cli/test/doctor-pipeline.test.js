const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pipeline = require('../src/lib/doctor-pipeline');

const READY_COLLECTOR = { binary: { ok: true }, safeLocalhostBinding: true, running: false };

function fixtureDir(name) {
  const dir = path.join(__dirname, `.doctor-fixture-${name}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRun(home, runId, state) {
  const dir = path.join(home, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  if (state) fs.writeFileSync(path.join(dir, 'session-delivery.json'), JSON.stringify(state));
  return dir;
}

test('version helpers compare Copilot versions including pre-release suffixes', () => {
  assert.deepEqual(pipeline.parseVersion('GitHub Copilot CLI 1.0.93-4.'), [1, 0, 93]);
  assert.equal(pipeline.parseVersion('no version here'), null);
  assert.equal(pipeline.compareVersions([1, 0, 92], [1, 0, 93]), -1);
  assert.equal(pipeline.compareVersions([1, 0, 93], [1, 0, 93]), 0);
  assert.equal(pipeline.compareVersions([1, 1, 0], [1, 0, 93]), 1);
  assert.equal(pipeline.formatAge(30 * 1000), 'just now');
  assert.equal(pipeline.formatAge(5 * 60000), '5 min ago');
  assert.equal(pipeline.formatAge(3 * 3600000), '3 h ago');
  assert.equal(pipeline.formatAge(72 * 3600000), '3 days ago');
});

test('copilot stage flags missing CLI, shim-only PATH, old versions and ready versions', () => {
  const missing = pipeline.copilotStage({ resolved: { ok: false, candidates: [] } });
  assert.equal(missing.status, 'fail');
  assert.equal(missing.fix, 'npm install -g @github/copilot');

  const shim = pipeline.copilotStage({ resolved: { ok: false, candidates: ['/x/copilot'] } });
  assert.equal(shim.status, 'fail');
  assert.match(shim.fix, /COPILOT_CLI_BIN/);

  const old = pipeline.copilotStage({ resolved: { ok: true, path: 'copilot' }, versionText: 'GitHub Copilot CLI 1.0.92' });
  assert.equal(old.status, 'warn');
  assert.equal(old.fix, 'copilot update');
  assert.match(old.reason, /1\.0\.92 is older than 1\.0\.93/);

  const unknown = pipeline.copilotStage({ resolved: { ok: true, path: 'copilot' }, versionText: null });
  assert.equal(unknown.status, 'warn');

  const ready = pipeline.copilotStage({ resolved: { ok: true, path: 'copilot' }, versionText: 'GitHub Copilot CLI 1.0.93-4.' });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.version, '1.0.93');
  assert.equal(ready.fix, null);
});

test('otel stage fails when content capture is enabled and warns when no spans were observed', () => {
  const genai = pipeline.otelStage({ env: { OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true' } });
  assert.equal(genai.status, 'fail');
  assert.equal(genai.fix, 'unset OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT');

  const onlyRequest = pipeline.otelStage({ env: { AGENTOPS_CAPTURE_CONTENT: 'true' } });
  assert.equal(onlyRequest.status, 'ready', 'capture request without the explicit allow flag stays off');

  const both = pipeline.otelStage({ env: { AGENTOPS_CAPTURE_CONTENT: '1', AGENTOPS_ALLOW_CONTENT_CAPTURE: 'yes' } });
  assert.equal(both.status, 'fail');
  assert.match(both.fix, /AGENTOPS_ALLOW_CONTENT_CAPTURE/);

  assert.equal(pipeline.otelStage({ env: {} }).status, 'ready');
  const observed = pipeline.otelStage({ env: {}, ledger: { latest: { spans: 12 } } });
  assert.equal(observed.status, 'ready');
  assert.match(observed.reason, /12 native spans/);
  const silent = pipeline.otelStage({ env: {}, ledger: { latest: { spans: 0 } } });
  assert.equal(silent.status, 'warn');
  assert.match(silent.fix, /copilot update/);
});

test('collector stage checks binary, loopback binding and loopback port', () => {
  assert.equal(pipeline.collectorStage({ status: null }).status, 'fail');
  const noBinary = pipeline.collectorStage({ status: { binary: { ok: false }, safeLocalhostBinding: true } });
  assert.equal(noBinary.status, 'fail');
  assert.equal(noBinary.fix, 'agentops collector install-binary');
  assert.equal(pipeline.collectorStage({ status: { binary: { ok: true }, safeLocalhostBinding: false } }).status, 'fail');
  const blocked = pipeline.collectorStage({ status: READY_COLLECTOR, loopback: { ok: false, error: 'EPERM' } });
  assert.equal(blocked.status, 'fail');
  assert.match(blocked.reason, /EPERM/);
  const ready = pipeline.collectorStage({ status: READY_COLLECTOR, loopback: { ok: true } });
  assert.equal(ready.status, 'ready');
  assert.match(ready.reason, /private loopback Collector/);
  assert.match(pipeline.collectorStage({ status: { ...READY_COLLECTOR, running: true } }).reason, /shared Collector running/);
});

test('ledger and report stages guide a first run and report the latest run', () => {
  const empty = pipeline.ledgerStage({ ledger: { count: 0, latest: null } });
  assert.equal(empty.status, 'warn');
  assert.equal(empty.fix, pipeline.LAUNCH_HINT);
  assert.equal(pipeline.ledgerStage({ ledger: { error: 'EACCES' } }).status, 'fail');
  const now = Date.parse('2026-10-07T12:00:00Z');
  const ready = pipeline.ledgerStage({ ledger: { count: 3, latest: { runId: 'r1', updatedAt: '2026-10-07T11:50:00Z' } }, now });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.reason, '3 runs · latest 10 min ago');

  assert.equal(pipeline.reportStage({ result: { state: 'no_runs' } }).status, 'warn');
  assert.equal(pipeline.reportStage({ result: { state: 'no_session' } }).status, 'warn');
  const failed = pipeline.reportStage({ result: { state: 'failed', ok: false, sessionId: 's1', runId: 'r1', error: 'boom' } });
  assert.equal(failed.status, 'fail');
  assert.match(failed.fix, /copilot-session view s1 --run-id r1/);
  const rendered = pipeline.reportStage({ result: { state: 'rendered', ok: true, sessionId: 's1', runId: 'r1', events: 4, bytes: 4096, durationMs: 20 } });
  assert.equal(rendered.status, 'ready');
  assert.match(rendered.reason, /4 events, 4 KB/);
});

test('azure stage is optional, skipped when unconfigured and never needs network by default', () => {
  const full = { subscriptionId: 'sub', logsIngestionEndpoint: 'https://example', dcrImmutableId: 'dcr-1', workspaceId: 'ws' };
  const skipped = pipeline.azureStage({ cloud: {} });
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.optional, true);

  const partial = pipeline.azureStage({ cloud: { subscriptionId: 'sub' } });
  assert.equal(partial.status, 'warn');
  assert.match(partial.fix, /--logs-ingestion-endpoint <url> --dcr-immutable-id <id>/);

  const noCap = pipeline.azureStage({ cloud: full, publishCap: 0 });
  assert.equal(noCap.status, 'warn');
  assert.equal(noCap.fix, 'export AGENTOPS_MAX_PUBLISH_BYTES_PER_DAY=1048576');

  const pending = pipeline.azureStage({ cloud: full, publishCap: 1048576, outbox: { pending: 2, accepted: 1 } });
  assert.equal(pending.status, 'warn');
  assert.equal(pending.fix, 'agentops delivery drain --yes');

  const ready = pipeline.azureStage({ cloud: full, publishCap: 1048576, outbox: { pending: 0, accepted: 3 } });
  assert.equal(ready.status, 'ready');
  assert.match(ready.reason, /cap 1024 KB\/day · 3 stream batch\(es\) accepted/);

  const withCloud = pipeline.azureStage({ cloud: full, publishCap: 0, readback: { ok: true, rows: 255 } });
  assert.match(withCloud.reason, /cloud: 255 AgentOps rows in last 24h/);

  const noTables = pipeline.azureStage({ cloud: full, publishCap: 1, readback: { ok: false, reason: 'no_tables', error: 'workspace has no AgentOps tables' } });
  assert.equal(noTables.status, 'warn');
  assert.match(noTables.fix, /--workspace-id/);
  const authFailed = pipeline.azureStage({ cloud: full, publishCap: 1, readback: { ok: false, reason: 'auth', error: 'az CLI is not signed in' } });
  assert.match(authFailed.fix, /az login/);
});

test('cloud readback parses counts and classifies az failures without leaking ids', () => {
  const calls = [];
  const ok = pipeline.cloudReadback({ workspaceId: 'ws' }, (cmd, args) => {
    calls.push([cmd, args]);
    return { status: 0, stdout: '[{"Count": 42}]' };
  });
  assert.deepEqual({ ok: ok.ok, rows: ok.rows }, { ok: true, rows: 42 });
  assert.equal(calls[0][0], 'az');
  assert.ok(calls[0][1].includes('query'));
  assert.match(calls[0][1].at(-3), /AgentOpsEvents_CL, AgentOpsSpans_CL/);

  const noTables = pipeline.cloudReadback({ workspaceId: 'ws' }, () => ({ status: 1, stderr: 'ERROR: (BadArgumentError)\n"code": "SEM0529"' }));
  assert.equal(noTables.reason, 'no_tables');
  const auth = pipeline.cloudReadback({ workspaceId: 'ws' }, () => ({ status: 1, stderr: "Please run 'az login' to setup account." }));
  assert.equal(auth.reason, 'auth');
  const other = pipeline.cloudReadback({ workspaceId: 'ws' }, () => ({ status: 1, stderr: 'ERROR: workspace 0123abcd-0000-4000-8000-123456789abc is gone' }));
  assert.equal(other.error, 'ERROR: workspace <id> is gone');
  const missing = pipeline.cloudReadback({ workspaceId: 'ws' }, () => ({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) }));
  assert.equal(missing.error, 'az CLI not found');
  assert.match(pipeline.cloudReadback({}, () => assert.fail('must not call az')).error, /workspaceId is not configured/);
});

test('summary counts non-skipped stages and picks the most important next fix', () => {
  const stage = (id, status, optional = false) => ({ id, status, optional, fix: `fix-${id}`, reason: id });
  const summary = pipeline.summarizePipeline([
    stage('a', 'ready'), stage('b', 'warn'), stage('c', 'fail'), stage('azure', 'skipped', true)
  ]);
  assert.deepEqual({ ready: summary.ready, total: summary.total, allReady: summary.allReady }, { ready: 1, total: 3, allReady: false });
  assert.equal(summary.next.stage, 'c', 'required failures outrank warnings');

  const optionalOnly = pipeline.summarizePipeline([stage('a', 'ready'), stage('azure', 'warn', true)]);
  assert.equal(optionalOnly.next.stage, 'azure');
  assert.equal(optionalOnly.ready, 1);
  assert.equal(optionalOnly.total, 2);

  const done = pipeline.summarizePipeline([stage('a', 'ready'), stage('azure', 'skipped', true)]);
  assert.equal(done.allReady, true);
  assert.equal(done.next, null);
});

test('renderer uses glyphs plus words, and colour only when asked', () => {
  const stages = [
    { id: 'copilot', title: 'Copilot CLI', status: 'ready', reason: 'v1.0.93', fix: null },
    { id: 'ledger', title: 'Local ledger', status: 'warn', reason: 'no runs yet', fix: pipeline.LAUNCH_HINT },
    { id: 'collector', title: 'Local Collector', status: 'fail', reason: 'binary missing', fix: 'agentops collector install-binary' },
    { id: 'azure', title: 'Azure publishing', status: 'skipped', optional: true, reason: 'optional · not configured', fix: null }
  ];
  const value = { stages, summary: pipeline.summarizePipeline(stages) };
  const plain = pipeline.renderPipeline(value, { color: false });
  assert.doesNotMatch(plain, /\u001b\[/);
  assert.match(plain, /✓ ready +1\. Copilot CLI/);
  assert.match(plain, /! check +2\. Local ledger/);
  assert.match(plain, /✗ broken +3\. Local Collector/);
  assert.match(plain, /– skipped 4\. Azure publishing/);
  assert.match(plain, /fix: agentops collector install-binary/);
  assert.match(plain, /1\/3 ready \(Azure publishing: skipped, optional\) — next: agentops collector install-binary/);
  assert.match(plain, /Details: agentops doctor --verbose/);

  const coloured = pipeline.renderPipeline(value, { color: true, verbose: true });
  assert.match(coloured, /\u001b\[32m✓ ready/);
  assert.match(coloured, /\u001b\[31m✗ broken/);
  assert.doesNotMatch(coloured, /Details: agentops doctor --verbose/);

  const allReady = { stages: [stages[0]], summary: pipeline.summarizePipeline([stages[0]]) };
  assert.match(pipeline.renderPipeline(allReady), /1\/1 ready — all set/);
});

test('useColor respects NO_COLOR, FORCE_COLOR and TTY', () => {
  assert.equal(pipeline.useColor({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(pipeline.useColor({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' }), false);
  assert.equal(pipeline.useColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
  assert.equal(pipeline.useColor({ isTTY: false }, { FORCE_COLOR: '0' }), false);
  assert.equal(pipeline.useColor({ isTTY: true }, {}), true);
  assert.equal(pipeline.useColor({ isTTY: false }, {}), false);
});

test('readLedger orders runs by last update and handles a missing runs directory', () => {
  const home = fixtureDir('ledger');
  try {
    assert.deepEqual(pipeline.readLedger(home), { count: 0, latest: null, runs: [] });
    writeRun(home, 'run_old', { sessionId: 'sess-old', updatedAt: '2026-10-01T00:00:00Z', streams: { spans: { rows: 5 } } });
    writeRun(home, 'run_new', { sessionId: 'sess-new', updatedAt: '2026-10-06T00:00:00Z', streams: { spans: { rows: 9, status: 'not_observed' } } });
    writeRun(home, 'wrapper_run_1', null);
    fs.utimesSync(path.join(home, 'runs', 'wrapper_run_1'), new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));
    fs.mkdirSync(path.join(home, 'runs', '.hidden'));
    const ledger = pipeline.readLedger(home);
    assert.equal(ledger.count, 3);
    assert.equal(ledger.runs.find(run => run.runId === 'run_new').spans, 0);
    assert.equal(ledger.runs.find(run => run.runId === 'run_old').spans, 5);
    assert.equal(ledger.runs.find(run => run.runId === 'wrapper_run_1').sessionId, null);
    assert.deepEqual(ledger.runs.map(run => run.runId), ['run_new', 'run_old', 'wrapper_run_1']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderSelfTest renders the latest session for real and removes its output', () => {
  const root = fixtureDir('render');
  const savedCopilotHome = process.env.COPILOT_HOME;
  delete process.env.COPILOT_HOME;
  try {
    const agentopsHome = path.join(root, 'agentops');
    const homeDir = path.join(root, 'home');
    const sessionId = 'doctor-fixture-session';
    writeRun(agentopsHome, 'run_1', { sessionId, updatedAt: '2026-10-06T00:00:00Z' });
    const ledger = pipeline.readLedger(agentopsHome);

    assert.equal(pipeline.renderSelfTest({ count: 0 }).state, 'no_runs');
    assert.equal(pipeline.renderSelfTest(ledger, { agentopsHome, homeDir }).state, 'no_session');

    const sessionDir = path.join(homeDir, '.copilot', 'session-state', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const events = [
      { type: 'session.start', timestamp: '2026-10-06T00:00:00.000Z', data: {} },
      { type: 'tool.execution_start', timestamp: '2026-10-06T00:00:01.000Z', data: { toolCallId: 'a', toolName: 'bash' } },
      { type: 'tool.execution_complete', timestamp: '2026-10-06T00:00:02.000Z', data: { toolCallId: 'a', success: true } },
      { type: 'session.shutdown', timestamp: '2026-10-06T00:00:03.000Z', data: {} }
    ];
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));

    const result = pipeline.renderSelfTest(ledger, { agentopsHome, homeDir });
    assert.equal(result.state, 'rendered', result.error);
    assert.equal(result.ok, true);
    assert.equal(result.events, 4);
    assert.ok(result.bytes > 1000);
    assert.deepEqual(fs.readdirSync(agentopsHome).filter(name => name.startsWith('.doctor-selftest')), []);
    assert.equal(pipeline.reportStage({ result }).status, 'ready');
  } finally {
    if (savedCopilotHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = savedCopilotHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctorPipeline assembles six stages from injected facts without network', async () => {
  const result = await pipeline.doctorPipeline({
    env: {},
    copilot: { ok: true, path: 'copilot' },
    copilotVersionText: 'GitHub Copilot CLI 1.0.93',
    collectorStatus: READY_COLLECTOR,
    loopback: { ok: true },
    ledger: { count: 0, latest: null, runs: [] },
    renderResult: { state: 'no_runs' },
    cloudValues: {},
    agentopsHome: path.join(__dirname, '.doctor-fixture-missing'),
    cloudSpawnSync: () => assert.fail('no cloud call without --cloud')
  });
  assert.deepEqual(result.stages.map(item => item.id), ['copilot', 'otel', 'collector', 'ledger', 'report', 'azure']);
  assert.deepEqual(result.stages.map(item => item.status), ['ready', 'ready', 'ready', 'warn', 'warn', 'skipped']);
  assert.equal(result.summary.total, 5);
  assert.equal(result.summary.ready, 3);
  assert.equal(result.summary.next.fix, pipeline.LAUNCH_HINT);
  assert.equal(result.cloudReadback, false);

  const withCloud = await pipeline.doctorPipeline({
    env: {},
    copilot: { ok: true, path: 'copilot' },
    copilotVersionText: 'GitHub Copilot CLI 1.0.93',
    collectorStatus: READY_COLLECTOR,
    loopback: { ok: true },
    ledger: { count: 0, latest: null, runs: [] },
    renderResult: { state: 'no_runs' },
    cloudValues: { subscriptionId: 's', logsIngestionEndpoint: 'https://e', dcrImmutableId: 'd', workspaceId: 'w' },
    agentopsHome: path.join(__dirname, '.doctor-fixture-missing'),
    cloud: true,
    cloudSpawnSync: () => ({ status: 0, stdout: '[{"Count": 7}]' })
  });
  assert.match(withCloud.stages[5].reason, /cloud: 7 AgentOps rows/);
});

test('doctor command keeps legacy JSON fields, adds pipeline, and defaults to a no-network checklist', async () => {
  const summaryLib = require('../src/lib/doctor-summary');
  const originalSummary = summaryLib.doctorSummary;
  const originalPipeline = pipeline.doctorPipeline;
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  const summaryCalls = [];
  const pipelineCalls = [];
  const stages = [{ id: 'copilot', title: 'Copilot CLI', status: 'ready', reason: 'v1.0.93', fix: null }];
  summaryLib.doctorSummary = async options => {
    summaryCalls.push(options);
    return { ok: true, checks: [{ name: 'exists:copilot/copilot-observe', ok: true }], collector: READY_COLLECTOR, copilot: { ok: true } };
  };
  pipeline.doctorPipeline = async options => {
    pipelineCalls.push(options);
    return { stages, summary: pipeline.summarizePipeline(stages) };
  };
  const commandPath = require.resolve('../src/lib/doctor-command');
  delete require.cache[commandPath];
  let output = '';
  process.stdout.write = chunk => { output += chunk; return true; };
  try {
    const { doctorCommand } = require('../src/lib/doctor-command');
    await doctorCommand([]);
    const human = output;
    output = '';
    await doctorCommand(['--json']);
    const json = JSON.parse(output);
    output = '';
    await doctorCommand(['--verbose', '--cloud']);
    const verbose = output;
    process.stdout.write = originalWrite;

    assert.equal(summaryCalls[0].localOnly, true, 'default human checklist skips Azure validation');
    assert.equal(pipelineCalls[0].cloud, false);
    assert.match(human, /1\/1 ready — all set/);
    assert.doesNotMatch(human, /exists:copilot/);

    assert.equal(summaryCalls[1].localOnly, false, '--json keeps its historical validation contract');
    assert.equal(json.ok, true);
    assert.equal(json.checks[0].name, 'exists:copilot/copilot-observe');
    assert.equal(json.pipeline.stages[0].id, 'copilot');

    assert.equal(pipelineCalls[2].cloud, true);
    assert.match(verbose, /exists:copilot\/copilot-observe: ok/);
    assert.equal(process.exitCode, 0);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
    summaryLib.doctorSummary = originalSummary;
    pipeline.doctorPipeline = originalPipeline;
    delete require.cache[commandPath];
  }
});
