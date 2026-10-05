const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  copilotSessionCommand,
  launchObservedCopilot,
  parseCopilotSessionArgs,
  renderCopilotSessionEnrichment,
} = require('../src/lib/copilot/session-command');
const { attachCommand, coverageCommand } = require('../src/lib/attach-command');

test('copilot session command library parses args and renders enrichment summary', () => {
  assert.deepEqual(parseCopilotSessionArgs([
    'enrich',
    'session-1',
    '--file',
    'events.jsonl',
    '--output',
    'view.html',
    '--allow-content',
    '--sidecar',
    'sidecar-events.jsonl',
    '--endpoint',
    'http://127.0.0.1:4319',
    '--id',
    'import-1',
    '--otel-file',
    'native.jsonl',
    '--otel-file',
    'script.jsonl',
    '--run-id',
    'run-1',
    '--dry-run',
    '--json'
  ]), {
    subcommand: 'enrich',
    sessionId: 'session-1',
    file: 'events.jsonl',
    output: 'view.html',
    allowContent: true,
    synthetic: false,
    confirm: false,
    sidecarFile: 'sidecar-events.jsonl',
    otelFiles: ['native.jsonl', 'script.jsonl'],
    runId: 'run-1',
    taskId: null,
    repo: null,
    copilotHome: null,
    expectationsFile: null,
    upload: false,
    yes: false,
    help: false,
    endpoint: 'http://127.0.0.1:4319',
    id: 'import-1',
    dryRun: true,
    json: true,
    commandArgs: []
  });
  assert.match(renderCopilotSessionEnrichment({
    session_id: 'session-1',
    source_file: 'events.jsonl',
    enriched_rows: 2,
    dry_run: true,
    ok: true,
    event_counts: { 'agent.selected': 1, 'mcp.tools.call': 1 },
    next: ['agentops open latest']
  }), /- mcp\.tools\.call: 1/);
});

test('copilot-session launch help is read-only and never starts Copilot', async () => {
  let invoked = false;
  let output = '';
  const result = await copilotSessionCommand(['launch', '--help'], {
    stdout: { write(value) { output += value; } },
    startScopedStrictCollector: async () => { invoked = true; throw new Error('must not start'); },
    spawnSync: () => { invoked = true; return { status: 1 }; }
  });
  assert.deepEqual(result, { ok: true, action: 'help' });
  assert.equal(invoked, false);
  assert.match(output, /--upload --yes/);
  assert.match(output, /Evidence stays local/);
});

test('copilot-session launch help works through the executable CLI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-help-home-'));
  try {
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'launch', '--help'
    ], { encoding: 'utf8', env: { ...process.env, COPILOT_HOME: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agentops copilot-session launch/);
    assert.match(result.stdout, /Evidence stays local/);
    assert.doesNotMatch(result.stdout, /Native Copilot observation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('content export labels local restriction and unverified synthetic declaration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-restricted-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventsFile = path.join(root, 'events.jsonl');
  const output = path.join(root, 'AgentOpsContent_CL.jsonl');
  fs.writeFileSync(eventsFile, `${JSON.stringify({
    type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'synthetic question' }
  })}\n`);
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'export-content',
    '--file', eventsFile, '--allow-content', '--synthetic', '--output', output, '--json'
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.privacy_profile, 'restricted_local');
  assert.equal(report.synthetic_provenance, 'user_declared_unverified');
  assert.equal(report.redaction_status, 'best_effort_redacted');
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
});

test('delete-content previews by default, only deletes the exact file with --confirm, and never claims Azure deletion', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delete-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventsFile = path.join(root, 'events.jsonl');
  const output = path.join(root, 'AgentOpsContent_CL.jsonl');
  fs.writeFileSync(eventsFile, `${JSON.stringify({
    type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'synthetic question' }
  })}\n`);
  const exported = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'export-content', 'session-delete-test',
    '--file', eventsFile, '--allow-content', '--synthetic', '--output', output, '--run-id', 'run-delete-test', '--json'
  ], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);

  const preview = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'delete-content', 'session-delete-test',
    '--file', output, '--run-id', 'run-delete-test', '--json'
  ], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.mode, 'preview');
  assert.equal(previewReport.deleted, false);
  assert.equal(previewReport.scope, 'local_only');
  assert.equal(previewReport.azure_deletion_claimed, false);
  assert.ok(fs.existsSync(output), 'preview-by-default must not delete the file');

  const confirmed = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'delete-content', 'session-delete-test',
    '--file', output, '--run-id', 'run-delete-test', '--confirm', '--json'
  ], { encoding: 'utf8' });
  assert.equal(confirmed.status, 0, confirmed.stderr);
  const confirmedReport = JSON.parse(confirmed.stdout);
  assert.equal(confirmedReport.mode, 'confirmed');
  assert.equal(confirmedReport.deleted, true);
  assert.equal(confirmedReport.azure_deletion_claimed, false);
  assert.ok(!fs.existsSync(output), 'confirmed deletion must remove the exact selected file');
});

