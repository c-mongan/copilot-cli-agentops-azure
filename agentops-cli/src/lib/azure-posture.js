const { commandShellQuote } = require('./smoke');
const { asArray } = require('./type-predicates');

function pathValue(source, keys, fallback = null) {
  let value = source;
  for (const key of keys) {
    if (value === undefined || value === null) return fallback;
    value = value[key];
  }
  return value === undefined ? fallback : value;
}

function boolish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

const azureRoleIds = {
  logAnalyticsDataReader: '3b03c2da-16b3-4a49-8834-0f8130efdd3b',
  monitoringReader: '43d0d8ad-25c7-4714-9337-8ba259a9fe05',
  grafanaViewer: '60921a7e-fef1-4a43-9b16-a26c52ad4769',
  grafanaEditor: 'a79a5197-3a5c-4973-a920-486035ffd60f',
  grafanaAdmin: '22926164-76b3-42b3-bc55-97df8dab3e41',
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  owner: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
  userAccessAdministrator: ['f1a07417', 'd97a', '45cb', '824c', '7a7467783830b'].join('-')
};

function roleDefinitionIdSuffix(value) {
  const id = String(value || '').toLowerCase();
  const parts = id.split('/');
  return parts[parts.length - 1] || id;
}

function roleAssignmentSummary(assignments, allowedRoleIds) {
  const allowed = new Set(allowedRoleIds.map(role => role.toLowerCase()));
  const rows = asArray(assignments);
  const matching = rows.filter(row => allowed.has(roleDefinitionIdSuffix(row.roleDefinitionId)));
  const groupAssignments = matching.filter(row => String(row.principalType || '').toLowerCase() === 'group');
  const broadAssignments = rows.filter(row => [
    azureRoleIds.owner,
    azureRoleIds.contributor,
    azureRoleIds.userAccessAdministrator
  ].includes(roleDefinitionIdSuffix(row.roleDefinitionId)));
  return {
    assignments: rows.length,
    matching: matching.length,
    group_assignments: groupAssignments.length,
    broad_assignments: broadAssignments.length,
    principal_types: Array.from(new Set(rows.map(row => row.principalType).filter(Boolean))).sort(),
    role_names: Array.from(new Set(rows.map(row => row.roleDefinitionName).filter(Boolean))).sort()
  };
}

function agentOpsScheduledQueryRules(rules) {
  return asArray(rules).filter(rule => {
    const name = String(rule.name || '').toLowerCase();
    const displayName = String(pathValue(rule, ['properties', 'displayName'], '')).toLowerCase();
    return name.startsWith('sqr-') || displayName.includes('copilot agentops');
  });
}

function logAnalyticsTablesFromResult(value) {
  const parsed = asArray(value?.value || value);
  return parsed.map(table => ({
    name: table?.name || pathValue(table, ['properties', 'name'], ''),
    retention_days: [table?.retentionInDays, pathValue(table, ['properties', 'retentionInDays'], NaN)]
      .map(Number)
      .find(Number.isFinite),
    total_retention_days: Number(table?.totalRetentionInDays ?? pathValue(table, ['properties', 'totalRetentionInDays'], NaN))
  }));
}

function agentOpsContentTables(tables) {
  return logAnalyticsTablesFromResult(tables).filter(table => String(table.name || '').toLowerCase() === 'agentopscontent_cl');
}

function azureBudgetsFromResult(value) {
  return asArray(value?.value || value).map(budget => ({
    name: budget?.name || '',
    amount: Number(budget?.amount ?? pathValue(budget, ['properties', 'amount'], NaN)),
    category: budget?.category || pathValue(budget, ['properties', 'category'], ''),
    time_grain: budget?.timeGrain || pathValue(budget, ['properties', 'timeGrain'], '')
  }));
}

function privateEndpointConnectionsFromResource(resource) {
  return asArray(pathValue(resource, ['properties', 'privateEndpointConnections'], []));
}

function approvedPrivateEndpointConnections(resource) {
  return privateEndpointConnectionsFromResource(resource).filter(connection => {
    const status = String(
      pathValue(connection, ['properties', 'privateLinkServiceConnectionState', 'status'], '') ||
      pathValue(connection, ['privateLinkServiceConnectionState', 'status'], '')
    ).toLowerCase();
    return status === 'approved';
  });
}

