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
        ? 'azd env get-values did not return AgentOps outputs. Use agentops provision azure for a fresh pilot, or select the existing azd environment.'
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
    const cloud = configuredCloudValues({ ...options, projectOnly: true });
    const azureAccount = azureAccountStatus(options, toolByName.az.ok);
    const expectedSubscriptionId = cloud.subscriptionId || null;
    const subscriptionMatch = Boolean(expectedSubscriptionId && azureAccount.id && expectedSubscriptionId.toLowerCase() === azureAccount.id.toLowerCase());
    const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
    const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
    const agentsViewConfigured = isConfiguredValue(cloud.agentsViewUrl, /^$/);
    const cloudConfigured = workspaceConfigured
      && Boolean(cloud.subscriptionId && cloud.resourceGroup && cloud.logsIngestionEndpoint && cloud.dcrImmutableId);
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
    const localReady = Boolean(toolByName.node.ok && toolByName.copilot.ok);
    const azd = azdEnvironmentStatus(options, toolByName.azd.ok);
    const dashboardCloud = cloudConfigured ? cloud : { ...cloud, ...azd.values };
    const dashboardGrafanaConfigured = isConfiguredValue(dashboardCloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
    const dashboardImportCommand = dashboardGrafanaConfigured
      ? grafanaDashboardImportCommand(dashboardCloud)
      : 'agentops configure set --grafana-url <grafana-url> && agentops dashboard import';
    const azureProvisionPreviewCommand = 'agentops provision azure --subscription <subscription-id> --resource-group <new-agentops-rg> --profile pilot';
    const azureProvisionApplyCommand = `${azureProvisionPreviewCommand} --yes`;
    const projectBindCommand = 'agentops configure set --project --subscription-id <subscription-id> --resource-group <resource-group> --workspace-id <workspace-customer-id> --workspace-name <workspace-name> --logs-ingestion-endpoint <dce-ingestion-endpoint> --dcr-immutable-id <dcr-immutable-id>';
    const observeCommand = 'agentops copilot-session launch --repo . -- --agent <agent-name>';
    const uploadCommand = 'agentops copilot-session launch --repo . --upload --yes -- --agent <agent-name>';
    const coverageCommand = 'agentops coverage --repo . --json';
    const runtimeProfileCommand = 'agentops configure set --project --python-runtime <version> --node-runtime <version> --typescript-loader <loader-or-unknown>';
    const azureValidationCommand = 'agentops validate-azure --profile personal --json';
    const viewCommand = 'agentops copilot-session view <session-id> --run-id <run-id> --output <local.html>';

    const phases = [
      {
        name: '1. Review and attach this repository',
        status: 'review',
        commands: [
          'agentops attach --repo .',
          'Review discovered agents, skills, references, and hash-eligible scripts.',
          'After review, apply with: agentops attach --repo . --yes'
        ],
        verify: coverageCommand
      },
      {
        name: '2. Record the project runtime profile',
        status: 'review',
        commands: [
          'Ask which Python and Node runtimes execute repository scripts, and which loader executes TypeScript.',
          runtimeProfileCommand,
          'Omit flags for unused runtimes; use unknown when the TypeScript loader is not known.'
        ],
        verify: 'agentops configure show --json; runtime labels are private metadata, not proof that scripts were observed.'
      },
      {
        name: '3. Provision Azure once when needed',
        status: cloudTargetReady ? 'done' : cloudConfigured ? 'needs-review' : (azd.ok ? 'ready-to-import' : 'needed'),
        commands: cloudTargetReady
          ? ['agentops configure show']
          : cloudConfigured
          ? ['agentops validate-azure --last 24h', 'confirm the intended Azure resource group before any write']
          : azd.ok
          ? ['agentops configure import-azd --project']
          : [...(azureAccount.ok ? [] : ['az login']), azureProvisionPreviewCommand, `Review the Azure what-if; after explicit target and cost approval, rerun: ${azureProvisionApplyCommand}`],
        verify: azd.ok && !cloudConfigured ? 'agentops configure import-azd --project' : 'Verify provision readback, then bind the selected target to this project.'
      },
      {
        name: '4. Bind local CLI to Azure outputs',
        status: cloudTargetReady ? 'done' : cloudConfigured ? 'needs-review' : 'needed',
        commands: cloudTargetReady
          ? ['agentops configure show']
          : cloudConfigured
          ? ['agentops configure show', 'do not redirect to another resource group automatically']
          : azd.ok
          ? ['agentops configure import-azd --project']
          : [projectBindCommand],
        verify: `agentops configure show --json; then ${azureValidationCommand}`
      },
      {
        name: '5. Start one process-scoped observed run',
        status: localReady ? 'ready' : 'blocked',
        commands: [observeCommand, ...(cloudTargetReady ? [uploadCommand] : [])],
        verify: `${coverageCommand}; then open the matching local run view`
      },
      {
        name: '6. Review evidence and coverage',
        status: localReady ? 'ready' : 'blocked',
        commands: [viewCommand, coverageCommand],
        verify: 'Confirm the selected agent, observed scripts, missing links, and delivery state for the same run and session.'
      }
    ];

    const firstRun = {
      name: 'First-run loop',
      ready: cloudTargetReady && localReady,
      read_only: true,
      setup_command: 'agentops setup',
      guided_command: 'agentops attach --repo .',
      observe_command: observeCommand,
      upload_command: uploadCommand,
      runtime_profile_command: runtimeProfileCommand,
      coverage_command: coverageCommand,
      view_command: viewCommand,
      azure_validation_command: azureValidationCommand,
      bind_command: cloudTargetReady
        ? 'agentops configure show'
        : cloudConfigured
        ? 'agentops validate-azure --last 24h'
        : azd.ok
        ? 'agentops configure import-azd --project'
        : projectBindCommand,
      azure_provision_preview_command: !cloudConfigured && !azd.ok ? azureProvisionPreviewCommand : null,
      azure_provision_apply_command: !cloudConfigured && !azd.ok ? azureProvisionApplyCommand : null,
      privacy_smoke_command: 'agentops collector smoke --privacy strict --poison --json',
      smoke_command: 'agentops smoke --real-copilot --wait 2m --poll 10s --open-browser',
      run_command: observeCommand,
      latest_command: 'agentops latest --last 2h',
      replay_command: 'agentops replay latest --last 2h',
      open_command: 'agentops open latest --last 2h',
      dashboard_import_command: dashboardImportCommand,
      dashboard_verify_command: 'agentops dashboard verify --live --last 24h --json',
      content_command: 'agentops content status --json',
      privacy_note: 'Prompts and responses stay off by default. Use agentops content opt-in only when you intentionally want transcript rows.'
    };

    const next = [];
    const missingTools = ['node', 'copilot'].filter(name => !toolByName[name]?.ok);
    if (missingTools.length > 0) {
      next.push(`Install missing tools: ${missingTools.join(', ')}.`);
    }
    next.push('agentops attach --repo .');
    next.push('Review the inventory; apply only after agreement with: agentops attach --repo . --yes');
    next.push(`Interview and record applicable runtime labels (omit unused-runtime flags): ${runtimeProfileCommand}`);
    next.push(observeCommand);
    next.push(coverageCommand);
    next.push(viewCommand);
    if (!cloudConfigured) {
      if (azd.ok) {
        next.push('agentops configure import-azd --project');
      } else {
        if (!azureAccount.ok) next.push('az login');
        next.push(azureProvisionPreviewCommand);
        next.push(`Review the Azure what-if; after explicit target and cost approval, rerun: ${azureProvisionApplyCommand}`);
        next.push(projectBindCommand);
      }
    } else if (!cloudTargetReady) {
      next.push('agentops validate-azure --last 24h');
      next.push('Confirm the intended Azure resource group; AgentOps will not redirect to another group automatically.');
    }
    if (cloudTargetReady) {
      next.push(azureValidationCommand);
      next.push(`Upload only after validation passes: ${uploadCommand}`);
    }

    return {
      ok: localReady && cloudTargetReady,
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
    lines.push(`Compatibility shim (optional): ${result.shim.copilot_agentops_installed ? 'installed' : 'not installed'}; transparent routing=${result.shim.plain_copilot_observed ? 'enabled' : 'disabled'}. Default observation is process-scoped.`);
    lines.push(`Project cloud config: workspace=${result.cloud.workspace_id_configured ? 'set' : 'missing'}, Azure Monitor Agents view=${result.cloud.agents_view_url_configured ? 'set' : 'missing'}, Grafana advanced=${result.cloud.grafana_url_configured ? 'set' : 'missing'}.`);
    lines.push(`Project Azure target: resource group=${result.cloud.resource_group || 'missing'} (${result.cloud.resource_group_status || 'not-checked'}); binding=${result.cloud.binding_status || 'unknown'}.`);

    lines.push('', 'Recommended Copilot CLI setup:');
    lines.push(`1. No-write repo inventory: ${result.first_run.guided_command}`);
    lines.push('   Review the discovered agents, skills, references, and eligible scripts. Attach only after review: agentops attach --repo . --yes');
    lines.push(`2. Record runtime labels: ${result.first_run.runtime_profile_command}`);
    lines.push('   Ask which versions actually run scripts. Omit unused runtime flags; use “unknown” if the TypeScript loader is unclear. Labels are private setup metadata, not execution proof.');
    lines.push(`3. Process-scoped observed run: ${result.first_run.observe_command}`);
    lines.push('   This is local-only by default. It does not install hooks or change shell startup. Plain copilot sessions remain uninstrumented.');
    lines.push(`4. Check declared-versus-observed coverage: ${result.first_run.coverage_command}`);
    lines.push(`5. Open the matching local waterfall: ${result.first_run.view_command}`);
    if (result.first_run.azure_provision_preview_command) {
      lines.push(`Azure is optional for the local smoke. To prepare an isolated target, preview: ${result.first_run.azure_provision_preview_command}`);
      lines.push(`Review the Azure what-if, exact target, resource list, and expected cost before applying: ${result.first_run.azure_provision_apply_command}`);
    }
    lines.push(`Project Azure binding: ${result.first_run.bind_command}`);
    lines.push(`Validate Azure before upload: ${result.first_run.azure_validation_command}`);
    lines.push(`Azure upload is separate and requires a complete validated project target: ${result.first_run.upload_command}`);
    lines.push(`For synthetic content only, review the restricted content workflow separately. ${result.first_run.privacy_note}`);
    lines.push(`Optional advanced dashboards: ${result.first_run.dashboard_import_command} && ${result.first_run.dashboard_verify_command}`);
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
