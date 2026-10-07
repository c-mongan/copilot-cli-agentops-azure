const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { dedupeNativeSpans } = require('../src/lib/copilot/native-span-identity');
const { countNativeSpans } = require('../src/lib/copilot/run-status');
const { readSessionOtelSpans } = require('../src/lib/copilot/session-otel');
const { readSessionSpanRows, spanRowsFromOtelSpans } = require('../src/lib/copilot/session-span-export');
const { sessionWaterfall } = require('../src/lib/copilot/session-waterfall');
const { dedupeSpans } = require('../src/lib/ui/data');

const SESSION = 'session-dup';
const RUN = 'run-dup';

function attr(key, value) {
  return { key, value: { stringValue: value } };
}

function toolSpan(spanId, toolCallId, startSec = 1, endSec = 2) {
  return {
    traceId: 'trace-dup', spanId, parentSpanId: 'root', name: 'execute_tool bash',
    startTimeUnixNano: `${1767225600 + startSec}000000000`, endTimeUnixNano: `${1767225600 + endSec}000000000`,
    attributes: [
      attr('gen_ai.conversation.id', SESSION), attr('gen_ai.operation.name', 'execute_tool'),
      attr('gen_ai.tool.name', 'bash'), attr('gen_ai.tool.call.id', toolCallId)
    ],
    events: [{ name: 'tool.output', timeUnixNano: `${1767225600 + startSec}500000000` }]
  };
}

function request(spans) {
  return JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] });
}

// Synthetic Copilot file-export receipt: the same span re-emitted in a later
// batch, plus the same tool call re-emitted under a new span ID.
function writeDuplicateReceipt(directory) {
  const first = path.join(directory, 'native-receipt.jsonl');
  const second = path.join(directory, 'native-azure-receipt.jsonl');
  fs.writeFileSync(first, [
    request([toolSpan('span-a', 'call-1'), toolSpan('span-b', 'call-2', 3, 4)]),
    request([toolSpan('span-a', 'call-1')]),
    request([toolSpan('span-a2', 'call-1')])
  ].join('\n') + '\n');
  fs.writeFileSync(second, `${request([toolSpan('span-b', 'call-2', 3, 4), toolSpan('span-c', 'call-2', 5, 6)])}\n`);
  return [first, second];
}

test('dedupeNativeSpans keeps one span per trace/span ID and per identical tool call window', () => {
  const spans = [
    { traceId: 't', spanId: '1', operation: 'execute_tool', toolCallId: 'c1', start: 1, end: 2 },
    { traceId: 't', spanId: '1', operation: 'execute_tool', toolCallId: 'c1', start: 1, end: 2 },
    { traceId: 't', spanId: '2', operation: 'execute_tool', toolCallId: 'c1', start: 1, end: 2 },
    { traceId: 't', spanId: '3', operation: 'execute_tool', toolCallId: 'c1', start: 1, end: 3 },
    { traceId: 't', spanId: '4', operation: 'chat', toolCallId: '', start: 1, end: 2 },
    { traceId: 't', spanId: '5', operation: 'chat', toolCallId: '', start: 1, end: 2 }
  ];
  assert.deepEqual(dedupeNativeSpans(spans).map(span => span.spanId), ['1', '3', '4', '5']);
  assert.equal(dedupeNativeSpans([{ spanId: 'x' }]).length, 0);
  assert.equal(dedupeNativeSpans([{ spanId: 'x' }], { keepUnidentified: true }).length, 1);
});

test('ledger rows dedupe re-emitted tool calls and ignore span-event rows sharing the call ID', () => {
  const row = (SpanId, extra = {}) => ({
    TraceId: 't', SpanId, OperationName: 'execute_tool', SpanName: 'execute_tool bash', ToolCallId: 'call-1',
    TimeGenerated: '2026-01-01T00:00:01.000Z', DurationNs: 1000000000, LinkType: 'native-session', ...extra
  });
  const rows = [row('s1'), row('s2'), row('s1', { LinkType: 'span-event', SpanName: 'tool.output' }), row('s3', { DurationNs: 2000000000 })];
  assert.equal(countNativeSpans(rows), 2);
  assert.deepEqual(dedupeSpans(rows).map(item => item.SpanId), ['s1', 's3']);
});

test('native receipt, ledger round trip and waterfall show each duplicated tool call once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-span-dedupe-'));
  try {
    const native = readSessionOtelSpans(SESSION, writeDuplicateReceipt(directory), { runId: RUN });
    assert.deepEqual(native.spans.map(span => span.spanId), ['span-a', 'span-b', 'span-c']);
    assert.equal(countNativeSpans(native.spans), 3);

    const rows = spanRowsFromOtelSpans(native.spans, SESSION, RUN);
    assert.equal(rows.filter(row => row.LinkType === 'native-session').length, 3);
    const doubled = [...rows, ...rows, { ...rows[0], SpanId: 'span-a3' }];
    fs.writeFileSync(path.join(directory, 'AgentOpsSpans_CL.jsonl'), `${doubled.map(row => JSON.stringify(row)).join('\n')}\n`);
    const ledger = readSessionSpanRows(directory, RUN, SESSION);
    assert.deepEqual(ledger.spans.map(span => span.spanId), ['span-a', 'span-b', 'span-c']);
    assert.equal(ledger.spans[0].events.length, 1, 'span events attach to the kept span once per ledger row');

    const waterfall = sessionWaterfall([], [...native.spans, ...native.spans, { ...native.spans[0], spanId: 'span-a4' }], { referencePaths: new Set(), skillReferences: new Map() });
    assert.equal(waterfall.nativeSpans, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
