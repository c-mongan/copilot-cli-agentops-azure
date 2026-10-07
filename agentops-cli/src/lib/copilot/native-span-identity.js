'use strict';

// One shared rule for "is this the same native span?" so the launch summary,
// `copilot-session view`, export-spans/export-otel and the local UI agree.
//
// Copilot CLI's native OTel file export can re-emit a span: the same
// (TraceId, SpanId) twice, or the same execute_tool call under a second span ID
// with an identical start and end. Both are one tool call, not two.

function field(span, camel, pascal) {
  const value = span[camel] !== undefined && span[camel] !== null && span[camel] !== '' ? span[camel] : span[pascal];
  return value === undefined || value === null ? '' : String(value);
}

function isSpanEventRow(span) {
  return span.LinkType === 'span-event' || span.linkType === 'span-event';
}

function isToolSpan(span) {
  const operation = field(span, 'operation', 'OperationName') || field(span, 'op', '');
  const name = field(span, 'spanName', 'SpanName');
  return operation === 'execute_tool' || name === 'execute_tool' || name.startsWith('execute_tool ');
}

// Returns [startMs, endMs] for normalized spans ({ start, end }) or ledger rows
// ({ TimeGenerated, DurationNs | DurationMs }); null when either is unknown.
function spanWindow(span) {
  if (Number.isFinite(span.start) && Number.isFinite(span.end)) return [span.start, span.end];
  const start = Date.parse(span.TimeGenerated || '');
  if (!Number.isFinite(start)) return null;
  const rawNs = span.DurationNs;
  let durationMs = null;
  if (typeof rawNs === 'string' && /^\d+$/.test(rawNs)) durationMs = Number(BigInt(rawNs)) / 1000000;
  else if (Number.isSafeInteger(rawNs) && rawNs >= 0) durationMs = rawNs / 1000000;
  else if (Number.isFinite(Number(span.DurationMs)) && span.DurationMs !== null && span.DurationMs !== '') durationMs = Number(span.DurationMs);
  return durationMs === null ? null : [start, start + durationMs];
}

function toolCallIdentity(span) {
  if (!isToolSpan(span)) return '';
  const callId = field(span, 'toolCallId', 'ToolCallId');
  const window = callId ? spanWindow(span) : null;
  if (!window) return '';
  return `${callId}\u0000${window[0]}\u0000${window[1]}`;
}

// Keeps the first occurrence of each native span. Span-event rows are dropped
// unless `keepSpanEvents` is set; spans without a trace/span ID are dropped
// unless `keepUnidentified` is set (they cannot be deduplicated by identity).
function dedupeNativeSpans(spans = [], { keepSpanEvents = false, keepUnidentified = false } = {}) {
  const seenSpans = new Set();
  const seenToolCalls = new Set();
  const result = [];
  for (const span of spans) {
    if (!span || typeof span !== 'object') continue;
    if (isSpanEventRow(span)) {
      if (keepSpanEvents) result.push(span);
      continue;
    }
    const traceId = field(span, 'traceId', 'TraceId');
    const spanId = field(span, 'spanId', 'SpanId');
    if (!traceId || !spanId) {
      if (keepUnidentified) result.push(span);
      continue;
    }
    const key = `${traceId}:${spanId}`;
    if (seenSpans.has(key)) continue;
    const toolKey = toolCallIdentity(span);
    if (toolKey && seenToolCalls.has(toolKey)) continue;
    seenSpans.add(key);
    if (toolKey) seenToolCalls.add(toolKey);
    result.push(span);
  }
  return result;
}

module.exports = { dedupeNativeSpans, isToolSpan, toolCallIdentity };
