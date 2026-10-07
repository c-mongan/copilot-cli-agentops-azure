const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  openUrlInBrowser,
  postJson,
  runRealCopilotSmoke,
  verifySmokeInAzure,
  waitForLatestRunSummary
} = require('../src/lib/smoke-runtime');

test('smoke runtime posts JSON and reports collector response', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      received = {
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        body: JSON.parse(body)
      };
      res.writeHead(202, { 'Content-Type': 'text/plain' });
      res.end('accepted');
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const response = await postJson(`http://127.0.0.1:${port}/v1/traces`, { hello: 'agentops' });

    assert.deepEqual(response, { ok: true, statusCode: 202, body: 'accepted' });
    assert.deepEqual(received, {
      method: 'POST',
      url: '/v1/traces',
      contentType: 'application/json',
      body: { hello: 'agentops' }
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('smoke runtime runs real Copilot smoke with strict telemetry env', () => {
  let invocation = null;
  const result = runRealCopilotSmoke({
    cwd: '/tmp/agentops',
    endpoint: 'http://127.0.0.1:4318',
    timeout: '5s',
    spawnSync: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: 'ok', stderr: '' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(invocation.command, 'copilot');
  assert.equal(invocation.options.cwd, '/tmp/agentops');
  assert.equal(invocation.options.timeout, 5000);
  assert.equal(invocation.options.env.AGENTOPS_PRIVACY_MODE, 'strict');
  assert.equal(invocation.options.env.AGENTOPS_CAPTURE_CONTENT, 'false');
  assert.equal(invocation.options.env.COPILOT_OTEL_ENABLED, 'true');
  assert.equal(invocation.options.env.COPILOT_OTEL_EXPORTER_TYPE, 'otlp-http');
  assert.equal(invocation.options.env.COPILOT_OTEL_SOURCE_NAME, 'github.copilot');
  assert.equal(invocation.options.env.COPILOT_OTEL_CAPTURE_CONTENT, 'false');
  assert.equal(invocation.options.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:4318');
  assert.equal(invocation.options.env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/protobuf');
  assert.equal(invocation.options.env.OTEL_SERVICE_NAME, 'github-copilot');
  assert.match(invocation.options.env.OTEL_RESOURCE_ATTRIBUTES, /agentops\.profile=native-smoke/);
});

test('smoke runtime opens URLs through injected browser opener', () => {
  const opened = openUrlInBrowser('https://grafana.example/d/run', {
    openUrl: url => ({ ok: true, url, source: 'test' })
  });

  assert.deepEqual(opened, { ok: true, url: 'https://grafana.example/d/run', source: 'test' });
  assert.deepEqual(openUrlInBrowser(''), { ok: false, reason: 'missing-url' });
});

test('smoke runtime polls latest run summary until visible', async () => {
  let calls = 0;
  const result = await waitForLatestRunSummary({
    last: '30m',
    waitMs: 1000,
    pollMs: 1,
    sleep: async () => {},
    latestSummary: ({ last }) => {
      calls += 1;
      return calls === 1
        ? { session: null }
        : { session: { id: 'session-123', grafana_url: `https://grafana.example/${last}` } };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'found');
  assert.equal(result.summary.session.id, 'session-123');
  assert.equal(result.attempts.length, 2);
});

test('smoke runtime verifies smoke rows through injected Azure query', async () => {
  const result = await verifySmokeInAzure('agentops-smoke-test', {
    last: '15m',
    waitMs: 0,
    workspaceId: 'workspace-123',
    runAzureLogAnalyticsQuery: (query, options) => ({
      ok: true,
      rows: [{ Rows: 1 }],
      query,
      workspaceId: options.workspaceId
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'found');
  assert.equal(result.workspace_id, 'workspace-123');
  assert.equal(result.rows, 1);
  assert.match(result.query, /agentops-smoke-test/);
  assert.match(result.query, /ago\(15m\)/);
});

test('smoke runtime defaults to a five minute cloud wait when no wait is given', async () => {
  const sleeps = [];
  let calls = 0;
  const result = await verifySmokeInAzure('agentops-smoke-default-wait', {
    pollMs: 3_600_000,
    workspaceId: 'workspace-123',
    sleep: async ms => { sleeps.push(ms); },
    runAzureLogAnalyticsQuery: () => ({ ok: true, rows: calls++ ? [{ Rows: 1 }] : [] })
  });

  assert.equal(result.status, 'found');
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] > 60_000 && sleeps[0] <= 300_000, `first sleep ${sleeps[0]}`);
});
