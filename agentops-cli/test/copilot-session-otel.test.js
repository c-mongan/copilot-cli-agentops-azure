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
    assert.match(renderSessionWaterfall(events, 'session-a', { nativeSpans: native.spans }), /<strong>1<\/strong><span>Exact-session native spans/);
    assert.match(renderSessionWaterfall(events, 'session-a'), /No exact-session native spans were observed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Copilot file exporter spans use flat attributes and second/nanosecond timestamps', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-flat-'));
  try {
    const file = path.join(directory, 'native.jsonl');
    const root = {
      type: 'span', traceId: 'trace-flat', spanId: 'root', name: 'invoke_agent',
      startTime: [1767225601, 250000000], endTime: [1767225603, 500000000],
      attributes: { 'gen_ai.conversation.id': 'session-a', 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'fixture-agent' },
      events: [{ name: 'github.copilot.skill.invoked', time: [1767225602, 0], attributes: { 'github.copilot.skill.name': 'fixture-flow' } }],
      status: { code: 1 }
    };
    const tool = {
      ...root, spanId: 'tool', parentSpanId: 'root', name: 'execute_tool',
      attributes: { 'gen_ai.conversation.id': 'session-a', 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'fixture-mcp-search', 'gen_ai.tool.call.id': 'call-flat' },
      status: { code: 2 }
    };
    fs.writeFileSync(file, [root, tool, { ...root, spanId: 'other', attributes: { 'gen_ai.conversation.id': 'session-b' } }, { type: 'metric', name: 'duration' }].map(JSON.stringify).join('\n'));
    const result = readSessionOtelSpans('session-a', [file]);
    assert.equal(result.invalid, 0);
    assert.equal(result.spans.length, 2);
    assert.equal(result.spans[0].end - result.spans[0].start, 2250);
    assert.equal(result.spans[0].agent, 'fixture-agent');
    assert.deepEqual(result.spans[0].events, [{ time: 1767225602000, name: 'github.copilot.skill.invoked', attributes: { 'github.copilot.skill.name': 'fixture-flow' } }]);
    assert.equal(result.spans[1].parentSpanId, 'root');
    assert.equal(result.spans[1].toolCallId, 'call-flat');
    assert.equal(result.spans[1].failed, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('owned script spans require an explicit exact run ID and remain logical links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-script-otel-'));
  try {
    const file = path.join(directory, 'script.jsonl');
    const script = (runId, spanId, name, attributes) => ({
      type: 'span', traceId: 'script-trace', spanId, name,
      startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
      resource: { attributes: { 'agentops.run.id': runId } }, attributes
    });
    fs.writeFileSync(file, [
      script('run-a', 'root', 'agentops.script', { 'agentops.script.name': 'fixture.py', 'gen_ai.conversation.id': 'session-a' }),
      script('run-a', 'step', 'agentops.script.step', { 'agentops.script.name': 'fixture.py', 'agentops.step.name': 'parse' }),
      script('run-b', 'other', 'agentops.script', { 'agentops.script.name': 'other.py' }),
      script('run-a', 'unrelated', 'unrelated.operation', {})
    ].map(JSON.stringify).join('\n'));
    assert.equal(readSessionOtelSpans('session-a', [file]).spans.length, 0);
    const result = readSessionOtelSpans('session-a', [file], { runId: 'run-a' });
    assert.equal(result.spans.length, 2);
    assert.equal(result.spans[0].match, 'run-linked-script');
    assert.equal(result.spans[1].stepName, 'parse');
    const waterfall = sessionWaterfall([], result.spans);
    assert.equal(waterfall.nativeSpans, 0);
    assert.equal(waterfall.scriptSpans, 2);
    assert.equal(waterfall.rows[0].details.link.kind, 'logical');
    assert.match(renderSessionWaterfall([], 'session-a', { nativeSpans: result.spans }), /Run-linked script spans/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
