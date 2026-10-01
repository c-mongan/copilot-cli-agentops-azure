const assert = require('node:assert/strict');
const test = require('node:test');

const { createMcpHttpProxyObserver } = require('../src/lib/mcp/proxy-http');

function newObserver(options = {}) {
  const rows = [];
  const observer = createMcpHttpProxyObserver({
    serverName: 'synthetic-http-mcp',
    runId: 'run-mcp-http-synthetic',
    sessionId: 'mcp-http-session-synthetic',
    onObservation: row => rows.push(row),
    ...options
  });
  return { observer, rows };
}

test('http proxy correlates a tools/call request with its response by id and emits a success row', () => {
  const { observer, rows } = newObserver();
  const outgoing = observer.observeRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/tmp/a' } } });
  assert.equal(outgoing.observed, true);
  assert.equal(rows.length, 0);

  const row = observer.observeResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  assert.ok(row);
  assert.equal(rows.length, 1);
  assert.equal(row.Status, 'success');
  assert.equal(row.ToolName, 'read_file');
  assert.equal(row.McpTransport, 'http');
  assert.equal(row.ErrorType, '');
});

test('http proxy correlates ids across numeric and numeric-string representations', () => {
  const { observer, rows } = newObserver();
  observer.observeRequest({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'list_dir', arguments: {} } });
  const row = observer.observeResponse({ jsonrpc: '2.0', id: '42', result: {} });
  assert.ok(row, 'response with string id must still match request registered with numeric id');
  assert.equal(rows.length, 1);
  assert.equal(row.ToolName, 'list_dir');
});

test('http proxy correlates replies that arrive out of order', () => {
  const { observer, rows } = newObserver();
  observer.observeRequest({ jsonrpc: '2.0', id: 'a', method: 'tools/call', params: { name: 'tool-a', arguments: {} } });
  observer.observeRequest({ jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'tool-b', arguments: {} } });

  observer.observeResponse({ jsonrpc: '2.0', id: 'b', result: {} });
  observer.observeResponse({ jsonrpc: '2.0', id: 'a', result: {} });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].ToolName, 'tool-b');
  assert.equal(rows[1].ToolName, 'tool-a');
});

test('http proxy reports an error response as a failed row with an error type', () => {
  const { observer, rows } = newObserver();
  observer.observeRequest({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'write_file', arguments: {} } });
  const row = observer.observeResponse({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'boom' } });
  assert.ok(row);
  assert.equal(row.Status, 'failed');
  assert.equal(row.ErrorType, '-32000');
});

test('http proxy passes non-tools/call methods through unobserved', () => {
  const { observer, rows } = newObserver();
  const message = { jsonrpc: '2.0', id: 9, method: 'resources/list', params: {} };
  const outgoing = observer.observeRequest(message);
  assert.equal(outgoing.observed, false);
  assert.deepEqual(outgoing.message, message);

  const row = observer.observeResponse({ jsonrpc: '2.0', id: 9, result: [] });
  assert.equal(row, null, 'a reply to an unobserved request id must never produce a row');
  assert.equal(rows.length, 0);
});

test('http proxy emits a cancelled row and clears the pending entry when a client cancellation notification arrives', () => {
  const { observer, rows } = newObserver();
  observer.observeRequest({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'long_running_tool', arguments: {} } });

  const cancellation = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5, reason: 'user cancelled' } };
  const passthrough = observer.observeRequest(cancellation);

  assert.deepEqual(passthrough.message, cancellation, 'the cancellation notification itself must be forwarded unmodified');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Status, 'cancelled');
  assert.equal(rows[0].ToolName, 'long_running_tool');

  const lateReply = observer.observeResponse({ jsonrpc: '2.0', id: 5, result: { ok: true } });
  assert.equal(lateReply, null);
  assert.equal(rows.length, 1);
});

test('http proxy ignores a cancellation notification for an id that is not pending', () => {
  const { observer, rows } = newObserver();
  const cancellation = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'unknown-id' } };
  const result = observer.observeRequest(cancellation);
  assert.equal(result.observed, false);
  assert.equal(rows.length, 0);
});

test('http proxy never writes raw tool arguments or raw tool results into an emitted row', () => {
  const { observer, rows } = newObserver();
  const secret = 'TOP-SECRET-CANARY-VALUE-13579';
  observer.observeRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'read_secret', arguments: { token: secret, nested: { value: secret } } }
  });
  const row = observer.observeResponse({ jsonrpc: '2.0', id: 1, result: { content: secret, blob: [secret] } });
  assert.ok(row);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(secret));
  for (const value of Object.values(row)) {
    assert.doesNotMatch(JSON.stringify(value), new RegExp(secret));
  }
});

test('http proxy observeExchange convenience correlates a single request/response pair', () => {
  const { observer, rows } = newObserver();
  const { request, observed, row } = observer.observeExchange(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: {} } },
    { jsonrpc: '2.0', id: 3, result: { pong: true } }
  );
  assert.equal(observed, true);
  assert.ok(request);
  assert.ok(row);
  assert.equal(row.Status, 'success');
  assert.equal(rows.length, 1);
});
