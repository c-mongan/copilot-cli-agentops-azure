const { validateKqlDuration } = require('./kql');
const { baseFilter } = require('./observability-queries');
const { renderValidateAzure } = require('./azure-validation-render');
const {
  azAvailable,
  azErrorDetail,
  checkResult,
  parseJsonOutput,
  runAz
} = require('./azure-validation-runtime');
const {
  actionGroupReceiverSummary,
  agentOpsContentTables,
  agentOpsScheduledQueryRules,
  approvedPrivateEndpointConnections,
  asArray,
  azureBudgetsFromResult,
  azureProductionRemediationPlan,
  azureRoleIds,
  boolish,
  logAnalyticsTablesFromResult,
  pathValue,
  privateEndpointConnectionsFromResource,
  roleAssignmentSummary
} = require('./azure-posture');
const { validateDurableReceiptAzureSchema } = require('./azure/durable-receipt-schema-guard');

function validateAzure(options = {}, dependencies = {}) {
  const {
    configuredCloudValues,
    isConfiguredValue,
    runAzureLogAnalyticsQuery,
    listGrafanaDashboardFiles,
    flattenGrafanaList,
    grafanaItemUid,
    grafanaDashboardImportCommand,
    runGrafanaDashboardImportRemediation
  } = dependencies;

  const last = validateKqlDuration(options.last || '2h');
  const cloud = configuredCloudValues(options);
  const checks = [];
  const next = [];
  const hasAz = azAvailable(options);
  const production = Boolean(options.production);
  const requestedReadinessProfile = String(options.readinessProfile || '').toLowerCase();
  const readinessProfileValid = !requestedReadinessProfile || ['personal', 'team', 'internal'].includes(requestedReadinessProfile);
  const readinessProfile = production
    ? 'internal'
    : (['personal', 'team', 'internal'].includes(requestedReadinessProfile) ? requestedReadinessProfile : 'personal');
  const costGuardrailsRequired = readinessProfile === 'team' || readinessProfile === 'internal';
  const groupRbacRequired = production || readinessProfile === 'internal';
  const azureViewsRequired = readinessProfile === 'team' || readinessProfile === 'internal';

  checks.push(checkResult('azure-readiness-profile', readinessProfileValid, {
    readiness_profile: readinessProfile,
    cost_guardrails_required: costGuardrailsRequired,
    advisory: readinessProfile === 'personal',
    detail: !readinessProfileValid
      ? `unsupported readiness profile: ${requestedReadinessProfile}`
      : readinessProfile === 'personal'
      ? 'personal dev/demo posture only; do not use for Microsoft confidential, customer, or production data'
      : `${readinessProfile} posture requires a finite Log Analytics daily cap and an Azure budget`
  }));

  checks.push(checkResult('az-cli', hasAz, hasAz ? {} : { detail: 'Azure CLI was not found on PATH.' }));

  let account = null;
  if (hasAz) {
    const accountResult = runAz(['account', 'show', '-o', 'json'], options);
    account = accountResult.status === 0 ? parseJsonOutput(accountResult) : null;
    checks.push(checkResult('azure-account', accountResult.status === 0, {
      detail: accountResult.status === 0 ? account?.name || account?.id || 'logged in' : (accountResult.stderr || accountResult.stdout || 'az account show failed').trim()
    }));
    if (cloud.subscriptionId && account?.id && account.id !== cloud.subscriptionId) {
      checks.push(checkResult('azure-subscription', false, {
        expected: cloud.subscriptionId,
        actual: account.id,
        detail: 'Active Azure subscription does not match AGENTOPS_AZURE_SUBSCRIPTION_ID/AZURE_SUBSCRIPTION_ID.'
      }));
      next.push(`az account set --subscription "${cloud.subscriptionId}"`);
    } else if (cloud.subscriptionId) {
      checks.push(checkResult('azure-subscription', true, { expected: cloud.subscriptionId, actual: account?.id || null }));
    }
  }

  if (!cloud.resourceGroup) {
    checks.push(checkResult('resource-group-configured', false, { detail: 'Set AZURE_RESOURCE_GROUP or AGENTOPS_AZURE_RESOURCE_GROUP.' }));
    next.push('agentops configure set --resource-group rg-agentops-dev');
  } else if (hasAz) {
    const groupResult = runAz(['group', 'exists', '--name', cloud.resourceGroup, '-o', 'tsv'], options);
    const exists = groupResult.status === 0 && String(groupResult.stdout || '').trim() === 'true';
    checks.push(checkResult('resource-group', exists, { resource_group: cloud.resourceGroup }));
    if (!exists) next.push('Run ./scripts/azure-readiness.sh and review the target resource group.');
  }

  if (hasAz && cloud.resourceGroup) {
    const budgetResult = runAz(['consumption', 'budget', 'list', '--resource-group', cloud.resourceGroup, '-o', 'json'], options);
    const budgets = budgetResult.status === 0 ? azureBudgetsFromResult(parseJsonOutput(budgetResult)) : [];
    const validBudgets = budgets.filter(budget => Number.isFinite(budget.amount) && budget.amount > 0);
    const budgetObserved = budgetResult.status === 0 && validBudgets.length > 0;
    const budgetPostureOk = !costGuardrailsRequired || budgetObserved;
    checks.push(checkResult('azure-budget-posture', budgetPostureOk, {
      budgets: budgets.length,
      budget_names: budgets.map(budget => budget.name).filter(Boolean),
      valid_budgets: validBudgets.length,
      production,
      readiness_profile: readinessProfile,
      required: costGuardrailsRequired,
      advisory: !costGuardrailsRequired && !budgetObserved,
      detail: budgetResult.status !== 0
        && costGuardrailsRequired
        ? azErrorDetail(budgetResult, 'could not list Azure Consumption budgets')
        : budgetResult.status !== 0
          ? 'personal dev advisory: Azure budget posture could not be read'
        : budgetObserved
          ? 'Azure budget guardrail observed'
          : costGuardrailsRequired
            ? `${readinessProfile} posture requires an Azure budget for AgentOps spend guardrails`
            : 'personal dev advisory: no Azure budget observed; keep usage metadata-only and review spend manually'
    }));
    if (budgetResult.status !== 0 && costGuardrailsRequired) next.push('Verify Azure Consumption budget read permissions for the resource group.');
    else if (costGuardrailsRequired && validBudgets.length === 0) next.push(`Configure an Azure Consumption budget before ${readinessProfile} AgentOps rollout.`);
  }

  const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  checks.push(checkResult('log-analytics-workspace-id', workspaceConfigured, {
    workspace_id: workspaceConfigured ? cloud.workspaceId : null,
    detail: workspaceConfigured ? 'configured' : 'Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID or LOG_ANALYTICS_WORKSPACE_ID.'
  }));
  if (!workspaceConfigured) next.push('agentops configure set --workspace-id "<workspace-id>"');

  if (hasAz && workspaceConfigured) {
    const query = `AppDependencies | where TimeGenerated > ago(${last}) | where ${baseFilter} | summarize Rows=count()`;
    const queryResult = runAzureLogAnalyticsQuery(query, {
      spawnSync: options.spawnSync,
      workspaceId: cloud.workspaceId
    });
    const rowCount = queryResult.rows?.[0]?.Rows ?? queryResult.rows?.[0]?.rows ?? null;
    checks.push(checkResult('log-analytics-query', queryResult.ok, {
      rows: rowCount,
      detail: queryResult.ok ? 'query succeeded' : queryResult.error
    }));
  }

  if (hasAz) {
    const schemaValidation = validateDurableReceiptAzureSchema({
      resourceGroup: cloud.resourceGroup,
      workspaceName: cloud.workspaceName,
      dcrImmutableId: cloud.dcrImmutableId,
      runAz: args => runAz(args, options)
    });
    checks.push(checkResult('durable-receipt-live-schema', schemaValidation.ok, schemaValidation));
    if (!schemaValidation.ok) {
      next.push('Preserve EstimatedCostUsd as long; add EventId:string, Sequence:long, and EstimatedCostUsdReal:real to AgentOpsEvents_CL and Custom-AgentOpsEvents_CL before relying on exact ordered Azure receipt proof.');
    }
  }

  if (hasAz && cloud.resourceGroup && cloud.workspaceName) {
    let workspaceRbacOkForContent = null;
    const workspaceResult = runAz([
      'monitor',
      'log-analytics',
      'workspace',
      'show',
      '--resource-group',
      cloud.resourceGroup,
      '--workspace-name',
      cloud.workspaceName,
      '-o',
      'json'
    ], options);
    const workspace = workspaceResult.status === 0 ? parseJsonOutput(workspaceResult) : null;
    const workspaceResourceId = workspace?.id || null;
    const retentionDays = Number(workspace?.retentionInDays ?? 0);
    const dailyQuotaGb = Number(pathValue(workspace, ['workspaceCapping', 'dailyQuotaGb'], NaN));
    const resourceScopedAccess = boolish(pathValue(workspace, ['features', 'enableLogAccessUsingOnlyResourcePermissions'], false));
    const logAnalyticsPostureOk = workspaceResult.status === 0 &&
      (!costGuardrailsRequired || (retentionDays > 0 && dailyQuotaGb !== -1 && resourceScopedAccess));
    checks.push(checkResult('log-analytics-posture', logAnalyticsPostureOk, {
      workspace: cloud.workspaceName,
      retention_days: Number.isFinite(retentionDays) ? retentionDays : null,
      daily_quota_gb: Number.isFinite(dailyQuotaGb) ? dailyQuotaGb : null,
      resource_scoped_access: resourceScopedAccess,
      issues: [
        retentionDays <= 0 ? 'retention' : null,
        dailyQuotaGb === -1 ? 'daily_cap' : null,
        !resourceScopedAccess ? 'resource_scoped_access' : null
      ].filter(Boolean),
      production,
      readiness_profile: readinessProfile,
      cost_guardrails_required: costGuardrailsRequired,
      advisory: !costGuardrailsRequired && dailyQuotaGb === -1,
      detail: workspaceResult.status !== 0
        ? azErrorDetail(workspaceResult, 'could not read Log Analytics workspace posture')
        : costGuardrailsRequired
          ? (logAnalyticsPostureOk
              ? 'retention, daily cap, and resource-scoped access configured'
              : `${readinessProfile} posture requires retention, a finite daily ingestion cap, and resource-scoped access`)
          : dailyQuotaGb === -1
            ? 'personal dev advisory: Log Analytics ingestion is uncapped; team/internal readiness would fail'
            : 'personal dev Log Analytics posture observed'
    }));
    if (workspaceResult.status !== 0) next.push('Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME to the deployed workspace name.');
    else if (costGuardrailsRequired && (retentionDays <= 0 || dailyQuotaGb === -1 || !resourceScopedAccess)) {
      next.push(`Review Log Analytics retention, daily cap, and resource-scoped access before ${readinessProfile} rollout.`);
    }

    if (workspaceResult.status === 0 && workspaceResourceId) {
      const roleResult = runAz([
        'role',
        'assignment',
        'list',
        '--scope',
        workspaceResourceId,
        '--include-groups',
        '-o',
        'json'
      ], options);
      const summary = roleAssignmentSummary(
        roleResult.status === 0 ? parseJsonOutput(roleResult) : [],
        [azureRoleIds.logAnalyticsDataReader, azureRoleIds.monitoringReader]
      );
      const workspaceRbacOk = roleResult.status === 0 &&
        (!groupRbacRequired || (summary.group_assignments > 0 && summary.broad_assignments === 0));
      workspaceRbacOkForContent = workspaceRbacOk;
      checks.push(checkResult('log-analytics-rbac-posture', workspaceRbacOk, {
        scope: workspaceResourceId,
        ...summary,
        production,
        readiness_profile: readinessProfile,
        group_rbac_required: groupRbacRequired,
        detail: roleResult.status !== 0
          ? azErrorDetail(roleResult, 'could not list Log Analytics RBAC assignments')
          : groupRbacRequired
            ? (workspaceRbacOk
                ? 'least-privilege group RBAC observed on Log Analytics'
                : `${readinessProfile} posture expects group-based reader RBAC and no broad Owner/Contributor assignments on Log Analytics`)
            : 'Log Analytics RBAC posture observed'
      }));
      if (roleResult.status !== 0) next.push('Verify Azure RBAC read permissions for the Log Analytics workspace.');
      else if (groupRbacRequired && !workspaceRbacOk) next.push(`Review Log Analytics RBAC: assign observer groups and remove routine broad roles before ${readinessProfile} rollout.`);
    }

    if (production && workspaceResult.status === 0) {
      const tableResult = runAz([
        'monitor',
        'log-analytics',
        'workspace',
        'table',
        'list',
        '--resource-group',
        cloud.resourceGroup,
        '--workspace-name',
        cloud.workspaceName,
        '-o',
        'json'
      ], options);
      const contentTables = tableResult.status === 0 ? agentOpsContentTables(parseJsonOutput(tableResult)) : [];
      const retentionCandidates = contentTables
        .map(table => table.retention_days)
        .filter(Number.isFinite);
      const contentRetentionDays = retentionCandidates.length > 0
        ? Math.min(...retentionCandidates)
        : retentionDays;
      const hasContentTable = contentTables.length > 0;
      const shortRetention = Number.isFinite(contentRetentionDays) && contentRetentionDays > 0 && contentRetentionDays <= 30;
      const contentPostureOk = tableResult.status === 0 &&
        (!hasContentTable || (shortRetention && resourceScopedAccess && workspaceRbacOkForContent === true));
      checks.push(checkResult('content-capture-table-posture', contentPostureOk, {
        table: 'AgentOpsContent_CL',
        observed: hasContentTable,
        retention_days: Number.isFinite(contentRetentionDays) ? contentRetentionDays : null,
        max_retention_days: 30,
        resource_scoped_access: resourceScopedAccess,
        log_analytics_rbac_ok: workspaceRbacOkForContent,
        issues: hasContentTable ? [
          !shortRetention ? 'short_retention' : null,
          !resourceScopedAccess ? 'resource_scoped_access' : null,
          workspaceRbacOkForContent !== true ? 'workspace_rbac' : null
        ].filter(Boolean) : [],
        production,
        detail: tableResult.status !== 0
          ? azErrorDetail(tableResult, 'could not list Log Analytics tables')
          : hasContentTable
            ? (contentPostureOk
                ? 'optional content table uses short retention and least-privilege workspace access'
                : 'production mode expects optional content rows to use <=30 day retention and least-privilege workspace access')
            : 'no optional content capture table observed'
      }));
      if (tableResult.status !== 0) next.push('Install/update Azure CLI monitor extension or verify Log Analytics table read permissions.');
      else if (hasContentTable && !contentPostureOk) {
        next.push('Harden optional content capture: keep AgentOpsContent_CL retention <=30 days and restrict Log Analytics access before production.');
      }
    }
  }

  if (cloud.appInsightsName && hasAz && cloud.resourceGroup) {
    const appResult = runAz([
      'monitor',
      'app-insights',
      'component',
      'show',
      '--resource-group',
      cloud.resourceGroup,
      '--app',
      cloud.appInsightsName,
      '-o',
      'json'
    ], options);
    checks.push(checkResult('application-insights', appResult.status === 0, {
      app: cloud.appInsightsName,
      required: azureViewsRequired,
      detail: appResult.status === 0 ? 'found' : (appResult.stderr || appResult.stdout || 'not found').trim()
    }));
    if (appResult.status !== 0) next.push('Check APPLICATIONINSIGHTS_NAME against the deployed App Insights component name.');
  } else if (cloud.appInsightsName) {
    checks.push(checkResult('application-insights', !azureViewsRequired, {
      app: cloud.appInsightsName,
      required: azureViewsRequired,
      skipped: !azureViewsRequired,
      detail: 'configured, but could not be checked without Azure CLI and a resource group'
    }));
  } else {
    checks.push(checkResult('application-insights', !azureViewsRequired, {
      required: azureViewsRequired,
      skipped: !azureViewsRequired,
      detail: azureViewsRequired
        ? 'required for team/internal readiness; configure APPLICATIONINSIGHTS_NAME'
        : 'optional for personal metadata-only readiness; not configured'
    }));
    if (azureViewsRequired && !cloud.appInsightsName) next.push('Configure APPLICATIONINSIGHTS_NAME for team/internal readiness.');
  }

  const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
  checks.push(checkResult('grafana-base-url', grafanaConfigured || !azureViewsRequired, {
    url: grafanaConfigured ? cloud.grafanaBaseUrl : null,
    required: azureViewsRequired,
    skipped: !grafanaConfigured && !azureViewsRequired,
    detail: grafanaConfigured
      ? 'configured'
      : azureViewsRequired
        ? 'required for team/internal readiness; set AGENTOPS_GRAFANA_BASE_URL'
        : 'optional for personal metadata-only readiness; not configured'
  }));
  if (!grafanaConfigured && azureViewsRequired) next.push('agentops configure set --grafana-url "https://<your-grafana>.grafana.azure.com"');

  if (hasAz && cloud.grafanaName && cloud.resourceGroup) {
    const grafanaResult = runAz(['grafana', 'show', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
    const grafanaFound = grafanaResult.status === 0;
    const grafanaResource = grafanaFound ? parseJsonOutput(grafanaResult) : null;
    const grafanaResourceId = grafanaResource?.id || null;
    checks.push(checkResult('grafana-resource', grafanaFound, {
      grafana: cloud.grafanaName,
      detail: grafanaFound ? 'found' : azErrorDetail(grafanaResult, 'not found')
    }));
    if (!grafanaFound) {
      next.push('Set GRAFANA_NAME or AGENTOPS_GRAFANA_NAME to the deployed Azure Managed Grafana resource name.');
    } else {
      const identityType = String(pathValue(grafanaResource, ['identity', 'type'], ''));
      const apiKey = String(pathValue(grafanaResource, ['properties', 'apiKey'], ''));
      const publicNetworkAccess = String(pathValue(grafanaResource, ['properties', 'publicNetworkAccess'], 'unknown'));
      const zoneRedundancy = String(pathValue(grafanaResource, ['properties', 'zoneRedundancy'], 'unknown'));
      const grafanaPostureOk = identityType.includes('SystemAssigned') &&
        apiKey === 'Disabled' &&
        (!production || publicNetworkAccess === 'Disabled') &&
        (!production || zoneRedundancy === 'Enabled');
      checks.push(checkResult('grafana-production-posture', grafanaPostureOk, {
        identity_type: identityType || null,
        api_key: apiKey || null,
        public_network_access: publicNetworkAccess,
        zone_redundancy: zoneRedundancy,
        issues: [
          !identityType.includes('SystemAssigned') ? 'managed_identity' : null,
          apiKey !== 'Disabled' ? 'api_keys' : null,
          publicNetworkAccess !== 'Disabled' ? 'public_network_access' : null,
          zoneRedundancy !== 'Enabled' ? 'zone_redundancy' : null
        ].filter(Boolean),
        production,
        detail: grafanaPostureOk
          ? (production ? 'managed identity and Grafana hardening posture verified' : 'pilot Grafana posture observed')
          : production
            ? 'production mode expects managed identity, API keys disabled, private access, and zone redundancy'
            : 'pilot posture observed; use --production to enforce private access and zone redundancy'
      }));
      if (!grafanaPostureOk) {
        next.push(production
          ? 'Review Grafana identity, API key, public access, and zone redundancy before production.'
          : 'Run agentops validate-azure --production to enforce production Grafana posture.');
      }

      if (production) {
        const approvedPrivateConnections = approvedPrivateEndpointConnections(grafanaResource);
        const privateAccessOk = publicNetworkAccess === 'Disabled' && approvedPrivateConnections.length > 0;
        checks.push(checkResult('grafana-private-access-posture', privateAccessOk, {
          public_network_access: publicNetworkAccess,
          private_endpoint_connections: privateEndpointConnectionsFromResource(grafanaResource).length,
          approved_private_endpoint_connections: approvedPrivateConnections.length,
          production,
          detail: privateAccessOk
            ? 'public access disabled and approved private endpoint connection observed'
            : 'production mode expects disabled public access plus an approved private endpoint connection'
        }));
        if (!privateAccessOk) next.push('Verify Managed Grafana private endpoint connectivity before production.');
      }

      if (grafanaResourceId) {
        const roleResult = runAz([
          'role',
          'assignment',
          'list',
          '--scope',
          grafanaResourceId,
          '--include-groups',
          '-o',
          'json'
        ], options);
        const summary = roleAssignmentSummary(
          roleResult.status === 0 ? parseJsonOutput(roleResult) : [],
          [azureRoleIds.grafanaViewer, azureRoleIds.grafanaEditor, azureRoleIds.grafanaAdmin]
        );
        const grafanaRbacOk = roleResult.status === 0 &&
          (!groupRbacRequired || (summary.group_assignments > 0 && summary.broad_assignments === 0));
        checks.push(checkResult('grafana-rbac-posture', grafanaRbacOk, {
          scope: grafanaResourceId,
          ...summary,
          production,
          readiness_profile: readinessProfile,
          group_rbac_required: groupRbacRequired,
          detail: roleResult.status !== 0
            ? azErrorDetail(roleResult, 'could not list Grafana RBAC assignments')
            : groupRbacRequired
              ? (grafanaRbacOk
                  ? 'least-privilege group RBAC observed on Managed Grafana'
                  : `${readinessProfile} posture expects group-based Grafana RBAC and no broad Owner/Contributor assignments on Managed Grafana`)
              : 'Grafana RBAC posture observed'
        }));
        if (roleResult.status !== 0) next.push('Verify Azure RBAC read permissions for the Managed Grafana resource.');
        else if (groupRbacRequired && !grafanaRbacOk) next.push(`Review Managed Grafana RBAC: assign observer/operator groups and remove routine broad roles before ${readinessProfile} rollout.`);
      }

      const dataSourceResult = runAz(['grafana', 'data-source', 'list', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
      const dataSources = flattenGrafanaList(dataSourceResult.status === 0 ? parseJsonOutput(dataSourceResult) : null);
      const datasourceFound = dataSources.some(item => grafanaItemUid(item) === cloud.grafanaDatasourceUid || item?.name === cloud.grafanaDatasourceUid);
      checks.push(checkResult('grafana-datasource', dataSourceResult.status === 0 && datasourceFound, {
        expected_uid: cloud.grafanaDatasourceUid,
        observed: dataSources.map(grafanaItemUid).filter(Boolean).slice(0, 10),
        detail: dataSourceResult.status !== 0
          ? (dataSourceResult.stderr || dataSourceResult.stdout || 'could not list datasources').trim()
          : datasourceFound
            ? 'found'
            : 'datasource UID not found'
      }));
      if (dataSourceResult.status !== 0 || !datasourceFound) {
        next.push('Set AGENTOPS_GRAFANA_DATASOURCE_UID to the Azure Monitor datasource UID used by the dashboards.');
      }

      const expectedDashboards = options.expectedDashboards || listGrafanaDashboardFiles(options);
      const dashboardResult = runAz(['grafana', 'dashboard', 'list', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
      const dashboards = flattenGrafanaList(dashboardResult.status === 0 ? parseJsonOutput(dashboardResult) : null);
      const observedUids = new Set(dashboards.map(grafanaItemUid).filter(Boolean));
      const missingDashboards = expectedDashboards.filter(dashboard => !observedUids.has(dashboard.uid));
      checks.push(checkResult('grafana-dashboards', dashboardResult.status === 0 && missingDashboards.length === 0, {
        expected: expectedDashboards.length,
        missing: missingDashboards.map(dashboard => dashboard.uid),
        detail: dashboardResult.status !== 0
          ? (dashboardResult.stderr || dashboardResult.stdout || 'could not list dashboards').trim()
          : missingDashboards.length === 0
            ? 'all expected dashboards found'
            : `${missingDashboards.length} expected dashboard${missingDashboards.length === 1 ? '' : 's'} missing`
      }));
      if (options.verifyDashboardContent && dashboardResult.status === 0 && missingDashboards.length === 0) {
        const coreDashboards = expectedDashboards.filter(dashboard => String(dashboard.uid || '').startsWith('agentops-v2-'));
        const contentResults = coreDashboards.map(expected => {
          const showResult = runAz([
            'grafana', 'dashboard', 'show',
            '-n', cloud.grafanaName,
            '-g', cloud.resourceGroup,
            '--dashboard', expected.uid,
            '-o', 'json'
          ], options);
          const payload = showResult.status === 0 ? parseJsonOutput(showResult) : null;
          const deployed = payload?.dashboard || payload;
          const serialized = JSON.stringify(deployed || {});
          return {
            uid: expected.uid,
            expected_title: expected.title,
            deployed_title: deployed?.title || null,
            title_match: deployed?.title === expected.title,
            stale_run_replay_mentions: (serialized.match(/Run Replay/g) || []).length,
            run_story_mentions: (serialized.match(/Run Story/g) || []).length,
            ok: showResult.status === 0 && deployed?.title === expected.title && !serialized.includes('Run Replay'),
            error: showResult.status === 0 ? null : azErrorDetail(showResult, 'dashboard show failed')
          };
        });
        const contentOk = coreDashboards.length > 0 && contentResults.every(item => item.ok);
        checks.push(checkResult('grafana-dashboard-content', contentOk, {
          dashboards: contentResults,
          checked: contentResults.length,
          run_story_mentions: contentResults.reduce((sum, item) => sum + item.run_story_mentions, 0),
          stale_run_replay_mentions: contentResults.reduce((sum, item) => sum + item.stale_run_replay_mentions, 0),
          detail: contentOk
            ? 'deployed core dashboard titles and Run Story language match the current product contract'
            : 'deployed core dashboard content is stale, missing, or does not match expected titles'
        }));
        if (!contentOk) next.push(grafanaDashboardImportCommand(cloud));
      }
      if (dashboardResult.status !== 0 || missingDashboards.length > 0) {
        next.push(grafanaDashboardImportCommand(cloud));
        if (options.importDashboards) {
          const remediation = runGrafanaDashboardImportRemediation(cloud, options);
          checks.push(checkResult('grafana-dashboard-import', remediation.ok, {
            command: remediation.command,
            detail: remediation.ok
              ? 'import completed'
              : (remediation.stderr || remediation.stdout || remediation.error || `dashboard import exited ${remediation.status}`).trim(),
            remediation
          }));
          if (remediation.ok) next.push('agentops validate-azure --last 24h');
        }
      }
    }
  } else if (!cloud.grafanaName) {
    checks.push(checkResult('grafana-resource', !azureViewsRequired, {
      required: azureViewsRequired,
      skipped: !azureViewsRequired,
      detail: azureViewsRequired
        ? 'required for team/internal readiness; configure GRAFANA_NAME'
        : 'optional for personal metadata-only readiness; not configured'
    }));
    checks.push(checkResult('grafana-production-posture', !azureViewsRequired, {
      required: azureViewsRequired,
      skipped: !azureViewsRequired,
      detail: azureViewsRequired
        ? 'required for team/internal readiness; configure a Managed Grafana resource'
        : 'optional for personal metadata-only readiness; not configured'
    }));
    checks.push({ name: 'grafana-datasource', ok: true, skipped: true, detail: 'Skipped because Grafana resource name is not configured.' });
    checks.push({ name: 'grafana-dashboards', ok: true, skipped: true, detail: 'Skipped because Grafana resource name is not configured.' });
    if (azureViewsRequired) next.push('Configure GRAFANA_NAME for team/internal readiness.');
  }

  if (hasAz && cloud.resourceGroup) {
    const alertResult = runAz(['monitor', 'scheduled-query', 'list', '--resource-group', cloud.resourceGroup, '-o', 'json'], options);
    const rules = alertResult.status === 0 ? agentOpsScheduledQueryRules(parseJsonOutput(alertResult)) : [];
    const enabledRules = rules.filter(rule => boolish(pathValue(rule, ['properties', 'enabled'], false)));
    const routedRules = rules.filter(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], [])).length > 0);
    const unroutedRules = rules.filter(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], [])).length === 0);
    const actionGroupIds = Array.from(new Set(routedRules.flatMap(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], []))).filter(Boolean)));
    const alertPostureOk = alertResult.status === 0 && (!production || (enabledRules.length > 0 && enabledRules.length === routedRules.length));
    checks.push(checkResult('alert-routing-posture', alertPostureOk, {
      rules: rules.length,
      rule_names: rules.map(rule => rule.name).filter(Boolean),
      enabled_rules: enabledRules.length,
      enabled_rule_names: enabledRules.map(rule => rule.name).filter(Boolean),
      routed_rules: routedRules.length,
      action_groups: actionGroupIds.length,
      unrouted_rule_names: unroutedRules.map(rule => rule.name).filter(Boolean),
      production,
      detail: alertResult.status !== 0
        ? azErrorDetail(alertResult, 'could not list scheduled query rules')
        : production
          ? 'production mode expects enabled AgentOps alerts routed to action groups'
          : 'scheduled query alert posture observed'
    }));
    if (alertResult.status !== 0) next.push('Install/update Azure CLI monitor extension or verify scheduled query rule read permissions.');
    else if (production && (enabledRules.length === 0 || enabledRules.length !== routedRules.length)) {
      next.push('Configure AgentOps scheduled query alerts with approved Azure Monitor action groups before production.');
    }

    if (production && alertResult.status === 0) {
      const actionGroupChecks = actionGroupIds.map(id => {
        const groupResult = runAz(['monitor', 'action-group', 'show', '--ids', id, '-o', 'json'], options);
        const actionGroup = groupResult.status === 0 ? parseJsonOutput(groupResult) : null;
        const receiverSummary = actionGroupReceiverSummary(actionGroup);
        const enabled = boolish(actionGroup?.enabled ?? pathValue(actionGroup, ['properties', 'enabled'], true));
        return {
          id,
          ok: groupResult.status === 0 && enabled && receiverSummary.receiver_count > 0,
          status: groupResult.status,
          enabled,
          receiver_count: receiverSummary.receiver_count,
          receiver_types: receiverSummary.receiver_types,
          detail: groupResult.status === 0 ? 'found' : azErrorDetail(groupResult, 'could not read action group')
        };
      });
      const actionGroupDestinationOk = actionGroupIds.length > 0 && actionGroupChecks.every(item => item.ok);
      checks.push(checkResult('action-group-destination-posture', actionGroupDestinationOk, {
        action_groups: actionGroupIds.length,
        checked: actionGroupChecks.length,
        invalid: actionGroupChecks.filter(item => !item.ok).map(item => item.id),
        receivers: actionGroupChecks.reduce((sum, item) => sum + item.receiver_count, 0),
        production,
        detail: actionGroupDestinationOk
          ? 'routed action groups exist and have notification receivers'
          : 'production mode expects routed action groups to exist, be enabled, and have at least one receiver'
      }));
      if (!actionGroupDestinationOk) next.push('Review Azure Monitor action group destinations before production alerts are enabled.');
    }
  }

  const workspaceRbacCheck = checks.find(check => check.name === 'log-analytics-rbac-posture');
  const grafanaRbacCheck = checks.find(check => check.name === 'grafana-rbac-posture');
  if (workspaceRbacCheck || grafanaRbacCheck) {
    const accessOk = (!workspaceRbacCheck || workspaceRbacCheck.ok) && (!grafanaRbacCheck || grafanaRbacCheck.ok);
    checks.push(checkResult('access-rbac-posture', accessOk, {
      production,
      readiness_profile: readinessProfile,
      group_rbac_required: groupRbacRequired,
      log_analytics_ok: workspaceRbacCheck ? workspaceRbacCheck.ok : null,
      grafana_ok: grafanaRbacCheck ? grafanaRbacCheck.ok : null,
      detail: accessOk
        ? 'Azure access RBAC posture observed'
        : `${readinessProfile} posture expects least-privilege group RBAC for Log Analytics and Managed Grafana`
    }));
  } else if (production) {
    checks.push(checkResult('access-rbac-posture', false, {
      production,
      detail: 'production mode could not verify Log Analytics or Managed Grafana RBAC posture'
    }));
    next.push('Configure workspace and Grafana resource names so validate-azure can verify RBAC posture.');
  }

  if (next.length === 0) {
    next.push('node agentops-cli/src/index.js collector smoke --privacy strict --poison');
    next.push('node agentops-cli/src/index.js smoke --real-copilot --wait 2m --poll 10s --open-browser');
    next.push('copilot -p "Reply with exactly: agentops smoke."');
    next.push('node agentops-cli/src/index.js latest --last 2h');
  }

  const result = {
    ok: checks.every(check => check.ok),
    last,
    config: {
      subscription_id: cloud.subscriptionId || account?.id || null,
      active_subscription_id: account?.id || null,
      active_subscription_name: account?.name || null,
      resource_group: cloud.resourceGroup,
      workspace_id: workspaceConfigured ? cloud.workspaceId : null,
      workspace_name: cloud.workspaceName,
      grafana_base_url: grafanaConfigured ? cloud.grafanaBaseUrl : null,
      grafana_name: cloud.grafanaName || null,
      grafana_datasource_uid: cloud.grafanaDatasourceUid,
      app_insights_name: cloud.appInsightsName,
      production,
      readiness_profile: readinessProfile,
      data_boundary: readinessProfile === 'personal'
        ? 'personal-dev-demo-metadata-only'
        : 'requires-organizational-approval'
    },
    checks,
    next
  };
  if (options.remediationPlan) {
    result.remediation_plan = azureProductionRemediationPlan(result, options);
  }
  return result;
}

module.exports = {
  actionGroupReceiverSummary,
  agentOpsContentTables,
  agentOpsScheduledQueryRules,
  approvedPrivateEndpointConnections,
  asArray,
  azAvailable,
  azureBudgetsFromResult,
  azureProductionRemediationPlan,
  azureRoleIds,
  azErrorDetail,
  boolish,
  checkResult,
  logAnalyticsTablesFromResult,
  parseJsonOutput,
  pathValue,
  privateEndpointConnectionsFromResource,
  renderValidateAzure,
  validateAzure,
  roleAssignmentSummary,
  runAz
};
