const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { optionValue } = require('./args');
const { jsonOutput, writeJsonOrRender } = require('./command-output');
const { checkAzureSubscription } = require('./azure/subscription-guard');

const resourceGroupTagContract = Object.freeze({
  app: 'copilot-cli-agentops-azure',
  telemetryContent: 'synthetic-eval',
  managedBy: 'agentops-cli',
  deploymentProfile: 'pilot'
});

const agentOpsTables = Object.freeze([
  'AgentOpsCollectorHealth_CL',
  'AgentOpsContent_CL',
  'AgentOpsEval_CL',
  'AgentOpsEvents_CL',
  'AgentOpsGithubOutcomes_CL',
  'AgentOpsInsights_CL',
  'AgentOpsMcpCalls_CL',
  'AgentOpsPrivacy_CL',
  'AgentOpsRecommendations_CL',
  'AgentOpsRunSummary_CL',
  'AgentOpsSpans_CL',
  'AgentOpsToolCalls_CL'
]);
const metricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb';

function parseProvisionAzureArgs(args = []) {
  const [subcommand = 'azure'] = args;
  const subscriptionId = optionValue(args, '--subscription');
  const resourceGroupName = optionValue(args, '--resource-group');
  const environmentName = optionValue(args, '--environment', 'pilot');
  const location = optionValue(args, '--location', 'northeurope');
  const profile = optionValue(args, '--profile', 'pilot');
  const principalId = optionValue(args, '--principal-id');
  const principalType = optionValue(args, '--principal-type', 'User');
  const receiptPath = optionValue(args, '--receipt');
  const yes = args.includes('--yes');
  return {
    subcommand,
    subscriptionId,
    resourceGroupName,
    environmentName,
    location,
    profile,
    principalId,
    principalType,
    receiptPath,
    yes,
    dryRun: args.includes('--dry-run') || !yes,
    json: args.includes('--json')
  };
}

function parseJson(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}

function commandResult(spawnSync, args, options = {}) {
  const result = spawnSync('az', args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error?.message || ''
  };
}

function validateProvisionInput(options = {}) {
  if (options.subcommand !== 'azure') return 'provision supports: azure';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(options.subscriptionId || ''))) {
    return 'provision azure requires --subscription <subscription-id>.';
  }
  if (!/^[A-Za-z0-9._()-]{1,90}$/.test(String(options.resourceGroupName || ''))) {
    return 'provision azure requires a valid --resource-group name (1–90 letters, digits, dot, underscore, parentheses, or hyphen).';
  }
  if (!/^[a-z][a-z0-9-]{1,11}$/.test(String(options.environmentName || ''))) {
    return '--environment must start with a lowercase letter and contain 2–12 lowercase letters, digits, or hyphens.';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9]{1,30}$/.test(String(options.location || ''))) {
    return '--location must be an Azure region name such as northeurope.';
  }
  if (options.profile !== 'pilot') return 'The supported provisioning profile is --profile pilot (synthetic EVAL only).';
  if (options.principalId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.principalId)) {
    return '--principal-id must be a Microsoft Entra object ID.';
  }
  if (!['User', 'ServicePrincipal', 'Group'].includes(options.principalType)) {
    return '--principal-type must be User, ServicePrincipal, or Group.';
  }
  if (options.yes && options.dryRun) return '--yes cannot be combined with --dry-run.';
  return null;
}

function changesFromWhatIf(payload) {
  const changes = payload?.properties?.changes ?? payload?.changes;
  return Array.isArray(changes) ? changes : null;
}

function ownedResourceGroupTags(tags = {}, environmentName) {
  return tags.app === resourceGroupTagContract.app
    && tags.telemetryContent === resourceGroupTagContract.telemetryContent
    && tags.managedBy === resourceGroupTagContract.managedBy
    && tags.deploymentProfile === resourceGroupTagContract.deploymentProfile
    && tags.environment === environmentName;
}

