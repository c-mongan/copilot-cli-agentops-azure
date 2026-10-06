const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function createCloudValidation(dependencies = {}) {
  const {
    azureResourceGroup,
    configuredCloudValuesFromConfig,
    grafanaDatasourceUid,
    logAnalyticsWorkspaceName,
    readJson,
    root,
    runAzureLogAnalyticsQuery,
    validateAzureBase
  } = dependencies;

  function configuredCloudValues(options = {}) {
    return configuredCloudValuesFromConfig({
      ...options,
      defaults: {
        azureResourceGroup,
        logAnalyticsWorkspaceName,
        grafanaDatasourceUid,
        appInsightsName: 'appi-agentops-dev'
      }
    });
  }

  function validationCloudValues(options = {}) {
    const cloud = configuredCloudValuesFromConfig({
      ...options,
      defaults: {
        azureResourceGroup,
        logAnalyticsWorkspaceName,
        grafanaDatasourceUid
      }
    });
    return cloud;
  }

  function listGrafanaDashboardFiles(options = {}) {
    const dirs = [options.grafanaDir || path.join(root, 'grafana')];
    if (options.includeV2 !== false) dirs.push(path.join(root, 'grafana', 'dashboards', 'v2'));
    return dirs.flatMap(dir => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => path.join(dir, file));
    })
      .map(fullPath => {
        const dashboard = readJson(fullPath);
        return {
          file: path.relative(root, fullPath),
          uid: dashboard.uid || path.basename(file, '.json'),
          title: dashboard.title || path.basename(file, '.json')
        };
      })
      .sort((left, right) => left.uid.localeCompare(right.uid));
  }

  function flattenGrafanaList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.value)) return payload.value;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.dashboards)) return payload.dashboards;
    if (Array.isArray(payload?.dataSources)) return payload.dataSources;
    if (Array.isArray(payload?.datasources)) return payload.datasources;
    return [];
  }

  function grafanaItemUid(item) {
    return item?.uid || item?.dashboard?.uid || item?.model?.uid || item?.slug || item?.name || item?.title || '';
  }

  function grafanaDashboardImportCommand(cloud) {
    const args = [
      'agentops dashboard import --yes',
      cloud.resourceGroup ? `--resource-group ${cloud.resourceGroup}` : null,
      cloud.grafanaName ? `--grafana-name ${cloud.grafanaName}` : null
    ].filter(Boolean);
    return args.join(' ');
  }

  function runGrafanaDashboardImportRemediation(cloud, options = {}) {
    const args = [
      path.join(root, 'agentops-cli', 'src', 'index.js'),
      'dashboard',
      'import',
      '--yes',
      ...(cloud.resourceGroup ? ['--resource-group', cloud.resourceGroup] : []),
      ...(cloud.grafanaName ? ['--grafana-name', cloud.grafanaName] : [])
    ];
    const spawnSync = options.spawnDashboardImport || options.spawnSync || childProcess.spawnSync;
    const result = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      ok: result.status === 0,
      command: grafanaDashboardImportCommand(cloud),
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error?.message || null
    };
  }

  function isConfiguredValue(value, placeholderPattern) {
    return Boolean(value) && !placeholderPattern.test(value);
  }

  function validateAzure(options = {}) {
    return validateAzureBase(options, {
      configuredCloudValues: validationCloudValues,
      isConfiguredValue,
      runAzureLogAnalyticsQuery,
      listGrafanaDashboardFiles,
      flattenGrafanaList,
      grafanaItemUid,
      grafanaDashboardImportCommand,
      runGrafanaDashboardImportRemediation
    });
  }

  return {
    configuredCloudValues,
    flattenGrafanaList,
    grafanaDashboardImportCommand,
    grafanaItemUid,
    isConfiguredValue,
    listGrafanaDashboardFiles,
    runGrafanaDashboardImportRemediation,
    validateAzure
  };
}

module.exports = { createCloudValidation };
