'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNativeAzureDelivery, nativeMetadataEvents } = require('../src/azure-delivery');
const subscription = '11111111-1111-4111-8111-111111111111';
function span(overrides = {}) { return { traceId: '00112233445566778899aabbccddeeff', spanId: '0011223344556677',
  sessionId: 'private-session', start: 1000, end: 2000, operation: 'chat', inputTokens: 12, outputTokens: null, ...overrides }; }
function receipt(file) {
  fs.writeFileSync(file, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{
    traceId: span().traceId, spanId: span().spanId, name: 'SECRET_CANARY', startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
    attributes: [ { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
      { key: 'gen_ai.conversation.id', value: { stringValue: 'SECRET_CANARY' } },
      { key: 'gen_ai.request.model', value: { stringValue: 'SECRET_CANARY' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '12' } } ]
  }] }] }] }) + '\n', { mode: 0o600 });
}
function options(storage, fetchImpl) { return { publishingApproved: true, storage,
  expectedSubscriptionId: subscription, approvedSubscriptionIds: [subscription],
  endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-safe',
  deliveryLimits: { maxPublishBytesPerDay: 1048576 },
  spawnSync() { assert.fail('must not invoke az'); }, tokenProvider: async () => 'mock-private-token', fetchImpl }; }

test('event projection omits arbitrary labels and unmeasured tokens, hashes session and has stable identities', () => {
  const result = nativeMetadataEvents([span(), span(), span({ spanId: 'invalid' })]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rejected, 1);
  const row = result.rows[0];
  assert.equal(row.EventName, 'native.span.observed');
  assert.equal(row.InputTokens, 12);
  assert.equal('OutputTokens' in row, false);
  assert.equal(JSON.stringify(row).includes('private-session'), false);
  assert.deepEqual(nativeMetadataEvents([span()]).rows[0], row);
  assert.equal('InputTokens' in nativeMetadataEvents([span({ operation: 'invoke_agent' })]).rows[0], false);
  assert.equal(nativeMetadataEvents([span({ operation: 'SECRET_CANARY' })]).rows[0].SpanName, 'unknown');
});

test('receipt publishes metadata with no CLI and repeated reads or restarts cannot replay acknowledged rows', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-azure-'));
  try {
    const file = path.join(storage, 'receipt.json'); receipt(file);
    const sent = [];
    const settings = options(storage, async (_uri, request) => { sent.push(JSON.parse(request.body)); return { status: 204 }; });
    const delivery = createNativeAzureDelivery(settings);
    const first = await delivery.publishReceipt(file);
    assert.equal(first.mode, 'native-metadata-events-only');
    assert.equal(first.admitted, 1); assert.equal(first.acknowledged, 1);
    assert.equal(first.admittedIds.length, 1); assert.match(first.admittedIds[0], /^native_[a-f0-9]{32}$/);
    assert.equal(JSON.stringify(sent).includes('SECRET_CANARY'), false);
    assert.equal(JSON.stringify(sent).includes('mock-private-token'), false);
    assert.equal((await delivery.publishReceipt(file)).duplicate, 1);
    assert.equal((await createNativeAzureDelivery(settings).publishReceipt(file)).duplicate, 1);
    assert.equal(sent.length, 1);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});

test('failed delivery stays queued and a later receipt read retries without extra admission', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-retry-'));
  try {
    const file = path.join(storage, 'receipt.json'); receipt(file);
    let status = 503;
    const delivery = createNativeAzureDelivery(options(storage, async () => ({ status })));
    const first = await delivery.publishReceipt(file);
    assert.equal(first.status.pending, 1); assert.equal(first.acknowledged, 0);
    status = 204;
    const retry = await delivery.publishReceipt(file);
    assert.deepEqual(retry.admittedIds, []);
    assert.equal(retry.admitted, 0); assert.equal(retry.duplicate, 1); assert.equal(retry.acknowledged, 1);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});

test('publishing is opt-in and a zero byte ceiling acquires no token', async () => {
  assert.throws(() => createNativeAzureDelivery({}), /explicit destination approval/);
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-ceiling-'));
  try {
    const file = path.join(storage, 'receipt.json'); receipt(file);
    const delivery = createNativeAzureDelivery({ ...options(storage, () => assert.fail('must not send')),
      tokenProvider: () => assert.fail('must not authenticate'), deliveryLimits: { maxPublishBytesPerDay: 0 } });
    const result = await delivery.publishReceipt(file);
    assert.equal(result.acknowledged, 0); assert.equal(result.status.pending, 1);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});

test('two delivery instances cannot change an admission journal at the same time', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-owner-'));
  try {
    const file = path.join(storage, 'receipt.json'); receipt(file);
    let finish;
    let sending;
    const started = new Promise(resolve => { sending = resolve; });
    const first = createNativeAzureDelivery(options(storage, async () => {
      sending(); await new Promise(resolve => { finish = resolve; }); return { status: 204 };
    }));
    const second = createNativeAzureDelivery(options(storage, async () => assert.fail('second owner must not send')));
    const pending = first.publishReceipt(file);
    await started;
    await assert.rejects(second.publishReceipt(file), /already in progress/);
    finish(); await pending;
    assert.equal((await second.publishReceipt(file)).duplicate, 1);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});
