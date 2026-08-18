const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOtelSetup,
  classifyOtelEndpoint,
  parseOtelSetupArgs,
  renderOtelSetup
} = require('../src/lib/otel-setup');

test('native setup defaults to loopback OTLP HTTP/protobuf with content capture off', () => {
  const options = parseOtelSetupArgs([]);
  const setup = buildOtelSetup(options);

  assert.equal(options.unsafeDirect, false);
  assert.equal(setup.endpointPolicy.classification, 'loopback');
  assert.equal(setup.nativeEnv.COPILOT_OTEL_ENABLED, 'true');
  assert.equal(setup.nativeEnv.COPILOT_OTEL_EXPORTER_TYPE, 'otlp-http');
  assert.equal(setup.nativeEnv.COPILOT_OTEL_SOURCE_NAME, 'github.copilot');
  assert.equal(setup.nativeEnv.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:4318');
  assert.equal(setup.nativeEnv.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/protobuf');
  assert.equal(setup.nativeEnv.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'false');
  assert.deepEqual(setup.sessionExport.settings, { remoteExport: false });
  assert.equal(setup.sessionExport.cliFlag, '--no-remote-export');
  assert.equal(setup.fileExport.env.COPILOT_OTEL_FILE_EXPORTER_PATH, './copilot-otel.jsonl');
});

test('endpoint classifier distinguishes loopback, link-local, public, file, and malformed values', () => {
  const cases = [
    ['http://localhost:4318', 'loopback'],
    ['https://127.0.0.2:4318/v1/traces', 'loopback'],
    ['http://[::1]:4318', 'loopback'],
    ['http://169.254.10.20:4318', 'link-local'],
    ['https://collector.example.test:4318', 'public'],
    ['file:///tmp/copilot-otel.jsonl', 'file'],
    ['not-a-url', 'malformed'],
    ['ftp://collector.example.test:4318', 'malformed']
  ];

  for (const [endpoint, expected] of cases) {
    assert.equal(classifyOtelEndpoint(endpoint).classification, expected, endpoint);
  }
});

test('non-loopback endpoints require explicit unsafe-direct opt-in', () => {
  for (const endpoint of [
    'https://collector.example.test:4318',
    'http://169.254.10.20:4318',
    'file:///tmp/copilot-otel.jsonl'
  ]) {
    assert.throws(
      () => parseOtelSetupArgs(['--endpoint', endpoint]),
      /only loopback endpoints are allowed by default/,
      endpoint
    );

    const options = parseOtelSetupArgs(['--endpoint', endpoint, '--unsafe-direct']);
    const setup = buildOtelSetup(options);
    assert.equal(setup.unsafeDirect, true);
    assert.equal(setup.endpoint, endpoint);
  }
});

test('unsafe-direct is the explicit bypass for a malformed endpoint classification', () => {
  assert.throws(
    () => parseOtelSetupArgs(['--endpoint', 'not-a-url']),
    /classified as malformed/
  );

  const options = parseOtelSetupArgs(['--endpoint', 'not-a-url', '--unsafe-direct']);
  const setup = buildOtelSetup(options);
  assert.equal(setup.endpointPolicy.classification, 'malformed');
  assert.equal(setup.endpoint, 'not-a-url');
});

test('shell and JSON renderers emit native variables without session-export claims', () => {
  const options = parseOtelSetupArgs(['--endpoint', 'http://localhost:4318', '--service-name', 'copilot-chat']);
  const setup = buildOtelSetup(options);
  const bash = renderOtelSetup(setup, options);
  const powershell = renderOtelSetup(setup, { ...options, shell: 'powershell' });
  const json = JSON.parse(renderOtelSetup(setup, { ...options, shell: 'json' }));

  assert.match(bash, /export COPILOT_OTEL_ENABLED='true'/);
  assert.match(bash, /export OTEL_EXPORTER_OTLP_ENDPOINT='http:\/\/localhost:4318'/);
  assert.match(bash, /export OTEL_EXPORTER_OTLP_PROTOCOL='http\/protobuf'/);
  assert.match(bash, /export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT='false'/);
  assert.match(bash, /Session export controls are separate from OTel/);
  assert.match(bash, /--no-remote-export/);
  assert.match(bash, /remoteExport/);
  assert.doesNotMatch(bash, /export COPILOT_OTEL_ENDPOINT=/);
  assert.doesNotMatch(bash, /--no-remote proves/);
  assert.match(powershell, /\$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http\/protobuf"/);
  assert.equal(json.nativeEnv.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/protobuf');
  assert.equal(json.nativeEnv.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'false');
  assert.equal(json.fileExport.env.COPILOT_OTEL_FILE_EXPORTER_PATH, './copilot-otel.jsonl');
});

test('capture-content remains an explicit opt-in', () => {
  const setup = buildOtelSetup(parseOtelSetupArgs(['--capture-content']));

  assert.equal(setup.nativeEnv.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'true');
  assert.equal(setup.fileExport.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'true');
});
