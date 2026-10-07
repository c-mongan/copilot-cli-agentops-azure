const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONTENT_ATTRIBUTES,
  SCHEMA_URL,
  SEMCONV_VERSION,
  SPAN_KIND,
  toGenAiSpans,
  toOtlpTraceRequest
} = require('../src/lib/otel/genai-semconv');
const {
  azureMonitorConfig,
  connectionStringFromEnv,
  exportSessionGenAi,
  loadSessionSpans,
  startAzureMonitorCollector,
  tracesUrl
} = require('../src/lib/copilot/session-genai-export');

const FIXTURE = path.join(__dirname, 'fixtures', 'genai-semconv');
const SESSION_ID = '00000000-0000-4000-8000-00000000f1a7';
const RUN_ID = 'native_run_fixture_0000000001';

function fixtureHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-genai-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const runDirectory = path.join(home, 'runs', RUN_ID);
  fs.mkdirSync(runDirectory, { recursive: true });
  const target = path.join(runDirectory, 'AgentOpsSpans_CL.jsonl');
  fs.copyFileSync(path.join(FIXTURE, 'runs', RUN_ID, 'AgentOpsSpans_CL.jsonl'), target);
  fs.chmodSync(target, 0o600);
  return home;
}

function fixtureSpans(t) {
  return loadSessionSpans({ sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixtureHome(t), eventsFile: path.join(FIXTURE, 'missing-events.jsonl') });
}

function flatAttributes(span) {
  return Object.fromEntries(span.attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
}

test('pins exactly one semconv version and schema URL', () => {
  assert.equal(SEMCONV_VERSION, '1.41.0');
  assert.equal(SCHEMA_URL, 'https://opentelemetry.io/schemas/1.41.0');
});

test('golden: real-shaped Copilot CLI 1.0.93 ledger maps to the expected OTLP GenAI request', t => {
  const loaded = fixtureSpans(t);
  assert.equal(loaded.source, 'agentops-run-ledger');
  const mapped = toGenAiSpans(loaded.spans, { sessionId: SESSION_ID, runId: RUN_ID });
  const request = toOtlpTraceRequest(mapped.spans, {}, '0.1.0');
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected-otlp.json'), 'utf8'));
  assert.deepEqual(request, expected);
});

test('maps span names, kinds, tree and token counts per the GenAI conventions', t => {
  const { spans } = toGenAiSpans(fixtureSpans(t).spans, { sessionId: SESSION_ID, runId: RUN_ID });
  const root = spans.find(span => span.attributes['gen_ai.operation.name'] === 'invoke_agent');
  assert.equal(root.name, 'invoke_agent GitHub Copilot CLI');
  assert.equal(root.kind, SPAN_KIND.INTERNAL);
  assert.equal(root.parentSpanId, '');
  assert.equal(root.attributes['gen_ai.usage.input_tokens'], 60177);
  assert.equal(root.attributes['gen_ai.usage.output_tokens'], 525);
  assert.equal(root.attributes['agentops.agent.name_source'], 'default');

  const chats = spans.filter(span => span.attributes['gen_ai.operation.name'] === 'chat');
  assert.equal(chats.length, 2);
  for (const chat of chats) {
    assert.equal(chat.name, 'chat claude-haiku-4.5');
    assert.equal(chat.kind, SPAN_KIND.CLIENT);
    assert.equal(chat.parentSpanId, root.spanId);
    assert.equal(chat.attributes['gen_ai.request.model'], 'claude-haiku-4.5');
    assert.equal(chat.attributes['gen_ai.provider.name'], 'github');
    assert.equal(chat.attributes['gen_ai.system'], 'github');
  }
  assert.equal(chats.reduce((sum, chat) => sum + chat.attributes['gen_ai.usage.input_tokens'], 0), 60177);
  assert.equal(chats.reduce((sum, chat) => sum + chat.attributes['gen_ai.usage.output_tokens'], 0), 525);

  const tools = spans.filter(span => span.attributes['gen_ai.operation.name'] === 'execute_tool');
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.equal(tool.name, 'execute_tool bash');
    assert.equal(tool.kind, SPAN_KIND.INTERNAL);
    assert.match(tool.attributes['gen_ai.tool.call.id'], /^toolu_/);
  }
  const failed = tools.filter(tool => tool.status.code === 2);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].attributes['error.type'], 'denied');
  assert.equal(tools.find(tool => tool.status.code !== 2).attributes['error.type'], undefined);
});

