const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  healthCheck,
  logFile,
  otlpAttributes,
  pidFile,
  processAlive
} = require('../src/lib/collector-runtime');
const {
  collectorHealthUrl,
  collectorHealthUrlWithSlash,
  otlpHttpEndpoint
} = require('../src/lib/collector-endpoints');

test('collector runtime helpers expose local process and OTLP primitives', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(204);
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const health = await healthCheck(`http://127.0.0.1:${port}`, 500);
    const attrs = otlpAttributes({
      'content.capture.enabled': false,
      'agentops.retry_count': 2,
      'agentops.score': 98.5,
      'service.name': 'agentops-test'
    });

    assert.equal(health.ok, true);
    assert.equal(health.statusCode, 204);
    assert.equal(processAlive(process.pid), true);
    assert.match(pidFile(), /otelcol\.pid$/);
    assert.match(logFile(), /otelcol\.log$/);
    assert.equal(path.basename(pidFile()), 'otelcol.pid');
    assert.deepEqual(attrs, [
      { key: 'content.capture.enabled', value: { boolValue: false } },
      { key: 'agentops.retry_count', value: { intValue: '2' } },
      { key: 'agentops.score', value: { doubleValue: 98.5 } },
      { key: 'service.name', value: { stringValue: 'agentops-test' } }
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('collector endpoint helpers own localhost defaults', () => {
  assert.equal(otlpHttpEndpoint, 'http://127.0.0.1:4318');
  assert.equal(collectorHealthUrl, 'http://127.0.0.1:13133');
  assert.equal(collectorHealthUrlWithSlash, 'http://127.0.0.1:13133/');

  for (const file of [
    'collector-runtime.js',
    'collector-status.js',
    'collector-validation.js',
    'copilot/session-command.js',
    'custom-telemetry.js',
    'otel-setup.js',
    'smoke-runtime.js',
    'smoke.js'
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
    assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1:4318/);
    if (file.startsWith('collector-')) {
      assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1:13133/);
    }
  }
});