function validateWhatIfChanges(changes, subscriptionId, resourceGroupName, deploymentName) {
  if (!Array.isArray(changes)) return { ok: false, error: 'Azure what-if returned no structured resource changes; refusing deployment.' };
  const allowedTypes = new Set(['Create', 'NoChange', 'Ignore']);
  const rootPrefix = `/subscriptions/${subscriptionId.toLowerCase()}/resourcegroups/${resourceGroupName.toLowerCase()}`;
  const deploymentPrefix = `/subscriptions/${subscriptionId.toLowerCase()}/providers/microsoft.resources/deployments/${deploymentName.toLowerCase()}`;
  const unexpected = changes.filter(change => {
    const type = String(change.changeType || '');
    const resourceId = String(change.resourceId || '').toLowerCase();
    return !allowedTypes.has(type)
      || (!resourceId.startsWith(`${rootPrefix}/`) && resourceId !== rootPrefix && resourceId !== deploymentPrefix);
  });
  return unexpected.length
    ? { ok: false, error: 'Azure what-if includes a modification, deletion, unsupported change, or resource outside the selected AgentOps resource group.', unexpected }
    : { ok: true, changes };
}

function runReadback(spawnSync, options, outputs) {
  const group = commandResult(spawnSync, [
    'group', 'show', '--subscription', options.subscriptionId,
    '--name', options.resourceGroupName, '--output', 'json'
  ]);
  const groupValue = parseJson(group.stdout);
  const expectedWorkspace = `law-copilot-agentops-eval-${options.environmentName}`;
  const expectedAppInsights = `appi-copilot-agentops-eval-${options.environmentName}`;
  const workspace = commandResult(spawnSync, [
    'monitor', 'log-analytics', 'workspace', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--workspace-name', expectedWorkspace,
    '--output', 'json'
  ]);
  const workspaceValue = parseJson(workspace.stdout);
  const appInsights = commandResult(spawnSync, [
    'monitor', 'app-insights', 'component', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--app', expectedAppInsights,
    '--query', '{name:name,kind:kind,workspaceResourceId:workspaceResourceId,tags:tags}',
    '--output', 'json'
  ]);
  const appInsightsValue = parseJson(appInsights.stdout);
  const resources = commandResult(spawnSync, [
    'resource', 'list', '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName, '--output', 'json'
  ]);
  const resourceRows = parseJson(resources.stdout);
  const types = Array.isArray(resourceRows) ? resourceRows.map(row => row.type) : [];
  const expectedResourceNames = [
    expectedWorkspace,
    `dce-copilot-agentops-eval-${options.environmentName}`,
    `dce-copilot-agentops-${options.environmentName}`,
    `dcr-copilot-agentops-eval-${options.environmentName}`,
    `dcr-copilot-agentops-${options.environmentName}-v2`
  ];
  const actualResourceNames = Array.isArray(resourceRows) ? resourceRows.map(row => row.name) : [];
  const additionalResources = Array.isArray(resourceRows)
    ? resourceRows.filter(row => !expectedResourceNames.some(name => name.toLowerCase() === String(row.name || '').toLowerCase()))
    : [];
  const tableList = commandResult(spawnSync, [
    'monitor', 'log-analytics', 'workspace', 'table', 'list',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--workspace-name', expectedWorkspace,
    '--output', 'json'
  ]);
  const tables = parseJson(tableList.stdout);
  const tableRows = Array.isArray(tables) ? tables : [];
  const tableNames = tableRows.map(table => table.name);
  const requiredTables = [...agentOpsTables];
  const contentRule = commandResult(spawnSync, [
    'monitor', 'data-collection', 'rule', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--name', `dcr-copilot-agentops-eval-${options.environmentName}`,
    '--output', 'json'
  ]);
  const spansRule = commandResult(spawnSync, [
    'monitor', 'data-collection', 'rule', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--name', `dcr-copilot-agentops-${options.environmentName}-v2`,
    '--output', 'json'
  ]);
  const contentRuleValue = parseJson(contentRule.stdout);
  const spansRuleValue = parseJson(spansRule.stdout);
  const spansTable = commandResult(spawnSync, [
    'monitor', 'log-analytics', 'workspace', 'table', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--workspace-name', expectedWorkspace,
    '--name', 'AgentOpsSpans_CL',
    '--output', 'json'
  ]);
  const spansTableValue = parseJson(spansTable.stdout);
  const contentEndpoint = commandResult(spawnSync, [
    'monitor', 'data-collection', 'endpoint', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--name', `dce-copilot-agentops-eval-${options.environmentName}`,
    '--output', 'json'
  ]);
  const spansEndpoint = commandResult(spawnSync, [
    'monitor', 'data-collection', 'endpoint', 'show',
    '--subscription', options.subscriptionId,
    '--resource-group', options.resourceGroupName,
    '--name', `dce-copilot-agentops-${options.environmentName}`,
    '--output', 'json'
  ]);
  const contentEndpointValue = parseJson(contentEndpoint.stdout);
  const spansEndpointValue = parseJson(spansEndpoint.stdout);
  const contentRoleAssignments = commandResult(spawnSync, [
    'role', 'assignment', 'list', '--subscription', options.subscriptionId,
    '--scope', contentRuleValue?.id || '', '--query', '[].{principalId:principalId,roleDefinitionName:roleDefinitionName}', '--output', 'json'
  ]);
  const spansRoleAssignments = commandResult(spawnSync, [
    'role', 'assignment', 'list', '--subscription', options.subscriptionId,
    '--scope', spansRuleValue?.id || '', '--query', '[].{principalId:principalId,roleDefinitionName:roleDefinitionName}', '--output', 'json'
  ]);
  const contentAssignments = parseJson(contentRoleAssignments.stdout) || [];
  const metadataAssignments = parseJson(spansRoleAssignments.stdout) || [];
  const spansColumns = spansRuleValue?.streamDeclarations?.['Custom-AgentOpsSpans_CL']?.columns || [];
  const spansColumnNames = spansColumns.map(column => column.name);
  const spansTableColumnNames = (spansTableValue?.schema?.columns || []).map(column => column.name);
  const dailyQuotaGb = workspaceValue?.workspaceCapping?.dailyQuotaGb
    ?? workspaceValue?.properties?.workspaceCapping?.dailyQuotaGb;
  const groupOk = group.ok && groupValue?.name === options.resourceGroupName
    && ownedResourceGroupTags(groupValue.tags, options.environmentName);
  const workspaceOk = workspace.ok && workspaceValue?.name === expectedWorkspace
    && Number(dailyQuotaGb) === 1;
  const tablesOk = tableList.ok && requiredTables.every(name => tableNames.includes(name));
  const workspaceId = workspaceValue?.id;
  const appInsightsTags = appInsightsValue?.tags || {};
  const appInsightsOk = appInsights.ok
    && actualResourceNames.some(name => String(name).toLowerCase() === expectedAppInsights.toLowerCase())
    && String(appInsightsValue?.name || '').toLowerCase() === expectedAppInsights.toLowerCase()
    && String(appInsightsValue?.kind || '').toLowerCase() === 'web'
    && String(appInsightsValue?.workspaceResourceId || '').toLowerCase() === String(workspaceId || '').toLowerCase()
    && appInsightsTags.app === resourceGroupTagContract.app
    && appInsightsTags.environment === options.environmentName
    && appInsightsTags.telemetryContent === 'metadata-only'
    && appInsightsTags.managedBy === 'agentops-bicep';
  const contentRuleOk = contentRule.ok
    && Boolean(contentRuleValue?.streamDeclarations?.['Custom-AgentOpsContent_CL'])
    && (contentRuleValue?.dataFlows || []).some(flow => (flow.streams || []).includes('Custom-AgentOpsContent_CL'))
    && (contentRuleValue?.destinations?.logAnalytics || []).some(destination => destination.workspaceResourceId === workspaceId);
  const spansRuleOk = spansRule.ok
    && (spansRuleValue?.dataFlows || []).some(flow => (flow.streams || []).includes('Custom-AgentOpsSpans_CL'))
    && (spansRuleValue?.destinations?.logAnalytics || []).some(destination => destination.workspaceResourceId === workspaceId)
    && [
      'ParentToolCallId', 'McpServerName', 'McpToolName',
      'ScriptRuntimeName', 'ScriptRuntimeVersion', 'ScriptRuntimeImplementation', 'ScriptLoaderName'
    ].every(name => spansColumnNames.includes(name));
  const additionalResourcesOk = additionalResources.every(resource => {
    const type = String(resource.type || '').toLowerCase();
    const name = String(resource.name || '').toLowerCase();
    const tags = resource.tags || {};
    const ownedMetadataTags = tags.app === resourceGroupTagContract.app
      && tags.environment === options.environmentName
      && tags.telemetryContent === 'metadata-only'
      && ['agentops-bicep', 'azd-bicep'].includes(tags.managedBy);
    if (type === 'microsoft.insights/components'.toLowerCase()) return ownedMetadataTags;
    if (type === 'microsoft.dashboard/grafana'.toLowerCase()) return ownedMetadataTags;
    if (type === 'microsoft.consumption/budgets'.toLowerCase()) {
      return name.startsWith('budget-copilot-agentops-');
    }
    return false;
  });
  const endpointsOk = contentEndpoint.ok && spansEndpoint.ok
    && Boolean(contentEndpointValue?.logsIngestion?.endpoint)
    && Boolean(spansEndpointValue?.logsIngestion?.endpoint)
    && expectedResourceNames.every(name => actualResourceNames.includes(name))
    && additionalResourcesOk;
  const tableRetentionOk = requiredTables.every(name => {
    const table = tableRows.find(row => row.name === name);
    return table?.plan === 'Analytics'
      && Number(table.retentionInDays) === 7
      && Number(table.totalRetentionInDays) === 7;
  });
  const hasSenderAssignment = assignments => contentRoleAssignments.ok && spansRoleAssignments.ok
    && Array.isArray(assignments)
    && assignments.some(assignment => String(assignment.principalId || '').toLowerCase() === String(options.principalId || '').toLowerCase()
      && assignment.roleDefinitionName === 'Monitoring Metrics Publisher');
  const senderAccessOk = Boolean(options.principalId)
    && hasSenderAssignment(contentAssignments)
    && hasSenderAssignment(metadataAssignments);
  const effectiveOutputs = {
    ...outputs,
    workspaceResourceId: workspaceValue?.id || outputs?.workspaceResourceId,
    workspaceCustomerId: workspaceValue?.customerId || outputs?.workspaceCustomerId,
    contentDataCollectionRuleResourceId: contentRuleValue?.id || outputs?.contentDataCollectionRuleResourceId,
    contentDataCollectionRuleImmutableId: contentRuleValue?.immutableId || outputs?.contentDataCollectionRuleImmutableId,
    contentLogsIngestionEndpoint: contentEndpointValue?.logsIngestion?.endpoint || outputs?.contentLogsIngestionEndpoint,
    metadataDataCollectionRuleResourceId: spansRuleValue?.id || outputs?.metadataDataCollectionRuleResourceId,
    metadataDataCollectionRuleImmutableId: spansRuleValue?.immutableId || outputs?.metadataDataCollectionRuleImmutableId,
    metadataLogsIngestionEndpoint: spansEndpointValue?.logsIngestion?.endpoint || outputs?.metadataLogsIngestionEndpoint
  };
  const checks = {
    resource_group_owned: groupOk,
    workspace_exists_and_capped: workspaceOk,
    application_insights_workspace_link_verified: appInsightsOk,
    all_agentops_tables_exist: tablesOk,
    ingestion_rules_target_workspace: Boolean(contentRuleOk && spansRuleOk),
    spans_schema_has_mcp_link_fields: ['ParentToolCallId', 'McpServerName', 'McpToolName'].every(name => spansColumnNames.includes(name)),
    spans_schema_has_script_runtime_fields: ['ScriptRuntimeName', 'ScriptRuntimeVersion', 'ScriptRuntimeImplementation', 'ScriptLoaderName'].every(name => spansColumnNames.includes(name)),
    spans_table_schema_has_script_runtime_fields: spansTable.ok
      && ['ScriptRuntimeName', 'ScriptRuntimeVersion', 'ScriptRuntimeImplementation', 'ScriptLoaderName'].every(name => spansTableColumnNames.includes(name)),
    both_ingestion_endpoints_verified: endpointsOk,
    additional_resources_verified: additionalResourcesOk,
    seven_day_retention_verified_for_all_agentops_tables: tableRetentionOk,
    dcr_sender_role_scoped_to_both_rules: senderAccessOk,
    deployment_outputs_present: Boolean(effectiveOutputs.workspaceResourceId
      && effectiveOutputs.contentDataCollectionRuleImmutableId
      && effectiveOutputs.metadataDataCollectionRuleImmutableId
      && effectiveOutputs.contentLogsIngestionEndpoint
      && effectiveOutputs.metadataLogsIngestionEndpoint)
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    resource_group_id: groupValue?.id || '',
    workspace_resource_id: workspaceValue?.id || outputs?.workspaceResourceId || '',
    workspace_customer_id: workspaceValue?.customerId || outputs?.workspaceCustomerId || '',
    daily_quota_gb: dailyQuotaGb ?? null,
    required_tables: requiredTables,
    present_required_tables: requiredTables.filter(name => tableNames.includes(name)),
    table_retention_days: Object.fromEntries(requiredTables.map(name => {
      const table = tableRows.find(row => row.name === name);
      return [name, { plan: table?.plan || null, retention_in_days: table?.retentionInDays ?? null, total_retention_in_days: table?.totalRetentionInDays ?? null }];
    })),
    resource_types: [...new Set(types)].sort(),
    application_insights_name: appInsightsValue?.name || '',
    additional_resource_names: additionalResources.map(resource => resource.name),
    content_dcr_resource_id: effectiveOutputs.contentDataCollectionRuleResourceId || '',
    content_dcr_immutable_id: effectiveOutputs.contentDataCollectionRuleImmutableId || '',
    content_logs_ingestion_endpoint: effectiveOutputs.contentLogsIngestionEndpoint || '',
    spans_dcr_resource_id: effectiveOutputs.metadataDataCollectionRuleResourceId || '',
    spans_dcr_immutable_id: effectiveOutputs.metadataDataCollectionRuleImmutableId || '',
    logs_ingestion_endpoint: effectiveOutputs.metadataLogsIngestionEndpoint || '',
    ingestion_principal_id: options.principalId || ''
  };
}