test('privacy: never emits content attributes or unknown keys even when the input carries them', t => {
  const loaded = fixtureSpans(t);
  const poisoned = loaded.spans.map(span => ({
    ...span,
    'gen_ai.input.messages': 'SECRET PROMPT',
    attributes: { 'gen_ai.tool.call.arguments': 'curl https://secret', 'gen_ai.output.messages': 'SECRET' },
    prompt: 'SECRET PROMPT',
    toolArguments: '{"command":"curl https://secret"}',
    result: 'SECRET RESULT'
  }));
  const request = toOtlpTraceRequest(toGenAiSpans(poisoned, { sessionId: SESSION_ID, runId: RUN_ID }).spans);
  const text = JSON.stringify(request);
  assert.doesNotMatch(text, /SECRET|curl https/);
  for (const span of request.resourceSpans[0].scopeSpans[0].spans) {
    for (const key of Object.keys(flatAttributes(span))) {
      assert.ok(!CONTENT_ATTRIBUTES.includes(key), `content attribute ${key} leaked`);
      assert.match(key, /^(gen_ai\.|error\.type$|agentops\.)/, `unexpected attribute ${key}`);
    }
  }
});

test('privacy: rejects unsafe free-text values instead of exporting them', () => {
  const { spans } = toGenAiSpans([{
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), parentSpanId: '', start: 1791369907494, end: 1791369908494,
    operation: 'execute_tool', toolName: 'bash\nrm -rf /; echo "secret"', toolCallId: 'call 1 with spaces is fine', failed: true,
    errorType: 'Error: token=abc\nstack', agent: 'native OTel'
  }], { sessionId: SESSION_ID, runId: RUN_ID });
  assert.equal(spans[0].attributes['gen_ai.tool.name'], 'unknown');
  assert.equal(spans[0].name, 'execute_tool unknown');
  assert.equal(spans[0].attributes['error.type'], '_OTHER');
});

test('dedupes duplicate spans by traceId:spanId and keeps a failure sticky', t => {
  const spans = fixtureSpans(t).spans;
  const tool = spans.find(span => span.operation === 'execute_tool' && !span.failed);
  const duplicate = { ...tool, failed: true, errorType: 'denied' };
  const mapped = toGenAiSpans([...spans, { ...tool }, duplicate], { sessionId: SESSION_ID, runId: RUN_ID });
  assert.equal(mapped.spans.length, 5);
  assert.equal(mapped.stats.duplicates, 2);
  const merged = mapped.spans.find(span => span.spanId === tool.spanId);
  assert.equal(merged.status.code, 2);
  assert.equal(merged.attributes['error.type'], 'denied');
});

test('skips non-GenAI operations and invalid identifiers', () => {
  const base = { start: 1791369907494, end: 1791369908494, parentSpanId: '' };
  const mapped = toGenAiSpans([
    { ...base, traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), operation: 'agentops.script', spanName: 'agentops.script' },
    { ...base, traceId: 'not-hex', spanId: 'c'.repeat(16), operation: 'chat' },
    { ...base, traceId: 'a'.repeat(32), spanId: 'd'.repeat(16), operation: '', spanName: 'invoke_agent' }
  ], { agentName: 'Reviewer' });
  assert.deepEqual({ skipped: mapped.stats.skipped, invalid: mapped.stats.invalid, mapped: mapped.stats.mapped }, { skipped: 1, invalid: 1, mapped: 1 });
  assert.equal(mapped.spans[0].name, 'invoke_agent Reviewer');
  assert.equal(mapped.spans[0].attributes['agentops.agent.name_source'], 'override');
});

test('OTLP request carries the pinned schema URL and int64 values as strings', t => {
  const request = toOtlpTraceRequest(toGenAiSpans(fixtureSpans(t).spans, { sessionId: SESSION_ID, runId: RUN_ID }).spans);
  const resourceSpans = request.resourceSpans[0];
  assert.equal(resourceSpans.schemaUrl, SCHEMA_URL);
  assert.equal(resourceSpans.scopeSpans[0].schemaUrl, SCHEMA_URL);
  const root = resourceSpans.scopeSpans[0].spans.find(span => span.name.startsWith('invoke_agent'));
  assert.deepEqual(root.attributes.find(attribute => attribute.key === 'gen_ai.usage.input_tokens').value, { intValue: '60177' });
  assert.equal(root.parentSpanId, undefined);
  assert.ok(BigInt(root.endTimeUnixNano) - BigInt(root.startTimeUnixNano) === 20629000000n);
});

