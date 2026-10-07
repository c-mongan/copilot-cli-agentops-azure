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

// One vocabulary for every surface (launch, view, UI, digest, export-otel):
// a failure is a tool call that errored, or a failed hook or subagent; a
// denial or a shell non-zero exit only needs attention.
const OUTCOME_SEVERITY = Object.freeze({ ok: null, failed: 'failure', denied: 'attention', nonzero_exit: 'attention' });

const OUTCOME_LABELS = Object.freeze({
  failedToolCalls: 'Failed tool calls',
  attention: 'Needs attention'
});

function severityOfOutcome(outcome) {
  if (!outcome) return null;
  return Object.prototype.hasOwnProperty.call(OUTCOME_SEVERITY, outcome) ? OUTCOME_SEVERITY[outcome] : 'failure';
}

// The shared count shape every surface reports for one run or a window.
function toolOutcomeCounts({ toolFailures = 0, denials = 0, nonZeroExits = 0 } = {}) {
  return {
    failedToolCalls: Number(toolFailures) || 0,
    deniedToolCalls: Number(denials) || 0,
    nonZeroExitToolCalls: Number(nonZeroExits) || 0
  };
}

function attentionText({ denials = 0, nonZeroExits = 0 } = {}) {
  return `${denials} denied, ${nonZeroExits} non-zero exit${nonZeroExits === 1 ? '' : 's'}`;
}

// "Failed tool calls 0 · Needs attention: 1 denied, 1 non-zero exit"
function outcomeSummaryText(signals = {}) {
  const parts = [`${OUTCOME_LABELS.failedToolCalls} ${signals.toolFailures || 0}`];
  if (signals.hookFailures) parts.push(`failed hooks ${signals.hookFailures}`);
  if (signals.subagentFailures) parts.push(`failed subagents ${signals.subagentFailures}`);
  parts.push(`${OUTCOME_LABELS.attention}: ${attentionText({ denials: signals.denials || 0, nonZeroExits: signals.nonZeroExits || 0 })}`);
  return parts.join(' · ');
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
  const seenToolCalls = new Set();
  for (const event of events) {
    const data = event?.data || event || {};
    if (event?.type === 'tool.execution_complete') {
      // A resumed session can replay a completion; one tool call counts once.
      const toolCallId = data.toolCallId || '';
      if (toolCallId && seenToolCalls.has(toolCallId)) continue;
      if (toolCallId) seenToolCalls.add(toolCallId);
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
  OUTCOME_LABELS,
  OUTCOME_SEVERITY,
  SPAN_COUNT_LABELS,
  STATUS_LABELS,
  attentionText,
  classifyRunStatus,
  classifyToolCompletionEvent,
  classifyToolOutcome,
  countNativeSpans,
  isDenialCode,
  outcomeSummaryText,
  sessionRunStatus,
  sessionStatusSignals,
  severityOfOutcome,
  toolOutcomeCounts,
  uniqueNativeSpans
};
