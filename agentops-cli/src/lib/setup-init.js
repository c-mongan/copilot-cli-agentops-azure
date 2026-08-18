const childProcess = require('node:child_process');
const path = require('node:path');
const { createSetupGuide } = require('./setup-guide');
const { checkAzureSubscription: defaultCheckAzureSubscription } = require('./azure/subscription-guard');

const LOCAL_NATIVE_SHELLS = new Set(['bash', 'zsh', 'fish', 'powershell', 'json']);
const LOCAL_NATIVE_OTEL_ENV = Object.freeze({
  COPILOT_OTEL_ENABLED: 'true',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false'
});

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function renderNativeOtelExports(env, shell) {
  if (shell === 'json') return `${JSON.stringify(env, null, 2)}\n`;
  const lines = [];
  for (const [key, value] of Object.entries(env)) {
    if (shell === 'powershell') {
      lines.push(`$env:${key} = "${String(value).replace(/"/g, '`"')}"`);
    } else if (shell === 'fish') {
      lines.push(`set -gx ${key} ${shellQuote(value)}`);
    } else {
      lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function assetPlan(result, key) {
  if (!result) return null;
  const inventoryKey = key === 'skills' ? 'skills' : 'agents';
  const installedKey = key === 'skills' ? 'installedSkills' : 'installedAgents';
  const inventory = Array.isArray(result[inventoryKey]) ? result[inventoryKey] : [];
  const target = item => item?.target || item?.targetDir || null;
  return {
    target_dir: result.targetDir || null,
    would_install: (result[installedKey] || []).map(target).filter(Boolean),
    would_update: (result.updated || []).map(target).filter(Boolean),
    would_skip: (result.skipped || []).map(target).filter(Boolean),
    available: inventory.map(item => item.name || item.file || item.directory).filter(Boolean)
  };
}

function createSetupInit(dependencies = {}) {
  const {
    agentopsConfigure,
    agentopsStatusSummary,
    checkAzureSubscription = defaultCheckAzureSubscription,
    commandCandidates,
    configFromEnvValues,
    configuredCloudValues,
    defaultInstallDir,
    doctor,
    durationToMs,
    grafanaDashboardImportCommand,
    installDefaultAgents,
    installDefaultSkills,
    installedShimStatus,
    isConfiguredValue,
    optionValue,
    parseEnvAssignments,
    plural,
    realCopilotSmokeCommand,
    validateAzure
  } = dependencies;
  const cliEntryPath = dependencies.cliEntryPath || path.join(__dirname, '..', 'index.js');
  const {
    agentopsSetupGuide,
    azureAccountStatus,
    azureResourceGroupStatus,
    azdEnvironmentStatus,
    parseSetupArgs,
    renderSetupGuide,
    setupToolStatus
  } = createSetupGuide({
    commandCandidates,
    configFromEnvValues,
    configuredCloudValues,
    defaultInstallDir,
    grafanaDashboardImportCommand,
    installedShimStatus,
    isConfiguredValue,
    parseEnvAssignments,
    realCopilotSmokeCommand
  });

  function parseInitArgs(args) {
    const full = args.includes('--full');
    const localOnly = args.includes('--local-only');
    const yes = args.includes('--yes');
    const shellArgPresent = args.includes('--shell') || args.some(arg => arg.startsWith('--shell='));
    const shell = optionValue(args, ['--shell']);
    if (shellArgPresent && !shell) throw new Error('--shell requires bash, zsh, fish, powershell, or json');
    if (shellArgPresent && !LOCAL_NATIVE_SHELLS.has(shell)) {
      throw new Error('--shell must be bash, zsh, fish, powershell, or json');
    }
    const localOnlyConflicts = ['--full', '--provision-cloud', '--import-dashboards', '--run-smoke', '--triage-latest']
      .filter(flag => args.includes(flag));
    if (localOnly && localOnlyConflicts.length > 0) {
      throw new Error(`--local-only cannot be combined with ${localOnlyConflicts.join(', ')}`);
    }
    if (shellArgPresent && !localOnly) throw new Error('--shell is only supported with --local-only');
    const requestedWrites = full || ['--provision-cloud', '--import-dashboards', '--run-smoke', '--triage-latest']
      .some(flag => args.includes(flag));
    const explicitDryRun = args.includes('--dry-run');
    const localPreview = localOnly && !yes && !explicitDryRun;
    return {
      dryRun: explicitDryRun || localPreview || (requestedWrites && !yes),
      full,
      localOnly,
      yes,
      shell: localOnly ? (shell || 'bash') : null,
      confirmationRequired: (localOnly || requestedWrites) && !yes && !explicitDryRun,
      confirmationCommand: localOnly
        ? `agentops init --local-only --yes --shell ${shell || 'bash'}`
        : full ? 'agentops init --full --yes' : null,
      forceSkills: args.includes('--force-skills') || args.includes('--force'),
      json: args.includes('--json'),
      importDashboards: full || args.includes('--import-dashboards'),
      noSkills: args.includes('--no-skills') || args.includes('--no-plugin'),
      provisionCloud: full || args.includes('--provision-cloud'),
      forceProvisionCloud: args.includes('--provision-cloud'),
      runSmoke: full || args.includes('--run-smoke'),
      triageLatest: full || args.includes('--triage-latest'),
      copilotHome: optionValue(args, ['--copilot-home', '--home']),
      checkAzureAccount: true
    };
  }

  function agentopsInitLocal(options = {}) {
    const dryRun = options.dryRun === undefined ? options.yes !== true : options.dryRun !== false;
    const confirmationRequired = options.confirmationRequired === undefined
      ? dryRun && options.yes !== true
      : Boolean(options.confirmationRequired);
    const confirmationCommand = options.confirmationCommand
      || `agentops init --local-only --yes --shell ${options.shell || 'bash'}`;
    const status = doctor({ localOnly: true });
    const rawLocalStatus = agentopsStatusSummary({ checks: status });
    const localStatus = {
      ok: rawLocalStatus.ok,
      required_files: rawLocalStatus.required_files,
      content_capture_off: rawLocalStatus.content_capture_off,
      collector_localhost: rawLocalStatus.collector_localhost
    };
    const skillsResult = options.noSkills
      ? null
      : installDefaultSkills({
          copilotHome: options.copilotHome,
          force: options.forceSkills,
          dryRun
        });
    const agentsResult = options.noSkills
      ? null
      : installDefaultAgents({
          copilotHome: options.copilotHome,
          force: options.forceSkills,
          dryRun
        });
    const skills = assetPlan(skillsResult, 'skills');
    const agents = assetPlan(agentsResult, 'agents');
    const wouldWrite = [
      ...(skills?.would_install || []),
      ...(skills?.would_update || []),
      ...(agents?.would_install || []),
      ...(agents?.would_update || [])
    ];
    const nativeOtel = {
      endpoint: LOCAL_NATIVE_OTEL_ENV.OTEL_EXPORTER_OTLP_ENDPOINT,
      protocol: LOCAL_NATIVE_OTEL_ENV.OTEL_EXPORTER_OTLP_PROTOCOL,
      capture_content: false,
      wrapper_required: false,
      session_export: {
        remote_export: false,
        verified: false,
        enforcement: 'per-invocation-cli-flag',
        cli_flag: '--no-remote-export',
        settings: { remoteExport: false }
      },
      exports: { ...LOCAL_NATIVE_OTEL_ENV },
      shell: options.shell || 'bash'
    };
    const collectorCommand = 'agentops collector start --mode local --privacy strict';
    const result = {
      ok: true,
      mode: dryRun ? 'local-preview' : 'local-applied',
      local_only: true,
      dry_run: dryRun,
      mutates: !dryRun,
      confirmation_required: confirmationRequired,
      confirmation_command: confirmationRequired
        ? confirmationCommand
        : null,
      local_status: localStatus,
      local_ready: Boolean(localStatus.required_files?.missing?.length === 0 && localStatus.content_capture_off),
      cloud: {
        checked: false,
        required: false,
        ready: false,
        state: 'not_checked'
      },
      wrapper_required: false,
      native_otel: nativeOtel,
      shell_exports: renderNativeOtelExports(nativeOtel.exports, nativeOtel.shell),
      would_install: {
        skills: skills?.would_install || [],
        agents: agents?.would_install || []
      },
      would_update: {
        skills: skills?.would_update || [],
        agents: agents?.would_update || []
      },
      would_write: dryRun ? wouldWrite : [],
      would_start: dryRun ? [collectorCommand] : [],
      applied: dryRun ? null : {
        skills: skills?.would_install || [],
        agents: agents?.would_install || [],
        updated_skills: skills?.would_update || [],
        updated_agents: agents?.would_update || [],
        collector: 'not_started_by_init'
      },
      next: dryRun
        ? [options.confirmationCommand || 'agentops init --local-only --yes --shell bash', 'agentops smoke --local']
        : [collectorCommand, 'agentops smoke --local', 'copilot --no-remote-export']
    };
    result.summary = {
      status: dryRun ? 'preview' : 'applied',
      detail: dryRun
        ? 'No local writes or process starts were made. Review the planned AgentOps-owned setup, then confirm explicitly.'
        : 'AgentOps-owned local setup was applied. Native Copilot OTel exports are ready for the current shell.'
    };
    return result;
  }

  function runInitCloudProvision(options = {}) {
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const command = options.azdCommand || 'azd';
    const provisionArgs = options.azdProvisionArgs || ['provision'];
    const commandText = `${command} ${provisionArgs.join(' ')}`;
    if (options.dryRun) {
      return {
        requested: true,
        dry_run: true,
        ok: true,
        command: commandText,
        import_result: { dryRun: true, action: 'import-azd' },
        failing_stage: null,
        next: []
      };
    }

    const subscriptionGuard = checkAzureSubscription({
      env: options.env,
      expectedSubscriptionId: options.expectedSubscriptionId,
      approvedSubscriptionIds: options.approvedSubscriptionIds,
      spawnSync
    });
    if (!subscriptionGuard.ok) {
      return {
        requested: true,
        dry_run: false,
        ok: false,
        command: commandText,
        failing_stage: 'subscription guard',
        subscription_guard: subscriptionGuard,
        import_result: null,
        next: [
          'export AGENTOPS_AZURE_SUBSCRIPTION_ID="<approved-subscription-id>"',
          'export AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS="<approved-subscription-id>"',
          'az account show --query "{name:name,id:id}" -o table',
          'agentops init --dry-run --provision-cloud'
        ]
      };
    }

    const provision = spawnSync(command, provisionArgs, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    const provisionOk = provision.status === 0 && !provision.error;
    const importResult = provisionOk
      ? agentopsConfigure({
          subcommand: 'import-azd',
          configPath: options.configPath,
          dryRun: false,
          spawnSync
        })
      : null;
    const importOk = importResult?.ok === true;
    const failingStage = !provisionOk ? 'azd provision' : importOk ? null : 'agentops configure import-azd';
    const next = !provisionOk
      ? [
          'az login',
          'azd env list',
          commandText,
          'agentops init --dry-run --provision-cloud'
        ]
      : importOk
        ? []
        : [
            'azd env get-values',
            'agentops configure import-azd',
            'agentops configure set --workspace-id "<workspace-id>"',
            'agentops configure set --agents-url "<azure-monitor-agents-view-url>"'
          ];

    return {
      requested: true,
      dry_run: false,
      ok: provisionOk && importOk,
      command: commandText,
      failing_stage: failingStage,
      provision: {
        ok: provisionOk,
        status: provision.status,
        stdout: provision.stdout || '',
        stderr: provision.stderr || '',
        error: provision.error?.message || null
      },
      import_result: importResult,
      next
    };
  }

  function runInitDashboardImport(options = {}) {
    const command = 'agentops validate-azure --import-dashboards --last 24h';
    if (!options.importDashboards) {
      return {
        requested: false,
        dry_run: Boolean(options.dryRun),
        ok: null,
        command
      };
    }

    if (options.dryRun) {
      return {
        requested: true,
        dry_run: true,
        ok: true,
        command,
        validation: null,
        next: []
      };
    }

    const validate = options.validateAzure || validateAzure;
    const validation = validate({
      ...options,
      last: '24h',
      importDashboards: true,
      production: false,
      remediationPlan: false
    });

    return {
      requested: true,
      dry_run: false,
      ok: validation.ok === true,
      command,
      validation,
      next: validation.ok === true
        ? ['node agentops-cli/src/index.js collector smoke --privacy strict --poison --json']
        : (Array.isArray(validation.next) && validation.next.length ? validation.next : [command])
    };
  }

  function runInitRealSmoke(options = {}) {
    const args = ['smoke', '--real-copilot', '--wait', '2m', '--poll', '10s', '--open-browser', '--json'];
    const command = 'agentops smoke --real-copilot --wait 2m --poll 10s --open-browser --json';
    if (!options.runSmoke) {
      return {
        requested: false,
        dry_run: Boolean(options.dryRun),
        ok: null,
        command
      };
    }

    if (options.dryRun) {
      return {
        requested: true,
        dry_run: true,
        ok: true,
        command,
        status: null,
        next: []
      };
    }

    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync(process.execPath, [cliEntryPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      encoding: 'utf8',
      timeout: durationToMs(options.smokeTimeoutMs ?? options.timeout, 180000),
      maxBuffer: 20 * 1024 * 1024
    });
    const status = result.status === null || result.status === undefined ? 1 : result.status;
    let smoke = null;
    try {
      smoke = result.stdout ? JSON.parse(result.stdout) : null;
    } catch {
      smoke = null;
    }

    const ok = status === 0 && !result.error && smoke?.ok !== false;
    return {
      requested: true,
      dry_run: false,
      ok,
      command,
      status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error?.message || null,
      smoke,
      next: ok
        ? ['agentops open latest --last 2h']
        : [command, 'agentops latest --last 2h', 'agentops open latest --last 2h']
    };
  }

  function runInitLatestTriage(options = {}) {
    const args = ['triage', 'latest', '--out', '.agentops/triage/latest', '--json'];
    const command = 'agentops triage latest --out .agentops/triage/latest --json';
    if (!options.triageLatest) {
      return {
        requested: false,
        dry_run: Boolean(options.dryRun),
        ok: null,
        command
      };
    }

    if (options.dryRun) {
      return {
        requested: true,
        dry_run: true,
        ok: true,
        command,
        status: null,
        next: []
      };
    }

    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync(process.execPath, [cliEntryPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    const status = result.status === null || result.status === undefined ? 1 : result.status;
    let triage = null;
    try {
      triage = result.stdout ? JSON.parse(result.stdout) : null;
    } catch {
      triage = null;
    }

    const ok = status === 0 && !result.error && triage?.ok !== false;
    return {
      requested: true,
      dry_run: false,
      ok,
      command,
      status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error?.message || null,
      triage,
      next: ok
        ? []
        : [command, 'agentops latest --last 2h', 'agentops open latest --last 2h']
    };
  }

  function buildInitSummary(result) {
    const dryRun = result.mode === 'dry-run';
    const cloudTargetBlocked = result.cloud?.binding_status === 'configured-but-target-missing-or-unverified'
      && result.cloud_provision?.requested !== true;
    const stages = [
      ['cloud_provision', result.cloud_provision],
      ['dashboard_import', result.dashboard_import],
      ['real_smoke', result.real_smoke],
      ['triage_latest', result.triage_latest]
    ]
      .filter(([, stage]) => stage?.requested)
      .map(([name, stage]) => ({
        name,
        status: cloudTargetBlocked
          ? 'blocked'
          : result.confirmation_required || dryRun ? 'planned' : stage.ok === true ? 'ready' : 'needs_review',
        command: stage.command
      }));
    const nextAction = result.next?.[0] || 'node agentops-cli/src/index.js open latest --last 2h';
    if (cloudTargetBlocked) {
      const targetDetail = String(result.cloud.resource_group_detail || 'verify or restore the intended target before continuing').replace(/[.!?]+$/, '');
      return {
        status: 'blocked',
        next_action: 'agentops init --dry-run --provision-cloud',
        detail: `No cloud or workflow writes were made. The configured Azure target ${result.cloud.resource_group || '<resource-group>'} is ${result.cloud.resource_group_status || 'not verified'}: ${targetDetail}. Review the reprovision preview, then run: agentops init --provision-cloud --yes. AgentOps will not redirect to a different resource group automatically.`,
        stages
      };
    }
    if (result.confirmation_required || dryRun) {
      const command = result.confirmation_required
        ? result.confirmation_command
        : stages.length > 0 ? 'agentops init --full --yes' : nextAction;
      return {
        status: 'preview',
        next_action: command,
        detail: `No cloud or workflow writes were made. Review the preview, verify the active subscription, then run: ${command}`,
        stages
      };
    }
    const ready = result.ok === true;
    return {
      status: ready ? 'ready' : 'needs_action',
      next_action: ready ? 'node agentops-cli/src/index.js open latest --last 2h' : nextAction,
      detail: ready
        ? 'AgentOps first-run path is ready; open the latest run or continue with normal Copilot work.'
        : `Run next: ${nextAction}`,
      stages
    };
  }

  function agentopsInit(options = {}) {
    if (options.localOnly) return agentopsInitLocal(options);
    const checks = doctor({ localOnly: true });
    const status = agentopsStatusSummary({ checks });
    const cloud = configuredCloudValues(options);
    const shim = installedShimStatus(options.installDir || defaultInstallDir);
    const skills = options.noSkills
      ? null
      : installDefaultSkills({
          copilotHome: options.copilotHome,
          force: options.forceSkills,
          dryRun: options.dryRun
        });
    const agents = options.noSkills
      ? null
      : installDefaultAgents({
          copilotHome: options.copilotHome,
          force: options.forceSkills,
          dryRun: options.dryRun
        });
    const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
    const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
    const agentsViewConfigured = isConfiguredValue(cloud.agentsViewUrl, /^$/);
    const cloudConfigured = workspaceConfigured && (grafanaConfigured || agentsViewConfigured);
    const azdTool = setupToolStatus('azd', options);
    const azd = azdEnvironmentStatus(options, azdTool.ok);
    const azTool = setupToolStatus('az', options);
    const azureAccount = options.checkAzureAccount
      ? azureAccountStatus(options, azTool.ok)
      : { checked: false, ok: false, id: null, name: null };
    const expectedSubscriptionId = cloud.subscriptionId || null;
    const subscriptionMatch = Boolean(expectedSubscriptionId && azureAccount.id
      && expectedSubscriptionId.toLowerCase() === azureAccount.id.toLowerCase());
    const resourceGroup = cloudConfigured && options.checkAzureAccount !== false
      ? azureResourceGroupStatus({
          resourceGroup: cloud.resourceGroup,
          subscriptionId: expectedSubscriptionId,
          resourceGroupExists: options.resourceGroupExists,
          spawnSync: options.spawnSync
        }, azTool.ok)
      : {
          checked: false,
          exists: null,
          ok: false,
          status: 'not-configured',
          detail: 'Cloud binding is incomplete or Azure account checking is disabled.'
        };
    const cloudTargetReady = cloudConfigured && resourceGroup.ok && subscriptionMatch;
    const shouldProvisionCloud = options.provisionCloud
      && (options.forceProvisionCloud || !cloudConfigured);
    const cloudProvision = shouldProvisionCloud
      ? runInitCloudProvision(options)
      : {
          requested: false,
          dry_run: Boolean(options.dryRun),
          ok: null,
          command: 'agentops init --provision-cloud',
          skipped_reason: options.provisionCloud ? 'cloud_already_configured' : null
        };
    const dashboardImport = runInitDashboardImport(options);
    const realSmoke = runInitRealSmoke(options);
    const latestTriage = runInitLatestTriage(options);
    const next = [];

    if (!shim.agentops_cli_installed) {
      next.push('agentops install');
    }
    if (!shim.plain_copilot_observed) next.push('agentops copilot');
    if (!cloudConfigured) {
      if (azd.ok) {
        next.push('agentops configure import-azd');
      } else if (!options.provisionCloud) {
        next.push('agentops init --provision-cloud');
      } else {
        if (!workspaceConfigured) {
          next.push('agentops configure set --workspace-id "<workspace-id>"');
        }
        if (!grafanaConfigured) {
          next.push('agentops configure set --agents-url "<azure-monitor-agents-view-url>"');
        }
      }
    } else if (!cloudTargetReady) {
      next.push('agentops init --dry-run --provision-cloud');
      next.push('agentops init --provision-cloud --yes');
    }
    if (dashboardImport.requested && dashboardImport.ok !== true) {
      for (const command of dashboardImport.next || []) next.push(command);
    } else if (!dashboardImport.requested) {
      next.push('agentops validate-azure --import-dashboards --last 24h');
    }
    next.push('agentops collector smoke --privacy strict --poison --json');
    if (realSmoke.requested && realSmoke.ok !== true) {
      for (const command of realSmoke.next || []) next.push(command);
    } else if (!realSmoke.requested) {
      next.push('agentops smoke --real-copilot --wait 2m --poll 10s');
      next.push('agentops latest --last 2h');
      next.push('agentops open latest --last 2h');
    } else {
      next.push('agentops open latest --last 2h');
    }
    if (latestTriage.requested && latestTriage.ok !== true) {
      for (const command of latestTriage.next || []) next.push(command);
    } else if (!latestTriage.requested) {
      next.push('agentops triage latest --out .agentops/triage/latest --json');
    }
    next.push('agentops plugin uninstall');

    const initOk = status.ok && Boolean(shim.agentops_cli_installed) && Boolean(shim.copilot_agentops_installed) && cloudTargetReady && (!cloudProvision.requested || cloudProvision.ok === true) && (!dashboardImport.requested || dashboardImport.ok === true) && (!realSmoke.requested || realSmoke.ok === true) && (!latestTriage.requested || latestTriage.ok === true);
    const result = {
      ok: initOk,
      mode: options.confirmationRequired ? 'preview-awaiting-confirmation' : options.dryRun ? 'dry-run' : 'local-init',
      confirmation_required: Boolean(options.confirmationRequired),
      confirmation_command: options.confirmationRequired
        ? (options.confirmationCommand || 'agentops init --full --yes')
        : null,
      local_status: status,
      azd,
      cloud_provision: cloudProvision,
      dashboard_import: dashboardImport,
      real_smoke: realSmoke,
      triage_latest: latestTriage,
      skills,
      agents,
      shim,
      cloud: {
        resource_group: cloud.resourceGroup,
        resource_group_checked: resourceGroup.checked,
        resource_group_exists: resourceGroup.exists,
        resource_group_status: resourceGroup.status,
        resource_group_detail: resourceGroup.detail,
        binding_status: cloudTargetReady ? 'ready' : cloudConfigured ? 'configured-but-target-missing-or-unverified' : 'unconfigured',
        workspace_id_configured: workspaceConfigured,
        grafana_url_configured: grafanaConfigured,
        grafana_name_configured: Boolean(cloud.grafanaName),
        agents_view_url_configured: agentsViewConfigured,
        app_insights_name: cloud.appInsightsName,
        expected_subscription_id: expectedSubscriptionId,
        active_subscription_id: azureAccount.id,
        active_subscription_name: azureAccount.name,
        subscription_match: subscriptionMatch
      },
      next
    };
    result.summary = buildInitSummary(result);
    return result;
  }

  function renderInit(result) {
    if (result.local_only) {
      if (result.native_otel.shell === 'json') {
        return `${JSON.stringify({
          mode: result.mode,
          local_only: true,
          dry_run: result.dry_run,
          wrapper_required: false,
          would_install: result.would_install,
          would_update: result.would_update,
          would_write: result.would_write,
          would_start: result.would_start,
          applied: result.applied,
          native_otel: result.native_otel,
          shell_exports: result.native_otel.exports,
          next: result.next
        }, null, 2)}\n`;
      }
      if (!result.dry_run) return result.shell_exports;
      const lines = [
        'AgentOps init --local-only',
        '',
        'Mode: preview. No local writes or process starts were made.',
        'Native Copilot OTel: planned; wrapper required: no; Azure: not checked and not required.',
        '',
        'would_install:',
        `- AgentOps skills: ${result.would_install.skills.length}`,
        `- AgentOps agents: ${result.would_install.agents.length}`,
        'would_write:',
        ...(result.would_write.length ? result.would_write.map(target => `- ${target}`) : ['- none']),
        'would_start:',
        ...result.would_start.map(command => `- ${command}`),
        '',
        'would_emit (native Copilot OTel exports):',
        ...result.shell_exports.trim().split('\n').map(line => `- ${line}`),
        '',
        `Next: ${result.confirmation_command || 'agentops init --local-only --yes --shell bash'}`,
        'Then: agentops smoke --local',
        'Execution remains the plain `copilot` command.'
      ];
      return `${lines.join('\n')}\n`;
    }
    const lines = [
      'AgentOps init',
      '',
      `Mode: ${result.mode}.`,
      `Local files: ${result.local_status.required_files.found} of ${result.local_status.required_files.total} found.`,
      result.local_status.content_capture_off
        ? 'Content capture: off.'
        : 'Content capture: on; turn it off before sharing telemetry.',
      result.local_status.collector_localhost
        ? 'Collector config: localhost confirmed.'
        : 'Collector config: localhost not confirmed.',
      `Shim: agentops=${result.shim.agentops_cli_installed ? 'installed' : 'missing'}, copilot-agentops=${result.shim.copilot_agentops_installed ? 'installed' : 'missing'}, transparent routing=${result.shim.plain_copilot_observed ? 'enabled' : 'disabled'}.`,
      `Cloud config: workspace=${result.cloud.workspace_id_configured ? 'set' : 'missing'}, Azure Monitor Agents view=${result.cloud.agents_view_url_configured ? 'set' : 'missing'}, Grafana advanced=${result.cloud.grafana_url_configured ? 'set' : 'missing'}.`,
      `Azure subscription: expected=${result.cloud.expected_subscription_id || 'not configured'}, active=${result.cloud.active_subscription_name || 'not signed in'} (${result.cloud.active_subscription_id || 'unknown'}), match=${result.cloud.subscription_match ? 'yes' : 'no'}.`,
      `azd environment: ${result.azd.ok ? 'AgentOps outputs found.' : result.azd.detail}`
    ];

    if (result.cloud_provision.requested) {
      lines.push(`Cloud provision: ${result.cloud_provision.ok ? 'ready' : 'needs review'} (${result.cloud_provision.command}).`);
      if (!result.cloud_provision.ok && result.cloud_provision.failing_stage) {
        lines.push(`Cloud provision failed at: ${result.cloud_provision.failing_stage}.`);
      }
      if (!result.cloud_provision.ok && result.cloud_provision.next?.length) {
        lines.push('Cloud provision next:');
        for (const command of result.cloud_provision.next) lines.push(`- ${command}`);
      }
    } else if (result.cloud_provision.skipped_reason === 'cloud_already_configured' && result.cloud.binding_status === 'ready') {
      lines.push('Cloud provision: skipped; the existing workspace and Grafana binding will be reused. Use `--provision-cloud` explicitly to reprovision.');
    } else if (result.cloud_provision.skipped_reason === 'cloud_already_configured') {
      lines.push(`Cloud provision: blocked; configured target is ${result.cloud.resource_group_status || 'not verified'} (${result.cloud.resource_group_detail || 'run validate-azure before any write'}).`);
    }
    if (result.dashboard_import?.requested) {
      lines.push(`Dashboard import: ${result.confirmation_required ? 'planned; not run' : result.dashboard_import.ok ? 'ready' : 'needs review'} (${result.dashboard_import.command}).`);
      if (!result.dashboard_import.ok && result.dashboard_import.next?.length) {
        lines.push('Dashboard import next:');
        for (const command of result.dashboard_import.next) lines.push(`- ${command}`);
      }
    }
    if (result.real_smoke?.requested) {
      lines.push(`Real smoke: ${result.confirmation_required ? 'planned; not run' : result.real_smoke.ok ? 'ready' : 'needs review'} (${result.real_smoke.command}).`);
      if (!result.real_smoke.ok && result.real_smoke.next?.length) {
        lines.push('Real smoke next:');
        for (const command of result.real_smoke.next) lines.push(`- ${command}`);
      }
    }
    if (result.triage_latest?.requested) {
      lines.push(`Latest triage: ${result.confirmation_required ? 'planned; not run' : result.triage_latest.ok ? 'ready' : 'needs review'} (${result.triage_latest.command}).`);
      if (!result.triage_latest.ok && result.triage_latest.next?.length) {
        lines.push('Latest triage next:');
        for (const command of result.triage_latest.next) lines.push(`- ${command}`);
      }
    }

    if (result.skills) {
      lines.push(`Skills: ${plural(result.skills.installed, 'new skill')}; ${plural(result.skills.updated.length, 'updated skill')}; skipped ${plural(result.skills.skipped.length, 'existing skill')}.`);
    }
    if (result.agents) {
      lines.push(`Agents: ${plural(result.agents.installed, 'new agent')}; ${plural(result.agents.updated.length, 'updated agent')}; skipped ${plural(result.agents.skipped.length, 'existing agent')}.`);
    }

    if (result.summary) {
      const stages = result.summary.stages?.length
        ? ` Stages: ${result.summary.stages.map(stage => `${stage.name}=${stage.status}`).join(', ')}.`
        : '';
      lines.push(`Summary: ${result.summary.status}. ${result.summary.detail}${stages}`);
    }

    lines.push('', 'Next commands:');
    for (const command of result.next) lines.push(`- ${command}`);
    lines.push('', 'Everyday observed use: agentops copilot');
    lines.push('See the latest result: agentops open latest');
    lines.push('Check local health: agentops status');
    lines.push('', 'Plugin files are reversible: run `agentops plugin uninstall` to remove only the bundled AgentOps agents and skills from Copilot home.');
    return `${lines.join('\n')}\n`;
  }

  return {
    agentopsInit,
    agentopsSetupGuide,
    parseInitArgs,
    parseSetupArgs,
    renderInit,
    renderSetupGuide
  };
}

module.exports = {
  createSetupInit
};
