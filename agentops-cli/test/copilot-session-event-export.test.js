const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { projectSessionEvents, writeSessionEvents } = require('../src/lib/copilot/session-event-export');

test('session event export links observed reference reads without exporting event payloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-event-export-'));
  const reference = '.agents/skills/other/references/runbook.md';
  try {
    fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agentops', 'attachment.json'), JSON.stringify({
      architecture: { skills: [{ references: [{ path: reference }] }] }
    }));
    const events = [
      { type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'PRIVATE_PROMPT_MARKER' } },
      { type: 'skill.context_delivered_ref', timestamp: '2026-01-01T00:00:01Z', data: { source: 'skill-other', prefix: 'PRIVATE_REFERENCE_CONTENT' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02Z', parentId: 'turn-parent', data: { toolCallId: 'call-reference', toolName: 'view', arguments: { path: path.join(root, reference) } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03Z', data: { toolCallId: 'call-reference', result: 'PRIVATE_TOOL_RESULT' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:03Z', data: { toolCallId: 'call-mcp', toolName: 'hindsight-hindsight_search_knowledge_pages', mcpServerName: 'hindsight', mcpToolName: 'hindsight_search_knowledge_pages', arguments: { query: 'PRIVATE_MCP_ARGUMENT' } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:04Z', data: { toolCallId: 'call-shell', toolName: 'bash', arguments: { command: 'python scripts/run.py --token PRIVATE_ARGUMENT' } } },
      { type: 'assistant.message', timestamp: '2026-01-01T00:00:05Z', data: { content: 'PRIVATE_ANSWER' } }
    ];
    const rows = projectSessionEvents(events, { sessionId: 'session-synthetic', runId: 'run-synthetic', repoRoot: root });
    assert.equal(rows.length, 5);
    assert.equal(rows[0].EventName, 'skill.context_delivered_ref');
    assert.equal(rows[0].SkillName, 'other');
    assert.equal(rows[1].ReferenceName, reference);
    assert.equal(rows[1].ToolCallId, 'call-reference');
    assert.equal(rows[1].ParentEventId, 'turn-parent');
    assert.equal(rows[3].McpServerName, 'hindsight');
    assert.equal(rows[3].McpToolName, 'hindsight_search_knowledge_pages');
    assert.equal(rows[3].ToolCallId, 'call-mcp');
    assert.equal(rows[4].CommandName, 'python');
    assert.equal(rows[4].ToolCallId, 'call-shell');
    assert.ok(rows.every(row => row.TraceId === '' && row.PrivacyMode === 'strict' && row.ContentCaptureMode === 'off'));
    const serialized = JSON.stringify(rows);
    for (const privateValue of ['PRIVATE_PROMPT_MARKER', 'PRIVATE_REFERENCE_CONTENT', 'PRIVATE_TOOL_RESULT', 'PRIVATE_ANSWER', 'PRIVATE_ARGUMENT', 'PRIVATE_MCP_ARGUMENT', 'run.py']) {
      assert.ok(!serialized.includes(privateValue), `metadata export leaked ${privateValue}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session event export omits undeclared references and writes a private non-overwriting file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-event-export-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-event-output-'));
  try {
    const rows = projectSessionEvents([
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00Z', data: { toolCallId: 'call-1', toolName: 'view', arguments: { path: '/private/other.md' } } },
      { type: 'tool.execution_start', timestamp: 'not-a-date', data: { toolCallId: 'call-2', toolName: 'view', arguments: { path: '/private/other.md' } } }
    ], { sessionId: 'session-synthetic', runId: 'run-synthetic', repoRoot: root, referencePaths: new Set() });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ReferenceName, '');
    const written = writeSessionEvents([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00Z', data: { name: 'other' } }
    ], 'session-synthetic', 'run-synthetic', outputDir, { repoRoot: root, referencePaths: new Set() });
    assert.equal(written.rows, 1);
    assert.equal(path.basename(written.output), 'AgentOpsEvents_CL.jsonl');
    assert.equal(fs.statSync(written.output).mode & 0o777, 0o600);
    assert.throws(() => writeSessionEvents([], 'session-synthetic', 'run-synthetic', outputDir, { repoRoot: root, referencePaths: new Set() }), /EEXIST/);
    assert.throws(() => projectSessionEvents([], { sessionId: 'bad id', runId: 'run-synthetic', repoRoot: root }), /safe session ID/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('session event export links a successful direct cat of a declared reference without exporting its command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-event-export-'));
  const reference = '.github/skills/fixture-run/references/guide.md';
  try {
    fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agentops', 'attachment.json'), JSON.stringify({
      architecture: { skills: [{ references: [{ path: reference }] }] }
    }));
    const command = `cat ${reference}`;
    const rows = projectSessionEvents([
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', data: {
        toolCallId: 'call-reference', toolName: 'bash', arguments: { command }
      } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02Z', data: {
        toolCallId: 'call-reference', toolName: 'bash', success: true, result: 'PRIVATE_REFERENCE_CONTENT'
      } }
    ], { sessionId: 'session-synthetic', runId: 'run-synthetic', repoRoot: root });
    const start = rows.find(row => row.EventName === 'tool.execution_start');
    const complete = rows.find(row => row.EventName === 'tool.execution_complete');
    assert.equal(start.ReferenceName, '');
    assert.equal(complete.ReferenceName, reference);
    assert.equal(complete.ToolCallId, 'call-reference');
    const serialized = JSON.stringify(rows);
    assert.ok(!serialized.includes(command));
    assert.ok(!serialized.includes('PRIVATE_REFERENCE_CONTENT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session event export does not mark failed, compound, or undeclared shell reads as reference use', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-event-export-'));
  const reference = '.github/skills/fixture-run/references/guide.md';
  try {
    fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agentops', 'attachment.json'), JSON.stringify({
      architecture: { skills: [{ references: [{ path: reference }] }] }
    }));
    const calls = [
      { id: 'call-failed', command: `cat ${reference}`, success: false, exitCode: 1 },
      { id: 'call-compound', command: `cat ${reference} && printf PRIVATE_MARKER`, success: true, exitCode: 0 },
      { id: 'call-undeclared', command: 'cat private/unlisted.md', success: true, exitCode: 0 }
    ];
    const events = calls.flatMap(call => [
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', data: {
        toolCallId: call.id, toolName: 'bash', arguments: { command: call.command }
      } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02Z', data: {
        toolCallId: call.id, toolName: 'bash', success: call.success,
        shellExecution: { exitCode: call.exitCode }
      } }
    ]);
    const rows = projectSessionEvents(events, { sessionId: 'session-synthetic', runId: 'run-synthetic', repoRoot: root });
    const completions = rows.filter(row => row.EventName === 'tool.execution_complete');
    assert.equal(completions.length, 3);
    assert.ok(completions.every(row => row.ReferenceName === ''));
    assert.ok(!JSON.stringify(rows).includes('PRIVATE_MARKER'));
    assert.ok(!JSON.stringify(rows).includes('private/unlisted.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('session event export projects parent and subagent joins and records shell exit failures', () => {
  const events = [
    { id: 'parent-event', type: 'subagent.started', timestamp: '2026-01-01T00:00:00Z', agentId: 'worker-id', data: { toolCallId: 'delegate-call', agentName: 'fixture-worker' } },
    { id: 'child-event', parentId: 'parent-event', type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01Z', agentId: 'worker-id', data: { toolCallId: 'python-call', toolName: 'bash', success: true, shellExecution: { exitCode: 1, command: 'python fail.py' } } },
    { id: 'parent-tool', type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02Z', agentId: 'root-id', data: { toolCallId: 'delegate-call', toolName: 'task' } }
  ];
  const rows = projectSessionEvents(events, { sessionId: 'session-synthetic', runId: 'run-synthetic', referencePaths: new Set() });
  assert.equal(rows[0].AgentId, 'worker-id');
  assert.equal(rows[1].AgentName, 'fixture-worker');
  assert.equal(rows[1].ParentEventId, rows[0].EventId);
  assert.equal(rows[1].ParentToolCallId, '');
  assert.equal(rows[1].ExitCode, 1);
  assert.equal(rows[1].Status, 'failed');
  assert.equal(rows[2].AgentId, 'root-id');
  const subagentRows = projectSessionEvents([
    { type: 'subagent.started', timestamp: '2026-01-01T00:00:00Z', agentId: 'child-id', data: { toolCallId: 'delegate-call', agentName: 'fixture-worker' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', agentId: 'root-id', data: { toolCallId: 'delegate-call', toolName: 'task' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02Z', agentId: 'child-id', data: { toolCallId: 'child-tool', parentToolCallId: 'delegate-call', toolName: 'view' } }
  ], { sessionId: 'session-synthetic', runId: 'run-synthetic', referencePaths: new Set() });
  assert.equal(subagentRows[2].ParentToolCallId, 'delegate-call');
  assert.equal(subagentRows[2].ParentAgentId, 'root-id');
});

test('session event export carries only safe start metadata onto completion rows', () => {
  const rows = projectSessionEvents([
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00Z', agentId: 'worker', data: {
      toolCallId: 'call-fail', toolName: 'bash', parentToolCallId: 'delegate',
      arguments: { command: 'python3 .github/skills/sample/scripts/fail.py --secret PRIVATE_ARGUMENT' }
    } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', data: {
      toolCallId: 'call-mcp', toolName: 'agentops-fixture-lookup_fixture',
      mcpServerName: 'agentops-fixture', mcpToolName: 'lookup_fixture', arguments: { key: 'PRIVATE_MCP_ARGUMENT' }
    } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02Z', agentId: 'worker', data: {
      toolCallId: 'call-fail', success: true, shellExecution: { exitCode: 1 }, result: 'PRIVATE_TOOL_RESULT'
    } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03Z', data: {
      toolCallId: 'call-mcp', success: true, result: 'PRIVATE_MCP_RESULT'
    } }
  ], { sessionId: 'session-synthetic', runId: 'run-synthetic', referencePaths: new Set() });
  const failure = rows.find(row => row.EventName === 'tool.execution_complete' && row.ExitCode === 1);
  const mcp = rows.find(row => row.EventName === 'tool.execution_complete' && row.ToolCallId === 'call-mcp');
  assert.equal(failure.CommandName, 'python3');
  assert.equal(failure.ParentToolCallId, 'delegate');
  assert.equal(failure.Status, 'failed');
  assert.equal(failure.ErrorType, 'shell_exit_code');
  assert.equal(mcp.McpServerName, 'agentops-fixture');
  assert.equal(mcp.McpToolName, 'lookup_fixture');
  assert.equal(Object.hasOwn(mcp, 'ExitCode'), false);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_ARGUMENT|PRIVATE_MCP_ARGUMENT|PRIVATE_TOOL_RESULT|PRIVATE_MCP_RESULT|fail\.py/);
});

test('session event export preserves requested model, provider, and measured usage tokens distinctly from absent', () => {
  const rows = projectSessionEvents([
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:00Z', data: {
      toolCallId: 'call-full', requestedModel: 'gpt-requested', provider: 'fixture-provider',
      tokenDetails: {
        input: { tokenCount: 123 }, output: { tokenCount: 45 },
        cache_read: { tokenCount: 10 }, cache_write: { tokenCount: 5 }
      }
    } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01Z', data: { toolCallId: 'call-unknown' } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02Z', data: {
      toolCallId: 'call-zero',
      tokenDetails: { input: { tokenCount: 0 }, output: { tokenCount: 0 } }
    } }
  ], { sessionId: 'session-synthetic', runId: 'run-synthetic', referencePaths: new Set() });
  const [full, unknown, zero] = rows;

  assert.equal(full.ModelRequested, 'gpt-requested');
  assert.equal(full.Provider, 'fixture-provider');
  assert.equal(full.InputTokens, 123);
  assert.equal(full.OutputTokens, 45);
  assert.equal(full.CacheReadTokens, 10);
  assert.equal(full.CacheWriteTokens, 5);

  assert.equal(unknown.ModelRequested, '');
  assert.equal(unknown.Provider, '');
  assert.equal(unknown.InputTokens, null, 'unmeasured token count must stay null, not collapse to 0');
  assert.equal(unknown.OutputTokens, null);
  assert.equal(unknown.CacheReadTokens, null);
  assert.equal(unknown.CacheWriteTokens, null);
  assert.match(JSON.stringify(unknown), /"InputTokens":null/);

  assert.equal(zero.InputTokens, 0, 'a measured zero token count must remain 0, distinct from absent/null');
  assert.equal(zero.OutputTokens, 0);
  assert.equal(zero.CacheReadTokens, null);
});
