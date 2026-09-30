const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  enrichSpansWithSessionToolContext,
  readSessionSpanRows,
  spanRowsFromOtelSpans,
  writeSessionSpans
} = require('../src/lib/copilot/session-span-export');
const { decodeOtlpProtobuf, readSessionOtelSpans } = require('../src/lib/copilot/session-otel');

function varint(value) {
  let number = BigInt(value);
  const bytes = [];
  while (number > 0x7fn) { bytes.push(Number(number & 0x7fn) | 0x80); number >>= 7n; }
  bytes.push(Number(number));
  return Buffer.from(bytes);
}

function field(number, wire, value) {
  const tag = varint((number << 3) | wire);
  if (wire === 2) return Buffer.concat([tag, varint(value.length), value]);
  return Buffer.concat([tag, value]);
}

function fixed64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function kv(key, value) {
  const any = field(1, 2, Buffer.from(value));
  return Buffer.concat([field(1, 2, Buffer.from(key)), field(2, 2, any)]);
}

test('session context enriches only exact tool-call IDs with MCP and agent attribution', () => {
  const workerId = 'worker-id';
  const taskCallId = 'task-call';
  const parentMcpCallId = 'parent-mcp-call';
  const childMcpCallId = 'child-mcp-call';
  const events = [
    { type: 'subagent.selected', data: { agentName: 'fixture-agent' } },
    {
      type: 'tool.execution_start',
      data: {
        toolCallId: parentMcpCallId,
        toolName: 'hashed-parent-tool',
        mcpServerName: 'agentops-fixture',
        mcpToolName: 'get_case'
      }
    },
    {
      type: 'subagent.started',
      agentId: workerId,
      data: { toolCallId: taskCallId, agentName: 'fixture-investigator' }
    },
    {
      type: 'tool.execution_start',
      agentId: workerId,
      data: {
        toolCallId: childMcpCallId,
        toolName: 'hashed-child-tool',
        parentToolCallId: taskCallId,
        mcpServerName: 'agentops-fixture',
        mcpToolName: 'get_case'
      }
    }
  ];
  const spans = [
    { start: 1767225601000, end: 1767225601000, toolCallId: parentMcpCallId, toolName: 'hashed-parent-tool', agent: 'native OTel' },
    { start: 1767225601000, end: 1767225601000, toolCallId: childMcpCallId, toolName: 'hashed-child-tool', agent: 'native OTel' },
    { start: 1767225601000, end: 1767225601000, toolCallId: 'unmatched-call', toolName: 'hashed-unmatched-tool', agent: 'native OTel' },
    { start: 1767225601000, end: 1767225601000, toolName: 'missing-call-id', agent: 'native OTel' }
  ];

  const enriched = enrichSpansWithSessionToolContext(spans, events);
  const rows = spanRowsFromOtelSpans(enriched, 'session-a', 'run-a');

  assert.equal(rows[0].AgentName, 'fixture-agent');
  assert.equal(rows[0].McpServerName, 'agentops-fixture');
  assert.equal(rows[0].McpToolName, 'get_case');
  assert.equal(rows[1].AgentName, 'fixture-investigator');
  assert.equal(rows[1].ParentToolCallId, taskCallId);
  assert.equal(rows[1].McpServerName, 'agentops-fixture');
  assert.equal(rows[1].McpToolName, 'get_case');
  assert.equal(rows[2].AgentName, '');
  assert.equal(rows[2].McpServerName, '');
  assert.equal(rows[2].McpToolName, '');
  assert.equal(rows[3].AgentName, '');
  assert.equal(rows[3].McpServerName, '');
  assert.equal(rows[3].McpToolName, '');
});

test('run-linked script spans receive inferred path-and-time tool-call attribution without exporting command text', () => {
  const scriptName = '.github/skills/fixture/scripts/check.py';
  const events = [
    { type: 'subagent.selected', data: { agentName: 'fixture-agent' } },
    {
      type: 'tool.execution_start',
      data: {
        toolName: 'bash',
        toolCallId: 'script-call-id',
        arguments: { command: `python3 ${scriptName}`, privateMarker: 'PRIVATE_COMMAND_TEXT' }
      }
    }
  ];
  const spans = [
    { start: 1767225601000, end: 1767225603000, spanName: 'execute_tool bash', toolCallId: 'script-call-id', match: 'exact-session' },
    { start: 1767225601000, end: 1767225602000, traceId: 'script-trace', spanId: 'script-root', spanName: 'agentops.script', scriptName, match: 'run-linked-script' },
    { start: 1767225601200, end: 1767225601400, traceId: 'script-trace', spanId: 'script-step', parentSpanId: 'script-root', spanName: 'agentops.script.step', scriptName, match: 'run-linked-script' }
  ];

  const rows = spanRowsFromOtelSpans(enrichSpansWithSessionToolContext(spans, events), 'session-a', 'run-a');

  assert.equal(rows[0].ToolCallId, 'script-call-id');
  assert.equal(rows[0].ToolCallEvidence, 'exact-session-tool-call-id');
  assert.equal(rows[1].ToolCallId, 'script-call-id');
  assert.equal(rows[1].ToolCallEvidence, 'inferred-unique-tool-span-window');
  assert.equal(rows[1].AgentName, 'fixture-agent');
  assert.equal(rows[1].LinkType, 'run-id-logical-link');
  assert.equal(rows[2].ToolCallId, 'script-call-id');
  assert.equal(rows[2].ToolCallEvidence, 'inferred-unique-tool-span-window');
  assert.equal(rows[2].LinkType, 'run-id-logical-link');
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_COMMAND_TEXT|python3/);
});

