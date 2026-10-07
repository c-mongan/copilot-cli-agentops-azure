'use strict';

// Shared run-status and span-count rules for `copilot-session launch`,
// `copilot-session view` and the local UI. See docs/local-ui.md
// ("How run status is decided") before changing any rule here.

const { dedupeNativeSpans } = require('./native-span-identity');

const STATUS_LABELS = Object.freeze({
  ok: 'Completed',
  attention: 'Needs attention',
  failed: 'Failed',
  live: 'Live',
  incomplete: 'Incomplete'
});

// Copilot CLI error codes that mean a permission/policy gate stopped the tool
// before it ran. They are not tool malfunctions.
const DENIAL_CODES = new Set(['denied', 'rejected', 'permission_denied', 'user_rejected', 'policy_denied']);

function isDenialCode(code) {
  return DENIAL_CODES.has(String(code || '').toLowerCase());
}

// Returns 'ok' | 'denied' | 'failed' | 'nonzero_exit' for one completed tool call.
function classifyToolOutcome({ success, errorCode, exitCode } = {}) {
  if (success === false) return isDenialCode(errorCode) ? 'denied' : 'failed';
  if (Number.isSafeInteger(exitCode) && exitCode !== 0) return 'nonzero_exit';
  return 'ok';
}

function classifyToolCompletionEvent(data = {}) {
  return classifyToolOutcome({
    success: data.success !== false,
    errorCode: data.error?.code,
    exitCode: data.shellExecution?.exitCode
  });
}

// Precedence: live > failed > incomplete > attention > ok.
function classifyRunStatus({ failures = 0, denials = 0, nonZeroExits = 0, runErrored = false, live = false, ended = true } = {}) {
  const reasons = [];
  if (runErrored) reasons.push('run_errored');
  if (failures > 0) reasons.push('failures');
  if (denials > 0) reasons.push('denials');
  if (nonZeroExits > 0) reasons.push('nonzero_exits');
  let status;
  if (live) status = 'live';
  else if (runErrored || failures > 0) status = 'failed';
  else if (!ended) status = 'incomplete';
  else if (denials > 0 || nonZeroExits > 0) status = 'attention';
  else status = 'ok';
  return { status, statusLabel: STATUS_LABELS[status], statusReasons: reasons };
}

// Counts status signals from raw Copilot session events (events.jsonl rows).
function sessionStatusSignals(events = []) {
  const signals = { toolCalls: 0, toolFailures: 0, denials: 0, nonZeroExits: 0, hookFailures: 0, subagentFailures: 0, ended: false };
  for (const event of events) {
    const data = event?.data || event || {};
    if (event?.type === 'tool.execution_complete') {
      signals.toolCalls += 1;
      const outcome = event?.data ? classifyToolCompletionEvent(data) : data.signal || classifyToolOutcome({ success: data.success, errorCode: data.outcome, exitCode: data.exitCode });
      if (outcome === 'failed') signals.toolFailures += 1;
      else if (outcome === 'denied') signals.denials += 1;
      else if (outcome === 'nonzero_exit') signals.nonZeroExits += 1;
    } else if (event?.type === 'hook.end' && data.success === false) {
      signals.hookFailures += 1;
    } else if (event?.type === 'subagent.failed') {
      signals.subagentFailures += 1;
    } else if (event?.type === 'session.shutdown') {
      signals.ended = true;
    } else if (event?.type === 'session.start' || event?.type === 'session.resume') {
      // A resume after a shutdown means the session is running again.
      signals.ended = false;
    }
  }
  signals.failures = signals.toolFailures + signals.hookFailures + signals.subagentFailures;
  return signals;
}

function sessionRunStatus(events = [], { runErrored = false, live = false, ended } = {}) {
  const signals = sessionStatusSignals(events);
  const { ended: sessionEnded, ...counts } = signals;
  return {
    ...classifyRunStatus({ ...counts, runErrored, live, ended: ended ?? sessionEnded }),
    signals: counts
  };
}

// A native OTel span is one unique (TraceId, SpanId); a re-emitted execute_tool
// span with the same tool call ID and identical start/end is the same call.
// Span-event rows (LinkType 'span-event') and repeated exports are not spans.
function uniqueNativeSpans(rows = []) {
  return dedupeNativeSpans(rows);
}

function countNativeSpans(rows = []) {
  return uniqueNativeSpans(rows).length;
}

const SPAN_COUNT_LABELS = Object.freeze({
  nativeSpans: 'native OTel spans (unique trace/span ID)',
  spanRows: 'span-table rows (spans plus span-event rows)',
  traceSpans: 'trace spans (session, turns, tool calls, hooks, model calls)'
});

module.exports = {
  DENIAL_CODES,
  SPAN_COUNT_LABELS,
  STATUS_LABELS,
  classifyRunStatus,
  classifyToolCompletionEvent,
  classifyToolOutcome,
  countNativeSpans,
  isDenialCode,
  sessionRunStatus,
  sessionStatusSignals,
  uniqueNativeSpans
};
