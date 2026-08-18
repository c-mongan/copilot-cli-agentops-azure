const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { writeJsonFile } = require('./command-output');
const { readJson } = require('./json');
const { defaultUserAgentOpsPath } = require('./paths');

const defaultConfigPath = process.env.AGENTOPS_CONFIG_PATH || defaultUserAgentOpsPath('config.json');

function normalizeAgentOpsConfig(raw = {}) {
  return {
    subscriptionId: raw.subscriptionId || raw.azureSubscriptionId || raw.AZURE_SUBSCRIPTION_ID || raw.AGENTOPS_AZURE_SUBSCRIPTION_ID || '',
    resourceGroup: raw.resourceGroup || raw.azureResourceGroup || raw.AZURE_RESOURCE_GROUP || raw.AGENTOPS_AZURE_RESOURCE_GROUP || '',
    workspaceId: raw.workspaceId || raw.logAnalyticsWorkspaceId || raw.LOG_ANALYTICS_WORKSPACE_ID || raw.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || '',
    workspaceName: raw.workspaceName || raw.logAnalyticsWorkspaceName || raw.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || '',
    grafanaBaseUrl: (raw.grafanaBaseUrl || raw.grafanaUrl || raw.AGENTOPS_GRAFANA_BASE_URL || '').replace(/\/$/, ''),
    grafanaName: raw.grafanaName || raw.GRAFANA_NAME || raw.AGENTOPS_GRAFANA_NAME || '',
    grafanaDatasourceUid: raw.grafanaDatasourceUid || raw.datasourceUid || raw.AGENTOPS_GRAFANA_DATASOURCE_UID || '',
    appInsightsName: raw.appInsightsName || raw.applicationInsightsName || raw.APPLICATIONINSIGHTS_NAME || raw.AGENTOPS_APPLICATIONINSIGHTS_NAME || '',
    agentsViewUrl: raw.agentsViewUrl || raw.azureAgentsUrl || raw.AGENTOPS_AZURE_AGENTS_URL || '',
    logsIngestionEndpoint: raw.logsIngestionEndpoint || raw.AGENTOPS_LOGS_INGESTION_ENDPOINT || '',
    dcrImmutableId: raw.dcrImmutableId || raw.AGENTOPS_DCR_IMMUTABLE_ID || '',
    portalLogsUrl: raw.portalLogsUrl || raw.AGENTOPS_AZURE_PORTAL_LOGS_URL || ''
  };
}