test('delete-content refuses deletion when the file is not exclusive to the selected session/run', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delete-content-mismatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventsFile = path.join(root, 'events.jsonl');
  const output = path.join(root, 'AgentOpsContent_CL.jsonl');
  fs.writeFileSync(eventsFile, `${JSON.stringify({
    type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'synthetic question' }
  })}\n`);
  const exported = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'export-content', 'session-a',
    '--file', eventsFile, '--allow-content', '--synthetic', '--output', output, '--run-id', 'run-a', '--json'
  ], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);

  const mismatched = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'delete-content', 'session-b',
    '--file', output, '--run-id', 'run-a', '--confirm', '--json'
  ], { encoding: 'utf8' });
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /not exclusive/);
  assert.ok(fs.existsSync(output), 'a mismatched run/session must never be deleted');
});

test('native Copilot launch scopes strict OTel to the real CLI process and keeps Azure upload explicit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-launch-'));
  const copilotHome = path.join(root, 'copilot-home');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const parentEnv = { PATH: process.env.PATH, COPILOT_OTEL_CAPTURE_CONTENT: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://untrusted.example/otlp' };
  let launch = null;
  let stopped = false;
  const previousExitCode = process.exitCode;
  try {
    const result = await launchObservedCopilot({
      repo,
      copilotHome,
      commandArgs: ['--agent', 'reviewer', '-p', 'synthetic test'],
      upload: false,
      json: true
    }, {
      env: parentEnv,
      startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/private/receipt.jsonl', stop: async () => { stopped = true; } }),
      resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
      snapshotCopilotSessions: () => new Map(),
      changedCopilotSession: () => ({ sessionId: 'native-launch-session' }),
      spawnSync: (command, args, options) => {
        launch = { command, args, options };
        return { status: 0, signal: null };
      },
      deliverCopilotSession: options => {
        assert.deepEqual(options.otelFiles, ['/private/receipt.jsonl']);
        assert.match(options.executionConfiguration.configurationVersion, /^[a-f0-9]{16}$/);
        assert.equal(options.executionConfiguration.source, 'observed_launch_arguments');
        assert.equal(options.executionConfiguration.completeness, 'partial');
        assert.equal(options.executionConfiguration.scope.skills, 'observed');
        return { state: 'local_pending', sessionId: options.summary.sessionId, runId: options.runId, events: 3, spans: 2, outputDir: '/private/agentops/runs/test' };
      },
      agentopsHome: '/private/agentops'
    });
    assert.equal(result.exitCode, 0);
    assert.equal(launch.command, '/usr/local/bin/copilot');
    assert.deepEqual(launch.args.slice(0, 4), ['--agent', 'reviewer', '-p', 'synthetic test']);
    assert.equal(launch.args[4], '--session-id');
    assert.match(launch.args[5], /^[a-f0-9-]{36}$/);
    assert.equal(launch.options.env.COPILOT_OTEL_ENABLED, 'true');
    assert.equal(launch.options.env.COPILOT_OTEL_CAPTURE_CONTENT, 'false');
    assert.equal(launch.options.env.AGENTOPS_PRIVACY_MODE, 'strict');
    assert.equal(launch.options.env.AGENTOPS_RUN_ID, result.runId);
    assert.equal(launch.options.env.COPILOT_HOME, copilotHome);
    assert.equal(launch.options.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:14320');
    assert.equal(launch.options.env.AGENTOPS_SCRIPT_OTLP_ENDPOINT, 'http://127.0.0.1:14320/v1/traces');
    assert.equal(stopped, true);
    assert.equal(launch.options.env.NODE_OPTIONS, undefined);
    assert.equal(parentEnv.COPILOT_OTEL_ENABLED, undefined);
    assert.equal(parentEnv.COPILOT_OTEL_CAPTURE_CONTENT, 'true');
  } finally {
    process.exitCode = previousExitCode;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copilot-session view joins payload-free per-stream delivery state by run and session IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-view-delivery-'));
  const sessionId = 'session-view-delivery-fixture';
  const runId = 'run_view_delivery_fixture';
  const eventsFile = path.join(root, 'copilot', 'session-state', sessionId, 'events.jsonl');
  const runDir = path.join(root, '.agentops', 'runs', runId);
  const output = path.join(root, 'waterfall.html');
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(eventsFile, `${JSON.stringify({ type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: { sessionId } })}\n`);
  fs.writeFileSync(path.join(runDir, 'session-delivery.json'), `${JSON.stringify({
    version: 1,
    runId,
    sessionId,
    target: { subscriptionId: 'do-not-render-subscription', logsIngestionEndpoint: 'https://do-not-render.example', dcrImmutableId: 'do-not-render-dcr' },
    streams: {
      events: { file: 'AgentOpsEvents_CL.jsonl', rows: 5, status: 'azure_accepted', attempts: 1 },
      spans: { file: 'AgentOpsSpans_CL.jsonl', rows: 3, status: 'azure_accepted', attempts: 1 }
    },
    updatedAt: '2026-01-01T00:00:01.000Z'
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'AgentOpsSpans_CL.jsonl'), [
    {
      TimeGenerated: '2026-01-01T00:00:02.000Z', RunId: runId, SessionId: sessionId,
      TraceId: 'trace-native', SpanId: 'span-native', ParentSpanId: '',
      SpanName: 'agentops.span', OperationName: 'execute_tool', AgentName: 'fixture-agent',
      ToolName: 'bash', ToolCallId: 'tool-call-1', ToolCallEvidence: 'exact-session-tool-call-id',
      DurationNs: 50000000, Outcome: 'ok', LinkType: 'native-session'
    },
    {
      TimeGenerated: '2026-01-01T00:00:03.000Z', RunId: runId, SessionId: sessionId,
      TraceId: 'trace-script', SpanId: 'span-script', ParentSpanId: '',
      SpanName: 'agentops.script', OperationName: 'script.execute', AgentName: 'fixture-agent',
      ScriptName: 'scripts/probe.py', ToolCallId: 'tool-call-2',
      ToolCallEvidence: 'inferred-unique-session-tool-event-window', DurationNs: 1000000,
      Outcome: 'ok', LinkType: 'run-id-logical-link'
    },
    {
      TimeGenerated: '2026-01-01T00:00:02.050Z', RunId: runId, SessionId: sessionId,
      TraceId: 'trace-native', SpanId: 'span-native', ParentSpanId: 'span-native',
      SpanName: 'github.copilot.skill.invoked', OperationName: 'github.copilot.skill.invoked',
      SkillName: 'fixture-skill', DurationNs: 0, Outcome: 'ok', LinkType: 'span-event'
    }
  ].map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'view', '--file', eventsFile,
      '--allow-content', '--run-id', runId, '--output', output, '--json'
    ], {
      encoding: 'utf8',
      env: { ...process.env, AGENTOPS_HOME: path.join(root, '.agentops'), COPILOT_HOME: path.join(root, 'copilot') }
    });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.native_spans, 1);
    assert.equal(summary.run_linked_script_spans, 1);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /execute_tool: bash/);
    assert.match(html, /script: scripts\/probe\.py/);
    assert.match(html, /inferred-unique-session-tool-event-window/);
    assert.match(html, /fixture-skill/);
    assert.match(html, /Azure accepted · readback unverified/);
    assert.match(html, /5 rows · 1 attempts/);
    assert.match(html, /3 rows · 1 attempts/);
    assert.doesNotMatch(html, /do-not-render-subscription|do-not-render\.example|do-not-render-dcr/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copilot-session view defaults to metadata-only HTML', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-view-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventsFile = path.join(root, 'events.jsonl');
  const output = path.join(root, 'view.html');
  fs.writeFileSync(eventsFile, [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'PROMPT_CANARY' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', data: { toolCallId: 'call-1', toolName: 'bash', arguments: { command: 'ARGUMENT_CANARY' } } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02Z', data: { toolCallId: 'call-1', success: false, result: 'RESULT_CANARY' } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'view',
    '--file', eventsFile, '--output', output, '--json'
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /Metadata only/);
  assert.match(html, /Failure detail/);
  assert.doesNotMatch(html, /PROMPT_CANARY|ARGUMENT_CANARY|RESULT_CANARY/);
});

test('native Copilot launch fails before invocation if its strict per-run Collector cannot start', async () => {
  let launched = false;
  await assert.rejects(launchObservedCopilot({}, {
    resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
    startScopedStrictCollector: async () => { throw new Error('strict collector unavailable'); },
    spawnSync: () => { launched = true; return { status: 0 }; }
  }), /strict collector unavailable/);
  assert.equal(launched, false);
});

test('native launcher rejects inherited trace endpoint and TLS settings without exposing values', async () => {
  let collectorStarted = false;
  const secret = 'SECRET_ENDPOINT_VALUE';
  await assert.rejects(launchObservedCopilot({ upload: false }, {
    env: {
      PATH: process.env.PATH,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `https://${secret}.example/v1/traces`,
      OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE: `/private/${secret}.pem`
    },
    resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
    startScopedStrictCollector: async () => { collectorStarted = true; throw new Error('must not start'); }
  }), error => {
    assert.match(error.message, /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT/);
    assert.match(error.message, /OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE/);
    assert.doesNotMatch(error.message, /SECRET_ENDPOINT_VALUE/);
    return true;
  });
  assert.equal(collectorStarted, false);
});

