const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repoRoot } = require('../src/lib/paths');
const { readJson } = require('../src/lib/json');
const { lintKql, portableDashboardBodies, validatePortableDashboard } = require('../src/lib/dashboard-validation');
const { dashboardKqlCheck, substituteGrafanaMacros, textboxDefaults } = require('../src/lib/dashboard-kql-check');

const file = path.join(repoRoot, 'grafana', 'agentops-copilot-cli.json');
const load = () => readJson(file);
const queryPanels = dashboard => dashboard.panels.filter(panel => panel.type !== 'text');

test('portable Grafana dashboard passes the portability checks', () => {
  assert.deepEqual(validatePortableDashboard(load()), []);
});

test('portable Grafana dashboard is generated from the build script', () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-grafana-portable-dashboard.js'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('portable Grafana dashboard covers the required panels and only queries AgentOps tables', () => {
  const dashboard = load();
  const titles = queryPanels(dashboard).map(panel => panel.title);
  for (const title of ['Runs over time', 'Failure rate', 'Top failing tools', 'Tool latency p50 / p95 by tool', 'Tokens in / out by model', 'Est. cost by model (USD, not billed)', 'Slowest runs']) {
    assert.ok(titles.includes(title), `missing panel ${title}`);
  }
  for (const panel of queryPanels(dashboard)) {
    const query = panel.targets[0].azureLogAnalytics.query;
    assert.match(query, /AgentOps(Events|Spans|RunSummary)_CL/, panel.title);
    assert.doesNotMatch(query, /\b(Prompt|Response|ToolArgs|ToolResult)\w*\b/, `${panel.title} must stay metadata-only`);
  }
  for (const panel of queryPanels(dashboard).filter(item => /cost/i.test(item.title))) {
    assert.match(panel.title, /Est\./);
  }
});

test('portable Grafana dashboard dedupes spans before counting tokens', () => {
  const query = queryPanels(load()).find(panel => panel.title === 'Tokens in').targets[0].azureLogAnalytics.query;
  assert.match(query, /arg_max\(TimeGenerated, \*\) by RunId, SpanId, OperationName/);
});

test('portable Grafana dashboard rejects hard-coded IDs and non-variable datasources', () => {
  const dashboard = load();
  dashboard.panels[1].datasource = { type: 'grafana-azure-monitor-datasource', uid: 'my-azure' };
  dashboard.panels[2].targets[0].azureLogAnalytics.resources = ['/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law'];
  dashboard.panels[3].id = dashboard.panels[2].id;
  const errors = validatePortableDashboard(dashboard, 'fixture');
  assert.ok(errors.some(error => /hard-coded GUID/.test(error)));
  assert.ok(errors.some(error => /hard-coded Azure resource ID/.test(error)));
  assert.ok(errors.some(error => /must use the \$\{datasource\} variable/.test(error)));
  assert.ok(errors.some(error => /\$workspace variable/.test(error)));
  assert.ok(errors.some(error => /duplicate panel id/.test(error)));
});

test('KQL lint catches structural mistakes', () => {
  const bounded = 'T | where TimeGenerated between ($__timeFrom() .. $__timeTo())';
  assert.deepEqual(lintKql(`${bounded} | extend A = "x)" // trailing (`), []);
  assert.match(lintKql(`${bounded} | summarize count() by (A`).join(), /unclosed \(/);
  assert.match(lintKql(`${bounded} | where A == "x`).join(), /unterminated string/);
  assert.match(lintKql(`${bounded} | | take 1`).join(), /empty pipe stage/);
  assert.match(lintKql('T | take 1').join(), /time range/);
});

test('kql-check renders portable panels with textbox defaults', () => {
  const dashboard = load();
  const variables = textboxDefaults(dashboard);
  assert.deepEqual(Object.keys(variables).sort(), ['est_price_in_usd_per_mtok', 'est_price_out_usd_per_mtok']);
  const rendered = substituteGrafanaMacros('print a = todouble("${est_price_in_usd_per_mtok}"), b = $__timeFrom()', { last: '7d', variables });
  assert.equal(rendered, 'print a = todouble("3"), b = ago(7d)\n| take 5');

  const result = dashboardKqlCheck(['--local-only'], { dashboardBodies: portableDashboardBodies });
  const portable = result.checks.filter(check => check.uid === 'agentops-copilot-cli');
  assert.equal(portable.length, queryPanels(dashboard).length);
  for (const check of portable) {
    assert.equal(check.ok, true, check.panel);
    assert.doesNotMatch(check.query, /\$\{?\w|\$__/, check.panel);
  }
});
