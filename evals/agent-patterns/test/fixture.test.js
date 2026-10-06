'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { respond } = require('../fixtures/scripts/mcp');
const root = path.join(__dirname, '../fixtures');
const call = (method, params) => respond({ jsonrpc: '2.0', id: 1, method, params });

test('MCP advertises only two local tools and distinguishes tool failure from protocol error', () => {
  assert.deepEqual(call('tools/list').result.tools.map(tool => tool.name), ['status', 'unavailable']);
  assert.equal(call('tools/call', { name: 'status' }).result.isError, false);
  assert.equal(call('tools/call', { name: 'unavailable' }).result.isError, true);
  assert.equal(call('tools/call', { name: 'missing' }).error.code, -32602);
  assert.equal(call('tools/call', { name: 'status', arguments: { target: 'production' } }).error.code, -32602);
  assert.equal(call('unknown').error.code, -32601);
  assert.equal(respond({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('stdio framing survives malformed rows and refuses oversized input', () => {
  const server = path.join(root, 'scripts/mcp.js');
  const result = spawnSync(process.execPath, [server], { input: 'bad-json\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n', encoding: 'utf8' });
  assert.equal(result.status, 0);
  const replies = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies[0].error.code, -32700);
  assert.deepEqual(replies[1], { jsonrpc: '2.0', id: 2, result: {} });
  const oversized = spawnSync(process.execPath, [server], { input: 'x'.repeat(65537), encoding: 'utf8' });
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /exceeds 64 KiB/);
});

test('owned Node probe succeeds while the Python release gate rejects independently', () => {
  const probe = spawnSync(process.execPath, ['.github/skills/incident-evidence/scripts/probe.js'], { cwd: root, encoding: 'utf8' });
  const gate = spawnSync('python3', ['.github/skills/release-verification/scripts/gate.py'], { cwd: root, encoding: 'utf8' });
  assert.equal(probe.status, 0);
  assert.equal(JSON.parse(probe.stdout).probe, 'passed');
  assert.equal(gate.status, 7);
  assert.equal(JSON.parse(gate.stdout).release, 'rejected');
});

test('independent stimulus manifest is accepted without claiming global completeness', () => {
  const { loadComponentExpectations, componentEvidence } = require('../../../agentops-cli/src/lib/copilot/component-evidence');
  const manifest = loadComponentExpectations(path.join(__dirname, '../expectations.json'));
  const missing = componentEvidence([], [], manifest);
  assert.equal(missing.references.missing, 4);
  assert.equal(missing.agents.missing, 1);
  assert.equal(missing.skills.status, 'unknown');
  for (const skill of ['incident-evidence', 'release-verification']) {
    assert.ok(fs.existsSync(path.join(root, '.github/skills', skill, 'SKILL.md')));
  }
});

test('semantic audit rejects correct reference counts with the wrong delegation order', () => {
  const { audit } = require('../audit');
  const ref = '.github/skills/incident-evidence/references/';
  let serial = 0;
  const read = (name, agent = '') => ({ EventName: 'tool.execution_start', ReferenceName: ref + name, AgentName: agent, ToolCallId: 'reference-' + serial++ });
  const events = [
    ...['incident-evidence', 'release-verification'].map(SkillName => ({ EventName: 'skill.invoked', SkillName })),
    read('incident.md'), read('counter-evidence.md'), read('incident.md'),
    { EventName: 'subagent.started', SubAgentName: 'incident-triager' },
    read('incident.md', 'incident-triager'),
    { EventName: 'subagent.completed', SubAgentName: 'incident-triager', Status: 'completed' },
    ...[['status', 'completed'], ['unavailable', 'failed']].map(([McpToolName, Status]) => ({ EventName: 'tool.execution_complete', McpServerName: 'fixture', McpToolName, Status })),
    { EventName: 'tool.execution_complete', ToolCallId: 'gate-call', Status: 'failed' }
  ].flatMap(row => row.ReferenceName ? [row, { ...row, EventName: 'tool.execution_complete', Status: 'completed' }] : [row]);
  const spans = [
    { ScriptName: '.github/skills/incident-evidence/scripts/probe.js', LinkType: 'run-id-logical-link', Outcome: 'ok' },
    { ScriptName: '.github/skills/release-verification/scripts/gate.py', LinkType: 'run-id-logical-link', Outcome: 'unknown', ToolCallId: 'gate-call' },
    { ModelActual: 'synthetic-model', InputTokens: 0, OutputTokens: 1 }
  ];
  assert.equal(audit(events, spans).passed, true);
  const incorrect = [...events];
  const mainThird = incorrect.findIndex(row => row.ToolCallId === 'reference-2');
  const delegated = incorrect.findIndex(row => row.ToolCallId === 'reference-3');
  [incorrect[mainThird], incorrect[delegated]] = [incorrect[delegated], incorrect[mainThird]];
  assert.equal(audit(incorrect, spans).checks.orderedReferences, true);
  assert.equal(audit(incorrect, spans).passed, false);
  assert.equal(audit(events, spans.map(row => ({ ...row, InputTokens: null, OutputTokens: null }))).checks.modelProvenance, false);
  assert.equal(audit([...events, { ContentCaptureMode: 'restricted' }], spans).checks.metadataPrivacy, false);
  assert.equal(audit(events.slice(0, -1), spans).checks.pythonGateRejected, false);
  assert.equal(audit(events.filter(row => !(row.EventName === 'tool.execution_complete' && row.ToolCallId === 'reference-2')), spans).passed, false);
});
