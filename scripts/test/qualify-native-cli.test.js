const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CANARY, fixtureTool, cleanEnvironment, inspectReceipt, externalCollector } = require('../qualify-native-cli');
test('qualification child cannot inherit provider, GitHub or exporter secrets', () => {
  assert.deepEqual(cleanEnvironment({ PATH: '/bin', HOME: '/home', GITHUB_TOKEN: 'secret', COPILOT_PROVIDER_API_KEY: 'secret', OTEL_EXPORTER_OTLP_HEADERS: 'secret', NODE_OPTIONS: 'unsafe' }), { PATH: '/bin', HOME: '/home' });
});
test('native proof requires all three runtime operations and checks the complete receipt', () => {
  const row = { resourceSpans: [{ scopeSpans: [{ spans: ['invoke_agent', 'chat', 'execute_tool'].map(operation => ({ traceId: 'one', spanId: operation, parentSpanId: operation === 'invoke_agent' ? undefined : 'invoke_agent', attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: operation } }] })) }] }] };
  const result = inspectReceipt(JSON.stringify(row));
  assert.equal(result.hasAgent && result.hasChat && result.hasTool, true);
  assert.equal(result.traceCount, 1);
  assert.equal(result.childrenHaveAgentParent, true);
  row.resourceSpans[0].scopeSpans[0].spans[1].parentSpanId = 'wrong-root';
  assert.equal(inspectReceipt(JSON.stringify(row)).childrenHaveAgentParent, false);
  row.extra = CANARY;
  assert.equal(inspectReceipt(JSON.stringify(row)).canaryAbsent, false);
  assert.equal(inspectReceipt('').hasAgent, false);
});
test('invalid receipt is not converted to positive qualification', () => {
  assert.throws(() => inspectReceipt('not JSON'), SyntaxError);
});
test('external Collector requires a private scope pair and rejects remote exports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-external-scope-test-'));
  fs.chmodSync(root, 0o700);
  const receiptPath = path.join(root, 'native-receipt.jsonl');
  fs.writeFileSync(receiptPath, '', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'otelcol.local.strict.yaml'), '      http:\n        endpoint: 127.0.0.1:4318\ntransform/privacy_strict\nfile/receipt\n');
  try {
    assert.equal(externalCollector({ collectorEndpoint: 'http://127.0.0.1:4318', receiptPath }).external, true);
    assert.throws(() => externalCollector({ collectorEndpoint: 'https://example.com:4318', receiptPath }), /loopback/);
    assert.throws(() => externalCollector({ collectorEndpoint: 'http://127.0.0.1:4318' }), /both/);
    assert.throws(() => externalCollector({ collectorEndpoint: 'http://127.0.0.1:4319', receiptPath }), /same strict Collector scope/);
    if (process.platform !== 'win32') {
    fs.chmodSync(receiptPath, 0o644);
    assert.throws(() => externalCollector({ collectorEndpoint: 'http://127.0.0.1:4318', receiptPath }), /private regular file/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Windows fixture allows only a fixed PowerShell marker and retains OS bootstrap variables', () => {
 assert.deepEqual(fixtureTool('win32'), {name:'powershell',command:'Write-Output agentops-native-fixture',permission:'shell(Write-Output)'});
 assert.deepEqual(cleanEnvironment({SystemRoot:'C:\\Windows',TEMP:'C:\\Temp',GITHUB_TOKEN:'secret',NODE_OPTIONS:'unsafe'}), {SystemRoot:'C:\\Windows',TEMP:'C:\\Temp'});
});