function compactConfig(config) {
  return Object.fromEntries(Object.entries(normalizeAgentOpsConfig(config)).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function readAgentOpsConfig(options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  if (!fs.existsSync(configPath)) {
    return { path: configPath, exists: false, values: {} };
  }

  try {
    return {
      path: configPath,
      exists: true,
      values: compactConfig(readJson(configPath))
    };
  } catch (error) {
    if (options.quiet) return { path: configPath, exists: true, values: {}, error: error.message };
    throw new Error(`Could not read AgentOps config at ${configPath}: ${error.message}`);
  }
}

function writeAgentOpsConfig(values, options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  const existing = readAgentOpsConfig({ configPath, quiet: true }).values;
  const next = compactConfig({ ...existing, ...values });
  if (!options.dryRun) {
    writeJsonFile(configPath, next);
  }
  return { path: configPath, exists: true, values: next, dryRun: Boolean(options.dryRun) };
}

function parseEnvAssignments(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\"/g, '"');
  }
  return values;
}

function configFromEnvValues(values = {}) {
  return compactConfig({
    subscriptionId: values.AGENTOPS_AZURE_SUBSCRIPTION_ID || values.AZURE_SUBSCRIPTION_ID,
    resourceGroup: values.AGENTOPS_AZURE_RESOURCE_GROUP || values.AZURE_RESOURCE_GROUP,
    workspaceId: values.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || values.LOG_ANALYTICS_WORKSPACE_ID,
    workspaceName: values.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || values.LOG_ANALYTICS_WORKSPACE_NAME,
    grafanaBaseUrl: values.AGENTOPS_GRAFANA_BASE_URL || values.GRAFANA_ENDPOINT,
    grafanaName: values.AGENTOPS_GRAFANA_NAME || values.GRAFANA_NAME,
    grafanaDatasourceUid: values.AGENTOPS_GRAFANA_DATASOURCE_UID,
    appInsightsName: values.AGENTOPS_APPLICATIONINSIGHTS_NAME || values.APPLICATIONINSIGHTS_NAME,
    agentsViewUrl: values.AGENTOPS_AZURE_AGENTS_URL,
    logsIngestionEndpoint: values.AGENTOPS_LOGS_INGESTION_ENDPOINT,
    dcrImmutableId: values.AGENTOPS_DCR_IMMUTABLE_ID,
    portalLogsUrl: values.AGENTOPS_AZURE_PORTAL_LOGS_URL
  });
}

function parseConfigureSetArgs(args) {
  const map = {
    '--subscription-id': 'subscriptionId',
    '--resource-group': 'resourceGroup',
    '--workspace-id': 'workspaceId',
    '--workspace-name': 'workspaceName',
    '--grafana-url': 'grafanaBaseUrl',
    '--grafana-name': 'grafanaName',
    '--datasource-uid': 'grafanaDatasourceUid',
    '--app-insights-name': 'appInsightsName',
    '--agents-url': 'agentsViewUrl',
    '--logs-ingestion-endpoint': 'logsIngestionEndpoint',
    '--dcr-immutable-id': 'dcrImmutableId',
    '--portal-logs-url': 'portalLogsUrl'
  };
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' || arg === '--dry-run') continue;
    const key = map[arg];
    if (!key) throw new Error(`Unknown configure set option: ${arg}`);
    if (!args[index + 1]) throw new Error(`${arg} requires a value`);
    values[key] = args[index + 1];
    index += 1;
  }
  return compactConfig(values);
}

function parseConfigureArgs(args) {
  const subcommandIndex = args.findIndex(arg => !arg.startsWith('--'));
  const subcommand = subcommandIndex === -1 ? 'show' : args[subcommandIndex];
  const subcommandArgs = subcommandIndex === -1 ? args : args.slice(subcommandIndex + 1);
  return {
    subcommand,
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run'),
    values: subcommand === 'set' ? parseConfigureSetArgs(subcommandArgs) : {}
  };
}

