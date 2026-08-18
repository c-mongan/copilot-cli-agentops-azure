const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { hasFlag, optionValue } = require('./args');
const { dashboardJsonFiles } = require('./dashboard-validation');
const { repoRoot } = require('./paths');
const { checkAzureSubscription } = require('./azure/subscription-guard');

function dashboardImportPlan(args = [], options = {}) {
  const env = options.env || process.env;
  const v2Only = !hasFlag(args, '--all');
  const folder = optionValue(args, '--folder', v2Only ? 'AgentOps for Azure' : 'AgentOps');
  const resourceGroup = optionValue(args, '--resource-group', env.AZURE_RESOURCE_GROUP || '');
  const grafanaName = optionValue(args, '--grafana-name', env.GRAFANA_NAME || env.AGENTOPS_GRAFANA_NAME || '');
  const script = path.join(repoRoot, 'scripts', 'grafana-import-dashboard.sh');
  const files = dashboardJsonFiles()
    .filter(file => !v2Only || file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`));
  const command = [
    `GRAFANA_FOLDER=${JSON.stringify(folder)}`,
    v2Only ? 'AGENTOPS_V2_ONLY=true' : 'AGENTOPS_V2_ONLY=false AGENTOPS_INCLUDE_V2=true AGENTOPS_INCLUDE_LEGACY=true',
    resourceGroup ? `AZURE_RESOURCE_GROUP=${JSON.stringify(resourceGroup)}` : 'AZURE_RESOURCE_GROUP=<resource-group>',
    grafanaName ? `GRAFANA_NAME=${JSON.stringify(grafanaName)}` : 'GRAFANA_NAME=<managed-grafana-name>',
    script
  ].join(' ');

  return {
    ok: files.length > 0,
    dry_run: !hasFlag(args, '--yes'),
    v2_only: v2Only,
    folder,
    script,
    dashboards: files.length,
    files,
    requires: [
      'az login',
      'Azure CLI amg extension',
      'Grafana Editor/Admin access',
      'Azure Monitor datasource UID configured'
    ],
    command,
    errors: files.length > 0 ? [] : ['no dashboards found to import']
  };
}

function runDashboardImport(args = [], options = {}) {
  const plan = dashboardImportPlan(args, options);
  if (!plan.ok || plan.dry_run) return plan;

  const env = {
    ...(options.env || process.env),
    GRAFANA_FOLDER: plan.folder,
    AGENTOPS_V2_ONLY: plan.v2_only ? 'true' : 'false',
    AGENTOPS_INCLUDE_V2: 'true',
    AGENTOPS_INCLUDE_LEGACY: plan.v2_only ? 'false' : 'true'
  };
  const resourceGroup = optionValue(args, '--resource-group', env.AZURE_RESOURCE_GROUP || '');
  const grafanaName = optionValue(args, '--grafana-name', env.GRAFANA_NAME || env.AGENTOPS_GRAFANA_NAME || '');
  if (resourceGroup) env.AZURE_RESOURCE_GROUP = resourceGroup;
  if (grafanaName) env.GRAFANA_NAME = grafanaName;

  const spawn = options.spawnSync || spawnSync;
  const subscription = checkAzureSubscription({
    spawnSync: spawn,
    env,
    expectedSubscriptionId: options.expectedSubscriptionId,
    approvedSubscriptionIds: options.approvedSubscriptionIds
  });
  if (!subscription.ok) {
    return {
      ...plan,
      dry_run: false,
      ok: false,
      executed: false,
      subscription_guard: subscription,
      errors: [subscription.error]
    };
  }
  const result = spawn(plan.script, [], {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });

  return {
    ...plan,
    dry_run: false,
    executed: true,
    subscription_guard: subscription,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    errors: result.status === 0 ? [] : [result.stderr || result.stdout || `dashboard import exited ${result.status}`]
  };
}

module.exports = {
  dashboardImportPlan,
  runDashboardImport
};
