'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { readBackNativeEvents, readbackQuery, selectEventIds, expectedFields } = require('../src/azure-readback');
const { createVsCodeAzureMonitorAuth, logAnalyticsReadScope } = require('../src/azure-auth');
const { createAzureControls, readAzureDestination } = require('../src/azure-controls');
const { readbackStage, captureStages } = require('../src/capture-stages');
const workspaceId = '22222222-2222-4222-8222-222222222222';
const tenantId = '11111111-1111-4111-8111-111111111111';
const ids = ['native_' + 'a'.repeat(32), 'native_' + 'b'.repeat(32)];
const columns = ['EventId', ...Object.keys(expectedFields)].map(name => ({ name, type: 'string' }));
const row = (id, overrides = {}) => [id, ...Object.entries(expectedFields).map(([field, value]) => overrides[field] ?? value)];
function reply(rows, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null },
    async text() { return JSON.stringify({ tables: [{ name: 'PrimaryResult', columns, rows }] }); } };
}
const base = { workspaceId, tokenProvider: async () => 'mock-read-token' };

test('query is fixed, typed and only interpolates validated event IDs', async () => {
  const requests = [];
  const result = await readBackNativeEvents({ ...base, eventIds: ids,
    fetch: async (url, init) => { requests.push({ url, init }); return reply([row(ids[0]), row(ids[1])]); } });
  assert.equal(result.state, 'verified'); assert.equal(result.found, 2); assert.equal(result.missing, 0);
  assert.equal(requests[0].url, `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`);
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].init.headers.authorization, 'Bearer mock-read-token');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.query, readbackQuery(ids, 7)); assert.equal(body.timespan, 'P7D');
  assert.match(body.query, /^AgentOpsEvents_CL \| where TimeGenerated > ago\(7d\) \| where EventId in \('native_a{32}','native_b{32}'\)/);
  assert.equal(JSON.stringify(result).includes('mock-read-token'), false);
  assert.equal(JSON.stringify(result).includes(ids[0]), false);
});

test('injection-shaped, empty or oversized ID lists fail before any token or request', async () => {
  let calls = 0;
  const counted = { ...base, tokenProvider: async () => { calls++; return 't'; }, fetch: async () => { calls++; return reply([]); } };
  for (const eventIds of [[], ["native_') | take 1 //"], ['native_' + 'A'.repeat(32)], undefined]) {
    await assert.rejects(readBackNativeEvents({ ...counted, eventIds }));
  }
  await assert.rejects(readBackNativeEvents({ ...counted, eventIds: ids, workspaceId: 'x/../y' }), /workspace ID/);
  await assert.rejects(readBackNativeEvents({ ...counted, eventIds: ids, lookbackDays: 90 }), /lookback/);
  assert.equal(calls, 0);
  const many = Array.from({ length: 501 }, (_, i) => 'native_' + i.toString(16).padStart(32, '0'));
  const selection = selectEventIds(many);
  assert.equal(selection.ids.length, 500); assert.equal(selection.sampled, true); assert.equal(selection.total, 501);
});

test('missing, partial, mismatched, duplicated and denied results map to explicit states', async () => {
  const run = (rows, status) => readBackNativeEvents({ ...base, eventIds: ids, fetch: async () => reply(rows, status) });
  assert.equal((await run([])).state, 'missing');
  const partial = await run([row(ids[0])]);
  assert.equal(partial.state, 'partial'); assert.equal(partial.missing, 1);
  const mismatch = await run([row(ids[0]), row(ids[1], { PrivacyMode: 'full' })]);
  assert.equal(mismatch.state, 'mismatch'); assert.equal(mismatch.mismatched, 1);
  assert.equal((await run([row(ids[0]), row(ids[1]), row('native_' + 'c'.repeat(32))])).state, 'mismatch');
  const duplicated = await run([row(ids[0]), row(ids[0]), row(ids[1])]);
  assert.equal(duplicated.state, 'verified'); assert.equal(duplicated.duplicates, 1);
  assert.equal((await run([], 403)).state, 'denied');
});

test('transport, HTTP and response failures return fixed messages without response content', async () => {
  const fail = fetch => readBackNativeEvents({ ...base, eventIds: ids, fetch });
  await assert.rejects(fail(async () => { throw new Error('secret-host-detail'); }), { message: 'Readback request did not complete.' });
  await assert.rejects(fail(async () => ({ status: 500, ok: false, async text() { return 'secret-body'; } })), { message: 'Readback query failed with HTTP 500.' });
  await assert.rejects(fail(async () => ({ status: 200, ok: true, headers: { get: () => null }, async text() { return 'secret-body'; } })), { message: 'Readback response is not valid JSON.' });
  await assert.rejects(fail(async () => ({ status: 200, ok: true, headers: { get: () => '999999999' }, async text() { return '{}'; } })), { message: 'Readback response is too large.' });
  await assert.rejects(fail(async () => ({ status: 200, ok: true, headers: { get: () => null }, async text() { return JSON.stringify({ tables: [{ columns: [{ name: 'EventId' }], rows: [] }] }); } })), /missing an expected column/);
});

