const assert = require('node:assert/strict');
const test = require('node:test');

const { scopedConfig } = require('../src/lib/copilot/scoped-collector');

test('per-run Collector config binds every receiver and telemetry listener to unique loopback ports', () => {
  const template = [
    'receivers:',
    '  otlp:',
    '    protocols:',
    '      http:',
    '        endpoint: 127.0.0.1:4318',
    '      grpc:',
    '        endpoint: 127.0.0.1:4317',
    '  otlp/receipt:',
    '    protocols:',
    '      http:',
    '        endpoint: 127.0.0.1:4319',
    'extensions:',
    '  health_check:',
    '    endpoint: 127.0.0.1:13133',
    'processors:',
    '  transform/privacy_strict: {}',
    'exporters:',
    '  file/receipt: {}',
    'service:',
    '  pipelines: {}',
    ''
  ].join('\n');
  const output = scopedConfig(template, { 4318: 20001, 4317: 20002, 4319: 20003, 13133: 20004, telemetry: 20005 });
  assert.match(output, /endpoint: 127\.0\.0\.1:20001/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20002/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20003/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20004/);
  assert.match(output, /host: 127\.0\.0\.1\n\s+port: 20005/);
  assert.match(output, /transform\/privacy_strict/);
  assert.match(output, /file\/receipt/);
  assert.doesNotMatch(output, /127\.0\.0\.1:(4317|4318|4319|13133)/);
});

test('per-run Collector config refuses a template missing strict redaction or receipt export', () => {
  const template = ['endpoint: 127.0.0.1:4318', 'endpoint: 127.0.0.1:4317', 'endpoint: 127.0.0.1:4319', 'endpoint: 127.0.0.1:13133', 'service:', ''].join('\n');
  assert.throws(() => scopedConfig(template, { 4318: 20001, 4317: 20002, 4319: 20003, 13133: 20004, telemetry: 20005 }), /strict privacy processor and local receipt exporter/);
});