function outputValues(payload) {
  const raw = payload?.properties?.outputs || payload?.outputs || {};
  return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, entry?.value ?? entry]));
}

function resolveIngestionPrincipal(spawnSync, options) {
  if (options.principalId) {
    return { ok: true, id: options.principalId, type: options.principalType };
  }
  const result = commandResult(spawnSync, ['ad', 'signed-in-user', 'show', '--query', 'id', '--output', 'tsv']);
  const id = result.stdout.trim();
  if (!result.ok || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return {
      ok: false,
      error: 'Could not resolve the signed-in Entra user for DCR-scoped ingestion access. Supply --principal-id and --principal-type for a user, service principal, or group.'
    };
  }
  return { ok: true, id, type: 'User' };
}

function writeProvisionReceipt(result, options, dependencies = {}) {
  result.receipt_path = path.resolve(options.receiptPath
    || path.join(dependencies.cwd || process.cwd(), '.agentops', 'provision', `${options.resourceGroupName}.json`));
  fs.mkdirSync(path.dirname(result.receipt_path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(result.receipt_path, jsonOutput(result), { mode: 0o600 });
  fs.chmodSync(result.receipt_path, 0o600);
  return result;
}

function provisionAzurePilot(rawOptions = {}, dependencies = {}) {
  const options = { retentionInDays: 7, dailyQuotaGb: 1, ...rawOptions };
  const invalid = validateProvisionInput(options);
  if (invalid) return { ok: false, executed: false, error: invalid };

  const spawnSync = dependencies.spawnSync || childProcess.spawnSync;
  const guard = (dependencies.checkAzureSubscription || checkAzureSubscription)({
    expectedSubscriptionId: options.subscriptionId,
    approvedSubscriptionIds: [options.subscriptionId],
    requireActive: false,
    spawnSync
  });
  if (!guard.ok) return { ok: false, executed: false, stage: 'subscription verification', subscription_guard: guard, error: guard.error };

  const groupExists = commandResult(spawnSync, [
    'group', 'exists', '--subscription', options.subscriptionId,
    '--name', options.resourceGroupName, '--output', 'tsv'
  ]);
  if (!groupExists.ok) return { ok: false, executed: false, stage: 'resource group check', error: groupExists.stderr || groupExists.error || 'Could not check the selected Azure resource group.' };
  const exists = groupExists.stdout.trim().toLowerCase() === 'true';
  if (exists) {
    const group = commandResult(spawnSync, [
      'group', 'show', '--subscription', options.subscriptionId,
      '--name', options.resourceGroupName, '--output', 'json'
    ]);
    const value = parseJson(group.stdout);
    if (!group.ok || !ownedResourceGroupTags(value?.tags, options.environmentName)) {
      return {
        ok: false,
        executed: false,
        stage: 'resource group ownership check',
        error: 'The selected resource group already exists and is not tagged as an AgentOps synthetic pilot for this environment. Choose a new group; no resources were changed.'
      };
    }
  }

  const principal = resolveIngestionPrincipal(spawnSync, options);
  if (!principal.ok) return { ok: false, executed: false, stage: 'ingestion principal resolution', error: principal.error };
  options.principalId = principal.id;
  options.principalType = principal.type;

  if (exists) {
    const verification = runReadback(spawnSync, options, {});
    if (!verification.ok) {
      return {
        ok: false,
        executed: false,
        stage: 'existing target verification',
        verification,
        error: 'The AgentOps-owned resource group does not match the complete pilot contract. Refusing to redeploy over an existing target; inspect the failed readback checks and repair it explicitly.'
      };
    }
    const result = {
      ok: true,
      executed: false,
      dry_run: options.dryRun,
      already_provisioned: true,
      subscription_guard: guard,
      preview: {
        subscription_id: options.subscriptionId,
        resource_group: options.resourceGroupName,
        environment: options.environmentName,
        location: options.location,
        profile: 'pilot',
        ingestion_principal_id: options.principalId,
        ingestion_principal_type: options.principalType,
        content_policy: 'synthetic EVAL only; content has a separate ingestion DCR/table',
        daily_ingestion_cap_gb: 1,
        table_retention_days: 7,
        changes: []
      },
      verification,
      next: 'This AgentOps pilot already matches the provisioned contract. No Azure resources were changed.'
    };
    return options.yes ? writeProvisionReceipt(result, options, dependencies) : result;
  }

  const templateFile = dependencies.templateFile || path.resolve(__dirname, '../../../infra/bicep/pilot-subscription.bicep');
  const deploymentName = options.deploymentName || `agentops-pilot-${options.environmentName}-${Date.now()}`;
  const parameters = [
    `resourceGroupName=${options.resourceGroupName}`,
    `location=${options.location}`,
    `environmentName=${options.environmentName}`,
    `retentionInDays=${options.retentionInDays}`,
    `dailyQuotaGb=${options.dailyQuotaGb}`,
    `ingestionPrincipalId=${options.principalId}`,
    `ingestionPrincipalType=${options.principalType}`
  ];
  const whatIf = commandResult(spawnSync, [
    'deployment', 'sub', 'what-if',
    '--subscription', options.subscriptionId,
    '--name', deploymentName,
    '--location', options.location,
    '--template-file', templateFile,
    '--parameters', ...parameters,
    '--result-format', 'ResourceIdOnly',
    '--no-pretty-print',
    '--output', 'json'
  ]);
  const whatIfPayload = parseJson(whatIf.stdout);
  if (!whatIf.ok) {
    return { ok: false, executed: false, stage: 'Azure what-if', deployment_name: deploymentName, error: whatIf.stderr || whatIf.error || 'Azure what-if failed.' };
  }
  const changes = changesFromWhatIf(whatIfPayload);
  const reviewed = validateWhatIfChanges(changes, options.subscriptionId.toLowerCase(), options.resourceGroupName, deploymentName);
  if (!reviewed.ok) {
    return { ok: false, executed: false, stage: 'what-if safety check', deployment_name: deploymentName, changes, error: reviewed.error };
  }
  const preview = {
    subscription_id: options.subscriptionId,
    resource_group: options.resourceGroupName,
    environment: options.environmentName,
    location: options.location,
    profile: 'pilot',
    content_policy: 'synthetic EVAL only; content has a separate ingestion DCR/table',
    ingestion_principal_id: options.principalId,
    ingestion_principal_type: options.principalType,
    daily_ingestion_cap_gb: 1,
    table_retention_days: 7,
    changes: changes.map(change => ({ change_type: change.changeType, resource_id: change.resourceId }))
  };
  if (options.dryRun) {
    return { ok: true, executed: false, dry_run: true, preview, deployment_name: deploymentName, next: 'Review the resource list. To apply, rerun this exact target with --yes.' };
  }

  const deployment = commandResult(spawnSync, [
    'deployment', 'sub', 'create',
    '--subscription', options.subscriptionId,
    '--name', deploymentName,
    '--location', options.location,
    '--template-file', templateFile,
    '--parameters', ...parameters,
    '--output', 'json'
  ]);
  if (!deployment.ok) {
    return { ok: false, executed: true, stage: 'Azure deployment', deployment_name: deploymentName, preview, error: deployment.stderr || deployment.error || 'Azure deployment failed.' };
  }
  const outputs = outputValues(parseJson(deployment.stdout));
  const verification = runReadback(spawnSync, options, outputs);
  const result = {
    ok: verification.ok,
    executed: true,
    dry_run: false,
    deployment_name: deploymentName,
    subscription_guard: guard,
    preview,
    outputs,
    verification,
    next: verification.ok
      ? 'Provisioned and readback-verified for synthetic EVAL. Review the receipt and access policy before sending any work data.'
      : 'Provisioning completed, but readback checks did not all pass. Do not use this target for work data.'
  };
  return writeProvisionReceipt(result, options, dependencies);
}

function renderProvisionAzure(result) {
  const lines = ['AgentOps Azure pilot provision', ''];
  if (result.error) {
    lines.push(`Status: ${result.executed ? 'deployment incomplete' : 'not applied'}`);
    if (result.stage) lines.push(`Stage: ${result.stage}`);
    lines.push(`Reason: ${result.error}`);
    return `${lines.join('\n')}\n`;
  }
  lines.push(`Status: ${result.dry_run ? 'preview only' : result.ok ? 'provisioned and verified' : 'deployed; verification incomplete'}`);
  const preview = result.preview || {};
  lines.push(`Subscription: ${preview.subscription_id || ''}`);
  lines.push(`Resource group: ${preview.resource_group || ''}`);
  lines.push(`Region: ${preview.location || ''}`);
  lines.push(`Profile: ${preview.profile || ''} · synthetic EVAL only`);
  if (preview.ingestion_principal_id) lines.push(`Ingestion identity: ${preview.ingestion_principal_type} · ${preview.ingestion_principal_id}`);
  lines.push(`Cost guard: ${preview.daily_ingestion_cap_gb} GB/day · ${preview.table_retention_days} day table retention`);
  if (result.already_provisioned) lines.push('Azure changes: none · existing target passed full readback');
  if (preview.changes) {
    lines.push('', 'Planned resource changes:');
    for (const change of preview.changes) lines.push(`- ${change.change_type}: ${change.resource_id}`);
  }
  if (result.receipt_path) lines.push('', `Receipt: ${result.receipt_path}`);
  if (result.next) lines.push('', result.next);
  return `${lines.join('\n')}\n`;
}

function renderProvisionAzureHelp() {
  return [
    'agentops provision azure --subscription <id> --resource-group <new-agentops-rg> [options]',
    '',
    'Creates an isolated synthetic EVAL workspace, ingestion rules, tables, and workspace-linked Application Insights.',
    'Preview is the default. Review the Azure what-if before applying.',
    '',
    'Options:',
    '  --environment <suffix>  Resource-name suffix (default: pilot)',
    '  --location <region>     Azure region (default: northeurope)',
    '  --profile pilot         Synthetic EVAL profile (only supported profile)',
    '  --principal-id <id>     Ingestion sender identity (defaults to signed-in user)',
    '  --principal-type <type> User, ServicePrincipal, or Group (default: User)',
    '  --yes                   Apply only after Azure what-if passes',
    '  --json                  Print machine-readable results',
    '  -h, --help              Show this help',
    '',
    'Example:',
    '  agentops provision azure --subscription <id> --resource-group <new-agentops-rg> --environment dev',
    '',
    'This profile is for synthetic EVAL data. It does not configure a spend budget, private networking, or team access.'
  ].join('\n') + '\n';
}

function azureProvisionCommand(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(renderProvisionAzureHelp());
    return;
  }
  const options = parseProvisionAzureArgs(args);
  const result = provisionAzurePilot(options);
  writeJsonOrRender(result, options.json, renderProvisionAzure);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  azureProvisionCommand,
  changesFromWhatIf,
  parseProvisionAzureArgs,
  provisionAzurePilot,
  resolveIngestionPrincipal,
  renderProvisionAzure,
  renderProvisionAzureHelp,
  runReadback,
  validateProvisionInput,
  validateWhatIfChanges
};
