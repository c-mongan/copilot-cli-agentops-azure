const test = require('node:test');
const assert = require('node:assert/strict');

const { rollupSpanRows } = require('../src/lib/rollup/span-to-agentops-tables');

function sdkSpan(sequence, eventName, attributes = {}, options = {}) {
  return {
    TimeGenerated: `2026-08-03T10:00:0${sequence}.000Z`,
    Name: eventName,
    OperationId: 'trace-sdk-rollup',
    Id: `span-${sequence}`,
    DurationMs: options.durationMs || 0,
    Status: options.status || { code: 'OK' },
    Properties: {
      'agentops.schema.version': '2',
      'agentops.run.id': 'run-sdk-rollup',
      'agentops.session.id': 'session-sdk-rollup',
      'agentops.surface': 'sdk',
      'agentops.privacy.mode': 'strict',
      'agentops.content_capture.mode': 'off',
      'agentops.event.sequence': sequence,
      'agentops.custom_event_id': `event_exact_${sequence}`,
      'agentops.parent_event_id': sequence > 1 ? `event_exact_${sequence - 1}` : '',
      'agentops.event.name': eventName,
      'gen_ai.operation.name': eventName,
      ...attributes
    }
  };
}

test('canonical SDK spans retain ordered evidence through AgentOps table rollup', () => {
  const rows = [
    sdkSpan(1, 'subagent.started', {
      'agentops.agent.name': 'orchestrator',
      'agentops.parent_agent.name': 'orchestrator',
      'agentops.sub_agent.name': 'reviewer'
    }),
    sdkSpan(2, 'skill.invoked', {
      'agentops.skill.name': 'qa',
      'agentops.content_capture.signal': true,
      'agentops.content.kind': 'prompt',
      'agentops.content.action': 'dropped',
      'agentops.content.dropped_bytes': 27,
      'agentops.content.secret_like': true,
      content: 'SECRET_POISON_MUST_NOT_SURVIVE'
    }),
    sdkSpan(3, 'tool.execution_start', {
      'gen_ai.tool.name': 'shell',
      'agentops.mcp.server': 'azure',
      'agentops.mcp.tool': 'monitor_query',
      'agentops.command.name': 'node',
      'agentops.script.name': 'check-results.js',
      'agentops.tool.args_schema_hash': 'schema_safe_1'
    }),
    sdkSpan(4, 'tool.execution_complete', {
      'gen_ai.tool.name': 'shell',
      'agentops.mcp.server': 'azure',
      'agentops.mcp.tool': 'monitor_query',
      'agentops.command.name': 'node',
      'agentops.script.name': 'check-results.js',
      'agentops.tool.args_schema_hash': 'schema_safe_1',
      'agentops.tool.result_size_bytes': 123
    }, { durationMs: 250 }),
    sdkSpan(5, 'assistant.usage', {
      'gen_ai.response.model': 'gpt-test',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 20,
      'gen_ai.usage.reasoning.output_tokens': 5,
      'gen_ai.usage.cache_read.input_tokens': 7,
      'gen_ai.usage.cache_creation.input_tokens': 3,
      'gen_ai.usage.total_tokens': 135,
      'agentops.tools.count': 1,
      'github.copilot.cost': 0.25,
      'agentops.cost.estimated_usd': 0.5,
      'github.copilot.premium_requests': 2,
      'github.copilot.aiu.nano': 900,
      'agentops.api.duration_ms': 41,
      'agentops.lines.added': 8,
      'agentops.lines.removed': 2,
      'agentops.files.edited_count': 1,
      'agentops.repo.hash': 'repo_safe_hash',
      'agentops.branch.hash': 'branch_safe_hash',
      'agentops.workspace.hash': 'workspace_safe_hash'
    }, { durationMs: 42 }),
    sdkSpan(6, 'permission.completed', {
      'agentops.permission.kind': 'mcp',
      'agentops.permission.decision': 'denied-by-rules',
      'agentops.outcome': 'denied-by-rules'
    })
  ];

  const { tables } = rollupSpanRows(rows, { baseTime: '2026-08-03T10:00:00.000Z' });
  const events = tables.AgentOpsEvents_CL;
  const run = tables.AgentOpsRunSummary_CL[0];

  assert.deepEqual(events.map(row => row.Sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(events.map(row => row.EventId), [1, 2, 3, 4, 5, 6].map(value => `event_exact_${value}`));
  assert.deepEqual(events.map(row => row.ParentEventId), ['', 'event_exact_1', 'event_exact_2', 'event_exact_3', 'event_exact_4', 'event_exact_5']);
  assert.equal(events[2].McpServerName, 'azure');
  assert.equal(events[2].McpToolName, 'monitor_query');
  assert.equal(events[2].CommandName, 'node');
  assert.equal(events[2].ScriptName, 'check-results.js');
  assert.equal(events[4].ReasoningTokens, 5);
  assert.equal(events[4].CacheReadTokens, 7);
  assert.equal(events[4].CacheWriteTokens, 3);
  assert.equal(events[4].TotalTokens, 135);
  assert.equal(events[4].EstimatedCostUsd, 0.5);
  assert.equal(events[4].FilesModified, 1);
  assert.equal(events[4].WorkingDirectoryHash, 'workspace_safe_hash');
  assert.equal(events[5].PermissionDecision, 'denied-by-rules');
  assert.equal(events[5].Status, 'failed');
  assert.equal(events[1].ContentDroppedBytes, 27);
  assert.equal(events[1].ContentAction, 'dropped');
  assert.equal(events[1].SecretLike, true);

  assert.equal(run.InputTokens, 100);
  assert.equal(run.OutputTokens, 20);
  assert.equal(run.ReasoningTokens, 5);
  assert.equal(run.CacheReadTokens, 7);
  assert.equal(run.CacheCreationTokens, 3);
  assert.equal(run.EstimatedCostUsd, 0.5);
  assert.equal(run.ToolCount, 1);
  assert.equal(run.ToolDeniedCount, 1);
  assert.equal(run.FilesEditedCount, 1);
  assert.equal(run.RepoHash, 'repo_safe_hash');
  assert.equal(run.BranchHash, 'branch_safe_hash');
  assert.equal(run.ContentCaptureSignal, true);

  assert.equal(tables.AgentOpsToolCalls_CL.length, 1);
  assert.equal(tables.AgentOpsToolCalls_CL[0].ArgsSchemaHash, 'schema_safe_1');
  assert.equal(tables.AgentOpsToolCalls_CL[0].OutputSizeBytes, 123);
  assert.equal(tables.AgentOpsMcpCalls_CL.length, 1);
  assert.equal(tables.AgentOpsMcpCalls_CL[0].McpServerName, 'azure');
  assert.equal(tables.AgentOpsMcpCalls_CL[0].ToolName, 'monitor_query');
  assert.equal(tables.AgentOpsPrivacy_CL.length, 1);
  assert.equal(tables.AgentOpsPrivacy_CL[0].ContentKind, 'prompt');
  assert.equal(tables.AgentOpsPrivacy_CL[0].Action, 'dropped');
  assert.equal(tables.AgentOpsPrivacy_CL[0].DroppedCount, 1);
  assert.doesNotMatch(JSON.stringify(tables), /SECRET_POISON_MUST_NOT_SURVIVE|\"content\"/);
});
