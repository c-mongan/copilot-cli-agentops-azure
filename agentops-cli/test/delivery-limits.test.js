const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { deliveryLimits, readPrivateFile, reserveSharedPublishBytes } = require('../src/lib/copilot/delivery-limits');
const { initializeSessionOutbox, readSessionOutbox, drainSessionOutboxes, sessionOutboxPrune } = require('../src/lib/copilot/session-delivery-outbox');
const { runLogsIngestionUpload, createDurableLogsIngestionUploader } = require('../src/lib/azure/logs-ingestion-upload');
const cloud = { subscriptionId: '11111111-1111-4111-8111-111111111111', logsIngestionEndpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-test' };
const clock = Date.parse('2026-10-02T00:00:00Z');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-limits-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function run(home, name) {
  const directory = path.join(home, 'runs', name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'AgentOpsEvents_CL.jsonl'), '{"EventId":"safe"}\n', { mode: 0o600 });
  return directory;
}
test('policy rejects unknown, fractional, and expanded local limits; publishing defaults to zero', () => {
  assert.equal(deliveryLimits().maxPublishBytesPerDay, 0);
  for (const policy of [{ ttlMs: 172800001 }, { maxQueueBytes: 268435457 }, { surprise: 1 }, { maxPublishBytesPerDay: -1 }, { ttlMs: 1.1 }]) assert.throws(() => deliveryLimits(policy));
});
test('shared reservations charge retries, retain target binding, serialize owners, and roll over only forward', t => {
  const home = fixture(t);
  const options = { agentopsHome: home, now: clock, deliveryLimits: { maxPublishBytesPerDay: 10 } };
  assert.equal(reserveSharedPublishBytes(options, cloud, 6).allowed, true);
  assert.equal(reserveSharedPublishBytes(options, cloud, 5).allowed, false);
  assert.equal(reserveSharedPublishBytes(options, cloud, 4).allowed, true);
  assert.throws(() => reserveSharedPublishBytes({ ...options, deliveryLimits: { maxPublishBytesPerDay: 20 } }, cloud, 1), /policy binding/);
  assert.throws(() => reserveSharedPublishBytes(options, { ...cloud, dcrImmutableId: 'dcr-other' }, 1), /binding/);
  assert.throws(() => reserveSharedPublishBytes({ ...options, now: clock - 86400000 }, cloud, 1), /clock/);
  assert.equal(reserveSharedPublishBytes({ ...options, now: clock + 86400000 }, cloud, 10).allowed, true);
  const { claimSessionOutbox, releaseSessionOutboxClaim } = require('../src/lib/copilot/session-delivery-outbox');
  const claim = claimSessionOutbox(path.join(home, 'runs'));
  try { assert.equal(reserveSharedPublishBytes(options, cloud, 1).reason, 'publishing_budget_busy'); } finally { releaseSessionOutboxClaim(claim); }
});
test('Windows budget reservation flushes its file and keeps ceilings without opening a directory handle', t => {
  const home = fixture(t);
  const options = { agentopsHome: home, now: clock, deliveryLimits: { maxPublishBytesPerDay: 10 } };
  const directory = path.join(home, 'runs');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const openSync = fs.openSync, fsyncSync = fs.fsyncSync, closeSync = fs.closeSync;
  const budgetHandles = new Set();
  let directoryOpens = 0, budgetFlushes = 0;
  try {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    fs.openSync = (file, flags, ...args) => {
      if (file === directory && flags === 'r') {
        directoryOpens++;
        const error = new Error('Windows directory handles are unavailable'); error.code = 'EPERM'; throw error;
      }
      const handle = openSync(file, flags, ...args);
      if (typeof file === 'string' && file.includes('.session-publish-budget.json.') && flags === 'wx') budgetHandles.add(handle);
      return handle;
    };
    fs.fsyncSync = handle => { if (budgetHandles.has(handle)) budgetFlushes++; return fsyncSync(handle); };
    fs.closeSync = handle => { budgetHandles.delete(handle); return closeSync(handle); };
    assert.equal(reserveSharedPublishBytes(options, cloud, 6).allowed, true);
    const state = JSON.parse(fs.readFileSync(path.join(directory, '.session-publish-budget.json'), 'utf8'));
    assert.equal(state.reservedUpperBoundBytes, 6);
    assert.equal(reserveSharedPublishBytes(options, cloud, 5).allowed, false);
    assert.throws(() => reserveSharedPublishBytes(options, { ...cloud, dcrImmutableId: 'dcr-other' }, 1), /binding/);
    assert.equal(directoryOpens, 0);
    assert.equal(budgetFlushes, 1);
  } finally {
    fs.openSync = openSync; fs.fsyncSync = fsyncSync; fs.closeSync = closeSync;
    Object.defineProperty(process, 'platform', platform);
  }
});
test('bounded reads and budget state reject symlinks, hard links, oversized files, and corrupt schemas', t => {
  const home = fixture(t);
  const file = path.join(home, 'source'); fs.writeFileSync(file, '12345');
  assert.throws(() => readPrivateFile(file, 4), /bounded/);
  const link = path.join(home, 'link'); fs.symlinkSync(file, link);
  assert.throws(() => readPrivateFile(link, 10));
  const hard = path.join(home, 'hard'); fs.linkSync(file, hard);
  assert.throws(() => readPrivateFile(file, 10), /hard links/);
  const options = { agentopsHome: home, now: clock, deliveryLimits: { maxPublishBytesPerDay: 10 } };
  reserveSharedPublishBytes(options, cloud, 1);
  fs.writeFileSync(path.join(home, 'runs', '.session-publish-budget.json'), '{}');
  assert.throws(() => reserveSharedPublishBytes(options, cloud, 1), /schema/);
});
test('expiry keeps ambiguous rows and loss receipt, and pruning never deletes them', t => {
  const home = fixture(t), directory = run(home, 'expired-run');
  initializeSessionOutbox(directory, { runId: 'expired-run', sessionId: 'session', cloud, now: clock });
  const stateFile = path.join(directory, 'session-delivery.json');
  const state = readSessionOutbox(directory); state.streams.events.status = 'in_flight'; state.streams.events.attempts = 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  drainSessionOutboxes({ agentopsHome: home, cloud, now: clock + 172800000, spawnSync() { throw new Error('must not send'); } });
  const held = readSessionOutbox(directory).streams.events;
  assert.equal(held.status, 'expired'); assert.equal(held.lossReceipt.remoteAcceptance, 'unknown');
  assert.equal(fs.existsSync(path.join(directory, held.file)), true);
  assert.equal(sessionOutboxPrune({ agentopsHome: home, now: clock + 400 * 86400000, apply: true }).removed.length, 0);
});
test('queue admission bounds aggregate eligible bytes and holds oversized exports without deleting local capture', t => {
  const home = fixture(t), first = run(home, 'first'), second = run(home, 'second');
  const bytes = fs.statSync(path.join(first, 'AgentOpsEvents_CL.jsonl')).size;
  const input = { sessionId: 'session', cloud, now: clock, deliveryLimits: { maxQueueBytes: bytes } };
  initializeSessionOutbox(first, { ...input, runId: 'first' });
  initializeSessionOutbox(second, { ...input, runId: 'second' });
  assert.equal(readSessionOutbox(first).streams.events.status, 'pending');
  assert.equal(readSessionOutbox(second).streams.events.status, 'overflow');
  const third = run(home, 'third');
  initializeSessionOutbox(third, { ...input, runId: 'third', deliveryLimits: { maxQueueBytes: 1 } });
  assert.equal(readSessionOutbox(third).streams.events.lossReceipt.rowsKnown, false);
  assert.equal(fs.existsSync(path.join(third, 'AgentOpsEvents_CL.jsonl')), true);
});
test('default zero allowance blocks direct requests and durable token acquisition', async t => {
  const home = fixture(t);
  assert.equal(runLogsIngestionUpload({ ok: true, errors: [], uploads: [] }, { agentopsHome: home, env: {}, spawnSync() { throw new Error('must not execute'); } }).executed, false);
  const uploader = createDurableLogsIngestionUploader({ agentopsHome: home, env: {}, endpoint: cloud.logsIngestionEndpoint, dcrImmutableId: cloud.dcrImmutableId, expectedSubscriptionId: cloud.subscriptionId, approvedSubscriptionIds: [cloud.subscriptionId], spawnSync() { return { status: 0, stdout: cloud.subscriptionId }; }, tokenProvider() { throw new Error('must not acquire token'); }, fetchImpl() { throw new Error('must not fetch'); } });
  assert.equal((await uploader({ EventId: 'safe' }, { table: 'AgentOpsEvents_CL' })).status, 429);
});
test('durable token refresh consumes a second reservation and stops when remaining allowance is insufficient', async t => {
  const home = fixture(t); let fetches = 0, tokens = 0;
  const row = { EventId: 'safe' }, bytes = Buffer.byteLength(JSON.stringify([row]));
  const uploader = createDurableLogsIngestionUploader({ agentopsHome: home, now: clock, deliveryLimits: { maxPublishBytesPerDay: bytes }, endpoint: cloud.logsIngestionEndpoint, dcrImmutableId: cloud.dcrImmutableId, expectedSubscriptionId: cloud.subscriptionId, approvedSubscriptionIds: [cloud.subscriptionId], spawnSync() { return { status: 0, stdout: cloud.subscriptionId }; }, tokenProvider() { tokens++; return 'fixture'; }, async fetchImpl() { fetches++; return { status: 401, headers: {} }; } });
  assert.equal((await uploader(row, { table: 'AgentOpsEvents_CL' })).status, 429);
  assert.equal(tokens, 1); assert.equal(fetches, 1);
});
