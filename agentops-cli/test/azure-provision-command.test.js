const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseProvisionAzureArgs,
  provisionAzurePilot,
  validateWhatIfChanges
} = require('../src/lib/azure-provision-command');

const subscriptionId = '0222a208-955a-45fd-b6d8-ca4704421bf0';
const resourceGroupName = 'rg-agentops-pilot-test';
const resourceGroupId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;
const workspaceName = 'law-copilot-agentops-eval-pilot';
const principalId = '1e822670-52ce-41e9-923c-607a4f2fa556';
const tableNames = [
  'AgentOpsCollectorHealth_CL', 'AgentOpsContent_CL', 'AgentOpsEval_CL', 'AgentOpsEvents_CL',
  'AgentOpsGithubOutcomes_CL', 'AgentOpsInsights_CL', 'AgentOpsMcpCalls_CL', 'AgentOpsPrivacy_CL',
  'AgentOpsRecommendations_CL', 'AgentOpsRunSummary_CL', 'AgentOpsSpans_CL', 'AgentOpsToolCalls_CL'
];

function options(args = []) {
  return parseProvisionAzureArgs([
    'azure', '--subscription', subscriptionId,
    '--resource-group', resourceGroupName,
    ...args
  ]);
}

function result(stdout, status = 0, stderr = '') {
  return { status, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr };
}

