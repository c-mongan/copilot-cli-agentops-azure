const childProcess = require('node:child_process');

const { checkAzureSubscription } = require('./subscription-guard');

const MANAGED_GRAFANA_RESOURCE_APP_ID = 'ce34e7e5-485f-4d76-964f-b3d2b16d1e4f';

function azureCliGrafanaBrowserAuth(options = {}) {
  const env = options.env || process.env;
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const subscription = checkAzureSubscription({
    env,
    spawnSync,
    approvedSubscriptionIds: options.approvedSubscriptionIds
  });
  if (!subscription.ok) {
    throw new Error(`Azure CLI Grafana authentication refused: ${subscription.error.replaceAll('write', 'access')}`);
  }

  const result = spawnSync('az', [
    'account', 'get-access-token',
    '--subscription', subscription.expected,
    '--resource', MANAGED_GRAFANA_RESOURCE_APP_ID,
    '--query', 'accessToken',
    '-o', 'tsv'
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const token = String(result.stdout || '').trim();
  if (result.error || result.status !== 0 || !token) {
    throw new Error(`Could not obtain a temporary Azure Managed Grafana token${result.error ? `: ${result.error.message}` : ` (az exited ${result.status})`}.`);
  }

  return {
    token,
    evidence: {
      method: 'azure-cli-bearer',
      subscriptionId: subscription.expected,
      resource: MANAGED_GRAFANA_RESOURCE_APP_ID,
      tokenPersisted: false
    }
  };
}

module.exports = {
  MANAGED_GRAFANA_RESOURCE_APP_ID,
  azureCliGrafanaBrowserAuth
};
