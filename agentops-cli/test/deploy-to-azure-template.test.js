const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const templatePath = path.join(root, 'infra/azuredeploy.json');
const bicepPath = path.join(root, 'infra/bicep/azuredeploy.bicep');
const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const bicep = fs.readFileSync(bicepPath, 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function nestedResources(resources, out = []) {
  for (const resource of Array.isArray(resources) ? resources : Object.values(resources || {})) {
    out.push(resource);
    if (resource.resources) nestedResources(resource.resources, out);
    if (resource.properties?.template) nestedResources(resource.properties.template.resources, out);
  }
  return out;
}

test('Deploy to Azure template is compiled ARM JSON with metadata-only defaults', () => {
  assert.match(template.$schema, /deploymentTemplate\.json#$/);
  assert.equal(template.metadata?._generator?.name, 'bicep');
  const defaults = Object.fromEntries(Object.entries(template.parameters).map(([key, value]) => [key, value.defaultValue]));
  assert.equal(defaults.grantDeployerUpload, false);
  assert.equal(defaults.allowPublicNetworkAccess, false);
  assert.equal(defaults.deployBudget, true);
  assert.equal(defaults.monthlyBudgetAmount, 5);
  assert.equal(defaults.budgetAlertEmail, '');
  assert.equal(defaults.dailyIngestionCapGb, 1);
  assert.equal(defaults.retentionInDays, 30);
  assert.equal(template.outputs.TELEMETRY_CONTENT.value, 'metadata-only');
  for (const name of Object.keys(template.parameters)) assert.match(bicep, new RegExp(`^param ${name} `, 'm'), `${name} missing from Bicep source`);
});

test('Deploy to Azure template deploys LAW, DCE, DCR, metadata tables, Workbook and budget only', () => {
  const types = new Set(nestedResources(template.resources).map(resource => resource.type));
  assert.deepEqual([...types].sort(), [
    'Microsoft.Resources/deployments',
    'Microsoft.Authorization/roleAssignments',
    'Microsoft.OperationalInsights/workspaces',
    'Microsoft.OperationalInsights/workspaces/tables',
    'Microsoft.Insights/dataCollectionEndpoints',
    'Microsoft.Insights/dataCollectionRules',
    'Microsoft.Insights/workbooks',
    'Microsoft.Consumption/budgets',
  ].sort());
  const ingestion = template.resources.find(resource => resource.name === 'agentops-v2-ingestion');
  assert.equal(ingestion.properties.parameters.metadataOnly.value, true);
  assert.equal(ingestion.properties.parameters.allowPublicNetworkAccess.value, "[parameters('allowPublicNetworkAccess')]");
  const module = ingestion.properties.template;
  assert.deepEqual(module.variables.v2Tables.map(table => table.name).sort(), [
    'AgentOpsRunSummary_CL', 'AgentOpsEvents_CL', 'AgentOpsSpans_CL',
    'AgentOpsToolCalls_CL', 'AgentOpsMcpCalls_CL', 'AgentOpsPrivacy_CL',
    'AgentOpsEval_CL', 'AgentOpsGithubOutcomes_CL', 'AgentOpsInsights_CL',
    'AgentOpsRecommendations_CL', 'AgentOpsCollectorHealth_CL',
  ].sort());
  const text = JSON.stringify(template);
  assert.doesNotMatch(text, /AgentOpsEvalContent|eval-content/i, 'content tables must not be deployed by the button');
  assert.doesNotMatch(text, /\/subscriptions\/[0-9a-f]{8}-/i, 'no hard-coded subscription');
});

test('blank budget email notifies the Owner role without an action group', () => {
  const budget = template.resources.find(resource => resource.name === 'agentops-budget');
  assert.ok(budget, 'budget module missing');
  assert.match(JSON.stringify(budget.properties.parameters.contactRoles), /empty\(parameters\('budgetAlertEmail'\)\).*Owner/);
  assert.match(JSON.stringify(budget.properties.parameters.contactEmails), /empty\(parameters\('budgetAlertEmail'\)\)/);
});

test('README Deploy to Azure badge points at the committed ARM template', () => {
  const encoded = encodeURIComponent('https://raw.githubusercontent.com/c-mongan/copilot-cli-agentops-azure/main/infra/azuredeploy.json');
  assert.ok(readme.includes(`https://portal.azure.com/#create/Microsoft.Template/uri/${encoded}`));
  assert.ok(readme.includes('https://aka.ms/deploytoazurebutton'));
});

test('button ingestion drops content and unrestricted containers by positive projection', () => {
  const module = template.resources.find(r => r.name === 'agentops-v2-ingestion').properties.template;
  const approved = module.variables['$fxv#0'];
  assert.equal(module.variables.metadataColumns, "[variables('$fxv#0')]");
  assert.ok(approved, 'explicit metadata column allowlist missing');
  assert.deepEqual(Object.keys(approved).sort(), module.variables.v2Tables.map(t => t.name).sort());
  for (const table of module.variables.v2Tables) {
    const allowed = approved[table.name];
    assert.ok(allowed.includes('TimeGenerated'));
    assert.ok(allowed.includes('SchemaVersion'));
    const columns = new Map(table.columns.map(c => [c.name, c.type]));
    for (const name of allowed) {
      assert.ok(columns.has(name), `${table.name}: unknown column ${name}`);
      assert.notEqual(columns.get(name), 'dynamic', `${table.name}: unrestricted container ${name}`);
    }
  }
  for (const name of ['BenchmarkArtifactContentDiffs', 'BenchmarkArtifactFiles', 'Validation', 'NextAction', 'ObservedPattern']) {
    assert.ok(!approved.AgentOpsRecommendations_CL.includes(name), `${name} must be dropped`);
  }
  assert.ok(!approved.AgentOpsInsights_CL.includes('Evidence'));
  assert.ok(!approved.AgentOpsCollectorHealth_CL.includes('Detail'));
  const source = fs.readFileSync(path.join(root, 'infra/bicep/v2-ingestion.bicep'), 'utf8');
  assert.match(source, /columns: filter\(table.columns, column => contains\(metadataColumns\[table.name\], column.name\)\)/);
  assert.match(source, /transformKql: metadataOnly \? 'source \| project \${join\(map\(table.columns, column => column.name\), ', '\)}'/);
  const tables = nestedResources(template.resources).filter(r => r.type === 'Microsoft.OperationalInsights/workspaces/tables');
  assert.equal(tables.length, 1, 'no extra literal table or table loop may bypass the approved schema');
  assert.equal(tables[0].copy.count, "[length(variables('effectiveTables'))]");
  assert.equal(tables[0].properties.schema.name, "[variables('effectiveTables')[copyIndex()].name]");
  assert.equal(tables[0].properties.schema.columns, "[variables('effectiveTables')[copyIndex()].columns]");
  const rule = module.resources.find(r => r.type === 'Microsoft.Insights/dataCollectionRules');
  assert.equal(rule.properties.streamDeclarations, "[toObject(variables('effectiveTables'), lambda('table', lambdaVariables('table').stream), lambda('table', createObject('columns', lambdaVariables('table').columns)))]");
  const flows = rule.properties.copy;
  assert.equal(flows.length, 1);
  assert.equal(flows[0].name, 'dataFlows');
  assert.equal(flows[0].count, "[length(variables('effectiveTables'))]");
  assert.equal(flows[0].input.transformKql, "[if(parameters('metadataOnly'), format('source | project {0}', join(map(variables('effectiveTables')[copyIndex('dataFlows')].columns, lambda('column', lambdaVariables('column').name)), ', ')), if(equals(variables('effectiveTables')[copyIndex('dataFlows')].stream, 'Custom-AgentOpsSpans_CL'), variables('spansTransformKql'), 'source'))]");
  assert.match(JSON.stringify(module.resources), /publicNetworkAccess.*allowPublicNetworkAccess.*Enabled.*Disabled/);
});

test('upload outputs select the two tables present in standard Copilot session directories', () => {
  assert.match(template.outputs.UPLOAD_COMMAND.value, /--events-only/);
  assert.match(template.outputs.UPLOAD_SPANS_COMMAND.value, /--spans-only/);
  for (const name of ['UPLOAD_COMMAND', 'UPLOAD_SPANS_COMMAND']) {
    assert.match(template.outputs[name].value, /--max-publish-bytes-per-day 5000000 --yes/);
  }
});

test('template normalization detects semantic drift in defaults, conditions, resources and outputs', () => {
  const { normalize } = require('../../scripts/check-deploy-to-azure-template');
  const expected = normalize(template);
  for (const mutate of [
    t => { t.parameters.grantDeployerUpload.defaultValue = true; },
    t => { t.resources[0].condition = false; },
    t => { t.resources.push({ type: 'Microsoft.Storage/storageAccounts' }); },
    t => { t.outputs.TELEMETRY_CONTENT.value = 'content'; },
    t => { t.resources.find(r => r.name === 'agentops-v2-ingestion').properties.template.variables['$fxv#0'].AgentOpsRecommendations_CL.push('BenchmarkArtifactContentDiffs'); },
  ]) {
    const changed = structuredClone(template);
    mutate(changed);
    assert.notDeepEqual(normalize(changed), expected);
  }
  const reordered = Object.fromEntries(Object.entries(template).reverse());
  assert.deepEqual(normalize(reordered), expected);
});

test('public access and both RBAC writes require explicit button parameters', () => {
  const resources = nestedResources(template.resources);
  const grants = resources.filter(r => r.type === 'Microsoft.Authorization/roleAssignments');
  assert.equal(grants.length, 2);
  assert.match(grants.find(r => r.condition.includes('grantDeployerUpload')).condition, /parameters\('grantDeployerUpload'\)/);
  assert.match(grants.find(r => !r.condition.includes('grantDeployerUpload')).condition, /not\(equals\(parameters\('ingestionPrincipalId'\), ''\)\)/);
  const ingestion = template.resources.find(r => r.name === 'agentops-v2-ingestion');
  assert.equal(ingestion.properties.parameters.ingestionPrincipalId.value, "[parameters('uploaderPrincipalId')]");
  assert.equal(template.parameters.uploaderPrincipalId.defaultValue, '');
  const workspaceModule = template.resources.find(r => r.name === 'agentops-log-analytics');
  assert.equal(workspaceModule.properties.parameters.allowPublicNetworkAccess.value, "[parameters('allowPublicNetworkAccess')]");
  const workspace = resources.find(r => r.type === 'Microsoft.OperationalInsights/workspaces');
  for (const key of ['publicNetworkAccessForIngestion', 'publicNetworkAccessForQuery']) {
    assert.equal(workspace.properties[key], "[if(parameters('allowPublicNetworkAccess'), 'Enabled', 'Disabled')]");
  }
});
