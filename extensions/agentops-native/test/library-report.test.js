const test = require('node:test');
const assert = require('node:assert/strict');
const { libraryReceiptCounts } = require('../src/library-report');
test('library counts are separate, fixed, deduplicated and reject invalid identities', () => {
  const span = kind => ({ traceId: '1'.repeat(32), spanId: '2'.repeat(16), attributes: [{ key: 'agentops.operation.kind', value: { stringValue: kind } }] });
  const http = span('http'), db = { ...span('database'), spanId: '3'.repeat(16) };
  const data = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [http, http, db, span('PRIVATE_CANARY'), { ...http, traceId: 'invalid' }] }] }] });
  assert.deepEqual(libraryReceiptCounts(data+'\ninvalid'), { librarySpanCount: 2, httpSpanCount: 1, databaseSpanCount: 1 });
  assert.deepEqual(libraryReceiptCounts(''), { librarySpanCount: 0, httpSpanCount: 0, databaseSpanCount: 0 });
});