test('repeated script calls are separated by their unique containing native tool-span windows', () => {
  const scriptName = '.github/skills/fixture/scripts/check.py';
  const events = ['first-script-call', 'retry-script-call'].map(toolCallId => ({
    type: 'tool.execution_start',
    data: { toolName: 'bash', toolCallId, arguments: { command: `python3 ${scriptName}` } }
  }));
  const spans = [
    { start: 1767225601000, end: 1767225601100, spanName: 'execute_tool bash', toolCallId: 'first-script-call', match: 'exact-session' },
    { start: 1767225602000, end: 1767225602100, spanName: 'execute_tool bash', toolCallId: 'retry-script-call', match: 'exact-session' },
    { start: 1767225601020, end: 1767225601040, traceId: 'script-trace', spanId: 'first-root', spanName: 'agentops.script', scriptName, match: 'run-linked-script' },
    { start: 1767225602020, end: 1767225602040, traceId: 'script-trace', spanId: 'retry-root', spanName: 'agentops.script', scriptName, match: 'run-linked-script' },
    { start: 1767225601050, end: 1767225601060, traceId: 'script-trace', spanId: 'first-step', parentSpanId: 'first-root', spanName: 'agentops.script.step', scriptName, match: 'run-linked-script' },
    { start: 1767225602050, end: 1767225602060, traceId: 'script-trace', spanId: 'retry-step', parentSpanId: 'retry-root', spanName: 'agentops.script.step', scriptName, match: 'run-linked-script' }
  ];
  const rows = spanRowsFromOtelSpans(enrichSpansWithSessionToolContext(spans, events), 'session-a', 'run-a');
  const scripts = rows.filter(row => row.ScriptName);
  assert.deepEqual(scripts.map(row => row.ToolCallId), [
    'first-script-call', 'retry-script-call', 'first-script-call', 'retry-script-call'
  ]);
  assert.ok(scripts.every(row => row.ToolCallEvidence === 'inferred-unique-tool-span-window'));
  assert.ok(scripts.every(row => row.LinkType === 'run-id-logical-link'));
});

test('script spans correlate through an exact unique session tool event interval', () => {
  const scriptName = '.github/skills/fixture/scripts/fail.py';
  const events = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: {
      toolName: 'bash', toolCallId: 'failed-script-call', arguments: { command: `python3 ${scriptName}` }
    } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: {
      toolCallId: 'failed-script-call', success: true, shellExecution: { exitCode: 1 }
    } }
  ];
  const spans = [{
    start: Date.parse('2026-01-01T00:00:01.500Z'), end: Date.parse('2026-01-01T00:00:02.500Z'),
    traceId: 'script-trace', spanId: 'script-root', spanName: 'agentops.script', scriptName, match: 'run-linked-script', failed: true
  }];
  const [row] = spanRowsFromOtelSpans(enrichSpansWithSessionToolContext(spans, events), 'session-a', 'run-a');
  assert.equal(row.ToolCallId, 'failed-script-call');
  assert.equal(row.ToolCallEvidence, 'inferred-unique-session-tool-event-window');
  assert.equal(row.Outcome, 'failed');
  assert.equal(row.LinkType, 'run-id-logical-link');
});

test('script tool-call attribution remains blank when temporal evidence is ambiguous', () => {
  const scriptName = '.github/skills/fixture/scripts/check.py';
  const events = ['first-script-call', 'retry-script-call'].map(toolCallId => ({
    type: 'tool.execution_start',
    data: { toolName: 'bash', toolCallId, arguments: { command: `python3 ${scriptName}` } }
  }));
  const spans = [
    { start: 1767225601000, end: 1767225602000, spanName: 'execute_tool bash', toolCallId: 'first-script-call', match: 'exact-session' },
    { start: 1767225601000, end: 1767225602000, spanName: 'execute_tool bash', toolCallId: 'retry-script-call', match: 'exact-session' },
    { start: 1767225601200, end: 1767225601300, traceId: 'script-trace', spanId: 'script-root',
      spanName: 'agentops.script', scriptName, match: 'run-linked-script' }
  ];
  const [row] = spanRowsFromOtelSpans(enrichSpansWithSessionToolContext(spans, events), 'session-a', 'run-a')
    .filter(item => item.ScriptName);
  assert.equal(row.ToolCallId, '');
  assert.equal(row.ToolCallEvidence, '');
  assert.equal(row.LinkType, 'run-id-logical-link');
});

