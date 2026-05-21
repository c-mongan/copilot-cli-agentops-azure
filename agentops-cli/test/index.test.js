const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildLink, contextPressureQuery, doctor, fieldCatalogQuery, importJsonl, parseFrontmatter, scan } = require('../src/index.js');

const root = path.resolve(__dirname, '..', '..');

test('scan finds plugin agents and skills', () => {
  const result = scan();
  assert.ok(result.agents.length >= 5);
  assert.ok(result.skills.length >= 4);
  assert.ok(result.mcp_servers.includes('azure-mcp'));
});

test('doctor local checks pass', () => {
  const checks = doctor({ localOnly: true });
  assert.equal(checks.every(check => check.ok), true);
});

test('import-jsonl summarizes operations', () => {
  const result = importJsonl(path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl'));
  assert.equal(result.rows, 2);
  assert.equal(result.operations.invoke_agent, 1);
  assert.equal(result.operations.execute_tool, 1);
});

test('frontmatter parser extracts simple fields', () => {
  const data = parseFrontmatter(path.join(root, 'plugin', 'agents', 'telemetry-investigator.agent.md'));
  assert.equal(data.name, 'telemetry-investigator');
  assert.match(data.description, /Investigates GitHub Copilot CLI telemetry/);
});

test('link session builds Grafana URL and KQL', () => {
  const result = buildLink('session', 'abc-123', { last: '2h' });
  assert.equal(result.kind, 'session');
  assert.match(result.grafana_url, /agentops-session-detail/);
  assert.match(result.grafana_url, /var-conversation=abc-123/);
  assert.match(result.query, /ago\(2h\)/);
  assert.match(result.query, /conversation == "abc-123"/);
});

test('link trace builds OperationId query', () => {
  const result = buildLink('trace', 'op-456');
  assert.equal(result.kind, 'trace');
  assert.match(result.grafana_url, /agentops-traces-spans/);
  assert.match(result.query, /OperationId == "op-456"/);
});

test('field catalog query discovers Properties keys', () => {
  const query = fieldCatalogQuery('14d');
  assert.match(query, /ago\(14d\)/);
  assert.match(query, /bag_keys\(Properties\)/);
  assert.match(query, /example_values/);
});

test('context pressure query ranks inefficient sessions', () => {
  const query = contextPressureQuery('3d');
  assert.match(query, /ago\(3d\)/);
  assert.match(query, /OutputYieldPct/);
  assert.match(query, /CacheLeveragePct/);
  assert.match(query, /high_context/);
});
