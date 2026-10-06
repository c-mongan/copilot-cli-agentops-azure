#!/usr/bin/env node
// Bounded local contracts only: not a KQL parser, cloud check, or portal renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEvidenceSchemas, replaySchemaProjection } = require('../agentops-cli/src/lib/product-evidence-bundle');
const WORKBOOK = path.join(__dirname, '../workbooks/agentops-enterprise-workbook.json');
// Time start/end render as KQL datetime expressions, matching the Workbook docs example.
// Mirrors documented single-value Workbook base64 formatting, without adding quotes
// that the single-select control does not supply. Azure executes the decoded filter.
function renderEnterpriseWorkbookQuery(query, { runId = '*', timeRange = '> ago(24h)' } = {}) {
  assert.equal(typeof runId, 'string');
  const end = new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const start = new Date(end.getTime() - 24 * 3600000);
  return query.replaceAll('{TimeRange:grain}', '1h').replaceAll('{TimeRange:start}', `datetime(${start.toISOString()})`).replaceAll('{TimeRange:end}', `datetime(${end.toISOString()})`).replaceAll('{TimeRange}', timeRange).replaceAll('{RunId:base64}', Buffer.from(runId, 'utf8').toString('base64'));
}
const PANEL_NAMES = ['kpi-tiles', 'activity-timechart', 'coverage-delivery', 'runs', 'model-events', 'tools-scripts', 'span-lineage', 'references', 'privacy', 'health', 'evaluations', 'github-outcomes', 'insights', 'recommendations'];
// Query panels live inside tab groups (type 12); collect them in document order.
function collectPanels(items) {
  return items.flatMap(item => item.type === 12 ? collectPanels(item.content.items) : item.type === 3 ? [item] : []);
}
function checkTabs(workbook) {
  const tabState = workbook.items.find(item => item.name === 'enterprise-tab-state').content.parameters;
  assert.deepEqual(tabState.map(parameter => [parameter.name, parameter.value, parameter.isHiddenWhenLocked]), [['selectedTab', 'overview', true]]);
  const links = workbook.items.find(item => item.type === 11 && item.content.style === 'tabs').content.links;
  const groups = workbook.items.filter(item => item.type === 12);
  assert.ok(groups.length >= 2);
  assert.deepEqual(links.map(link => [link.linkTarget, link.cellValue, link.subTarget]), groups.map(group => ['parameter', 'selectedTab', group.conditionalVisibility.value]));
  for (const group of groups) {
    assert.equal(group.content.version, 'NotebookGroup/1.0');
    assert.deepEqual([group.conditionalVisibility.parameterName, group.conditionalVisibility.comparison], ['selectedTab', 'isEqualTo']);
  }
  assert.equal(groups[0].conditionalVisibility.value, 'overview');
}
function checkEnterpriseWorkbook(workbook = JSON.parse(fs.readFileSync(WORKBOOK, 'utf8'))) {
  const schemas = loadEvidenceSchemas();
  assert.equal(Object.keys(schemas).length, 12);
  assert.equal(workbook.version, 'Notebook/1.0');
  const params = workbook.items.find(item => item.type === 9).content.parameters;
  assert.deepEqual(params.map(parameter => parameter.name), ['Workspace', 'TimeRange', 'RunId']);
  assert.equal(params[0].type, 5);
  assert.equal(params[0].value, 'value::1');
  assert.deepEqual(params[0].typeSettings.resourceTypeFilter, { 'microsoft.operationalinsights/workspaces': true });
  assert.deepEqual(params[0].typeSettings.additionalResourceOptions, ['value::1']);
  assert.equal(params[0].typeSettings.showDefault, false);
  assert.deepEqual(params[1].typeSettings.selectableValues, [3600000, 14400000, 86400000, 604800000].map(durationMs => ({ durationMs })));
  assert.equal(params[2].multiSelect, undefined);
  assert.equal(params[2].quote, undefined);
  assert.equal(params[2].delimiter, undefined);
  const panels = collectPanels(workbook.items);
  assert.deepEqual(panels.map(item => item.name), PANEL_NAMES);
  checkTabs(workbook);
  const queries = [...panels.map(item => item.content), params[2]];
  const sources = new Set();
  let checkedColumns = 0;
  const sourceContracts = [];
  for (const content of queries) {
    assert.equal(content.queryType, 0);
    assert.equal(content.resourceType, 'microsoft.operationalinsights/workspaces');
    assert.deepEqual(content.crossComponentResources, ['{Workspace}']);
    assert.equal(content.timeContextFromParameter, 'TimeRange');
    const query = content.query;
    assert.doesNotMatch(query, /AgentOpsContent_CL|PromptText|ResponseText|OtlpEndpoint|\bDetail\b|BenchmarkArtifactContentDiffs|\bReferenceName\b|\bSummary\b|\bNextAction\b/);
    assert.doesNotMatch(query, /coalesce\([^)]*,\s*0\)|sum\(|isfuzzy|\bpack_all\b/i);
    assert.match(query, /TimeGenerated \{TimeRange\}/);
    assert.doesNotMatch(query, /\{RunId\}/);
    for (const runId of ['*', 'run-fixture', "quote'\\backslash", "') | take 0 //"]) {
      const rendered = renderEnterpriseWorkbookQuery(query, { runId });
      assert.doesNotMatch(rendered, /\{(?:RunId|TimeRange)/);
      if (query.includes('{RunId:base64}')) {
        const encoded = /base64_decode_tostring\('([A-Za-z0-9+/=]*)'\)/.exec(rendered)[1];
        assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), runId);
        assert.ok(rendered.includes(`RunId == base64_decode_tostring('${encoded}')`));
      }
    }
    if (content.title) assert.match(query, /\| take 500$/);
    const matches = [...query.matchAll(/(AgentOps\w+_CL)\s*\|\s*where TimeGenerated \{TimeRange\}\s*(?:\|\s*where [^\n]*\n)?\|\s*project ([\w, ]+)/g)];
    assert.ok(matches.length, 'Each query must have a checked source projection');
    assert.equal(matches.length, [...query.replace(/"AgentOps\w+_CL"/g, '"metadata-source-label"').matchAll(/AgentOps\w+_CL/g)].length, 'Every source must use a checked projection');
    for (const match of matches) {
      const table = match[1];
      const columns = match[2].trim().split(/\s*,\s*/);
      assert.ok(schemas[table], `Unknown table ${table}`);
      for (const column of columns) assert.ok(schemas[table].columns.some(field => field.name === column), `${table}.${column} absent from maintained schema`);
      if (table !== 'AgentOpsCollectorHealth_CL' && content.title) assert.match(query, /RunId == base64_decode_tostring\('\{RunId:base64\}'\)/);
      sources.add(table);
      checkedColumns += columns.length;
      sourceContracts.push({ table, columns });
    }
  }
  assert.equal(sources.size, 11, 'All metadata tables must be represented; content must be excluded');
  const coverageQuery = panels.find(item => item.name === 'coverage-delivery').content.query;
  assert.doesNotMatch(coverageQuery, /withsource=|union_arg/);
  const coverageLabels = [...coverageQuery.matchAll(/extend SourceTable="(AgentOps\w+_CL)"/g)].map(match => match[1]);
  assert.deepEqual(coverageLabels.slice().sort(), Object.keys(schemas).filter(table => !['AgentOpsContent_CL', 'AgentOpsCollectorHealth_CL'].includes(table)).sort());
  assert.equal(new Set(coverageLabels).size, 10);

  const json = JSON.stringify(workbook);
  for (const phrase of ['request is not actual', 'UploadAcknowledgment', 'CaptureCompleteness', 'workspace-wide', 'no-leak verdict', 'not invoice', 'human review required']) assert.ok(json.includes(phrase));
  // Source projection replay deliberately covers the real column contract only.
  // It does not simulate KQL predicates, joins, extends, union or summarization.
  const fixture = { TimeGenerated: '2026-10-02T10:00:00Z', RunId: 'run-fixture', ModelRequested: 'requested-model', ModelActual: null, OutcomeStatus: null, InputTokens: null, OutputTokens: null, EstimatedCostUsdReal: null, TestsPassed: null };
  const projected = replaySchemaProjection('AgentOpsRunSummary_CL', fixture, schemas);
  const runSource = sourceContracts.find(contract => contract.table === 'AgentOpsRunSummary_CL' && contract.columns.includes('ModelRequested'));
  const visible = Object.fromEntries(runSource.columns.map(column => [column, projected[column] ?? null]));
  assert.equal(visible.ModelActual, null);
  assert.equal(visible.OutcomeStatus, null);
  assert.equal(visible.InputTokens, null);
  assert.equal(visible.EstimatedCostUsdReal, null);
  assert.equal(visible.TestsPassed, null);
  assert.equal(visible.ModelRequested, 'requested-model');
  const measured = replaySchemaProjection('AgentOpsRunSummary_CL', { ...fixture, InputTokens: 0, EstimatedCostUsdReal: 0.0125, TestsPassed: false, OutcomeStatus: 'failed' }, schemas);
  assert.equal(measured.InputTokens, 0);
  assert.equal(measured.EstimatedCostUsdReal, 0.0125);
  assert.equal(measured.TestsPassed, false);
  assert.equal(measured.OutcomeStatus, 'failed');
  // Check negative cases to ensure this checker rejects drift and content lanes.
  if (arguments.length === 0) {
    const drift = structuredClone(workbook);
    const driftPanel = collectPanels(drift.items).find(item => item.name === 'runs');
    driftPanel.content.query = driftPanel.content.query.replace('TestsRan,', 'InventedCoverage,');
    assert.throws(() => checkEnterpriseWorkbook(drift), /absent from maintained schema/);
    const invalidTimeValues = structuredClone(workbook);
    invalidTimeValues.items.find(item => item.type === 9).content.parameters[1].typeSettings.selectableValues = [3600000];
    assert.throws(() => checkEnterpriseWorkbook(invalidTimeValues));
    const invalidPicker = structuredClone(workbook);
    invalidPicker.items.find(item => item.type === 9).content.parameters[0].typeSettings.resourceTypeFilter = ['microsoft.operationalinsights/workspaces'];
    assert.throws(() => checkEnterpriseWorkbook(invalidPicker));
    const invalidContext = structuredClone(workbook);
    invalidContext.items.find(item => item.type === 9).content.parameters[0].value = 'value::context::resourceId';
    assert.throws(() => checkEnterpriseWorkbook(invalidContext));
    const contentLane = structuredClone(workbook);
    collectPanels(contentLane.items)[0].content.query += '\nAgentOpsContent_CL';
    const hiddenTabs = structuredClone(workbook);
    hiddenTabs.items.find(item => item.name === 'enterprise-tab-state').content.parameters[0].value = '';
    assert.throws(() => checkEnterpriseWorkbook(hiddenTabs));
    assert.throws(() => checkEnterpriseWorkbook(contentLane));
  }
  return { ok: true, evidenceTier: 'local-workbook-source-contract', queryPanels: panels.length, metadataTables: sources.size, checkedSourceColumns: checkedColumns, maintainedSchemas: Object.keys(schemas).length, nullableFixtureProjection: true, azureKqlExecutionVerified: false, portalRenderingVerified: false, cloudWritesPerformed: false };
}
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(checkEnterpriseWorkbook(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { checkEnterpriseWorkbook, renderEnterpriseWorkbookQuery };
