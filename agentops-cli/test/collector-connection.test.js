const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveConnectionString } = require('../src/lib/collector-connection');

test('collector connection string resolver prefers explicit environment value', () => {
  let called = false;
  const result = resolveConnectionString({
    APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=env'
  }, {
    run() {
      called = true;
      return { status: 1 };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 'InstrumentationKey=env');
  assert.equal(result.source, 'APPLICATIONINSIGHTS_CONNECTION_STRING');
  assert.equal(called, false);
});

test('collector connection string resolver builds Azure CLI lookup from env and config', () => {
  const calls = [];
  const result = resolveConnectionString({
    AZURE_RESOURCE_GROUP: '',
    APPLICATIONINSIGHTS_NAME: ''
  }, {
    readConfig: () => ({
      resourceGroup: 'rg-from-config',
      appInsightsName: 'appi-from-config',
      subscriptionId: 'sub-from-config'
    }),
    run(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: ' InstrumentationKey=from-az \n' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 'InstrumentationKey=from-az');
  assert.equal(result.source, 'az monitor app-insights component show');
  assert.equal(calls[0].command, 'az');
  assert.deepEqual(calls[0].args, [
    'monitor',
    'app-insights',
    'component',
    'show',
    '--resource-group',
    'rg-from-config',
    '--app',
    'appi-from-config',
    '--query',
    'connectionString',
    '-o',
    'tsv',
    '--subscription',
    'sub-from-config'
  ]);
  assert.equal(calls[0].options.timeout, 15000);
});

test('collector connection string resolver reports Azure CLI failures and empty output', () => {
  const failed = resolveConnectionString({}, {
    readConfig: () => ({}),
    run: () => ({ status: 1, stderr: 'az failed' })
  });
  const empty = resolveConnectionString({}, {
    readConfig: () => ({}),
    run: () => ({ status: 0, stdout: '\n' })
  });

  assert.deepEqual(failed, { ok: false, error: 'az failed' });
  assert.deepEqual(empty, { ok: false, error: 'Application Insights connection string lookup returned an empty value.' });
});