test('export posts OTLP JSON to a loopback endpoint and never sends content', async t => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const result = await exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixtureHome(t), eventsFile: path.join(FIXTURE, 'missing-events.jsonl'),
    endpoint: 'http://127.0.0.1:4318', fetchImpl
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:4318/v1/traces');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(result.delivery, 'otlp-http');
  assert.deepEqual(result.operations, { invoke_agent: 1, chat: 2, execute_tool: 2 });
  assert.equal(result.failed_tools, 1);
  assert.deepEqual(result.tokens, { invoke_agent_input: 60177, invoke_agent_output: 525, chat_input: 60177, chat_output: 525 });
  for (const key of CONTENT_ATTRIBUTES) assert.ok(!calls[0].init.body.includes(key));
});

test('export surfaces OTLP rejections', async t => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ partialSuccess: { rejectedSpans: 2 } }) });
  await assert.rejects(exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixtureHome(t), eventsFile: path.join(FIXTURE, 'missing-events.jsonl'),
    endpoint: 'http://127.0.0.1:4318', fetchImpl
  }), /rejected 2 span/);
});

test('Azure Monitor path reads the connection string from a named env var only', async t => {
  assert.throws(() => connectionStringFromEnv('InstrumentationKey=abc', {}), /NAME/);
  assert.throws(() => connectionStringFromEnv('APPI_CS', {}), /empty/);
  assert.throws(() => connectionStringFromEnv('APPI_CS', { APPI_CS: 'not-a-connection-string' }), /does not look like/);
  const value = 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/';
  assert.equal(connectionStringFromEnv('APPI_CS', { APPI_CS: value }), value);
  const config = azureMonitorConfig({ receiver: 40001, health: 40002 });
  assert.doesNotMatch(config, /InstrumentationKey/);
  assert.match(config, /connection_string: \$\{env:AGENTOPS_GENAI_EXPORT_CONNECTION_STRING\}/);
  assert.match(config, /endpoint: 127\.0\.0\.1:40001/);
  for (const key of CONTENT_ATTRIBUTES) assert.match(config, new RegExp(`key: ${key.replaceAll('.', '\\.')}\\n\\s+action: delete`));

  let stopped = false;
  const posted = [];
  const result = await exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixtureHome(t), eventsFile: path.join(FIXTURE, 'missing-events.jsonl'),
    connectionStringEnv: 'APPI_CS', flushWaitMs: 0,
    startCollector: async () => ({ endpoint: 'http://127.0.0.1:40001', stop: async () => { stopped = true; return { exportErrors: 0 }; } }),
    fetchImpl: async url => { posted.push(url); return { ok: true, status: 200, text: async () => '' }; }
  });
  assert.equal(result.delivery, 'azure-monitor-via-local-collector');
  assert.deepEqual(posted, ['http://127.0.0.1:40001/v1/traces']);
  assert.equal(stopped, true);
});

test('endpoint validation refuses remote plain http and embedded credentials', () => {
  assert.equal(tracesUrl('https://otlp.example.com/'), 'https://otlp.example.com/v1/traces');
  assert.equal(tracesUrl('http://localhost:4318/v1/traces'), 'http://localhost:4318/v1/traces');
  assert.throws(() => tracesUrl('http://collector.example.com:4318'), /loopback/);
  assert.throws(() => tracesUrl('https://user:pass@otlp.example.com'), /credentials/);
  assert.throws(() => tracesUrl('file:///etc/passwd'), /http/);
});

test('dry-run with --output writes the OTLP request without sending', async t => {
  const home = fixtureHome(t);
  const output = path.join(home, 'otlp.json');
  const result = await exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: home, eventsFile: path.join(FIXTURE, 'missing-events.jsonl'),
    output, dryRun: true, fetchImpl: () => { throw new Error('must not send'); }
  });
  assert.equal(result.delivery, 'dry-run');
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).resourceSpans[0].scopeSpans[0].spans.length, 5);
});

