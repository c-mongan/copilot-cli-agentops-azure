const assert = require('node:assert/strict');
const test = require('node:test');

const {
  attributeValue,
  booleanAttribute,
  isFailedRow,
  isSpanTelemetryRow,
  numberAttribute,
  operationFromRow,
  rowAttributes,
  sessionFromRow,
  telemetryTime
} = require('../src/lib/session-row-utils');

test('session row helpers read structured and JSON-string attributes', () => {
  assert.deepEqual(rowAttributes({ attributes: { model: 'gpt-4.1' } }), { model: 'gpt-4.1' });
  assert.deepEqual(rowAttributes({ Properties: '{"tool":"search"}' }), { tool: 'search' });
  assert.deepEqual(rowAttributes({ Properties: '{bad json' }), {});
});

test('session attribute helpers normalize values by type', () => {
  const attrs = {
    primary: '',
    fallback: '42',
    enabled: 'true',
    disabled: 'false',
    explicit: false
  };

  assert.equal(attributeValue(attrs, ['primary', 'fallback']), '42');
  assert.equal(attributeValue(attrs, ['missing']), null);
  assert.equal(numberAttribute(attrs, ['fallback']), 42);
  assert.equal(numberAttribute(attrs, ['missing']), 0);
  assert.equal(booleanAttribute(attrs, ['enabled']), true);
  assert.equal(booleanAttribute(attrs, ['disabled']), false);
  assert.equal(booleanAttribute(attrs, ['explicit']), false);
});

test('session row helpers infer operation session and failures', () => {
  assert.equal(operationFromRow({ EventName: 'chat' }, {}), 'chat');
  assert.equal(operationFromRow({}, { 'gen_ai.operation.name': 'execute_tool' }), 'execute_tool');
  assert.equal(operationFromRow({}, {}), 'unknown');

  assert.equal(sessionFromRow({ SessionId: 'session-1' }, {}), 'session-1');
  assert.equal(sessionFromRow({}, { 'gen_ai.conversation.id': 'conversation-1' }), 'conversation-1');
  assert.equal(sessionFromRow({}, {}), 'unknown-session');

  assert.equal(isFailedRow({ Success: 'false' }, {}), true);
  assert.equal(isFailedRow({ Status: 'blocked' }, {}), true);
  assert.equal(isFailedRow({ ResultCode: 'ERROR' }, {}), true);
  assert.equal(isFailedRow({}, { 'error.type': 'ToolError' }), true);
  assert.equal(isFailedRow({ Success: true }, {}), false);
});

test('session row helpers normalize native Copilot file-export rows', () => {
  const attrs = { 'gen_ai.operation.name': 'invoke_agent' };
  assert.equal(operationFromRow({ name: 'invoke_agent github.copilot.default' }, attrs), 'invoke_agent');
  assert.equal(telemetryTime([1785768920, 93000000]), '2026-08-03T14:55:20.093Z');
  assert.equal(isSpanTelemetryRow({ type: 'span' }), true);
  assert.equal(isSpanTelemetryRow({ type: 'metric' }), false);
  assert.equal(isSpanTelemetryRow({ Name: 'legacy Azure row' }), true);
});
