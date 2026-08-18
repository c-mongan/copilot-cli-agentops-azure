const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  agentOpsContentTables,
  azureProductionRemediationPlan,
  azureRoleIds,
  logAnalyticsTablesFromResult,
  roleAssignmentSummary
} = require('../src/lib/azure-posture');

test('azure posture helpers parse tables, summarize RBAC, and plan remediation', () => {
  const tables = logAnalyticsTablesFromResult({
    value: [{
      name: 'AgentOpsContent_CL',
      properties: {
        retentionInDays: 90,
        totalRetentionInDays: 90
      }
    }]
  });
  const rbac = roleAssignmentSummary([
    {
      roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${azureRoleIds.logAnalyticsDataReader}`,
      roleDefinitionName: 'Log Analytics Reader',
      principalType: 'Group'
    },
    {
      roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${azureRoleIds.contributor}`,
      roleDefinitionName: 'Contributor',
      principalType: 'User'
    }
  ], [azureRoleIds.logAnalyticsDataReader]);
  const plan = azureProductionRemediationPlan({
    last: '24h',
    config: {
      resource_group: 'rg-agentops-prod',
      workspace_name: 'law-agentops-prod',
      grafana_name: 'graf-agentops-prod'
    },
    checks: [
      { name: 'log-analytics-posture', ok: false },
      { name: 'alert-routing-posture', ok: false, rule_names: ['sqr-agentops-cost'] }
    ]
  });

  assert.equal(tables[0].name, 'AgentOpsContent_CL');
  assert.equal(tables[0].retention_days, 90);
  assert.equal(agentOpsContentTables(tables).length, 1);
  assert.equal(rbac.matching, 1);
  assert.equal(rbac.group_assignments, 1);
  assert.equal(rbac.broad_assignments, 1);
  assert.deepEqual(plan.actions.map(action => action.name), [
    'set-log-analytics-daily-cap',
    'route-agentops-alerts-to-action-groups'
  ]);
  assert.ok(plan.actions[1].commands.some(command => command.includes('sqr-agentops-cost')));
});

test('azure posture uses shared array type helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'azure-posture.js'), 'utf8');
  assert.doesNotMatch(source, /function asArray\(/);
});
