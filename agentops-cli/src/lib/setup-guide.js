const childProcess = require('node:child_process');

function createSetupGuide(dependencies = {}) {
  const {
    commandCandidates,
    configFromEnvValues,
    configuredCloudValues,
    defaultInstallDir,
    grafanaDashboardImportCommand,
    installedShimStatus,
    isConfiguredValue,
    parseEnvAssignments,
    realCopilotSmokeCommand
  } = dependencies;

  function setupToolStatus(name, options = {}) {
    if (name === 'node') {
      return { name, ok: true, path: process.execPath, version: process.version };
    }

    const availability = options.commandAvailability || {};
    if (Object.prototype.hasOwnProperty.call(availability, name)) {
      return {
        name,
        ok: Boolean(availability[name]),
        path: options.commandPaths?.[name] || null
      };
    }

    const candidates = commandCandidates(name);
    return { name, ok: candidates.length > 0, path: candidates[0] || null };
  }

  function azdEnvironmentStatus(options = {}, azdAvailable = true) {
    if (!azdAvailable) {
      return { checked: false, ok: false, values: {}, detail: 'azd is not available on PATH.' };
    }

    if (Object.prototype.hasOwnProperty.call(options, 'azdValues')) {
      const values = configFromEnvValues(parseEnvAssignments(options.azdValues));
      return {
        checked: true,
        ok: Object.keys(values).length > 0,
        values,
        detail: Object.keys(values).length > 0
          ? 'azd environment contains AgentOps outputs.'
          : 'azd environment does not contain AgentOps outputs yet.'
      };
    }

    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync('azd', ['env', 'get-values'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });

    if (result.error) {
      return { checked: true, ok: false, values: {}, detail: result.error.message };
    }
    if (result.status !== 0) {
      const rawDetail = (result.stderr || result.stdout || `azd exited with status ${result.status}`).trim();
      const detail = /out of date/i.test(rawDetail) && !/error|failed|not found/i.test(rawDetail)
        ? 'azd env get-values did not return AgentOps outputs. Run azd provision or select the right azd environment.'
        : rawDetail;
      return {
        checked: true,
        ok: false,
        values: {},
        detail
      };
    }

    const values = configFromEnvValues(parseEnvAssignments(result.stdout));
    return {
      checked: true,
      ok: Object.keys(values).length > 0,
      values,
      detail: Object.keys(values).length > 0
        ? 'azd environment contains AgentOps outputs.'
        : 'azd environment does not contain AgentOps outputs yet.'
    };
  }

  function parseSetupArgs(args) {
    return {
      json: args.includes('--json')
    };
  }

  function azureAccountStatus(options = {}, azAvailable = true) {
    if (!azAvailable) return { checked: false, ok: false, id: null, name: null, detail: 'Azure CLI is not available.' };
    if (options.azureAccount) {
      return {
        checked: true,
        ok: Boolean(options.azureAccount.id),
        id: options.azureAccount.id || null,
        name: options.azureAccount.name || null,
        detail: options.azureAccount.id ? 'Active Azure subscription found.' : 'Azure CLI account is not signed in.'
      };
    }
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync('az', ['account', 'show', '-o', 'json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    let account = null;
    try {
      account = result.status === 0 ? JSON.parse(result.stdout || '{}') : null;
    } catch {
      account = null;
    }
    return {
      checked: true,
      ok: Boolean(account?.id),
      id: account?.id || null,
      name: account?.name || null,
      detail: account?.id ? 'Active Azure subscription found.' : (result.stderr || result.stdout || 'Run az login.').trim()
    };
  }

  function azureResourceGroupStatus(options = {}, azAvailable = true) {
    const resourceGroup = options.resourceGroup || '';
    if (!resourceGroup) {
      return {
        checked: false,
        exists: null,
        ok: false,
        status: 'not-configured',
        detail: 'No Azure resource group is configured.'
      };
    }
    if (!azAvailable) {
      return {
        checked: false,
        exists: null,
        ok: false,
        status: 'not-checked',
        detail: 'Azure CLI is not available.'
      };
    }
    if (options.resourceGroupExists !== undefined) {
      const exists = Boolean(options.resourceGroupExists);
      return {
        checked: true,
        exists,
        ok: exists,
        status: exists ? 'ready' : 'missing',
        detail: exists
          ? `Configured Azure resource group ${resourceGroup} exists.`
          : `Configured Azure resource group ${resourceGroup} was not found.`
      };
    }

    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const args = ['group', 'exists', '--name', resourceGroup];
    if (options.subscriptionId) args.push('--subscription', options.subscriptionId);
    const result = spawnSync('az', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const raw = String(result.stdout || '').trim().toLowerCase();
    const failed = result.status !== 0 || result.error;
    const exists = !failed && raw === 'true';
    return {
      checked: !failed,
      exists: failed ? null : exists,
      ok: !failed && exists,
      status: failed ? 'not-checked' : exists ? 'ready' : 'missing',
      detail: failed
        ? (result.stderr || result.stdout || result.error?.message || 'Azure resource group lookup failed.').trim()
        : exists
          ? `Configured Azure resource group ${resourceGroup} exists.`
          : `Configured Azure resource group ${resourceGroup} was not found.`
    };
  }

  function agentopsSetupGuide(options = {}) {
    const tools = ['node', 'az', 'azd', 'docker', 'copilot']
      .map(name => setupToolStatus(name, options));
    const toolByName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    const shim = installedShimStatus(options.installDir || defaultInstallDir);
    const cloud = configuredCloudValues(options);
    const azureAccount = azureAccountStatus(options, toolByName.az.ok);
    const expectedSubscriptionId = cloud.subscriptionId || null;
    const subscriptionMatch = Boolean(expectedSubscriptionId && azureAccount.id && expectedSubscriptionId.toLowerCase() === azureAccount.id.toLowerCase());
    const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
    const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
    const agentsViewConfigured = isConfiguredValue(cloud.agentsViewUrl, /^$/);
    const cloudConfigured = workspaceConfigured && (grafanaConfigured || agentsViewConfigured);
    const resourceGroup = cloudConfigured
      ? azureResourceGroupStatus({
          resourceGroup: cloud.resourceGroup,
          subscriptionId: expectedSubscriptionId,
          resourceGroupExists: options.resourceGroupExists,
          spawnSync: options.spawnSync
        }, toolByName.az.ok)
      : {
          checked: false,
          exists: null,
          ok: false,
          status: 'not-configured',
          detail: 'Cloud binding is incomplete; Azure target lookup is deferred.'
        };
    const cloudTargetReady = cloudConfigured && resourceGroup.ok && subscriptionMatch;
    const localReady = Boolean(toolByName.node.ok && shim.agentops_cli_installed && shim.copilot_agentops_installed);
    const azd = azdEnvironmentStatus(options, toolByName.azd.ok);
    const dashboardCloud = cloudConfigured ? cloud : { ...cloud, ...azd.values };
    const dashboardGrafanaConfigured = isConfiguredValue(dashboardCloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
    const dashboardImportCommand = dashboardGrafanaConfigured
      ? grafanaDashboardImportCommand(dashboardCloud)
      : 'Optional advanced path: agentops configure set --grafana-url <grafana-url> then agentops dashboard import';

    const phases = [
      {
        name: '1. Provision Azure once',
        status: cloudTargetReady ? 'done' : cloudConfigured ? 'needs-review' : (azd.ok ? 'ready-to-import' : 'needed'),
        commands: cloudTargetReady
          ? ['agentops configure show']
          : cloudConfigured
          ? ['agentops validate-azure --last 24h', 'confirm the intended Azure resource group before any write']
          : ['az login', 'azd provision'],
        verify: 'agentops configure import-azd'
      },
      {
        name: '2. Install local AgentOps utility',
        status: shim.agentops_cli_installed && shim.copilot_agentops_installed ? 'done' : 'needed',
        commands: [
          'agentops install',
          'export PATH="$HOME/.local/bin:$PATH"'
        ],
        verify: 'agentops status'
      },
      {
        name: '3. Bind local CLI to Azure outputs',
        status: cloudTargetReady ? 'done' : cloudConfigured ? 'needs-review' : (azd.ok ? 'needed' : 'blocked'),
        commands: cloudTargetReady
          ? ['agentops configure show']
          : cloudConfigured
          ? ['agentops configure show', 'do not redirect to another resource group automatically']
          : azd.ok
          ? ['agentops configure import-azd']
          : ['agentops configure set --resource-group <resource-group> --workspace-id <workspace-id> --agents-url <azure-monitor-agents-view-url> --app-insights-name <app-insights-name>'],
        verify: 'agentops configure show'
      },
      {
        name: '4. Validate and smoke test',
        status: cloudTargetReady ? 'ready' : 'blocked',
        commands: [
          'agentops validate-enterprise',
          'agentops validate-azure',
          'agentops collector smoke --privacy strict --poison'
        ],
        verify: 'agentops latest --last 2h'
      },
      {
        name: '5. Observe a real run',
        status: cloudTargetReady ? 'ready' : 'blocked',
        commands: [
          'agentops copilot -p "Reply with exactly: agentops smoke."',
          'agentops latest --last 2h',
          'agentops open'
        ],
        verify: 'Open the newest run in Run Story.'
      }
    ];

    const firstRun = {
      name: 'First-run loop',
      ready: cloudTargetReady && shim.agentops_cli_installed && shim.copilot_agentops_installed,
      read_only: true,
      setup_command: 'agentops setup',
      guided_command: 'agentops init --full',
      bind_command: cloudTargetReady
        ? 'agentops configure show'
        : cloudConfigured
        ? 'agentops validate-azure --last 24h'
        : azd.ok
        ? 'agentops configure import-azd'
        : 'az login && azd provision && agentops configure import-azd',
      privacy_smoke_command: 'agentops collector smoke --privacy strict --poison --json',
      smoke_command: 'agentops smoke --real-copilot --wait 2m --poll 10s --open-browser',
      run_command: realCopilotSmokeCommand(),
      latest_command: 'agentops latest --last 2h',
      replay_command: 'agentops replay latest --last 2h',
      open_command: 'agentops open latest --last 2h',
      dashboard_import_command: dashboardImportCommand,
      dashboard_verify_command: 'agentops dashboard verify --live --last 24h --json',
      content_command: 'agentops content status --json',
      privacy_note: 'Prompts and responses stay off by default. Use agentops content opt-in only when you intentionally want transcript rows.'
    };

    const next = [];
    const missingTools = tools.filter(tool => !tool.ok).map(tool => tool.name);
    if (missingTools.length > 0) {
      next.push(`Install missing tools: ${missingTools.join(', ')}.`);
    }
    if (!cloudConfigured) {
      if (azd.ok) {
        next.push('agentops configure import-azd');
      } else {
        next.push('az login');
        next.push('azd provision');
        next.push('agentops configure import-azd');
      }
    } else if (!cloudTargetReady) {
      next.push('agentops validate-azure --last 24h');
      next.push('Confirm the intended Azure resource group; AgentOps will not redirect to another group automatically.');
    }
    if (!shim.agentops_cli_installed || !shim.copilot_agentops_installed) {
      next.push('agentops install');
    }
    if (!shim.plain_copilot_observed) {
      next.push('export PATH="$HOME/.local/bin:$PATH"');
    }
    next.push('agentops init --full');
    next.push('agentops validate-enterprise');
    next.push('agentops validate-azure');
    next.push('agentops collector smoke --privacy strict --poison');
    next.push('agentops copilot -p "Reply with exactly: agentops smoke."');
    next.push('agentops latest --last 2h');
    next.push('agentops open');

    return {
      ok: tools.every(tool => tool.ok) &&
        shim.agentops_cli_installed &&
        shim.copilot_agentops_installed &&
        cloudTargetReady,
      mode: 'guide',
      mutates: false,
      local_ready: localReady,
      cloud_ready: cloudTargetReady,
      readiness: {
        local: localReady ? 'ready' : 'needs-local-install',
        cloud: cloudTargetReady ? 'ready' : cloudConfigured ? 'configured-but-unverified' : 'not-configured'
      },
      tools,
      azd,
      shim,
      first_run: firstRun,
      cloud: {
        expected_subscription_id: expectedSubscriptionId,
        active_subscription_id: azureAccount.id,
        active_subscription_name: azureAccount.name,
        subscription_match: subscriptionMatch,
        resource_group: cloud.resourceGroup,
        resource_group_checked: resourceGroup.checked,
        resource_group_exists: resourceGroup.exists,
        resource_group_status: resourceGroup.status,
        resource_group_detail: resourceGroup.detail,
        binding_status: cloudTargetReady ? 'ready' : cloudConfigured ? 'configured-but-target-missing-or-unverified' : 'unconfigured',
        workspace_id_configured: workspaceConfigured,
        workspace_name: cloud.workspaceName || null,
        grafana_url_configured: grafanaConfigured,
        grafana_name: cloud.grafanaName || null,
        agents_view_url_configured: agentsViewConfigured,
        agents_view_url: cloud.agentsViewUrl || null,
        app_insights_name: cloud.appInsightsName || null
      },
      phases,
      next
    };
  }

  function renderSetupGuide(result) {
    const lines = [
      'AgentOps setup guide',
      '',
      'This command is read-only. It does not create Azure resources or change local files.',
      '',
      'Detected tools:'
    ];

    for (const tool of result.tools) {
      const detail = tool.path ? ` (${tool.path})` : '';
      const version = tool.version ? ` ${tool.version}` : '';
      lines.push(`- ${tool.name}: ${tool.ok ? 'found' : 'missing'}${version}${detail}`);
    }

    lines.push('', `azd environment: ${result.azd.ok ? 'AgentOps outputs found' : result.azd.detail}`);
    lines.push(`Azure subscription: expected=${result.cloud.expected_subscription_id || 'not configured'}, active=${result.cloud.active_subscription_name || 'not signed in'} (${result.cloud.active_subscription_id || 'unknown'}), match=${result.cloud.subscription_match ? 'yes' : 'no'}.`);
    lines.push(`Local shim: agentops=${result.shim.agentops_cli_installed ? 'installed' : 'missing'}, copilot-agentops=${result.shim.copilot_agentops_installed ? 'installed' : 'missing'}, transparent routing=${result.shim.plain_copilot_observed ? 'enabled' : 'disabled'}.`);
    lines.push(`Cloud config: workspace=${result.cloud.workspace_id_configured ? 'set' : 'missing'}, Azure Monitor Agents view=${result.cloud.agents_view_url_configured ? 'set' : 'missing'}, Grafana advanced=${result.cloud.grafana_url_configured ? 'set' : 'missing'}.`);
    lines.push(`Azure target: resource group=${result.cloud.resource_group || 'missing'} (${result.cloud.resource_group_status || 'not-checked'}); binding=${result.cloud.binding_status || 'unknown'}.`);

    lines.push('', 'One-minute first run:');
    lines.push(`1. Guided path: ${result.first_run.guided_command}`);
    lines.push('   This is a zero-write preview. Execute the reviewed plan with: agentops init --full --yes');
    lines.push(`2. Setup/bind fallback: ${result.first_run.bind_command}`);
    lines.push(`3. Privacy smoke fallback: ${result.first_run.privacy_smoke_command}`);
    lines.push(`4. Real smoke fallback: ${result.first_run.smoke_command}`);
    lines.push(`5. See it: the smoke opens Run Story, or run ${result.first_run.latest_command} && ${result.first_run.open_command}`);
    lines.push(`6. Dashboards: ${result.first_run.dashboard_import_command} && ${result.first_run.dashboard_verify_command}`);
    lines.push(`Privacy: ${result.first_run.privacy_note}`);
    lines.push('Everyday observed use: agentops copilot ... (plain copilot stays unobserved unless transparent routing is enabled).');

    lines.push('', 'Fastest path:');
    for (const phase of result.phases) {
      lines.push('', `${phase.name} (${phase.status})`);
      for (const command of phase.commands) lines.push(`  ${command}`);
      lines.push(`  verify: ${phase.verify}`);
    }

    lines.push('', 'Run next:');
    for (const command of result.next.slice(0, 3)) lines.push(`- ${command}`);
    if (result.next.length > 3) lines.push(`- ${result.next.length - 3} more fallback commands are available in: agentops setup --json`);
    return `${lines.join('\n')}\n`;
  }

  return {
    agentopsSetupGuide,
    azureAccountStatus,
    azureResourceGroupStatus,
    azdEnvironmentStatus,
    parseSetupArgs,
    renderSetupGuide,
    setupToolStatus
  };
}

module.exports = {
  createSetupGuide
};
