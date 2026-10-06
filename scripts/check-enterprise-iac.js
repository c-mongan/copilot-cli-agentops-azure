#!/usr/bin/env node
'use strict';
// Local compiler + deployed-resource contract. Never calls Azure or installs tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const compiler = process.env.BICEP_CLI || path.join(os.homedir(), '.azure/bin/bicep');
const entry = path.join(root, 'infra/bicep/enterprise-existing-workspace.bicep');
const result = spawnSync(compiler, ['build', entry, '--stdout'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stderr.trim(), '', `Compilation must have no warnings: ${result.stderr}`);
const template = JSON.parse(result.stdout);
const allResources = [];
const owners = new Map();
function collect(current) {
  for (const resource of Object.values(current.resources || {})) {
    allResources.push(resource);
    owners.set(resource, current);
    if (resource.properties?.template) collect(resource.properties.template);
  }
}
collect(template);
const allowedWrites = new Set([
  'Microsoft.Resources/deployments', 'Microsoft.Insights/workbooks',
  'Microsoft.Authorization/roleAssignments', 'Microsoft.Consumption/budgets',
  'Microsoft.Insights/actionGroups', 'Microsoft.Insights/scheduledQueryRules'
]);
for (const resource of allResources.filter(resource => !resource.existing)) {
  assert(allowedWrites.has(resource.type), `Unexpected infrastructure write: ${resource.type}`);
}
for (const type of ['Microsoft.OperationalInsights/workspaces', 'Microsoft.Insights/dataCollectionRules',
  'Microsoft.Insights/dataCollectionEndpoints', 'Microsoft.Insights/components']) {
  const references = allResources.filter(resource => resource.type === type);
  assert(references.length > 0, `Missing existing reference: ${type}`);
  assert(references.every(resource => resource.existing === true), `Existing resource could be mutated: ${type}`);
}
const workbook = allResources.find(resource => resource.type === 'Microsoft.Insights/workbooks' && !resource.existing);
assert.equal(workbook.kind, 'shared');
assert.equal(workbook.properties.sourceId, "[parameters('workspaceResourceId')]");
const workbookVariables = owners.get(workbook).variables;
assert.equal(workbook.properties.serializedData, "[string(variables('boundWorkbook'))]");
const embeddedExpression = /^\[variables\('([^']+)'\)\]$/.exec(workbookVariables.workbookTemplate);
assert(embeddedExpression, 'Reusable Workbook must be embedded at compile time');
const workbookAsset = JSON.parse(fs.readFileSync(path.join(root, 'workbooks/agentops-enterprise-workbook.json'), 'utf8'));
assert.deepEqual(workbookVariables[embeddedExpression[1]], workbookAsset);
// Check the actual compiled ARM transform, not merely the source token. This
// proves only Workspace.value changes inside items and both resource defaults
// receive the same deployment parameter; portal execution is a separate gate.
assert.equal(workbookVariables.boundItems, "[map(variables('workbookTemplate').items, lambda('item', if(equals(lambdaVariables('item').name, 'enterprise-parameters'), union(lambdaVariables('item'), createObject('content', union(lambdaVariables('item').content, createObject('parameters', map(lambdaVariables('item').content.parameters, lambda('parameter', if(equals(lambdaVariables('parameter').name, 'Workspace'), union(lambdaVariables('parameter'), createObject('value', parameters('workspaceResourceId'))), lambdaVariables('parameter')))))))), lambdaVariables('item'))))]");
assert.equal(workbookVariables.boundWorkbook, "[union(variables('workbookTemplate'), createObject('items', variables('boundItems'), 'fallbackResourceIds', createArray(parameters('workspaceResourceId')), 'defaultResourceIds', createArray(parameters('workspaceResourceId'))))]");
assert.equal(workbookAsset.items.filter(item => item.name === 'enterprise-parameters').length, 1);
const picker = workbookAsset.items.find(item => item.name === 'enterprise-parameters').content.parameters.filter(parameter => parameter.name === 'Workspace');
assert.equal(picker.length, 1);
assert.equal(picker[0].type, 5);
assert.deepEqual(picker[0].typeSettings.resourceTypeFilter, { 'microsoft.operationalinsights/workspaces': true });
for (const key of ['observers', 'editors', 'publishers', 'metadataReaders', 'budgetContactEmails', 'actionGroupContactEmails']) {
  assert.deepEqual(template.parameters[key].defaultValue, [], `${key} must default to no external recipients/access`);
}
for (const key of ['deployBudget', 'deployActionGroup', 'deployHealthRule']) assert.equal(template.parameters[key].defaultValue, false);
const queryRule = allResources.find(resource => resource.type === 'Microsoft.Insights/scheduledQueryRules');
assert.equal(queryRule.properties.enabled, false);
assert.match(queryRule.properties.criteria.allOf[0].query, /AgentOpsCollectorHealth_CL/);
const actionGroup = allResources.find(resource => resource.type === 'Microsoft.Insights/actionGroups');
assert.equal(actionGroup.properties.enabled, false);
assert(!actionGroup.properties.smsReceivers && !actionGroup.properties.webhookReceivers && !actionGroup.properties.automationRunbookReceivers);
const roles = allResources.filter(resource => resource.type === 'Microsoft.Authorization/roleAssignments');
assert.equal(roles.length, 4);
const expectedRoleScopes = new Map([
  ['b279062a-9be3-42a0-92ae-8b3cf002ec4d', 'Microsoft.Insights/workbooks/{0}'],
  ['e8ddcd69-c73f-4f9f-9844-4100522f16ad', 'Microsoft.Insights/workbooks/{0}'],
  ['3b03c2da-16b3-4a49-8834-0f8130efdd3b', "Microsoft.OperationalInsights/workspaces/{0}',"],
  ['3913510d-42f4-4e42-8a64-420c390055eb', 'Microsoft.Insights/dataCollectionRules/{0}']
]);
const seenRoles = new Set();
for (const role of roles) {
  assert(role.scope, 'Role assignment requires an explicit resource scope');
  const variable = /variables\('([^']+)'\)/.exec(role.properties.roleDefinitionId);
  assert(variable, 'Role definition must resolve to an explicit verified role');
  const roleId = owners.get(role).variables[variable[1]];
  assert(expectedRoleScopes.has(roleId), `Unexpected role: ${roleId}`);
  assert(role.scope.includes(expectedRoleScopes.get(roleId)), `Unexpected role scope: ${role.scope}`);
  seenRoles.add(roleId);
  assert.match(role.properties.principalType, /principalType/);
  assert.match(role.properties.principalId, /objectId/);
  if (roleId === '3b03c2da-16b3-4a49-8834-0f8130efdd3b') {
    assert.equal(role.properties.conditionVersion, '2.0');
    assert.equal(role.properties.condition, "[variables('metadataTableCondition')]");
    const condition = owners.get(role).variables.metadataTableCondition;
    const tables = [
      'AgentOpsRunSummary_CL', 'AgentOpsEvents_CL', 'AgentOpsSpans_CL', 'AgentOpsToolCalls_CL',
      'AgentOpsMcpCalls_CL', 'AgentOpsPrivacy_CL', 'AgentOpsEval_CL', 'AgentOpsGithubOutcomes_CL',
      'AgentOpsInsights_CL', 'AgentOpsRecommendations_CL', 'AgentOpsCollectorHealth_CL'
    ];
    assert.equal(condition.trim(), `(\n  !(ActionMatches{'Microsoft.OperationalInsights/workspaces/tables/data/read'})\n  OR\n  @Resource[Microsoft.OperationalInsights/workspaces/tables:name] ForAllOfAnyValues:StringEquals {${tables.map(table => `'${table}'`).join(', ')}}\n)`);
    // Exercise the fixed membership policy for every workbook table and denied data class.
    const allowlist = new Set([...condition.matchAll(/'(AgentOps[A-Za-z]+_CL)'/g)].map(match => match[1]));
    for (const table of tables) assert(allowlist.has(table), `Required metadata table excluded: ${table}`);
    for (const denied of ['AgentOpsContent_CL', 'AgentOpsNewSensitive_CL', 'AppTraces', 'SigninLogs']) assert(!allowlist.has(denied), `Unapproved data table allowed: ${denied}`);
  }
}
assert.equal(seenRoles.size, expectedRoleScopes.size);
assert(!JSON.stringify(template).includes('AgentOpsContent_CL'), 'No content reference or grant');
const example = JSON.parse(fs.readFileSync(path.join(root, 'infra/bicep/enterprise-existing-workspace.parameters.example.json'), 'utf8'));
for (const key of Object.keys(example.parameters)) assert(template.parameters[key], `Unknown example parameter ${key}`);
console.log(`Enterprise IaC contract passed: warning-free compile, ${allResources.length} resource declarations, existing-resource preservation, conditioned metadata-reader/DCR RBAC, disabled notifications and health rule.`);
