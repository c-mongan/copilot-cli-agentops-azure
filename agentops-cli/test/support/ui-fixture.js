const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Content markers planted in every field that can carry prompt, argument, result or
// error text. Privacy tests assert none of them reaches a UI API response.
const SECRETS = Object.freeze([
  'PROMPT_CANARY_7f3a',
  'ARG_CANARY_91bc',
  'RESULT_CANARY_02de',
  'ERROR_CANARY_c4d1',
  'ASSISTANT_CANARY_5e6f',
  'REASONING_CANARY_aa01',
  'secret-parent-dir',
  'secret-branch-name'
]);

const FAILED_ID = 'fa000000-0000-4000-8000-000000000001';
const OPEN_ID = 'b0000000-0000-4000-8000-000000000002';
const LEDGER_ONLY_ID = 'c0000000-0000-4000-8000-000000000003';
const RUN_ID = 'native_run_1790000000000_aaaaaaaaaa';
const LEDGER_ONLY_RUN_ID = 'native_run_1790000000001_bbbbbbbbbb';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();

// Mirrors the field layout of real Copilot CLI events.jsonl lines ("type" first).
function line(type, ms, data, extra = {}) {
  return JSON.stringify({ type, data, id: `evt-${type}-${ms}`, timestamp: at(ms), parentId: null, ...extra });
}

function failedSessionLines() {
  return [
    line('session.start', 0, {
      sessionId: FAILED_ID,
      version: 1,
      producer: 'copilot-agent',
      copilotVersion: '1.0.93-4',
      startTime: at(0),
      selectedModel: 'claude-haiku-4.5',
      context: { cwd: '/Users/someone/secret-parent-dir/demo-repo', gitRoot: '/Users/someone/secret-parent-dir/demo-repo', branch: 'secret-branch-name', repository: 'someone/secret-parent-dir' }
    }),
    line('user.message', 100, { content: 'PROMPT_CANARY_7f3a: run curl against the API', transformedContent: 'PROMPT_CANARY_7f3a', attachments: [] }),
    line('hook.start', 200, { hookInvocationId: 'hook-1', hookType: 'userPromptTransformed', input: { prompt: 'PROMPT_CANARY_7f3a' } }),
    line('hook.end', 20200, { hookInvocationId: 'hook-1', hookType: 'userPromptTransformed', success: true, output: { prompt: 'PROMPT_CANARY_7f3a' } }),
    line('assistant.turn_start', 21000, { turnId: '0', interactionId: 'i-1' }),
    line('assistant.reasoning', 21500, { content: 'REASONING_CANARY_aa01' }),
    line('assistant.message', 25000, { content: 'ASSISTANT_CANARY_5e6f', toolRequests: [{ toolCallId: 'toolu_ok', name: 'bash', arguments: { command: 'echo ARG_CANARY_91bc' } }] }),
    line('tool.execution_start', 26000, { toolCallId: 'toolu_ok', toolName: 'bash', turnId: '0', arguments: { command: 'echo ARG_CANARY_91bc', description: 'ARG_CANARY_91bc' } }),
    line('tool.execution_complete', 38000, { toolCallId: 'toolu_ok', success: true, result: { content: 'RESULT_CANARY_02de', detailedContent: 'RESULT_CANARY_02de' }, shellExecution: { exitCode: 0 }, toolTelemetry: { properties: { command: 'ARG_CANARY_91bc' } } }),
    line('tool.execution_start', 38100, { toolCallId: 'toolu_denied', toolName: 'bash', turnId: '0', arguments: { command: 'curl https://example.invalid/ARG_CANARY_91bc' } }),
    line('tool.execution_complete', 38157, { toolCallId: 'toolu_denied', success: false, error: { code: 'denied', message: 'ERROR_CANARY_c4d1: the user denied curl' } }),
    line('tool.execution_start', 38200, { toolCallId: 'toolu_weird', toolName: 'rm -rf ARG_CANARY_91bc', turnId: '0', arguments: {} }),
    line('tool.execution_complete', 38300, { toolCallId: 'toolu_weird', success: true, result: { content: 'RESULT_CANARY_02de' }, shellExecution: { exitCode: 2 } }),
    line('assistant.turn_end', 39000, { turnId: '0' }),
    '{"type":"assistant.message","data":{"content":"truncated ASSISTANT_CANARY_5e6f',
    line('assistant.turn_start', 40000, { turnId: '1' }),
    line('assistant.turn_end', 42100, { turnId: '1' }),
    line('session.shutdown', 44000, {
      shutdownType: 'routine',
      totalPremiumRequests: 0.33,
      currentModel: 'claude-haiku-4.5',
      codeChanges: { filesModified: ['/Users/someone/secret-parent-dir/demo-repo/ARG_CANARY_91bc.txt'] },
      modelMetrics: {
        'claude-haiku-4.5': { requests: { count: 2, cost: 0.33 }, usage: { inputTokens: 60000, outputTokens: 500, cacheReadTokens: 50000, cacheWriteTokens: 8000 } }
      }
    })
  ];
}

