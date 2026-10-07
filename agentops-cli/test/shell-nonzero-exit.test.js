const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SHELL_NONZERO_EXIT,
  enrichSpansWithSessionToolContext,
  spanRowsFromOtelSpans
} = require('../src/lib/copilot/session-span-export');
const { toGenAiSpans, toOtlpTraceRequest } = require('../src/lib/otel/genai-semconv');
const data = require('../src/lib/ui/data');

const SESSION_ID = '00000000-0000-4000-8000-0000000e0001';
const RUN_ID = 'shell_exit_fixture_run_0001';
const TRACE = 'c'.repeat(32);
const SECRET_COMMAND = 'cat synthetic-secret-file && exit 3';
const SECRET_OUTPUT = 'synthetic-output-should-never-leave';

function toolSpan(spanId, toolCallId, extra = {}) {
  return {
    traceId: TRACE, spanId, parentSpanId: '', start: 1000, end: 2000,
    spanName: 'execute_tool bash', operation: 'execute_tool', toolName: 'bash', toolCallId,
    agent: 'native OTel', failed: false, errorType: '', ...extra
  };
}

function shellCall(toolCallId, completion) {
  return [
    { type: 'tool.execution_start', data: { toolCallId, toolName: 'bash', arguments: { command: SECRET_COMMAND } } },
    { type: 'tool.execution_complete', data: { toolCallId, result: { content: `${SECRET_OUTPUT}\n<exited with exit code 3>` }, ...completion } }
  ];
}

function fixture() {
  const events = [
    ...shellCall('call-nonzero', { success: true, shellExecution: { exitCode: 3 } }),
    ...shellCall('call-zero', { success: true, shellExecution: { exitCode: 0 } }),
    ...shellCall('call-failed', { success: false, shellExecution: { exitCode: 1 }, error: { code: 'failure' } }),
    ...shellCall('call-no-exit', { success: true })
  ];
  const spans = [
    toolSpan('1000000000000001', 'call-nonzero'),
    toolSpan('1000000000000002', 'call-zero'),
    toolSpan('1000000000000003', 'call-failed', { failed: true, errorType: 'failure' }),
    toolSpan('1000000000000004', 'call-no-exit')
  ];
  return enrichSpansWithSessionToolContext(spans, events);
}

test('shell non-zero exit marks only the matching successful tool span with a bounded error type', () => {
  const [nonZero, zero, failed, noExit] = fixture();
  assert.equal(nonZero.errorType, SHELL_NONZERO_EXIT);
  assert.equal(nonZero.failed, false, 'Copilot reported success, so it is a warning, not a failure');
  assert.equal(zero.errorType, '');
  assert.equal(failed.errorType, 'failure', 'a real failure keeps its own error type');
  assert.equal(noExit.errorType, '', 'no exit code metadata means no inference from result text');
});

test('span ledger rows carry shell_nonzero_exit without content and keep Outcome ok', () => {
  const rows = spanRowsFromOtelSpans(fixture(), SESSION_ID, RUN_ID);
  const row = rows.find(item => item.ToolCallId === 'call-nonzero');
  assert.equal(row.ErrorType, SHELL_NONZERO_EXIT);
  assert.equal(row.Outcome, 'ok');
  assert.equal(rows.find(item => item.ToolCallId === 'call-failed').Outcome, 'failed');
  const text = JSON.stringify(rows);
  assert.ok(!text.includes('synthetic-secret-file') && !text.includes(SECRET_OUTPUT), 'no command text or output in rows');
});

test('GenAI export marks the shell non-zero exit span as an error with error.type shell_nonzero_exit', () => {
  const { spans } = toGenAiSpans(fixture(), { sessionId: SESSION_ID, runId: RUN_ID });
  const bySpan = Object.fromEntries(spans.map(span => [span.spanId, span]));
  assert.equal(bySpan['1000000000000001'].status.code, 2);
  assert.equal(bySpan['1000000000000001'].attributes['error.type'], SHELL_NONZERO_EXIT);
  assert.equal(bySpan['1000000000000002'].status.code, 0);
  assert.equal(bySpan['1000000000000002'].attributes['error.type'], undefined);
  assert.equal(bySpan['1000000000000004'].status.code, 0);
  const request = JSON.stringify(toOtlpTraceRequest(spans));
  assert.ok(!request.includes('synthetic-secret-file') && !request.includes(SECRET_OUTPUT), 'no command text or output exported');
});

test('UI counts a ledger shell non-zero exit as a warning, not a failure', () => {
  const rows = spanRowsFromOtelSpans(fixture(), SESSION_ID, RUN_ID).filter(row => row.LinkType === 'native-session');
  const ledger = rows.map(data.normalizeLedgerSpan);
  const nonZero = ledger.find(span => span.toolCallId === 'call-nonzero');
  assert.equal(nonZero.failed, false);
  assert.equal(nonZero.outcome, 'nonzero_exit');
  const entry = { id: 'ledger-only', eventsFile: '', mtimeMs: 0, ledgerRuns: [] };
  const okOnly = ledger.filter(span => span.toolCallId !== 'call-failed');
  const summary = data.summarize(entry, { events: [], firstTime: null, lastTime: null }, okOnly, 10_000_000);
  assert.equal(summary.failures, 0);
  assert.equal(summary.nonZeroExits, 1);
  assert.equal(summary.status, 'attention');
});
