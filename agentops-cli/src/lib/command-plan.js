const path = require('node:path');

function compactEnv(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function commandPlan(command, args = [], platform = process.platform, options = {}) {
  const root = options.root;
  const configuredCloudValues = options.configuredCloudValues || (() => ({}));
  const isWindows = platform === 'win32';
  const scriptPath = script => path.join(root, 'scripts', script);
  const cloudEnv = () => {
    const cloud = configuredCloudValues();
    return compactEnv({
      AZURE_SUBSCRIPTION_ID: cloud.subscriptionId,
      AZURE_RESOURCE_GROUP: cloud.resourceGroup,
      APPLICATIONINSIGHTS_NAME: cloud.appInsightsName,
      AGENTOPS_AZURE_SUBSCRIPTION_ID: cloud.subscriptionId,
      AGENTOPS_AZURE_RESOURCE_GROUP: cloud.resourceGroup,
      AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID: cloud.workspaceId,
      AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME: cloud.workspaceName,
      AGENTOPS_GRAFANA_BASE_URL: cloud.grafanaBaseUrl,
      AGENTOPS_GRAFANA_NAME: cloud.grafanaName,
      AGENTOPS_GRAFANA_DATASOURCE_UID: cloud.grafanaDatasourceUid,
      AGENTOPS_APPLICATIONINSIGHTS_NAME: cloud.appInsightsName,
      AGENTOPS_AZURE_AGENTS_URL: cloud.agentsViewUrl
    });
  };

  if (command === 'install') {
    const shadow = args.includes('--shadow-copilot') || args.includes('--shadow');
    const passThrough = args.filter(arg => !['--shadow-copilot', '--shadow', '--no-shadow-copilot', '--no-shadow'].includes(arg));
    const psInstallArgs = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (['--shadow-copilot', '--shadow', '--no-shadow-copilot', '--no-shadow'].includes(arg)) continue;
      if (arg === '--no-collector') psInstallArgs.push('-NoCollector');
      else if (arg === '--force-collector') psInstallArgs.push('-ForceCollector');
      else if (arg === '--plugin') psInstallArgs.push('-Plugin');
      else if (arg === '--collector-version') {
        psInstallArgs.push('-CollectorVersion', args[index + 1]);
        index += 1;
      } else if (arg.startsWith('--collector-version=')) {
        psInstallArgs.push('-CollectorVersion', arg.slice('--collector-version='.length));
      } else {
        psInstallArgs.push(arg);
      }
    }
    return isWindows
      ? {
          command: 'pwsh',
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(root, 'install-agentops.ps1'),
            ...(shadow ? ['-ShadowCopilot'] : ['-NoShadowCopilot']),
            ...psInstallArgs
          ]
        }
      : {
          command: path.join(root, 'install-agentops.sh'),
          args: shadow ? ['--shadow-copilot', ...passThrough] : passThrough
        };
  }

  if (command === 'enable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('install-copilot-agentops-shim.ps1'), '-ShadowCopilot'] }
      : { command: scriptPath('install-copilot-agentops-shim.sh'), args: ['--shadow-copilot'] };
  }

  if (command === 'disable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('uninstall-copilot-agentops-shim.ps1'), '-KeepAgentopsCommand'] }
      : { command: scriptPath('uninstall-copilot-agentops-shim.sh'), args: ['--keep-agentops-command'] };
  }

  if (command === 'uninstall') {
    const psUninstallArgs = args.map(arg => ({
      '--keep-plugin': '-KeepPlugin',
      '--keep-collector': '-KeepCollector',
      '--keep-binary': '-KeepBinary',
      '--purge': '-Purge',
      '--keep-agentops-command': '-KeepAgentopsCommand'
    }[arg] || arg));
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'uninstall-agentops.ps1'), ...psUninstallArgs] }
      : { command: path.join(root, 'uninstall-agentops.sh'), args };
  }

  if (command === 'copilot') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('copilot-agentops.ps1'), ...args], env: cloudEnv() }
      : { command: scriptPath('copilot-agentops'), args, env: cloudEnv() };
  }

  if (command === 'codex') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('agentops-codex.ps1'), ...args], env: cloudEnv() }
      : { command: scriptPath('agentops-codex'), args, env: cloudEnv() };
  }

  if (command === 'collector' || command === 'start' || command === 'stop') {
    const action = command === 'start' ? 'start' : command === 'stop' ? 'stop' : args[0];
    if (action === 'start') {
      return isWindows
        ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('collector-azuremonitor-up.ps1')], env: cloudEnv() }
        : { command: scriptPath('collector-azuremonitor-up.sh'), args: [], env: cloudEnv() };
    }
    if (action === 'stop') {
      return { command: 'docker', args: ['compose', '-f', path.join(root, 'collector', 'docker-compose.azuremonitor.yaml'), 'down'], env: cloudEnv() };
    }
    throw new Error('collector requires start or stop');
  }

  throw new Error(`No command plan for: ${command}`);
}

module.exports = {
  commandPlan
};
