const { readAgentOpsConfig } = require('./agentops-config');
const { run: runCommand } = require('./shell');

function configValues(readConfig) {
  const config = readConfig();
  return config?.values || config || {};
}

function resolveConnectionString(env = process.env, options = {}) {
  if (env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    return { ok: true, value: env.APPLICATIONINSIGHTS_CONNECTION_STRING, source: 'APPLICATIONINSIGHTS_CONNECTION_STRING' };
  }

  const readConfig = options.readConfig || (() => readAgentOpsConfig({ quiet: true }).values);
  const config = configValues(readConfig);
  const resourceGroup = env.AZURE_RESOURCE_GROUP || env.AGENTOPS_AZURE_RESOURCE_GROUP || config.resourceGroup || 'rg-agentops-dev';
  const app = env.APPLICATIONINSIGHTS_NAME || env.AGENTOPS_APPLICATIONINSIGHTS_NAME || config.appInsightsName || 'appi-agentops-dev';
  const args = ['monitor', 'app-insights', 'component', 'show', '--resource-group', resourceGroup, '--app', app, '--query', 'connectionString', '-o', 'tsv'];
  if (env.AZURE_SUBSCRIPTION_ID || env.AGENTOPS_AZURE_SUBSCRIPTION_ID || config.subscriptionId) {
    args.push('--subscription', env.AZURE_SUBSCRIPTION_ID || env.AGENTOPS_AZURE_SUBSCRIPTION_ID || config.subscriptionId);
  }

  const run = options.run || runCommand;
  const result = run('az', args, { timeout: 15000 });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || 'az monitor app-insights component show failed').trim()
    };
  }
  const value = String(result.stdout || '').trim();
  return value
    ? { ok: true, value, source: 'az monitor app-insights component show' }
    : { ok: false, error: 'Application Insights connection string lookup returned an empty value.' };
}

module.exports = {
  resolveConnectionString
};