function runCli(args, env = {}) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'index.js'), 'copilot-session', 'export-otel', ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }
  });
}

test('CLI export-otel validates arguments and refuses content opt-in', () => {
  assert.match(runCli([]).stderr, /requires <session-id>/);
  assert.match(runCli([SESSION_ID]).stderr, /requires --run-id/);
  assert.match(runCli([SESSION_ID, '--run-id', RUN_ID, '--allow-content']).stderr, /metadata-only/);
  assert.match(runCli([SESSION_ID, '--run-id', RUN_ID, '--endpoint', 'http://127.0.0.1:4318', '--appinsights-connection-string-env', 'APPI_CS']).stderr, /choose one/);
});

test('CLI export-otel dry-run reports the mapped tree as JSON', t => {
  const home = fixtureHome(t);
  const result = runCli([SESSION_ID, '--run-id', RUN_ID, '--file', path.join(FIXTURE, 'missing-events.jsonl'), '--dry-run', '--json'], { AGENTOPS_HOME: home });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.semconv_version, SEMCONV_VERSION);
  assert.equal(summary.spans, 5);
  assert.equal(summary.failed_tools, 1);
  assert.equal(summary.content_attributes, 'never-set');
  assert.equal(summary.delivery, 'dry-run');
});

test('--output alone writes the OTLP request as a file delivery', async t => {
  const home = fixtureHome(t);
  const output = path.join(home, 'only.json');
  const result = await exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: home, eventsFile: path.join(FIXTURE, 'missing-events.jsonl'), output
  });
  assert.equal(result.delivery, 'file');
  assert.ok(fs.existsSync(output));
});

test('rejects an unsafe --agent-name instead of silently replacing it', async t => {
  await assert.rejects(exportSessionGenAi({
    sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixtureHome(t), agentName: 'bad\nname', dryRun: true
  }), /--agent-name/);
});

test('Azure Monitor Collector start fails cleanly when the binary cannot spawn', async t => {
  const { EventEmitter } = require('node:events');
  const home = fixtureHome(t);
  await assert.rejects(startAzureMonitorCollector({
    agentopsHome: home,
    connectionStringEnv: 'APPI_CS',
    env: { APPI_CS: 'InstrumentationKey=00000000-0000-0000-0000-000000000000' },
    findCollectorBinary: () => ({ ok: true, path: '/nonexistent/otelcol-contrib' }),
    spawn: (binary, args, spawnOptions) => {
      assert.deepEqual(Object.keys(spawnOptions.env).sort(), ['AGENTOPS_GENAI_EXPORT_CONNECTION_STRING', 'HOME', 'PATH']);
      const configText = fs.readFileSync(args[1], 'utf8');
      assert.doesNotMatch(configText, /InstrumentationKey/);
      const child = new EventEmitter();
      child.kill = () => true;
      setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    },
    waitForHealthUrl: async () => { await new Promise(resolve => setImmediate(resolve)); return { ok: true }; }
  }), /did not become healthy/);
  const leftover = fs.readdirSync(path.join(home, 'scoped-collectors'));
  assert.equal(leftover.length, 1, 'failed collector directory is retained for diagnosis');
  assert.doesNotMatch(fs.readFileSync(path.join(home, 'scoped-collectors', leftover[0], 'otelcol.genai-azuremonitor.yaml'), 'utf8'), /InstrumentationKey/);
});

test('Azure Monitor Collector stops and removes its scoped directory after a healthy run', async t => {
  const { EventEmitter } = require('node:events');
  const home = fixtureHome(t);
  const collector = await startAzureMonitorCollector({
    agentopsHome: home,
    connectionStringEnv: 'APPI_CS',
    env: { APPI_CS: 'InstrumentationKey=00000000-0000-0000-0000-000000000000' },
    findCollectorBinary: () => ({ ok: true, path: '/fake/otelcol-contrib' }),
    spawn: () => { const child = new EventEmitter(); child.kill = () => true; return child; },
    waitForHealthUrl: async () => ({ ok: true })
  });
  assert.match(collector.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  const stopped = await collector.stop();
  assert.equal(stopped.exportErrors, 0);
  assert.deepEqual(fs.readdirSync(path.join(home, 'scoped-collectors')), []);
});