function openSessionLines() {
  return [
    line('session.start', 0, { sessionId: OPEN_ID, copilotVersion: '1.0.93-4', selectedModel: 'gpt-6.1-sol', context: { cwd: '/work/other-repo' } }),
    line('user.message', 10, { content: 'PROMPT_CANARY_7f3a' }),
    line('assistant.turn_start', 20, { turnId: '0' }),
    line('tool.execution_start', 30, { toolCallId: 'call_view', toolName: 'view', turnId: '0', arguments: { path: '/Users/someone/secret-parent-dir/ARG_CANARY_91bc' } }),
    line('tool.execution_complete', 530, { toolCallId: 'call_view', success: true, result: { content: 'RESULT_CANARY_02de' } })
  ];
}

function ledgerRow(fields) {
  return JSON.stringify({
    TimeGenerated: at(0), TraceId: 'trace-a', SpanId: '', ParentSpanId: '', ToolName: '', ToolCallId: '', Model: '',
    InputTokens: 0, OutputTokens: 0, ErrorType: '', DurationMs: 0, Outcome: 'ok', SpanName: 'agentops.span', OperationName: 'agentops.span',
    ...fields
  });
}

function failedLedgerRows() {
  const chat1 = ledgerRow({ TimeGenerated: at(21100), SpanId: 'chat0001', ParentSpanId: 'root0001', Model: 'claude-haiku-4.5', InputTokens: 29820, OutputTokens: 441, CacheReadTokens: 25000, DurationMs: 4000, OperationName: 'chat' });
  return [
    ledgerRow({ TimeGenerated: at(0), SpanId: 'root0001', InputTokens: 60000, OutputTokens: 500, DurationMs: 44000, OperationName: 'invoke_agent' }),
    chat1,
    chat1,
    ledgerRow({ TimeGenerated: at(40050), SpanId: 'chat0002', ParentSpanId: 'root0001', Model: 'claude-haiku-4.5', InputTokens: 30180, OutputTokens: 59, CacheReadTokens: 25000, DurationMs: 2000, OperationName: 'chat' }),
    ledgerRow({ TimeGenerated: at(26000), SpanId: 'tool0001', ParentSpanId: 'root0001', ToolName: 'bash', ToolCallId: 'toolu_ok', DurationMs: 12000, OperationName: 'execute_tool' }),
    ledgerRow({ TimeGenerated: at(26000), SpanId: 'tool0001', ParentSpanId: 'tool0001', ToolName: 'bash', ToolCallId: 'toolu_ok', DurationMs: 12000, SpanName: 'agentops.event', OperationName: 'agentops.event' })
  ];
}

function ledgerOnlyRows() {
  return [
    ledgerRow({ TraceId: 'trace-b', TimeGenerated: at(-3600000), SpanId: 'root0002', InputTokens: 1000, OutputTokens: 10, DurationMs: 5000, OperationName: 'invoke_agent' }),
    ledgerRow({ TraceId: 'trace-b', TimeGenerated: at(-3599000), SpanId: 'tool0002', ParentSpanId: 'root0002', ToolName: 'grep', ToolCallId: 'call_grep', DurationMs: 300, Outcome: 'failed', ErrorType: 'timeout', OperationName: 'execute_tool' })
  ];
}

function writeRun(agentOpsHome, runId, sessionId, rows, createdMs) {
  const dir = path.join(agentOpsHome, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ managedBy: 'agentops', schemaVersion: 1, runId, sessionId, repositoryRootHash: 'abcdef123456', createdAt: at(createdMs) }));
  fs.writeFileSync(path.join(dir, 'AgentOpsSpans_CL.jsonl'), `${rows.join('\n')}\n`);
}

// Creates COPILOT_HOME and AGENTOPS_HOME trees in the OS temp dir, so repo-walking
// tests never race with them, and returns their paths plus a cleanup function.
function createUiFixture(name = 'ui') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agentops-ui-fixture-${name}-`));
  const copilotHome = path.join(root, 'copilot');
  const agentOpsHome = path.join(root, 'agentops');
  const writeSession = (id, lines, mtimeMs) => {
    const dir = path.join(copilotHome, 'session-state', id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  };
  writeSession(FAILED_ID, failedSessionLines(), T0 + 44000);
  writeSession(OPEN_ID, openSessionLines(), T0 - 86400000);
  fs.mkdirSync(path.join(copilotHome, 'session-state', 'not a session id'), { recursive: true });
  writeRun(agentOpsHome, RUN_ID, FAILED_ID, failedLedgerRows(), 0);
  writeRun(agentOpsHome, LEDGER_ONLY_RUN_ID, LEDGER_ONLY_ID, ledgerOnlyRows(), -3600000);
  return {
    root,
    copilotHome,
    agentOpsHome,
    now: () => T0 + 3600000,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  };
}

module.exports = {
  FAILED_ID,
  LEDGER_ONLY_ID,
  LEDGER_ONLY_RUN_ID,
  OPEN_ID,
  RUN_ID,
  SECRETS,
  T0,
  createUiFixture,
  line
};