function actionGroupReceiverSummary(actionGroup) {
  const receiverKeys = [
    'emailReceivers',
    'smsReceivers',
    'webhookReceivers',
    'azureAppPushReceivers',
    'itsmReceivers',
    'automationRunbookReceivers',
    'voiceReceivers',
    'logicAppReceivers',
    'azureFunctionReceivers',
    'armRoleReceivers',
    'eventHubReceivers'
  ];
  const properties = actionGroup?.properties || actionGroup || {};
  const counts = Object.fromEntries(receiverKeys.map(key => [key, asArray(properties[key]).length]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { receiver_count: total, receiver_types: counts };
}

function azureProductionRemediationPlan(result, options = {}) {
  const checks = Object.fromEntries((result.checks || []).map(check => [check.name, check]));
  const config = result.config || {};
  const resourceGroup = config.resource_group || '<resource-group>';
  const workspaceName = config.workspace_name || '<workspace-name>';
  const grafanaName = config.grafana_name || '<grafana-name>';
  const desiredQuotaGb = Number(options.dailyQuotaGb || 5);
  const actionGroups = options.actionGroupResourceIds || '["/subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/<name>"]';
  const readinessProfile = String(config.readiness_profile || (config.production ? 'internal' : 'personal'));
  const readinessLabel = config.production ? 'production' : readinessProfile;
  const validationMode = config.production ? '--production' : `--profile ${commandShellQuote(readinessProfile)}`;
  const validateAgain = `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} ${validationMode} --json`;
  const actions = [];

  if (checks['log-analytics-posture'] && !checks['log-analytics-posture'].ok) {
    actions.push({
      name: 'set-log-analytics-daily-cap',
      risk: 'low',
      reason: 'Production mode expects a finite Log Analytics daily ingestion cap.',
      review: 'Confirm expected telemetry volume before applying the cap.',
      commands: [
        `az monitor log-analytics workspace update --resource-group ${commandShellQuote(resourceGroup)} --workspace-name ${commandShellQuote(workspaceName)} --quota ${desiredQuotaGb}`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['grafana-production-posture'] && !checks['grafana-production-posture'].ok) {
    actions.push({
      name: 'harden-managed-grafana-network-and-availability',
      risk: 'medium',
      reason: 'Production mode expects Managed Grafana private access and zone redundancy.',
      review: 'Verify private connectivity, DNS, operator access, and regional zone-redundancy support before disabling public access.',
      commands: [
        `AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS=Disabled AGENTOPS_GRAFANA_ZONE_REDUNDANCY=Enabled ./scripts/azure-what-if.sh`,
        `az grafana update --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(grafanaName)} --public-network-access Disabled --zone-redundancy Enabled`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['alert-routing-posture'] && !checks['alert-routing-posture'].ok) {
    const ruleNames = asArray(checks['alert-routing-posture'].rule_names).length
      ? asArray(checks['alert-routing-posture'].rule_names)
      : ['sqr-<agentops-alert-name>'];
    actions.push({
      name: 'route-agentops-alerts-to-action-groups',
      risk: 'medium',
      reason: 'Production mode expects enabled AgentOps scheduled query alerts routed to Azure Monitor action groups.',
      review: 'Create or approve action groups first, then tune thresholds against real traffic before enabling notifications.',
      commands: [
        `export AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS=${commandShellQuote(String(actionGroups))}`,
        'AGENTOPS_DEPLOY_ALERTS=true AGENTOPS_ENABLE_ALERTS=true ./scripts/azure-what-if.sh',
        ...ruleNames.map(name => `az monitor scheduled-query update --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(name)} --disabled false --action-groups "$AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS"`),
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['access-rbac-posture'] && !checks['access-rbac-posture'].ok) {
    actions.push({
      name: 'review-agentops-rbac-assignments',
      risk: 'medium',
      reason: `${readinessLabel} posture expects least-privilege RBAC on Log Analytics and Managed Grafana scopes.`,
      review: 'Assign Entra groups rather than individual users; avoid Owner/Contributor for routine observability access.',
      commands: [
        'AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS=true ./scripts/azure-what-if.sh',
        validateAgain
      ]
    });
  }

  if (checks['content-capture-table-posture'] && !checks['content-capture-table-posture'].ok) {
    actions.push({
      name: 'harden-optional-content-capture-storage',
      risk: 'high',
      reason: 'Optional prompt/response transcript storage must have short retention and least-privilege workspace access.',
      review: 'Confirm content capture is intentionally enabled, then restrict access and lower retention before production.',
      commands: [
        `az monitor log-analytics workspace table update --resource-group ${commandShellQuote(resourceGroup)} --workspace-name ${commandShellQuote(workspaceName)} --name AgentOpsContent_CL --retention-time 30`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['azure-budget-posture'] && !checks['azure-budget-posture'].ok) {
    actions.push({
      name: 'configure-agentops-budget',
      risk: 'medium',
      reason: `${readinessLabel} posture expects an Azure Consumption budget so runaway token/tool loops have a spend guardrail.`,
      review: 'Confirm the monthly amount and approved notification contacts before deploying the budget.',
      commands: [
        'AGENTOPS_DEPLOY_BUDGET=true ./scripts/azure-what-if.sh',
        validateAgain
      ]
    });
  }

  if (checks['grafana-private-access-posture'] && !checks['grafana-private-access-posture'].ok) {
    actions.push({
      name: 'verify-managed-grafana-private-access',
      risk: 'medium',
      reason: 'Production mode expects public Grafana access disabled with an approved private endpoint path.',
      review: 'Test private DNS and operator access before disabling or depending on private access.',
      commands: [
        `az grafana show --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(grafanaName)} --query properties.privateEndpointConnections`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['action-group-destination-posture'] && !checks['action-group-destination-posture'].ok) {
    actions.push({
      name: 'verify-alert-action-group-destinations',
      risk: 'medium',
      reason: 'Production mode expects routed AgentOps alerts to target enabled action groups with at least one receiver.',
      review: 'Review notification destinations, rate limits, and escalation ownership before enabling alerts.',
      commands: [
        'az monitor action-group list --resource-group <resource-group> --query "[].{name:name,enabled:enabled}"',
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  return {
    ok: actions.length === 0,
    mode: 'proposal-only',
    actions,
    note: actions.length === 0
      ? 'No production posture remediation is currently required.'
      : 'Review these commands before running them. The planner does not mutate Azure.'
  };
}

module.exports = {
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
};
