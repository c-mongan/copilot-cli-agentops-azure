const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const collectorBinary = process.env.AGENTOPS_OTELCOL_BIN
  || path.join(os.homedir(), '.agentops', 'collector', 'bin', 'otelcol-contrib');

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

function startCollector(config, env) {
  const child = childProcess.spawn(collectorBinary, ['--config', config], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk; });
  child.stderr.on('data', chunk => { child.output += chunk; });
  return child;
}

async function stopCollector(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('persistent collector queue survives a process crash with an in-flight batch', {
  skip: !fs.existsSync(collectorBinary),
  timeout: 30000
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-persistent-queue-'));
  const queueDir = path.join(temp, 'queue');
  const otlpPort = await freePort();
  const healthPort = await freePort();
  const backendPort = await freePort();
  const config = path.join(temp, 'collector.yaml');
  fs.writeFileSync(config, `receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:${otlpPort}
extensions:
  health_check:
    endpoint: 127.0.0.1:${healthPort}
  file_storage:
    directory: ${queueDir}
    create_directory: true
exporters:
  otlphttp:
    endpoint: http://127.0.0.1:${backendPort}
    sending_queue:
      enabled: true
      storage: file_storage
      queue_size: 10
      num_consumers: 1
    retry_on_failure:
      enabled: true
      initial_interval: 100ms
      max_interval: 1s
      max_elapsed_time: 0s
service:
  extensions: [health_check, file_storage]
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
`);
  const env = {};
  let collector;
  let backend;
  let holdResponse = true;
  const heldResponses = [];
  const received = [];
  try {
    backend = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        if (holdResponse) {
          heldResponses.push(response);
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise(resolve => backend.listen(backendPort, '127.0.0.1', resolve));
    collector = startCollector(config, env);
    const healthy = await waitFor(async () => {
      try { return (await fetch(`http://127.0.0.1:${healthPort}`)).ok; } catch { return false; }
    });
    assert.equal(healthy, true, `collector should become healthy: ${collector.output}`);

    const response = await fetch(`http://127.0.0.1:${otlpPort}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'agentops-restart-test' } }] },
        scopeSpans: [{ spans: [{
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        name: 'agentops.restart.proof',
        kind: 1,
        startTimeUnixNano: '1785780000000000000',
        endTimeUnixNano: '1785780000001000000',
        status: { code: 1 }
      }] }]
      }] })
    });
    assert.equal(response.ok, true);
    const firstAttempt = await waitFor(() => received.length >= 1);
    assert.equal(firstAttempt, true, `backend should receive the first in-flight attempt: ${collector.output}`);
    collector.kill('SIGKILL');
    await new Promise(resolve => collector.once('exit', resolve));
    collector = null;
    assert.equal(fs.existsSync(queueDir), true);
    assert.ok(fs.readdirSync(queueDir).length > 0, 'persistent queue should leave restart state on disk');

    holdResponse = false;
    for (const response of heldResponses) response.destroy();
    collector = startCollector(config, env);

    assert.equal(await waitFor(() => received.length >= 2, 15000), true,
      'queued span should reach the backend after collector restart');
    assert.equal(received[1], received[0], 'restart delivery should replay the same queued OTLP batch');
  } finally {
    await stopCollector(collector);
    if (backend) await new Promise(resolve => backend.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
