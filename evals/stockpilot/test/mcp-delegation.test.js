'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const server = path.join(__dirname, '../fixtures/mcp/stockpilot-readonly.js');
const specialist = path.join(__dirname, '../fixtures/agents/stock-risk-auditor.agent.md');
const contractFile = path.join(__dirname, '../mcp-delegation-contract.json');
const expectationsFile = path.join(__dirname, '../expectations.mcp-delegation.json');
const {
  MAX_DATA_BYTES, MAX_LINE_BYTES, STOCK_FILE, latestStock, respond
} = require(server);
const { audit } = require('../scripts/audit-mcp-delegation');
const call = (method, params, id = 1) => respond({ jsonrpc: '2.0', id, method, params });

test('owned MCP returns the latest bounded synthetic stock row', () => {
  assert.equal(fs.lstatSync(STOCK_FILE).size < MAX_DATA_BYTES, true);
  assert.deepEqual(latestStock({ sku: 'SKU-0042', warehouse: 'WH-EAST' }), {
    synthetic: true,
    sku: 'SKU-0042',
    warehouse: 'WH-EAST',
    observed_on: '2026-06-15',
    on_hand: 312,
    source: 'stock_levels.csv'
  });
  const reply = call('tools/call', {
    name: 'stock_snapshot', arguments: { sku: 'SKU-0042', warehouse: 'WH-EAST' }
  });
  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.structuredContent.on_hand, 312);
  assert.equal(JSON.parse(reply.result.content[0].text).observed_on, '2026-06-15');
});

test('owned MCP distinguishes planted tool failure from protocol errors', () => {
  assert.deepEqual(call('tools/list').result.tools.map(tool => tool.name), [
    'stock_snapshot', 'unavailable_snapshot'
  ]);
  assert.equal(call('tools/call', { name: 'unavailable_snapshot' }).result.isError, true);
  assert.equal(call('tools/call', { name: 'stock_snapshot', arguments: { sku: 'SKU-9999', warehouse: 'WH-EAST' } }).result.isError, true);
  assert.equal(call('tools/call', { name: 'missing' }).error.code, -32602);
  assert.equal(call('tools/call', { name: 'stock_snapshot', arguments: { sku: 'SKU-0042', warehouse: 'WH-EAST', path: '/tmp' } }).error.code, -32602);
  assert.equal(call('tools/call', { name: 'stock_snapshot', arguments: { sku: '../etc/passwd', warehouse: 'WH-EAST' } }).error.code, -32602);
  assert.equal(call('unknown').error.code, -32601);
  assert.equal(respond({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('stdio MCP continues after malformed JSON and rejects input above 64 KiB', () => {
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' });
  const result = spawnSync(process.execPath, [server], {
    input: `bad-json\n${ping}`,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  const replies = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies[0].error.code, -32700);
  assert.deepEqual(replies[1], { jsonrpc: '2.0', id: 2, result: {} });

  const oversized = spawnSync(process.execPath, [server], {
    input: 'x'.repeat(MAX_LINE_BYTES + 1),
    encoding: 'utf8'
  });
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /exceeds 64 KiB/);
});

test('pinned MCP SDK completes initialize, list, success, and error roundtrip', async () => {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js')
  ]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [server] });
  const client = new Client({ name: 'stockpilot-test', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['stock_snapshot', 'unavailable_snapshot']);
    const ok = await client.callTool({
      name: 'stock_snapshot', arguments: { sku: 'SKU-0042', warehouse: 'WH-EAST' }
    });
    const unavailable = await client.callTool({ name: 'unavailable_snapshot', arguments: {} });
    assert.equal(ok.isError, false);
    assert.equal(ok.structuredContent.on_hand, 312);
    assert.equal(unavailable.isError, true);
  } finally {
    await client.close();
  }
});

test('delegation contract pins one specialist and scoped expectations only', () => {
  const { loadComponentExpectations } = require('../../../agentops-cli/src/lib/copilot/component-evidence');
  const profile = fs.readFileSync(specialist, 'utf8');
  const frontmatter = profile.split('---')[1];
  const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
  const expectations = loadComponentExpectations(expectationsFile);
  assert.match(profile, /name: stock-risk-auditor/);
  assert.match(frontmatter, /tools: \['read'\]/);
  assert.doesNotMatch(frontmatter, /\b(?:bash|write|web)\b/i);
  assert.deepEqual(contract.configuration.workspaceAgents, ['stock-risk-auditor']);
  assert.deepEqual(contract.expectedSequence.map(row => row.name), [
    'stock_snapshot', 'unavailable_snapshot', 'stock-risk-auditor'
  ]);
  assert.equal(contract.coverage.expectedCountsProveStimulusContractOnly, true);
  assert.equal(contract.coverage.semanticOrderRequiresLedgerAudit, true);
  assert.equal(contract.coverage.globalCompleteness, 'unknown');
  assert.deepEqual(expectations.components.agents, { expected: 1, supported: true });
  assert.deepEqual(expectations.components.tools, { expected: 3, supported: true });
  assert.deepEqual(expectations.components.skills, { expected: 0, supported: false });
});

test('semantic ledger audit requires MCP success, MCP failure, then the named specialist', () => {
  const events = [
    { EventName: 'tool.execution_complete', McpServerName: 'stockpilot-readonly', McpToolName: 'stock_snapshot', Status: 'completed' },
    { EventName: 'tool.execution_complete', McpServerName: 'stockpilot-readonly', McpToolName: 'unavailable_snapshot', Status: 'failed' },
    { EventName: 'subagent.started', SubAgentName: 'stock-risk-auditor', Status: 'started' },
    { EventName: 'subagent.completed', SubAgentName: 'stock-risk-auditor', Status: 'completed' }
  ];
  const spans = [{ ModelActual: 'synthetic-model', InputTokens: 0, OutputTokens: 1 }];
  assert.equal(audit(events, spans).passed, true);
  assert.equal(audit([], spans).passed, false); // fabricated final text has no receipts to audit
  assert.equal(audit([events[0], events[2], events[1], events[3]], spans).checks.orderedMcpThenDelegation, false);
  assert.equal(audit(events.slice(0, 2), spans).checks.namedSpecialistCompleted, false);
  const fallback = events.map(row => row.SubAgentName ? { ...row, SubAgentName: 'fallback-agent' } : row);
  assert.equal(audit(fallback, spans).checks.namedSpecialistCompleted, false);
  assert.equal(audit(fallback, spans).checks.noUnexpectedSubagents, false);
  assert.equal(audit(events.map(row => ({ ...row, ContentCaptureMode: 'restricted' })), spans).checks.metadataPrivacy, false);
  assert.equal(audit([...events, { EventName: 'skill.invoked', SkillName: 'host-skill' }], spans).checks.noSkillsActivated, false);
  assert.equal(audit(events, [{ ModelActual: 'synthetic-model', InputTokens: null, OutputTokens: null }]).checks.modelProvenance, false);
});