function agentopsConfigure(options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  const subcommand = options.subcommand || 'show';
  if (subcommand === 'show') {
    return { action: 'show', ...readAgentOpsConfig({ configPath }) };
  }
  if (subcommand === 'set') {
    if (Object.keys(options.values || {}).length === 0) throw new Error('configure set requires at least one value');
    return { action: 'set', ...writeAgentOpsConfig(options.values, { configPath, dryRun: options.dryRun }) };
  }
  if (subcommand === 'import-azd') {
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync('azd', ['env', 'get-values'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (result.error) {
      return { action: 'import-azd', path: configPath, ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return { action: 'import-azd', path: configPath, ok: false, error: (result.stderr || result.stdout || `azd exited with status ${result.status}`).trim() };
    }
    const values = configFromEnvValues(parseEnvAssignments(result.stdout));
    if (Object.keys(values).length === 0) {
      return { action: 'import-azd', path: configPath, ok: false, error: 'azd env get-values did not include AgentOps configuration values' };
    }
    return { action: 'import-azd', ok: true, ...writeAgentOpsConfig(values, { configPath, dryRun: options.dryRun }) };
  }
  throw new Error('configure requires show, set, or import-azd');
}

function renderConfigure(result) {
  const lines = ['AgentOps config', '', `Path: ${result.path}`];
  if (result.error) lines.push(`Status: ${result.error}`);
  if (result.dryRun) lines.push('Mode: dry-run');
  const values = result.values || {};
  const labels = [
    ['subscriptionId', 'Subscription'],
    ['resourceGroup', 'Resource group'],
    ['workspaceId', 'Workspace ID'],
    ['workspaceName', 'Workspace name'],
    ['grafanaBaseUrl', 'Grafana URL'],
    ['grafanaName', 'Grafana resource'],
    ['grafanaDatasourceUid', 'Grafana datasource UID'],
    ['appInsightsName', 'Application Insights'],
    ['agentsViewUrl', 'Azure Monitor Agents URL'],
    ['logsIngestionEndpoint', 'Logs ingestion endpoint'],
    ['dcrImmutableId', 'DCR immutable ID'],
    ['portalLogsUrl', 'Portal logs URL']
  ];
  for (const [key, label] of labels) {
    lines.push(`${label}: ${values[key] || 'not set'}`);
  }
  lines.push('', 'Next:');
  lines.push('- agentops validate-azure');
  lines.push('- agentops collector smoke --privacy strict --poison');
  return `${lines.join('\n')}\n`;
}

function configuredCloudValues(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readAgentOpsConfig({ configPath: options.configPath, quiet: true }).values;
  const defaults = options.defaults || {};
  const optionValueOr = (key, ...values) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) return options[key];
    return values.find(value => value !== undefined && value !== null && value !== '') || '';
  };
  const configuredGrafanaBaseUrl = optionValueOr('grafanaBaseUrl', env.AGENTOPS_GRAFANA_BASE_URL, config.grafanaBaseUrl);
  return {
    subscriptionId: optionValueOr('subscriptionId', env.AGENTOPS_AZURE_SUBSCRIPTION_ID, env.AZURE_SUBSCRIPTION_ID, config.subscriptionId),
    resourceGroup: optionValueOr('resourceGroup', env.AGENTOPS_AZURE_RESOURCE_GROUP, env.AZURE_RESOURCE_GROUP, config.resourceGroup, defaults.azureResourceGroup),
    workspaceId: optionValueOr('workspaceId', env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID, env.LOG_ANALYTICS_WORKSPACE_ID, config.workspaceId),
    workspaceName: optionValueOr('workspaceName', env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME, config.workspaceName, defaults.logAnalyticsWorkspaceName),
    grafanaBaseUrl: configuredGrafanaBaseUrl.replace(/\/$/, ''),
    grafanaName: optionValueOr('grafanaName', env.AGENTOPS_GRAFANA_NAME, env.GRAFANA_NAME, config.grafanaName),
    grafanaDatasourceUid: optionValueOr('grafanaDatasourceUid', env.AGENTOPS_GRAFANA_DATASOURCE_UID, config.grafanaDatasourceUid, defaults.grafanaDatasourceUid),
    appInsightsName: optionValueOr('appInsightsName', env.APPLICATIONINSIGHTS_NAME, env.AGENTOPS_APPLICATIONINSIGHTS_NAME, config.appInsightsName, defaults.appInsightsName),
    agentsViewUrl: optionValueOr('agentsViewUrl', env.AGENTOPS_AZURE_AGENTS_URL, config.agentsViewUrl),
    logsIngestionEndpoint: optionValueOr('logsIngestionEndpoint', env.AGENTOPS_LOGS_INGESTION_ENDPOINT, config.logsIngestionEndpoint),
    dcrImmutableId: optionValueOr('dcrImmutableId', env.AGENTOPS_DCR_IMMUTABLE_ID, config.dcrImmutableId)
  };
}

module.exports = {
  agentopsConfigure,
  compactConfig,
  configFromEnvValues,
  configuredCloudValues,
  defaultConfigPath,
  normalizeAgentOpsConfig,
  parseConfigureArgs,
  parseConfigureSetArgs,
  parseEnvAssignments,
  readAgentOpsConfig,
  renderConfigure,
  writeAgentOpsConfig
};