test('span export preserves native and script parent IDs while omitting content payloads', () => {
  const spans = [
    {
      start: 1767225601000, end: 1767225603000, traceId: 'native-trace', spanId: 'agent', parentSpanId: '',
      spanName: 'invoke_agent fixture-agent', operation: 'invoke_agent', agent: 'fixture-agent',
      match: 'exact-session', attributes: { prompt: 'must never export' },
      events: [{ time: 1767225602000, name: 'github.copilot.skill.invoked', attributes: { 'github.copilot.skill.name': 'fixture-flow', 'github.copilot.skill.content': 'private' } }]
    },
    {
      start: 1767225601500, end: 1767225601800, traceId: 'script-trace', spanId: 'step', parentSpanId: 'script',
      spanName: 'agentops.script.step', operation: 'agentops.script.step', scriptName: 'fixture.py', stepName: 'parse',
      match: 'run-linked-script', failed: false
    }
  ];
  const rows = spanRowsFromOtelSpans(spans, 'session-a', 'run-a');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].LinkType, 'native-session');
  assert.equal(rows[1].LinkType, 'span-event');
  assert.equal(rows[1].SkillName, 'fixture-flow');
  assert.equal(rows[2].LinkType, 'run-id-logical-link');
  assert.equal(rows[2].ParentSpanId, 'script');
  assert.equal(rows[2].StepName, 'parse');
  assert.ok(rows.every(row => row.RunId === 'run-a' && row.SessionId === 'session-a' && row.SchemaVersion === '2'));
  assert.doesNotMatch(JSON.stringify(rows), /must never export|private/);
});

test('span export preserves sub-millisecond duration as nanoseconds and rounds legacy milliseconds', () => {
  const [row] = spanRowsFromOtelSpans([{
    start: 1767225601000.123, end: 1767225601000.456, durationNs: '333000',
    traceId: 'trace-submillisecond', spanId: 'span-submillisecond', spanName: 'agentops.script',
    operation: 'script.execute', scriptName: 'scripts/fail.py', match: 'run-linked-script'
  }], 'session-a', 'run-a');
  assert.equal(row.DurationNs, 333000);
  assert.equal(row.DurationMs, 0);
});

