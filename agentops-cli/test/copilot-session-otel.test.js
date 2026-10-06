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

test('session OTel reader preserves sub-millisecond timestamps and exact duration nanoseconds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-submillisecond-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{
      traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', name: 'agentops.script',
      startTimeUnixNano: '1767225601000123000', endTimeUnixNano: '1767225601000456000',
      attributes: [attr('agentops.run.id', 'run-a'), attr('agentops.script.name', 'scripts/fail.py')]
    }] }] }] })}\n`);
    const result = readSessionOtelSpans('session-a', [file], { runId: 'run-a' });
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0].durationNs, '333000');
    assert.equal(result.spans[0].durationMs, 0.333);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('waterfall separates exact native joins from inferred repeated-script tool links', () => {
  const callId = 'call-repeated-script-2';
  const events = [
    { type: 'tool.execution_start', timestamp: '2026-09-30T03:29:34.733Z', data: { toolCallId: callId, toolName: 'bash' } },
    { type: 'tool.execution_complete', timestamp: '2026-09-30T03:29:34.787Z', data: { toolCallId: callId, success: true } }
  ];
  const spans = [
    {
      start: Date.parse('2026-09-30T03:29:34.733Z'), end: Date.parse('2026-09-30T03:29:34.787Z'),
      spanName: 'execute_tool bash', operation: 'execute_tool', toolName: 'bash', toolCallId: callId,
      traceId: 'native-trace', spanId: 'native-bash-span', match: 'exact-session'
    },
    {
      start: Date.parse('2026-09-30T03:29:34.765Z'), end: Date.parse('2026-09-30T03:29:34.767Z'),
      spanName: 'agentops.script', operation: 'agentops.script', scriptName: '.agents/skills/other/scripts/run.js',
      toolCallId: callId, toolCallEvidence: 'inferred-unique-tool-span-window',
      traceId: 'script-trace', spanId: 'script-root', match: 'run-linked-script'
    }
  ];
  const result = sessionWaterfall(events, spans);
  const tool = result.rows.find(row => row.source === 'session event' && row.kind === 'tool.execution_start');
  const script = result.rows.find(row => row.source === 'script OTel');
  assert.equal(result.exactToolCallJoins, 1);
  assert.equal(result.inferredScriptToolLinks, 1);
  assert.deepEqual(tool.details.toolCallEvidenceLinks.map(link => link.evidence), [
    'exact-session-tool-call-id', 'inferred-unique-tool-span-window'
  ]);
  assert.equal(script.details.link.runEvidence, 'exact agentops.run.id; no shared trace parent observed');
  assert.equal(script.details.link.toolCallEvidence, 'inferred-unique-tool-span-window');
  const html = renderSessionWaterfall(events, 'session-a', { nativeSpans: spans });
  assert.match(html, /Exact tool-call joins/);
  assert.match(html, /Inferred script-to-tool links/);
  assert.match(html, /inferred-unique-tool-span-window/);
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
    assert.equal(result.spans[0].durationMs, 2250);
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

test('native receipt preserves requested/response model, provider, and measured usage tokens distinctly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-telemetry-contract-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    const span = (spanId, attributes) => ({
      type: 'span', traceId: 'trace-contract', spanId, name: 'gen_ai.chat',
      startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
      attributes: [attr('gen_ai.conversation.id', 'session-a'), attr('gen_ai.operation.name', 'chat'), ...attributes]
    });
    fs.writeFileSync(file, [
      span('span-full', [
        attr('gen_ai.request.model', 'gpt-requested'),
        attr('gen_ai.response.model', 'gpt-actual'),
        attr('gen_ai.provider.name', 'fixture-provider'),
        attr('gen_ai.usage.input_tokens', '123'),
        attr('gen_ai.usage.output_tokens', '45'),
        attr('gen_ai.usage.cache_read.input_tokens', '10'),
        attr('gen_ai.usage.cache_creation.input_tokens', '5')
      ]),
      span('span-unknown', []),
      span('span-zero', [
        attr('gen_ai.usage.input_tokens', '0'),
        attr('gen_ai.usage.output_tokens', '0')
      ]),
      span('span-invalid', [
        attr('gen_ai.usage.input_tokens', ''),
        attr('gen_ai.usage.output_tokens', '4.5'),
        attr('gen_ai.usage.cache_read.input_tokens', '-1')
      ])
    ].map(JSON.stringify).join('\n'));

    const result = readSessionOtelSpans('session-a', [file]);
    assert.equal(result.spans.length, 4);
    const [full, unknown, zero, invalid] = result.spans;

    assert.equal(full.modelRequested, 'gpt-requested');
    assert.equal(full.modelActual, 'gpt-actual');
    assert.equal(full.model, 'gpt-actual', 'legacy Model remains response-model-falls-back-to-request-model');
    assert.equal(full.provider, 'fixture-provider');
    assert.equal(full.inputTokens, 123);
    assert.equal(full.outputTokens, 45);
    assert.equal(full.cacheReadTokens, 10);
    assert.equal(full.cacheWriteTokens, 5);

    assert.equal(unknown.modelRequested, '');
    assert.equal(unknown.modelActual, '');
    assert.equal(unknown.provider, '');
    assert.equal(unknown.inputTokens, null, 'unmeasured token count must stay null, not collapse to 0');
    assert.equal(unknown.outputTokens, null);
    assert.equal(unknown.cacheReadTokens, null);
    assert.equal(unknown.cacheWriteTokens, null);

    assert.equal(zero.inputTokens, 0, 'a measured zero token count must remain 0, distinct from absent/null');
    assert.equal(zero.outputTokens, 0);
    assert.equal(zero.cacheReadTokens, null);

    assert.equal(invalid.inputTokens, null, 'present but empty usage is not a measured zero');
    assert.equal(invalid.outputTokens, null, 'fractional token usage is invalid');
    assert.equal(invalid.cacheReadTokens, null, 'negative token usage is invalid');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unrecognized OTLP attribute keys are silently dropped, never forwarded into parsed spans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-canary-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{
      traceId: 'trace-canary', spanId: 'span-canary', name: 'gen_ai.chat',
      startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
      attributes: [
        attr('gen_ai.conversation.id', 'session-a'),
        attr('gen_ai.operation.name', 'chat'),
        attr('some.future.unrecognized.attribute', 'LEAK_CANARY_VALUE'),
        attr('agentops.not_yet_invented.field', 'LEAK_CANARY_VALUE_2')
      ]
    }] }] }] })}\n`);
    const result = readSessionOtelSpans('session-a', [file]);
    assert.equal(result.invalid, 0);
    assert.equal(result.spans.length, 1);
    const serialized = JSON.stringify(result.spans);
    assert.doesNotMatch(serialized, /LEAK_CANARY_VALUE/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('strictly redacted Collector names still identify attached script spans by safe attributes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-redacted-script-otel-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    const script = (spanId, attributes) => ({
      type: 'span', traceId: 'strict-trace', spanId, name: 'agentops.span',
      startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
      resource: { attributes: { 'agentops.run.id': 'strict-run', 'agentops.session.id': 'strict-session' } },
      attributes: { 'agentops.script.name': '.github/skills/sample/scripts/do.py', ...attributes }
    });
    fs.writeFileSync(file, [
      script('script-root', {}),
      script('script-step', { 'agentops.step.name': 'validate' })
    ].map(JSON.stringify).join('\n'));
    const result = readSessionOtelSpans('strict-session', [file], { runId: 'strict-run' });
    assert.equal(result.spans.length, 2);
    assert.ok(result.spans.every(span => span.match === 'run-linked-script'));
    assert.deepEqual(result.spans.map(span => span.spanName), ['agentops.script', 'agentops.script.step']);
    assert.equal(result.spans[0].scriptName, '.github/skills/sample/scripts/do.py');
    assert.equal(result.spans[1].stepName, 'validate');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