test('native Copilot launch requires explicit confirmation before Azure upload', async () => {
  let collectorChecked = false;
  await assert.rejects(launchObservedCopilot({ upload: true, yes: false }, {
    collector: { status: async () => { collectorChecked = true; return {}; } }
  }), /--upload requires --yes/);
  assert.equal(collectorChecked, false);
});

test('native launch reports requested upload failure even when Copilot exits zero', async () => {
  const previousExitCode = process.exitCode;
  try {
    const result = await launchObservedCopilot({
      upload: true, yes: true, commandArgs: ['--version'], json: true
    }, {
      env: {
        PATH: process.env.PATH,
        AGENTOPS_AZURE_SUBSCRIPTION_ID: 'synthetic-subscription',
        AGENTOPS_LOGS_INGESTION_ENDPOINT: 'https://synthetic.ingest.monitor.azure.com',
        AGENTOPS_DCR_IMMUTABLE_ID: 'dcr-synthetic'
      },
      resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
      startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/private/receipt.jsonl', stop: async () => {} }),
      snapshotCopilotSessions: () => new Map(),
      changedCopilotSession: () => ({ sessionId: 'pending-session' }),
      spawnSync: () => ({ status: 0, signal: null }),
      deliverCopilotSession: () => ({ state: 'local_pending', events: 1, spans: 0, reason: 'collector offline' })
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, false);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('native Copilot upload scopes project subscription approval to post-run delivery only', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-launch-project-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'agentops');
  fs.mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  const { writeAgentOpsConfig } = require('../src/lib/agentops-config');
  writeAgentOpsConfig({ subscriptionId: 'synthetic-project-subscription', logsIngestionEndpoint: 'https://synthetic-project.ingest.monitor.azure.com', dcrImmutableId: 'dcr-synthetic-project' }, { scope: 'project', cwd: repo, agentOpsHome: home });
  const parentEnv = { PATH: process.env.PATH };
  let deliveryEnv;
  try {
    await launchObservedCopilot({ repo, copilotHome: path.join(root, 'copilot'), commandArgs: ['--version'], upload: true, yes: true, json: true }, {
      env: parentEnv,
      agentopsHome: home,
      startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/private/receipt.jsonl', stop: async () => {} }),
      resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
      snapshotCopilotSessions: () => new Map(),
      changedCopilotSession: () => ({ sessionId: 'project-upload-session' }),
      spawnSync: () => ({ status: 0, signal: null }),
      deliverCopilotSession: options => { deliveryEnv = options.env; return { state: 'azure_acknowledged', events: 1, spans: 1 }; }
    });
    assert.equal(deliveryEnv.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS, 'synthetic-project-subscription');
    assert.equal(parentEnv.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native Copilot upload fails closed when the selected repository has no project Azure target', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-launch-unbound-project-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  let collectorStarted = false;
  let copilotStarted = false;
  try {
    await assert.rejects(launchObservedCopilot({
      repo,
      copilotHome: path.join(root, 'copilot'),
      commandArgs: ['--version'],
      upload: true,
      yes: true
    }, {
      env: { PATH: process.env.PATH },
      agentopsHome: path.join(root, 'agentops'),
      resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
      startScopedStrictCollector: async () => {
        collectorStarted = true;
        return { endpoint: 'http://127.0.0.1:14320', receiptPath: '/private/receipt.jsonl', stop: async () => {} };
      },
      spawnSync: () => {
        copilotStarted = true;
        return { status: 0, signal: null };
      }
    }), /requires a project-scoped Azure target/);
    assert.equal(collectorStarted, false);
    assert.equal(copilotStarted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native Copilot upload accepts a complete one-shot Azure target from explicit environment values', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-launch-explicit-target-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  const env = {
    PATH: process.env.PATH,
    AGENTOPS_AZURE_SUBSCRIPTION_ID: 'synthetic-explicit-subscription',
    AGENTOPS_LOGS_INGESTION_ENDPOINT: 'https://synthetic-explicit.ingest.monitor.azure.com',
    AGENTOPS_DCR_IMMUTABLE_ID: 'dcr-synthetic-explicit'
  };
  let deliveryEnv;
  try {
    await launchObservedCopilot({ repo, copilotHome: path.join(root, 'copilot'), commandArgs: ['--version'], upload: true, yes: true }, {
      env,
      agentopsHome: path.join(root, 'agentops'),
      startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/private/receipt.jsonl', stop: async () => {} }),
      resolveCopilotBinary: () => ({ ok: true, path: '/usr/local/bin/copilot' }),
      snapshotCopilotSessions: () => new Map(),
      changedCopilotSession: () => ({ sessionId: 'explicit-target-session' }),
      spawnSync: () => ({ status: 0, signal: null }),
      deliverCopilotSession: options => { deliveryEnv = options.env; return { state: 'azure_acknowledged', events: 1, spans: 1 }; }
    });
    assert.equal(deliveryEnv.AGENTOPS_AZURE_SUBSCRIPTION_ID, 'synthetic-explicit-subscription');
    assert.equal(deliveryEnv.AGENTOPS_LOGS_INGESTION_ENDPOINT, 'https://synthetic-explicit.ingest.monitor.azure.com');
    assert.equal(deliveryEnv.AGENTOPS_DCR_IMMUTABLE_ID, 'dcr-synthetic-explicit');
    assert.equal(deliveryEnv.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS, 'synthetic-explicit-subscription');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copilot-session collect packages a native process locally and requires explicit Azure confirmation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-collect-'));
  try {
    const repo = path.join(root, 'repo');
    const copilotHome = path.join(root, 'copilot-home');
    const agentopsHome = path.join(root, 'agentops-home');
    const sessionId = 'native-session-collect-test';
    const runId = 'native_run_collect_test';
    const sessionDirectory = path.join(copilotHome, 'session-state', sessionId);
    const skill = path.join(repo, '.github', 'skills', 'sample');
    fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.github', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), '');
    spawnSync('git', ['init', '-q', repo]);
    fs.writeFileSync(path.join(repo, '.github', 'agents', 'reviewer.agent.md'), 'synthetic agent');
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'synthetic skill');
    fs.writeFileSync(path.join(skill, 'references', 'guide.md'), 'synthetic reference');
    fs.writeFileSync(path.join(skill, 'scripts', 'check.py'), 'print("synthetic")\n');
    attachCommand(['--repo', repo, '--yes', '--json'], { stdout: { write() {} } });
    fs.mkdirSync(sessionDirectory, { recursive: true });
    const events = [
      { type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: { sessionId } },
      { type: 'subagent.selected', timestamp: '2026-01-01T00:00:00.500Z', data: { agentName: 'reviewer' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', data: { name: 'sample' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', data: { toolName: 'bash', toolCallId: 'call-guide', arguments: { command: 'cat -- .github/skills/sample/references/guide.md' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.100Z', data: { toolCallId: 'call-guide', success: true, shellExecution: { exitCode: 0 } } },
      { type: 'session.shutdown', timestamp: '2026-01-01T00:00:03.000Z', data: {} }
    ];
    fs.writeFileSync(path.join(sessionDirectory, 'events.jsonl'), `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
    const env = { ...process.env, COPILOT_HOME: copilotHome, AGENTOPS_HOME: agentopsHome };
    const entry = path.resolve(__dirname, '../src/index.js');

    const denied = spawnSync(process.execPath, [entry, 'copilot-session', 'collect', sessionId, '--run-id', runId, '--repo', repo, '--upload', '--json'], {
      cwd: repo, env, encoding: 'utf8'
    });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /--upload requires --yes/);
    assert.equal(fs.existsSync(path.join(agentopsHome, 'runs', runId)), false);

    const collected = spawnSync(process.execPath, [entry, 'copilot-session', 'collect', sessionId, '--run-id', runId, '--repo', repo, '--json'], {
      cwd: repo, env, encoding: 'utf8'
    });
    assert.equal(collected.status, 0, collected.stderr);
    const summary = JSON.parse(collected.stdout);
    assert.equal(summary.state, 'local_pending');
    assert.equal(summary.events, events.length);
    assert.equal(summary.spans, 0);
    const eventFile = path.join(summary.outputDir, 'AgentOpsEvents_CL.jsonl');
    const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.find(row => row.ReferenceName)?.ReferenceName, '.github/skills/sample/references/guide.md');
    assert.doesNotMatch(fs.readFileSync(eventFile, 'utf8'), /cat --|synthetic reference/);
    const coverage = coverageCommand(['--repo', repo, '--json'], { agentopsHome, stdout: { write() {} } });
    // Manual post-run collection cannot bind a later inventory to this run.
    assert.equal(coverage.runtime.associatedRuns, 0);
    assert.equal(coverage.runtime.categories.agents.observed, 0);
    assert.equal(coverage.runtime.categories.skills.observed, 0);
    assert.equal(coverage.runtime.categories.referenceFiles.observed, 0);
    const context = JSON.parse(fs.readFileSync(path.join(summary.outputDir, 'run-context.json'), 'utf8'));
    assert.equal(context.preRunSnapshot, null);
    assert.equal(context.attachmentProvenance.status, 'not-captured');
    assert.equal(coverage.runtime.categories.scriptFiles.observed, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copilot-session export-events command writes metadata rows from the native session file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-command-'));
  try {
    const sessionId = 'session-command-test';
    const copilotHome = path.join(root, '.copilot');
    const stateDir = path.join(copilotHome, 'session-state', sessionId);
    const outputDir = path.join(root, 'out');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agentops', 'attachment.json'), JSON.stringify({ architecture: { skills: [] } }));
    fs.writeFileSync(path.join(stateDir, 'events.jsonl'), `${JSON.stringify({
      type: 'skill.invoked', timestamp: '2026-01-01T00:00:00Z', data: { name: 'synthetic-skill' }
    })}\n`);

    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'export-events', sessionId,
      '--run-id', 'run-session-command-test', '--output', outputDir, '--json'
    ], { cwd: root, env: { ...process.env, COPILOT_HOME: copilotHome }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.rows, 1);
    const rows = fs.readFileSync(summary.output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].EventName, 'skill.invoked');
    assert.equal(rows[0].SkillName, 'synthetic-skill');
    assert.equal(rows[0].RunId, 'run-session-command-test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copilot-session export-events derives the session ID when --file is used without a positional ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-file-only-'));
  try {
    const sessionId = 'session-file-only-test';
    const eventDir = path.join(root, sessionId);
    const eventFile = path.join(eventDir, 'events.jsonl');
    const outputDir = path.join(root, 'out');
    fs.mkdirSync(eventDir, { recursive: true });
    fs.writeFileSync(eventFile, `${JSON.stringify({
      type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00Z',
      data: { toolName: 'fixture-lookup_item', mcpServerName: 'fixture', mcpToolName: 'lookup_item', toolCallId: 'call-file-only' }
    })}\n`);

    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '../src/index.js'), 'copilot-session', 'export-events',
      '--file', eventFile, '--run-id', 'run-session-file-only-test', '--output', outputDir, '--json'
    ], { cwd: root, env: process.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    const rows = fs.readFileSync(summary.output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(summary.session_id, sessionId);
    assert.equal(rows[0].SessionId, sessionId);
    assert.equal(rows[0].McpServerName, 'fixture');
    assert.equal(rows[0].McpToolName, 'lookup_item');
    assert.equal(rows[0].ToolCallId, 'call-file-only');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, supervised] of [['collector death', { status: 0, collectorFailed: true, cancelled: true }], ['cooperative cancellation', { status: 0, collectorFailed: false, cancelled: true }]]) {
  test(`native launch reports ${label} as unsuccessful despite zero child exit`, async () => {
    const previousExitCode = process.exitCode;
    let lifecycle;
    try {
      const result = await launchObservedCopilot({ commandArgs: ['--version'], json: true }, {
        env: { PATH: process.env.PATH },
        resolveCopilotBinary: () => ({ ok: true, path: '/synthetic/copilot' }),
        startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/synthetic/receipt', stop: async () => {} }),
        snapshotCopilotSessions: () => new Map(), changedCopilotSession: () => ({ sessionId: 'synthetic-session' }),
        superviseProcess: async () => supervised,
        deliverCopilotSession: options => { lifecycle = options.lifecycle; return { state: 'local_pending', events: 1, spans: 0 }; }
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 0);
      assert.equal(process.exitCode, 1);
      assert.equal(lifecycle.process, 'cancelled');
      assert.equal(lifecycle.collector, supervised.collectorFailed ? 'failed' : 'completed');
    } finally { process.exitCode = previousExitCode; }
  });
}

test('native launch preserves resume/connect and explicit session arguments', async () => {
  const previousExitCode = process.exitCode;
  try {
    for (const commandArgs of [['--resume','existing-id'], ['-r','existing-id'], ['--continue'], ['--connect=existing-id'], ['--session-id','existing-id'], ['--session-id=existing-id']]) {
      let actualArgs;
      await launchObservedCopilot({ commandArgs, json: true }, {
        env: { PATH: process.env.PATH },
        resolveCopilotBinary: () => ({ ok: true, path: '/synthetic/copilot' }),
        startScopedStrictCollector: async () => ({ endpoint: 'http://127.0.0.1:14320', receiptPath: '/synthetic/receipt', stop: async () => {} }),
        snapshotCopilotSessions: () => new Map(), changedCopilotSession: () => null,
        superviseProcess: async (command, args) => { actualArgs=args; return { status:0 }; }
      });
      assert.deepEqual(actualArgs, commandArgs);
    }
  } finally { process.exitCode = previousExitCode; }
});

test('launch expectations parse separately from forwarded Copilot arguments', () => {
  const parsed = parseCopilotSessionArgs(['launch', '--expectations', 'manifest.json', '--', '-p', 'synthetic']);
  assert.equal(parsed.expectationsFile, 'manifest.json');
  assert.deepEqual(parsed.commandArgs, ['-p', 'synthetic']);
});
test('startup OS signal aborts readiness without launching and removes signal listeners', async () => {
  const { EventEmitter } = require('node:events');
  const signals = new EventEmitter();
  let launched = false, receivedSignal;
  await assert.rejects(launchObservedCopilot({ commandArgs: ['--version'] }, {
    signals, env: {}, resolveCopilotBinary: () => ({ ok: true, path: '/synthetic/copilot' }),
    startScopedStrictCollector: async options => {
      receivedSignal = options.abortSignal;
      assert.equal(signals.listenerCount('SIGINT'), 1);
      signals.emit('SIGINT');
      assert.equal(options.abortSignal.aborted, true);
      const error = new Error('aborted readiness'); error.name = 'AbortError'; throw error;
    },
    spawnSync: () => { launched = true; return { status: 0 }; }
  }), { name: 'AbortError' });
  assert.equal(receivedSignal.aborted, true);
  assert.equal(launched, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
test('cancelled startup cleans a collector returned after cancellation without spawning', async () => {
  const { EventEmitter } = require('node:events');
  const signals = new EventEmitter(); let stopped = 0, launched = false;
  await assert.rejects(launchObservedCopilot({ commandArgs: ['--version'] }, {
    signals, env: {}, resolveCopilotBinary: () => ({ ok: true, path: '/synthetic/copilot' }),
    startScopedStrictCollector: async () => { signals.emit('SIGTERM'); return { stop: async () => { stopped++; } }; },
    spawnSync: () => { launched = true; return { status: 0 }; }
  }), { name: 'AbortError' });
  assert.equal(stopped, 1);
  assert.equal(launched, false);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