test('readback auth uses only the fixed Log Analytics read scope; unknown resources fail closed', async () => {
  const calls = [];
  const auth = createVsCodeAzureMonitorAuth({ authentication: { async getSession(...args) { calls.push(args); return { accessToken: 'mock' }; } } },
    { tenantId, resource: 'logAnalyticsRead' });
  await auth.tokenProvider();
  assert.deepEqual(calls[0][1], [logAnalyticsReadScope, `VSCODE_TENANT:${tenantId}`]);
  assert.throws(() => createVsCodeAzureMonitorAuth({ authentication: { getSession() {} } }, { tenantId, resource: 'https://management.azure.com/.default' }), /not supported/);
});

function controlsFixture(destinationOverrides = {}) {
  const destination = { tenantId, subscriptionId: tenantId, approvedSubscriptionIds: [tenantId],
    endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-safe', maxPublishBytesPerDay: 1048576, ...destinationOverrides };
  const values = new Map(); const calls = { auth: [], readback: [] };
  const vscode = { env: {}, workspace: { isTrusted: true, getConfiguration: () => ({ inspect: () => ({ globalValue: destination }) }) },
    window: { async showWarningMessage() { return 'Enable Azure publishing'; } } };
  const context = { globalStorageUri: { fsPath: '/private/tmp/mock-native-profile' }, globalState: {
    get: key => values.get(key), async update(key, value) { if (value === undefined) values.delete(key); else values.set(key, value); } } };
  const deps = {
    createAuth(_vscode, options) { calls.auth.push(options); return { async signIn() {}, tokenProvider: async () => 'mock' }; },
    createDelivery() { return { async publishReceipt() { return { acknowledged: 2, refused: 0, admittedIds: ids }; } }; },
    async readBack(options) { calls.readback.push(options); await options.tokenProvider(); return { state: 'verified', expected: options.eventIds.length, found: options.eventIds.length, mismatched: 0 }; }
  };
  const controls = createAzureControls(vscode, context, { getReceipt: () => ({ ownsCapture: true, receiptPath: '/private/tmp/r' }) }, deps);
  return { controls, calls, destination };
}

test('readback requires consent, a configured workspace and IDs published by this window', async () => {
  const f = controlsFixture({ readbackWorkspaceId: workspaceId.toUpperCase() });
  await assert.rejects(f.controls.readback(), /approve this destination/);
  await f.controls.enable();
  await assert.rejects(f.controls.readback(), /Publish native metadata/);
  const published = await f.controls.publish();
  assert.equal('admittedIds' in published, false);
  const first = await f.controls.readback();
  assert.equal(first.state, 'verified'); assert.equal(first.sampled, false); assert.equal(first.total, 2);
  assert.deepEqual(f.calls.readback[0].eventIds, ids); assert.equal(f.calls.readback[0].workspaceId, workspaceId);
  assert.equal(f.calls.auth.at(-1).resource, 'logAnalyticsRead');
  await f.controls.disable();
  await assert.rejects(f.controls.readback(), /disabled/);
  const without = controlsFixture();
  await without.controls.enable(); await without.controls.publish();
  await assert.rejects(without.controls.readback(), /readbackWorkspaceId/);
});

test('readbackWorkspaceId is optional, validated and does not change existing destination hashes', () => {
  const make = value => ({ env: {}, workspace: { isTrusted: true, getConfiguration: () => ({ inspect: () => ({ globalValue: value }) }) } });
  const plain = { tenantId, subscriptionId: tenantId, approvedSubscriptionIds: [tenantId], endpoint: 'https://e.ingest.monitor.azure.com', dcrImmutableId: 'dcr-x', maxPublishBytesPerDay: 1 };
  assert.equal('readbackWorkspaceId' in readAzureDestination(make(plain)), false);
  assert.equal(readAzureDestination(make({ ...plain, readbackWorkspaceId: workspaceId })).readbackWorkspaceId, workspaceId);
  assert.throws(() => readAzureDestination(make({ ...plain, readbackWorkspaceId: 'not-a-guid' })), /invalid/);
});

test('readback stage states never claim coverage and treat absence as pending', () => {
  assert.equal(readbackStage(undefined).state, 'unverified');
  assert.equal(readbackStage(undefined, 'unavailable').state, 'unavailable');
  assert.equal(readbackStage({ failed: true }).state, 'failed');
  assert.equal(readbackStage({ state: 'denied' }).state, 'denied');
  assert.equal(readbackStage({ state: 'missing', expected: 2, found: 0, mismatched: 0 }).state, 'pending');
  assert.equal(readbackStage({ state: 'partial', expected: 2, found: 1, mismatched: 0 }).state, 'partial');
  assert.equal(readbackStage({ state: 'mismatch', expected: 2, found: 2, mismatched: 1 }).state, 'mismatch');
  assert.equal(readbackStage({ state: 'verified', expected: 2, found: -1, mismatched: 0 }).state, 'unknown');
  const verified = captureStages({ upload: { acknowledged: 2, refused: 0 }, readback: { state: 'verified', expected: 2, found: 2, mismatched: 0, sampled: true } });
  const stage = verified.find(item => item.id === 'cloudReadback');
  assert.equal(stage.state, 'verified'); assert.match(stage.detail, /latest 2/);
});
