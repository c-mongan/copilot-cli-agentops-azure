const assert = require('node:assert/strict');
const test = require('node:test');

const { createMcpProxyObserver } = require('../src/lib/mcp/proxy-stdio');

function newObserver(options = {}) {
  const rows = [];
  const observer = createMcpProxyObserver({
    serverName: 'synthetic-mcp',
    runId: 'run-mcp-synthetic',
    sessionId: 'mcp-session-synthetic',
    onObservation: row => rows.push(row),
    ...options
  });
  return { observer, rows };
}

test('stdio proxy correlates a tools/call request with its response by id and emits a success row', () => {
  const { observer, rows } = newObserver();
  const outgoing = observer.observeClientMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/tmp/a' } } });
  assert.equal(outgoing.observed, true);
  assert.equal(rows.length, 0);

  const row = observer.observeServerMessage({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  assert.ok(row);
  assert.equal(rows.length, 1);
  assert.equal(row.Status, 'success');
  assert.equal(row.ToolName, 'read_file');
  assert.equal(row.ErrorType, '');
});

test('stdio proxy correlates ids across numeric and numeric-string representations', () => {
  const { observer, rows } = newObserver();
  observer.observeClientMessage({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'list_dir', arguments: {} } });
  const row = observer.observeServerMessage({ jsonrpc: '2.0', id: '42', result: {} });
  assert.ok(row, 'response with string id must still match request registered with numeric id');
  assert.equal(rows.length, 1);
  assert.equal(row.ToolName, 'list_dir');
});

test('stdio proxy correlates replies that arrive out of order', () => {
  const { observer, rows } = newObserver();
  observer.observeClientMessage({ jsonrpc: '2.0', id: 'a', method: 'tools/call', params: { name: 'tool-a', arguments: {} } });
  observer.observeClientMessage({ jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'tool-b', arguments: {} } });

  observer.observeServerMessage({ jsonrpc: '2.0', id: 'b', result: {} });
  observer.observeServerMessage({ jsonrpc: '2.0', id: 'a', result: {} });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].ToolName, 'tool-b');
  assert.equal(rows[1].ToolName, 'tool-a');
});

test('stdio proxy reports an error response as a failed row with an error type', () => {
  const { observer, rows } = newObserver();
  observer.observeClientMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'write_file', arguments: {} } });
  const row = observer.observeServerMessage({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'boom' } });
  assert.ok(row);
  assert.equal(row.Status, 'failed');
  assert.equal(row.ErrorType, '-32000');
});

test('stdio proxy passes non-tools/call methods through unobserved', () => {
  const { observer, rows } = newObserver();
  const message = { jsonrpc: '2.0', id: 9, method: 'resources/list', params: {} };
  const outgoing = observer.observeClientMessage(message);
  assert.equal(outgoing.observed, false);
  assert.deepEqual(outgoing.message, message);

  const row = observer.observeServerMessage({ jsonrpc: '2.0', id: 9, result: [] });
  assert.equal(row, null, 'a reply to an unobserved request id must never produce a row');
  assert.equal(rows.length, 0);
});

test('stdio proxy emits a cancelled row and clears the pending entry when a client cancellation notification arrives', () => {
  const { observer, rows } = newObserver();
  observer.observeClientMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'long_running_tool', arguments: {} } });

  const cancellation = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5, reason: 'user cancelled' } };
  const passthrough = observer.observeClientMessage(cancellation);

  assert.deepEqual(passthrough.message, cancellation, 'the cancellation notification itself must be forwarded unmodified');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Status, 'cancelled');
  assert.equal(rows[0].ToolName, 'long_running_tool');

  // A late server reply for the already-cancelled id must not resurrect or double-emit a row,
  // and must not let a later, unrelated reused id falsely match the old pending entry.
  const lateReply = observer.observeServerMessage({ jsonrpc: '2.0', id: 5, result: { ok: true } });
  assert.equal(lateReply, null);
  assert.equal(rows.length, 1);
});

test('stdio proxy ignores a cancellation notification for an id that is not pending', () => {
  const { observer, rows } = newObserver();
  const cancellation = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'unknown-id' } };
  const result = observer.observeClientMessage(cancellation);
  assert.equal(result.observed, false);
  assert.equal(rows.length, 0);
});

test('stdio proxy never writes raw tool arguments or raw tool results into an emitted row', () => {
  const { observer, rows } = newObserver();
  const secret = 'TOP-SECRET-CANARY-VALUE-98765';
  observer.observeClientMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'read_secret', arguments: { token: secret, nested: { value: secret } } }
  });
  const row = observer.observeServerMessage({ jsonrpc: '2.0', id: 1, result: { content: secret, blob: [secret] } });
  assert.ok(row);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
  for (const value of Object.values(row)) {
    assert.doesNotMatch(JSON.stringify(value), new RegExp(secret));
  }
});