function createAzureMock({ existingGroup = false, groupTags = null, changes = null, additionalResources = [], appInsightsWorkspaceResourceId = null, missingScriptRuntimeTableColumns = false } = {}) {
  const calls = [];
  const defaultChanges = [
    { changeType: 'Create', resourceId: resourceGroupId },
    { changeType: 'Create', resourceId: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-eval-pilot` }
  ];
  const spawnSync = (_command, args) => {
    calls.push(args);
    if (args[0] === 'account' && args[1] === 'show') return result(subscriptionId);
    if (args[0] === 'ad' && args[1] === 'signed-in-user' && args[2] === 'show') return result(principalId);
    if (args[0] === 'group' && args[1] === 'exists') return result(String(existingGroup));
    if (args[0] === 'group' && args[1] === 'show') return result({
      id: resourceGroupId,
      name: resourceGroupName,
      tags: groupTags || {
        app: 'copilot-cli-agentops-azure',
        environment: 'pilot',
        telemetryContent: 'synthetic-eval',
        managedBy: 'agentops-cli',
        deploymentProfile: 'pilot'
      }
    });
    if (args[0] === 'deployment' && args[1] === 'sub' && args[2] === 'what-if') {
      return result({ properties: { changes: changes || defaultChanges } });
    }
    if (args[0] === 'deployment' && args[1] === 'sub' && args[2] === 'create') {
      return result({ properties: { outputs: {
        workspaceResourceId: { value: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-eval-pilot` },
        workspaceCustomerId: { value: 'workspace-customer-id' },
        contentDataCollectionRuleResourceId: { value: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/dcr-content` },
        contentDataCollectionRuleImmutableId: { value: 'dcr-content-id' },
        metadataDataCollectionRuleResourceId: { value: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/dcr-spans` },
        metadataDataCollectionRuleImmutableId: { value: 'dcr-spans-id' },
        metadataLogsIngestionEndpoint: { value: 'https://dce.example.ingest.monitor.azure.com' }
      } } });
    }
    if (args[0] === 'monitor' && args[1] === 'log-analytics' && args[2] === 'workspace' && args[3] === 'show') {
      return result({ name: 'law-copilot-agentops-eval-pilot', id: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-eval-pilot`, customerId: 'workspace-customer-id', workspaceCapping: { dailyQuotaGb: 1 } });
    }
    if (args[0] === 'resource' && args[1] === 'list') return result([
      { name: workspaceName, type: 'Microsoft.OperationalInsights/workspaces' },
      { name: 'dce-copilot-agentops-eval-pilot', type: 'Microsoft.Insights/dataCollectionEndpoints' },
      { name: 'dce-copilot-agentops-pilot', type: 'Microsoft.Insights/dataCollectionEndpoints' },
      { name: 'dcr-copilot-agentops-eval-pilot', type: 'Microsoft.Insights/dataCollectionRules' },
      { name: 'dcr-copilot-agentops-pilot-v2', type: 'Microsoft.Insights/dataCollectionRules' },
      {
        name: 'appi-copilot-agentops-eval-pilot',
        type: 'Microsoft.Insights/components',
        tags: { app: 'copilot-cli-agentops-azure', environment: 'pilot', managedBy: 'agentops-bicep', telemetryContent: 'metadata-only' }
      }
    ].concat(additionalResources));
    if (args[0] === 'monitor' && args[1] === 'app-insights' && args[2] === 'component' && args[3] === 'show') return result({
      name: 'appi-copilot-agentops-eval-pilot',
      kind: 'web',
      workspaceResourceId: appInsightsWorkspaceResourceId || `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}`,
      tags: { app: 'copilot-cli-agentops-azure', environment: 'pilot', managedBy: 'agentops-bicep', telemetryContent: 'metadata-only' }
    });
    if (args[0] === 'monitor' && args[1] === 'log-analytics' && args[2] === 'workspace' && args[3] === 'table' && args[4] === 'list') {
      return result(tableNames.map(name => ({ name, plan: 'Analytics', retentionInDays: 7, totalRetentionInDays: 7 })));
    }
    if (args[0] === 'monitor' && args[1] === 'log-analytics' && args[2] === 'workspace' && args[3] === 'table' && args[4] === 'show') {
      const columns = [
        { name: 'ParentToolCallId' }, { name: 'McpServerName' }, { name: 'McpToolName' }
      ];
      if (!missingScriptRuntimeTableColumns) columns.push(
        { name: 'ScriptRuntimeName' }, { name: 'ScriptRuntimeVersion' },
        { name: 'ScriptRuntimeImplementation' }, { name: 'ScriptLoaderName' }
      );
      return result({ schema: { columns } });
    }
    if (args[0] === 'monitor' && args[1] === 'data-collection' && args[2] === 'rule' && args[3] === 'show') {
      const isContent = args[args.indexOf('--name') + 1].includes('-eval-');
      return result(isContent ? {
        id: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/dcr-content`,
        immutableId: 'dcr-content-id',
        streamDeclarations: { 'Custom-AgentOpsContent_CL': { columns: [] } },
        dataFlows: [{ streams: ['Custom-AgentOpsContent_CL'] }],
        destinations: { logAnalytics: [{ workspaceResourceId: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}` }] }
      } : {
        id: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/dcr-spans`,
        immutableId: 'dcr-spans-id',
        streamDeclarations: { 'Custom-AgentOpsSpans_CL': { columns: [
          { name: 'ParentToolCallId' }, { name: 'McpServerName' }, { name: 'McpToolName' },
          { name: 'ScriptRuntimeName' }, { name: 'ScriptRuntimeVersion' },
          { name: 'ScriptRuntimeImplementation' }, { name: 'ScriptLoaderName' }
        ] } },
        dataFlows: [{ streams: ['Custom-AgentOpsSpans_CL'] }],
        destinations: { logAnalytics: [{ workspaceResourceId: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}` }] }
      });
    }
    if (args[0] === 'monitor' && args[1] === 'data-collection' && args[2] === 'endpoint' && args[3] === 'show') {
      return result({ logsIngestion: { endpoint: 'https://dce.example.ingest.monitor.azure.com' } });
    }
    if (args[0] === 'role' && args[1] === 'assignment' && args[2] === 'list') {
      return result([{ principalId, roleDefinitionName: 'Monitoring Metrics Publisher' }]);
    }
    return result('', 1, `Unexpected az command: ${args.slice(0, 3).join(' ')}`);
  };
  return { calls, spawnSync };
}

test('provision azure defaults to preview and scopes every Azure call to the explicit subscription', () => {
  const azure = createAzureMock();
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.dry_run, true);
  assert.equal(outcome.executed, false);
  assert.equal(outcome.preview.profile, 'pilot');
  assert.equal(outcome.preview.daily_ingestion_cap_gb, 1);
  assert.equal(outcome.preview.table_retention_days, 7);
  assert.ok(azure.calls.some(args => args[0] === 'deployment' && args[2] === 'what-if'));
  assert.equal(azure.calls.some(args => args[0] === 'deployment' && args[2] === 'create'), false);
  assert.ok(azure.calls.filter(args => args.includes('--subscription')).every(args => args[args.indexOf('--subscription') + 1] === subscriptionId));
});

test('provision azure applies only a reviewed additive plan and verifies Azure readback', () => {
  const azure = createAzureMock();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-azure-provision-test-'));
  try {
    const receiptPath = path.join(directory, 'receipt.json');
    const outcome = provisionAzurePilot(options(['--yes', '--receipt', receiptPath]), { spawnSync: azure.spawnSync });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.executed, true);
    assert.equal(outcome.verification.ok, true);
    assert.ok(azure.calls.some(args => args[0] === 'deployment' && args[2] === 'create'));
    assert.ok(fs.existsSync(receiptPath));
    assert.equal(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).verification.ok, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('provision azure refuses an existing unowned group before what-if or deployment', () => {
  const azure = createAzureMock({ existingGroup: true, groupTags: { managedBy: 'someone-else' } });
  const outcome = provisionAzurePilot(options(['--yes']), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, 'resource group ownership check');
  assert.equal(azure.calls.some(args => args[0] === 'deployment'), false);
});

test('provision azure returns a verified no-op for an already provisioned owned target', () => {
  const azure = createAzureMock({ existingGroup: true });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.executed, false);
  assert.equal(outcome.already_provisioned, true);
  assert.equal(outcome.verification.checks.dcr_sender_role_scoped_to_both_rules, true);
  assert.equal(azure.calls.some(args => args[0] === 'deployment'), false);
});

test('provision azure accepts a correctly tagged workspace-linked Application Insights add-on', () => {
  const azure = createAzureMock({ existingGroup: true });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.already_provisioned, true);
  assert.equal(outcome.verification.checks.additional_resources_verified, true);
  assert.equal(outcome.verification.checks.application_insights_workspace_link_verified, true);
});

test('provision azure requires script runtime columns in the spans table readback', () => {
  const azure = createAzureMock({ existingGroup: true, missingScriptRuntimeTableColumns: true });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.verification.checks.spans_table_schema_has_script_runtime_fields, false);
});

test('provision azure rejects Application Insights linked to a different workspace', () => {
  const azure = createAzureMock({
    existingGroup: true,
    appInsightsWorkspaceResourceId: `${resourceGroupId}/providers/Microsoft.OperationalInsights/workspaces/other-workspace`
  });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.verification.checks.application_insights_workspace_link_verified, false);
});

test('provision azure accepts a correctly tagged Managed Grafana add-on', () => {
  const azure = createAzureMock({
    existingGroup: true,
    additionalResources: [{
      name: 'graf-copilotagentopseva',
      type: 'Microsoft.Dashboard/grafana',
      tags: {
        app: 'copilot-cli-agentops-azure',
        environment: 'pilot',
        managedBy: 'azd-bicep',
        telemetryContent: 'metadata-only'
      }
    }]
  });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verification.checks.additional_resources_verified, true);
});

test('provision azure accepts the known resource-group monthly budget add-on', () => {
  const azure = createAzureMock({
    existingGroup: true,
    additionalResources: [{
      name: 'budget-copilot-agentops-pilot',
      type: 'Microsoft.Consumption/budgets'
    }]
  });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.verification.checks.additional_resources_verified, true);
});

test('provision azure still refuses an unknown resource in the synthetic pilot group', () => {
  const azure = createAzureMock({
    existingGroup: true,
    additionalResources: [{
      name: 'storage-unreviewed',
      type: 'Microsoft.Storage/storageAccounts',
      tags: { app: 'copilot-cli-agentops-azure', environment: 'pilot', telemetryContent: 'synthetic-eval' }
    }]
  });
  const outcome = provisionAzurePilot(options(), { spawnSync: azure.spawnSync });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, 'existing target verification');
  assert.equal(outcome.verification.checks.additional_resources_verified, false);
  assert.equal(azure.calls.some(args => args[0] === 'deployment'), false);
});

test('provision azure refuses modify, delete, and out-of-scope what-if changes', () => {
  for (const change of [
    { changeType: 'Modify', resourceId: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/unexpected` },
    { changeType: 'Delete', resourceId: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/unexpected` },
    { changeType: 'Create', resourceId: `/subscriptions/${subscriptionId}/resourceGroups/other/providers/Microsoft.Storage/storageAccounts/outside` }
  ]) {
    const reviewed = validateWhatIfChanges([change], subscriptionId, resourceGroupName, 'agentops-pilot-pilot-test');
    assert.equal(reviewed.ok, false);
  }

  const azure = createAzureMock({ changes: [{
    changeType: 'Modify',
    resourceId: `${resourceGroupId}/providers/Microsoft.Insights/dataCollectionRules/unexpected`
  }] });
  const outcome = provisionAzurePilot(options(['--yes']), { spawnSync: azure.spawnSync });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, 'what-if safety check');
  assert.equal(azure.calls.some(args => args[0] === 'deployment' && args[2] === 'create'), false);
});

test('provision azure validates explicit target and preview/apply flags', () => {
  assert.match(provisionAzurePilot({ subcommand: 'azure', resourceGroupName }).error, /--subscription/);
  assert.match(provisionAzurePilot(options(['--profile', 'enterprise'])).error, /synthetic EVAL only/);
  assert.match(provisionAzurePilot(options(['--yes', '--dry-run'])).error, /cannot be combined/);
});