test('span export writes owner-only JSONL and refuses overwrite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-spans-export-'));
  try {
    const output = path.join(directory, 'AgentOpsSpans_CL.jsonl');
    const result = writeSessionSpans([{
      start: 1767225601000, end: 1767225601000, traceId: 'trace-a', spanId: 'span-a',
      spanName: 'invoke_agent', operation: 'invoke_agent', match: 'exact-session'
    }], 'session-a', 'run-a', output);
    assert.equal(result.rows, 1);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => writeSessionSpans([{
      start: 1767225601000, end: 1767225601000, traceId: 'trace-a', spanId: 'span-a',
      spanName: 'invoke_agent', operation: 'invoke_agent', match: 'exact-session'
    }], 'session-a', 'run-a', output), /EEXIST/);
    assert.throws(() => spanRowsFromOtelSpans([], 'session-a', 'bad run'), /valid session and run IDs/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('run span ledger restores exact-run native and script spans without duplicating span events', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-span-ledger-'));
  try {
    const file = path.join(directory, 'AgentOpsSpans_CL.jsonl');
    const rows = [
      {
        TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: 'run-a', SessionId: 'session-a',
        TraceId: 'trace-native', SpanId: 'span-native', SpanName: 'agentops.span',
        OperationName: 'execute_tool', AgentName: 'fixture-agent', ToolName: 'bash',
        ToolCallId: 'call-native', DurationNs: null, DurationMs: 13.5,
        Outcome: 'ok', LinkType: 'native-session'
      },
      {
        TimeGenerated: '2026-01-01T00:00:01.000Z', RunId: 'run-a', SessionId: 'session-a',
        TraceId: 'trace-script', SpanId: 'span-script', SpanName: 'agentops.script',
        OperationName: 'script.execute', AgentName: 'fixture-agent', ScriptName: 'scripts/probe.py',
        ToolCallId: 'call-script', ToolCallEvidence: 'inferred-unique-session-tool-event-window',
        DurationNs: '333000', DurationMs: 0, Outcome: 'ok', LinkType: 'run-id-logical-link'
      },
      {
        TimeGenerated: '2026-01-01T00:00:00.013Z', RunId: 'run-a', SessionId: 'session-a',
        TraceId: 'trace-native', SpanId: 'span-native', ParentSpanId: 'span-native',
        SpanName: 'github.copilot.skill.invoked', OperationName: 'github.copilot.skill.invoked',
        SkillName: 'fixture-skill', DurationNs: 0, Outcome: 'ok', LinkType: 'span-event'
      },
      {
        TimeGenerated: '2026-01-01T00:00:02.000Z', RunId: 'other-run', SessionId: 'session-a',
        TraceId: 'trace-other', SpanId: 'span-other', SpanName: 'agentops.span',
        OperationName: 'chat', DurationNs: 0, DurationMs: 0, Outcome: 'ok', LinkType: 'native-session'
      }
    ];
    fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    const result = readSessionSpanRows(directory, 'run-a', 'session-a');

    assert.equal(result.spans.length, 2);
    assert.equal(result.invalid, 1);
    assert.equal(result.spans[0].durationMs, 13.5);
    assert.equal(result.spans[0].events[0].attributes['github.copilot.skill.name'], 'fixture-skill');
    assert.equal(result.spans[1].durationMs, 0.333);
    assert.equal(result.spans[1].durationNs, '333000');
    assert.equal(result.spans[1].match, 'run-linked-script');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('session OTel reader accepts OTLP JSON attribute value wrappers for run-linked scripts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-json-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'span', traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef',
      name: 'agentops.script', startTime: [1767225601, 0], endTime: [1767225602, 0],
      attributes: { 'agentops.run.id': { stringValue: 'run-a' }, 'agentops.script.name': { stringValue: 'scripts/check.py' } },
      resource: { attributes: { 'agentops.run.id': { stringValue: 'run-a' } } }
    })}\n`);
    const result = readSessionOtelSpans('session-a', [file], { runId: 'run-a' });
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0].scriptName, 'scripts/check.py');
    assert.equal(result.spans[0].runId, 'run-a');
    assert.equal(result.spans[0].match, 'run-linked-script');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('session OTel reader matches script spans from standard resourceSpans OTLP JSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-resource-json-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ resourceSpans: [{
      resource: { attributes: [{ key: 'agentops.run.id', value: { stringValue: 'run-a' } }] },
      scopeSpans: [{ spans: [{
        traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', name: 'agentops.script',
        startTimeUnixNano: '1767225601000000000', endTimeUnixNano: '1767225602000000000',
        attributes: [{ key: 'agentops.script.name', value: { stringValue: 'scripts/check.py' } }]
      }] }]
    }] })}\n`);
    const result = readSessionOtelSpans('session-a', [file], { runId: 'run-a' });
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0].scriptName, 'scripts/check.py');
    assert.equal(result.spans[0].runId, 'run-a');
    assert.equal(result.spans[0].match, 'run-linked-script');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('OTLP protobuf decoding preserves canonical IDs, timestamps, attributes, and run linkage', () => {
  const span = Buffer.concat([
    field(1, 2, Buffer.from('0123456789abcdef0123456789abcdef', 'hex')),
    field(2, 2, Buffer.from('0123456789abcdef', 'hex')),
    field(5, 2, Buffer.from('agentops.script')),
    field(7, 1, fixed64(1000000000)),
    field(8, 1, fixed64(2000000000)),
    field(9, 2, kv('agentops.script.name', 'scripts/check.py'))
  ]);
  const resource = field(1, 2, kv('agentops.run.id', 'run-a'));
  const scope = field(1, 2, field(1, 2, Buffer.from('agentops.test')));
  const scopeSpans = Buffer.concat([scope, field(2, 2, span)]);
  const resourceSpans = Buffer.concat([field(1, 2, resource), field(2, 2, scopeSpans)]);
  const request = field(1, 2, resourceSpans).toString('base64');
  const decoded = decodeOtlpProtobuf(request).resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(decoded.traceId, '0123456789abcdef0123456789abcdef');
  assert.equal(decoded.spanId, '0123456789abcdef');
  assert.equal(decoded.startTimeUnixNano, '1000000000');
  assert.equal(decoded.endTimeUnixNano, '2000000000');
  assert.equal(decoded.attributes[0].value.stringValue, 'scripts/check.py');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otel-protobuf-'));
  try {
    const file = path.join(directory, 'receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ contentType: 'application/x-protobuf', bodyBase64: request })}\n`);
    const result = readSessionOtelSpans('session-a', [file], { runId: 'run-a' });
    assert.equal(result.invalid, 0);
    assert.equal(result.spans.length, 1);
    assert.equal(result.spans[0].traceId, '0123456789abcdef0123456789abcdef');
    assert.equal(result.spans[0].scriptName, 'scripts/check.py');
    assert.equal(result.spans[0].match, 'run-linked-script');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
