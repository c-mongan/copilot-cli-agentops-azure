const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readSessionOtelSpans } = require('../src/lib/copilot/session-otel');
const { sessionWaterfall, renderSessionWaterfall } = require('../src/lib/copilot/session-waterfall');

function attr(key, value) {
  return { key, value: { stringValue: value } };
}

test('native receipt joins only exact Copilot conversation ID and tool call ID', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-otel-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    const span = (conversationId, spanId, toolCallId) => ({
      traceId: 'trace-1', spanId, name: 'agentops.span',
      startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
      attributes: [attr('gen_ai.conversation.id', conversationId), attr('gen_ai.operation.name', 'execute_tool'), attr('gen_ai.tool.name', 'view'), attr('gen_ai.tool.call.id', toolCallId)]
    });
    fs.writeFileSync(file, `${JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span('session-a', 'span-a', 'call-1'), span('session-b', 'span-b', 'call-1')] }] }] })}\n`);
    const native = readSessionOtelSpans('session-a', [file]);
    assert.equal(native.spans.length, 1);
    assert.equal(native.spans[0].spanId, 'span-a');
    assert.equal(native.spans[0].end - native.spans[0].start, 1000);

    const events = [
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-1', toolName: 'view' } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-1', success: true } }
    ];
    const waterfall = sessionWaterfall(events, native.spans);
    assert.equal(waterfall.nativeSpans, 1);
    assert.equal(waterfall.nativeToolJoins, 1);
    assert.equal(waterfall.rows.find(row => row.source === 'session event').details.nativeOtel.spanId, 'span-a');
    assert.match(renderSessionWaterfall(events, 'session-a', { nativeSpans: native.spans }), /1 exact-session OTel spans/);
    assert.match(renderSessionWaterfall(events, 'session-a'), /No matching native spans were observed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
