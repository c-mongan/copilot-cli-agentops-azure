'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createVsCodeAzureMonitorAuth, azureMonitorScope } = require('../src/azure-auth');
const tenantId = '11111111-1111-4111-8111-111111111111';

test('explicit sign-in and silent token lookup use only the Monitor audience and selected tenant', async () => {
  const calls = [];
  const auth = createVsCodeAzureMonitorAuth({ authentication: {
    async getSession(...args) { calls.push(args); return { accessToken: 'mock-private-token', account: { label: 'private-user' } }; }
  } }, { tenantId });
  assert.deepEqual(await auth.signIn(), { signedIn: true });
  assert.equal(await auth.tokenProvider(), 'mock-private-token');
  assert.deepEqual(calls, [
    ['microsoft', [azureMonitorScope, `VSCODE_TENANT:${tenantId}`], { createIfNone: true }],
    ['microsoft', [azureMonitorScope, `VSCODE_TENANT:${tenantId}`], { silent: true }]
  ]);
  assert.equal(JSON.stringify(auth).includes('mock-private-token'), false);
});

test('background lookup does not prompt and receives renewed provider tokens without an adapter cache', async () => {
  let sequence = 0;
  const auth = createVsCodeAzureMonitorAuth({ authentication: {
    async getSession(_provider, _scopes, options) { assert.deepEqual(options, { silent: true }); return { accessToken: `mock-${++sequence}` }; }
  } }, { tenantId });
  assert.equal(await auth.tokenProvider(), 'mock-1');
  assert.equal(await auth.tokenProvider(), 'mock-2');
});

test('provider failures and absent sessions return fixed errors with no private values', async () => {
  for (const response of [undefined, { accessToken: '' }, 'throws']) {
    const auth = createVsCodeAzureMonitorAuth({ authentication: {
      async getSession() { if (response === 'throws') throw new Error('private-account secret-token'); return response; }
    } }, { tenantId });
    await assert.rejects(auth.tokenProvider(), error => error.message === 'Azure publishing requires Microsoft sign-in.');
    await assert.rejects(auth.signIn(), error => error.message === (response === 'throws'
      ? 'Microsoft sign-in was not completed.' : 'Azure publishing requires Microsoft sign-in.'));
  }
});

test('invalid tenants and missing provider are refused before a session request', () => {
  for (const invalid of ['', 'common', 'organizations', 'tenant@private.example', `${tenantId}/attacker`]) {
    assert.throws(() => createVsCodeAzureMonitorAuth({}, { tenantId: invalid }), /explicit directory tenant ID/);
  }
  assert.throws(() => createVsCodeAzureMonitorAuth({}, { tenantId }), /authentication is unavailable/);
});
