'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNativeAzureDelivery } = require('../src/azure-delivery');
const { createAzureControls, readAzureDestination } = require('../src/azure-controls');
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const destination = { tenantId: id, subscriptionId: id, approvedSubscriptionIds: [id],
    endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-safe', maxPublishBytesPerDay: 1048576 };
  const inspected = { globalValue: destination };
  const values = new Map();
  const calls = { auth: 0, signin: 0, delivery: 0, publish: 0, prompts: [] };
  const vscode = { env: {}, workspace: { isTrusted: true, getConfiguration: () => ({ inspect: () => inspected }) },
    window: { async showWarningMessage(...args) { calls.prompts.push(args); return 'Enable Azure publishing'; } } };
  const context = { globalStorageUri: { fsPath: '/private/tmp/mock-native-profile' }, globalState: {
    get: key => values.get(key), async update(key, value) { if (value === undefined) values.delete(key); else values.set(key, value); }
  } };
  const options = { getReceipt: () => ({ ownsCapture: true, receiptPath: '/private/tmp/mock-receipt' }) };
  const deps = {
    createAuth() { calls.auth++; return { async signIn() { calls.signin++; }, tokenProvider: async () => 'unused-mock' }; },
    createDelivery(settings) { calls.delivery++; assert.equal(settings.publishingApproved, true);
      return { async publishReceipt(file) { calls.publish++; assert.equal(file, '/private/tmp/mock-receipt'); return { acknowledged: 1 }; } }; }
  };
  return { destination, inspected, values, calls, vscode, context, options, deps };
}

test('approval and sign-in precede manual delivery; persisted consent contains only hash and policy', async () => {
  const f = fixture(); const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
  await assert.rejects(controls.publish(), /approve this destination/);
  assert.equal(f.calls.auth, 0);
  assert.equal((await controls.enable()).publishing, 'manual');
  assert.equal(f.calls.signin, 1); assert.equal(f.calls.publish, 0);
  const prompt = f.calls.prompts[0];
  assert.match(prompt[0], /Subscription: 11111111/); assert.match(prompt[0], /not a financial cap/);
  assert.deepEqual(prompt[1], { modal: true });
  assert.equal(JSON.stringify([...f.values.values()]).includes(id), false);
  assert.equal(JSON.stringify([...f.values.values()]).includes('unused-mock'), false);
  assert.equal((await controls.publish()).acknowledged, 1);
  const restarted = createAzureControls(f.vscode, f.context, f.options, f.deps);
  await restarted.publish(); assert.equal(f.calls.signin, 1);
  await restarted.disable();
  await assert.rejects(controls.publish(), /approve this destination/);
});

test('cancelled modal performs no authentication, delivery preparation or consent write', async () => {
  const f = fixture(); f.vscode.window.showWarningMessage = async () => undefined;
  const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
  assert.equal((await controls.enable()).cancelled, true);
  assert.equal(f.calls.auth, 0); assert.equal(f.calls.delivery, 0); assert.equal(f.values.size, 0);
});

test('changed destination or budget requires new approval before publishing', async () => {
  const f = fixture(); const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
  await controls.enable(); f.destination.maxPublishBytesPerDay++;
  await assert.rejects(controls.publish(), /approve this destination/);
  assert.equal(f.calls.publish, 0);
});

test('untrusted, remote, overridden, denied, or malformed settings fail before sign-in', async () => {
  for (const change of [f => { f.vscode.workspace.isTrusted = false; }, f => { f.vscode.env.remoteName = 'ssh'; },
    f => { f.inspected.workspaceValue = f.destination; }, f => { f.inspected.policyValue = f.destination; },
    f => { f.destination.approvedSubscriptionIds = []; }, f => { f.destination.endpoint = 'https://evil.example'; },
    f => { f.destination.maxPublishBytesPerDay = 0; }]) {
    const f = fixture(); change(f);
    assert.throws(() => readAzureDestination(f.vscode));
    await assert.rejects(createAzureControls(f.vscode, f.context, f.options, f.deps).enable());
    assert.equal(f.calls.auth, 0); assert.equal(f.values.size, 0);
  }
});

test('a window without capture ownership cannot approve or publish', async () => {
  const f = fixture(); f.options.getReceipt = () => ({ ownsCapture: false });
  const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
  await assert.rejects(controls.enable(), /must own native capture/);
  assert.equal(f.calls.auth, 0);
});

test('a destination change or disable during sign-in cancels approval', async () => {
  for (const action of ['change', 'disable']) {
    const f = fixture(); let finish, began;
    const started = new Promise(resolve => { began = resolve; });
    f.deps.createAuth = () => ({ async signIn() { began(); await new Promise(resolve => { finish = resolve; }); } });
    const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
    const enabling = controls.enable(); await started;
    if (action === 'change') f.destination.dcrImmutableId = 'dcr-new'; else await controls.disable();
    finish(); await assert.rejects(enabling, /approval changed/);
    assert.equal(f.values.size, 0); assert.equal(f.calls.delivery, 0);
  }
});

test('disable aborts an active multirow drain and prevents all later authentication and requests', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-revoke-'));
  try {
    const f = fixture(); const receipt = path.join(storage, 'receipt.json');
    fs.writeFileSync(receipt, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [1, 2].map(index => ({
      traceId: '00112233445566778899aabbccddeeff', spanId: `001122334455667${index}`,
      name: 'chat', startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
      attributes: [{ key: 'gen_ai.conversation.id', value: { stringValue: 'mock-session' } }]
    })) }] }] }) + '\n', { mode: 0o600 });
    f.options.storage = storage;
    f.options.getReceipt = () => ({ ownsCapture: true, receiptPath: receipt });
    let tokens = 0, requests = 0, aborted = false, began;
    const started = new Promise(resolve => { began = resolve; });
    f.deps.createAuth = () => ({ async signIn() {}, async tokenProvider() { tokens++; return 'mock-token'; } });
    f.deps.createDelivery = settings => createNativeAzureDelivery({ ...settings,
      async fetchImpl(_uri, request) {
        requests++; began();
        return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => {
          aborted = true; reject(new Error('request cancelled'));
        }, { once: true }));
      }
    });
    const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
    await controls.enable();
    const draining = controls.publish(); await started; await controls.disable();
    const result = await draining;
    assert.equal(aborted, true); assert.equal(requests, 1); assert.equal(tokens, 1);
    assert.equal(result.acknowledged, 0); assert.equal(result.status.pending, 2);
    await assert.rejects(controls.publish(), /disabled/);
  } finally { fs.rmSync(storage, { recursive: true, force: true }); }
});

test('revocation while token lookup awaits prevents the token from reaching delivery', async () => {
  const f = fixture(); let resolveToken, began, guardedProvider;
  const started = new Promise(resolve => { began = resolve; });
  f.deps.createAuth = () => ({ async signIn() {}, async tokenProvider() {
    began(); return new Promise(resolve => { resolveToken = resolve; });
  } });
  f.deps.createDelivery = settings => { guardedProvider = settings.tokenProvider; return { publishReceipt: guardedProvider }; };
  const controls = createAzureControls(f.vscode, f.context, f.options, f.deps);
  await controls.enable(); const lookup = guardedProvider(); await started;
  await controls.disable(); resolveToken('mock-token');
  await assert.rejects(lookup, /approval was revoked/);
});
