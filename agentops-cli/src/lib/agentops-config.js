const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeJsonFile } = require('./command-output');
const { readJson } = require('./json');
const { defaultUserAgentOpsPath } = require('./paths');

const defaultConfigPath = process.env.AGENTOPS_CONFIG_PATH || defaultUserAgentOpsPath('config.json');

function projectRootFor(cwd = process.cwd()) {
  let current;
  try {
    current = fs.realpathSync.native(path.resolve(cwd));
  } catch {
    return '';
  }
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function projectAgentOpsConfigPath(options = {}) {
  const root = projectRootFor(options.cwd || process.cwd());
  if (!root) return '';
  const homeDir = options.homeDir || os.homedir();
  const agentOpsHome = options.agentOpsHome || process.env.AGENTOPS_HOME || defaultUserAgentOpsPath('', homeDir);
  const projectId = crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
  return path.join(agentOpsHome, 'projects', `${projectId}.json`);
}

function normalizeRuntimeLabel(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,63}$/.test(label) ? label : '';
}

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
    portalLogsUrl: raw.portalLogsUrl || raw.AGENTOPS_AZURE_PORTAL_LOGS_URL || '',
    pythonRuntime: normalizeRuntimeLabel(raw.pythonRuntime || raw.AGENTOPS_PYTHON_RUNTIME),
    nodeRuntime: normalizeRuntimeLabel(raw.nodeRuntime || raw.AGENTOPS_NODE_RUNTIME),
    typescriptLoader: normalizeRuntimeLabel(raw.typescriptLoader || raw.AGENTOPS_TYPESCRIPT_LOADER)
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
  const configPath = options.scope === 'project'
    ? projectAgentOpsConfigPath(options)
    : (options.configPath || defaultConfigPath);
  if (!configPath) throw new Error('Project-scoped AgentOps config requires a directory inside a Git repository.');
  const existing = readAgentOpsConfig({ configPath, quiet: true }).values;
  const next = compactConfig({ ...existing, ...values });
  if (!options.dryRun) {
    writeJsonFile(configPath, next);
    if (options.scope === 'project') {
      fs.chmodSync(path.dirname(configPath), 0o700);
      fs.chmodSync(configPath, 0o600);
    }
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
    '--portal-logs-url': 'portalLogsUrl',
    '--python-runtime': 'pythonRuntime',
    '--node-runtime': 'nodeRuntime',
    '--typescript-loader': 'typescriptLoader'
  };
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' || arg === '--dry-run' || arg === '--project' || arg === '--user') continue;
    const key = map[arg];
    if (!key) throw new Error(`Unknown configure set option: ${arg}`);
    if (!args[index + 1]) throw new Error(`${arg} requires a value`);
    values[key] = args[index + 1];
    index += 1;
  }
  for (const key of ['pythonRuntime', 'nodeRuntime', 'typescriptLoader']) {
    if (values[key] !== undefined && !normalizeRuntimeLabel(values[key])) {
      const flag = key === 'pythonRuntime' ? '--python-runtime' : key === 'nodeRuntime' ? '--node-runtime' : '--typescript-loader';
      throw new Error(`${flag} requires a short label using letters, numbers, dot, underscore, plus, at sign, or hyphen; do not enter a path or command arguments`);
    }
  }
  return compactConfig(values);
}

function parseConfigureArgs(args) {
  const subcommandIndex = args.findIndex(arg => !arg.startsWith('--'));
  const subcommand = subcommandIndex === -1 ? 'show' : args[subcommandIndex];
  const subcommandArgs = subcommandIndex === -1 ? args : args.slice(subcommandIndex + 1);
  if (args.includes('--project') && args.includes('--user')) {
    throw new Error('--project and --user cannot be combined');
  }
  return {
    subcommand,
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run'),
    scope: args.includes('--project') ? 'project' : (args.includes('--user') ? 'user' : undefined),
    values: subcommand === 'set' ? parseConfigureSetArgs(subcommandArgs) : {}
  };
}

function agentopsConfigure(options = {}) {
  const subcommand = options.subcommand || 'show';
  const projectConfigPath = projectAgentOpsConfigPath(options);
  const autoProjectShow = subcommand === 'show'
    && options.scope !== 'user'
    && !process.env.AGENTOPS_CONFIG_PATH
    && projectConfigPath
    && fs.existsSync(projectConfigPath);
  const scope = options.scope === 'project' || autoProjectShow ? 'project' : 'user';
  const configPath = scope === 'project'
    ? projectConfigPath
    : (options.configPath || defaultConfigPath);
  if (!configPath) throw new Error('Project-scoped AgentOps config requires a directory inside a Git repository.');
  if (subcommand === 'show') {
    return { action: 'show', scope, ...readAgentOpsConfig({ configPath }) };
  }
  if (subcommand === 'set') {
    if (Object.keys(options.values || {}).length === 0) throw new Error('configure set requires at least one value');
    return { action: 'set', scope, ...writeAgentOpsConfig(options.values, { configPath, scope, cwd: options.cwd, homeDir: options.homeDir, agentOpsHome: options.agentOpsHome, dryRun: options.dryRun }) };
  }
  if (subcommand === 'import-azd') {
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync('azd', ['env', 'get-values'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (result.error) {
      return { action: 'import-azd', scope, path: configPath, ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return { action: 'import-azd', scope, path: configPath, ok: false, error: (result.stderr || result.stdout || `azd exited with status ${result.status}`).trim() };
    }
    const values = configFromEnvValues(parseEnvAssignments(result.stdout));
    if (Object.keys(values).length === 0) {
      return { action: 'import-azd', scope, path: configPath, ok: false, error: 'azd env get-values did not include AgentOps configuration values' };
    }
    return {
      action: 'import-azd',
      scope,
      ok: true,
      ...writeAgentOpsConfig(values, {
        configPath,
        scope,
        cwd: options.cwd,
        homeDir: options.homeDir,
        agentOpsHome: options.agentOpsHome,
        dryRun: options.dryRun
      })
    };
  }
  throw new Error('configure requires show, set, or import-azd');
}

function renderConfigure(result) {
  const lines = ['AgentOps config', '', `Path: ${result.path}`];
  if (result.scope) lines.push(`Scope: ${result.scope}`);
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
    ['portalLogsUrl', 'Portal logs URL'],
    ['pythonRuntime', 'Python runtime label'],
    ['nodeRuntime', 'Node runtime label'],
    ['typescriptLoader', 'TypeScript loader label']
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
  const userConfig = options.config || readAgentOpsConfig({ configPath: options.configPath, quiet: true }).values;
  const projectConfigPath = options.projectConfigPath || projectAgentOpsConfigPath(options);
  const scopedProjectConfig = !options.config && !options.disableProjectConfig && !env.AGENTOPS_CONFIG_PATH && projectConfigPath
    ? readAgentOpsConfig({ configPath: projectConfigPath, quiet: true })
    : null;
  // A project config is a target boundary: omitted project fields must not
  // silently inherit resource names or workspace IDs from another project.
  const config = scopedProjectConfig?.exists ? scopedProjectConfig.values : options.projectOnly ? {} : userConfig;
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
  projectAgentOpsConfigPath,
  projectRootFor,
  readAgentOpsConfig,
  renderConfigure,
  writeAgentOpsConfig
};
