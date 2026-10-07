const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyRunStatus,
  classifyToolCompletionEvent,
  classifyToolOutcome,
  countNativeSpans,
  sessionRunStatus,
  sessionStatusSignals
} = require('../src/lib/copilot/run-status');

test('run status: tool outcomes separate denials, failures and non-zero shell exits', () => {
  assert.equal(classifyToolOutcome({ success: true }), 'ok');
  assert.equal(classifyToolOutcome({ success: true, exitCode: 0 }), 'ok');
  assert.equal(classifyToolOutcome({ success: true, exitCode: 1 }), 'nonzero_exit');
  assert.equal(classifyToolOutcome({ success: false, errorCode: 'denied' }), 'denied');
  assert.equal(classifyToolOutcome({ success: false, errorCode: 'USER_REJECTED' }), 'denied');
  assert.equal(classifyToolOutcome({ success: false, errorCode: 'timeout' }), 'failed');
  assert.equal(classifyToolOutcome({ success: false }), 'failed');
  assert.equal(classifyToolOutcome({ success: false, exitCode: 2 }), 'failed', 'a reported failure wins over the exit code');
  assert.equal(classifyToolCompletionEvent({ success: false, error: { code: 'denied', message: 'Permission denied' } }), 'denied');
  assert.equal(classifyToolCompletionEvent({ success: true, shellExecution: { exitCode: 1 } }), 'nonzero_exit');
  assert.equal(classifyToolCompletionEvent({}), 'ok');
});

test('run status: precedence is live, failed, incomplete, attention, ok', () => {
  assert.deepEqual(classifyRunStatus({}), { status: 'ok', statusLabel: 'Completed', statusReasons: [] });
  assert.deepEqual(classifyRunStatus({ denials: 1 }), { status: 'attention', statusLabel: 'Needs attention', statusReasons: ['denials'] });
  assert.deepEqual(classifyRunStatus({ nonZeroExits: 2 }), { status: 'attention', statusLabel: 'Needs attention', statusReasons: ['nonzero_exits'] });
  assert.equal(classifyRunStatus({ denials: 1, ended: false }).status, 'incomplete');
  assert.deepEqual(classifyRunStatus({ failures: 1, denials: 1 }), { status: 'failed', statusLabel: 'Failed', statusReasons: ['failures', 'denials'] });
  assert.deepEqual(classifyRunStatus({ runErrored: true, denials: 1 }).statusReasons, ['run_errored', 'denials']);
  assert.equal(classifyRunStatus({ runErrored: true }).status, 'failed');
  assert.equal(classifyRunStatus({ failures: 3, live: true }).status, 'live');
});

test('run status: the QA session shape (denied view, npm test exit 1) needs attention, not failure', () => {
  const events = [
    { type: 'session.start', data: {} },
    { type: 'tool.execution_complete', data: { toolCallId: 'a', success: false, error: { code: 'denied', message: 'Permission denied' } } },
    { type: 'tool.execution_complete', data: { toolCallId: 'b', success: true, shellExecution: { exitCode: 1 } } },
    { type: 'tool.execution_complete', data: { toolCallId: 'c', success: true } },
    { type: 'session.shutdown', data: {} }
  ];
  const result = sessionRunStatus(events);
  assert.equal(result.status, 'attention');
  assert.equal(result.statusLabel, 'Needs attention');
  assert.deepEqual(result.statusReasons, ['denials', 'nonzero_exits']);
  assert.deepEqual(result.signals, { toolCalls: 3, toolFailures: 0, denials: 1, nonZeroExits: 1, hookFailures: 0, subagentFailures: 0, failures: 0 });
  assert.equal(sessionRunStatus(events, { runErrored: true }).status, 'failed');
  assert.equal(sessionRunStatus(events.slice(0, -1)).status, 'incomplete');
  assert.equal(sessionRunStatus(events.slice(0, -1), { ended: true }).status, 'attention');
});

test('run status: failed tools, hooks and sub-agents are failures', () => {
  const signals = sessionStatusSignals([
    { type: 'tool.execution_complete', data: { success: false, error: { code: 'timeout' } } },
    { type: 'hook.end', data: { success: false } },
    { type: 'hook.end', data: { success: true } },
    { type: 'subagent.failed', data: {} },
    { type: 'session.shutdown', data: {} }
  ]);
  assert.equal(signals.failures, 3);
  assert.equal(signals.ended, true);
  assert.equal(sessionRunStatus([{ type: 'subagent.failed', data: {} }], { ended: true }).status, 'failed');
});

test('run status: native span count dedupes by trace and span ID and skips span-event rows', () => {
  const rows = [];
  for (let index = 0; index < 16; index += 1) {
    rows.push({ TraceId: 't1', SpanId: `s${index}`, SpanName: 'agentops.span' });
  }
  rows.push({ TraceId: 't1', SpanId: 's0', SpanName: 'agentops.span' });
  for (let index = 0; index < 40; index += 1) {
    rows.push({ TraceId: 't1', SpanId: `s${index % 16}`, SpanName: 'agentops.event' });
  }
  assert.equal(rows.length, 57);
  assert.equal(countNativeSpans(rows), 16);
  assert.equal(countNativeSpans([{ traceId: 'a', spanId: '1' }, { traceId: 'a', spanId: '1' }, { traceId: 'b', spanId: '1' }]), 2, 'canonical camelCase spans dedupe too');
  assert.equal(countNativeSpans([]), 0);
});

test('native span counts accept actual operation names and require trace/span identity', () => {
  assert.equal(countNativeSpans([{ TraceId: 't1', SpanId: 's1', SpanName: 'gen_ai.chat', LinkType: 'native-session' }]), 1);
  assert.equal(countNativeSpans([{}, { SpanId: 's1' }, { TraceId: 't1' }]), 0);
  assert.equal(countNativeSpans([
    { TraceId: 't1', SpanId: 's1', SpanName: 'gen_ai.chat', LinkType: 'native-session' },
    { TraceId: 't1', SpanId: 's1', SpanName: 'gen_ai.chat' },
    { TraceId: 't1', SpanId: 's1', SpanName: 'tool.start', LinkType: 'span-event' },
    { traceId: 't2', spanId: 's1', spanName: 'tool.execute' },
    { SpanId: 's2', SpanName: 'missing-trace' },
    { TraceId: 't1', SpanName: 'missing-span' },
    {}, null
  ]), 2);
});
