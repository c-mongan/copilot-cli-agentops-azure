const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { doctor, importJsonl, parseFrontmatter, scan } = require('../src/index.js');

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
