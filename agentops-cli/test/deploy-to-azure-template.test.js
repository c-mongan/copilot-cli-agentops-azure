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
    if (resource.properties?.template) nestedResources(resource.properties.template.resources, out);
  }
  return out;
}

test('Deploy to Azure template is compiled ARM JSON with metadata-only defaults', () => {
  assert.match(template.$schema, /deploymentTemplate\.json#$/);
  assert.equal(template.metadata?._generator?.name, 'bicep');
  const defaults = Object.fromEntries(Object.entries(template.parameters).map(([key, value]) => [key, value.defaultValue]));
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
  for (const type of [
    'Microsoft.OperationalInsights/workspaces',
    'Microsoft.OperationalInsights/workspaces/tables',
    'Microsoft.Insights/dataCollectionEndpoints',
    'Microsoft.Insights/dataCollectionRules',
    'Microsoft.Insights/workbooks',
    'Microsoft.Consumption/budgets',
  ]) assert.ok(types.has(type), `missing ${type}`);
  for (const type of ['Microsoft.Insights/actionGroups', 'Microsoft.Insights/components', 'Microsoft.Dashboard/grafana', 'Microsoft.KeyVault/vaults']) {
    assert.ok(!types.has(type), `unexpected ${type}`);
  }
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
