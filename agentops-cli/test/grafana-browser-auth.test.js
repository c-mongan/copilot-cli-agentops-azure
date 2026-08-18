const assert = require('node:assert/strict');
const test = require('node:test');

const { azureCliGrafanaBrowserAuth, MANAGED_GRAFANA_RESOURCE_APP_ID } = require('../src/lib/azure/grafana-browser-auth');

const approved = '11111111-1111-4111-8111-111111111111';

test('Azure CLI Grafana auth is subscription-guarded and returns non-secret evidence', () => {
  const calls = [];
  const result = azureCliGrafanaBrowserAuth({
    env: { AGENTOPS_AZURE_SUBSCRIPTION_ID: approved, AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: approved },
    spawnSync(command, args) {
      calls.push([command, args]);
      if (args[0] === 'account' && args[1] === 'show') return { status: 0, stdout: `${approved}\n`, stderr: '' };
      return { status: 0, stdout: 'secret-token-value\n', stderr: '' };
    }
  });

  assert.equal(result.token, 'secret-token-value');
  assert.equal(result.evidence.tokenPersisted, false);
  assert.equal(JSON.stringify(result.evidence).includes(result.token), false);
  assert.deepEqual(calls[1][1], [
    'account', 'get-access-token', '--subscription', approved,
    '--resource', MANAGED_GRAFANA_RESOURCE_APP_ID, '--query', 'accessToken', '-o', 'tsv'
  ]);
});

test('Azure CLI Grafana auth fails closed before token acquisition on subscription mismatch', () => {
  let calls = 0;
  assert.throws(() => azureCliGrafanaBrowserAuth({
    env: { AGENTOPS_AZURE_SUBSCRIPTION_ID: approved, AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: approved },
    spawnSync() {
      calls += 1;
      return { status: 0, stdout: 'different-subscription\n', stderr: '' };
    }
  }), /authentication refused/);
  assert.equal(calls, 1);
});
