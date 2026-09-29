const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { renderSessionWaterfall, sessionWaterfall, writeSessionWaterfall } = require('../src/lib/copilot/session-waterfall');

const events = [
  { type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: {} },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'a', toolName: 'view', arguments: { path: '<fixture>' } } },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.500Z', data: { toolCallId: 'b', toolName: 'bash' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'b', success: false, result: 'failed' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'a', success: true, result: '<content>' } },
  { type: 'session.shutdown', timestamp: '2026-01-01T00:00:04.000Z', data: {} }
];

test('local waterfall pairs overlapping calls by ID and marks failures', () => {
  const { rows, durationMs } = sessionWaterfall(events);
  assert.equal(durationMs, 4000);
  assert.equal(rows.find(row => row.label === 'view').end - rows.find(row => row.label === 'view').start, 2000);
  assert.equal(rows.find(row => row.label === 'bash').status, 'failed');
  assert.equal(rows.filter(row => row.kind === 'tool.execution_complete').length, 0);
});

test('local waterfall escapes rich content and writes owner-only file without overwriting', () => {
  const html = renderSessionWaterfall(events, 'test<script>');
  assert.match(html, /test&lt;script&gt;/);
  assert.match(html, /&lt;content&gt;/);
  assert.doesNotMatch(html, /<content>|test<script>/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-waterfall-test-'));
  try {
    const output = path.join(directory, 'run.html');
    writeSessionWaterfall(events, 'synthetic', output);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => writeSessionWaterfall(events, 'synthetic', output), /EEXIST/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('failure-first view links preceding context and exact native evidence', () => {
  const failureEvents = [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00.000Z', data: { content: 'Fix the build' } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:00.500Z', data: { content: 'I will run the build' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-1', toolName: 'bash', arguments: { command: 'npm test' } } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-1', success: false, result: 'exit 1 <failed>' } }
  ];
  const nativeSpans = [{ start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:02.000Z'), traceId: 'trace-1', spanId: 'span-1', operation: 'execute_tool', toolName: 'bash', toolCallId: 'call-1', agent: 'copilot', failed: true }];
  const html = renderSessionWaterfall(failureEvents, 'fixture', { nativeSpans });
  assert.match(html, /2 failure signals observed/);
  assert.match(html, /Failure detail/);
  assert.match(html, /exit 1 &lt;failed&gt;/);
  assert.match(html, /Fix the build/);
  assert.match(html, /&quot;command&quot;:&quot;npm test&quot;/);
  assert.match(html, /href="#event-0">User message/);
  assert.match(html, /href="#event-1">Assistant message/);
  assert.match(html, /href="#event-3">Matching native span/);
  assert.match(html, /data-filter="failed"/);
  assert.match(html, /Trace trace-1/);
  assert.doesNotMatch(html, /exit 1 <failed>/);
});

test('empty failure view does not claim a run succeeded', () => {
  const html = renderSessionWaterfall(events.filter(event => event.data?.success !== false), 'fixture');
  assert.match(html, /No failure signal was observed in the available evidence/);
  assert.match(html, /This does not prove the run succeeded/);
});

test('native skill invocation appears at its event time on the waterfall', () => {
  const nativeSpans = [{
    start: 1767225601000, end: 1767225603000, traceId: 'trace-1', spanId: 'root',
    operation: 'invoke_agent', agent: 'fixture-agent', failed: false,
    events: [{ time: 1767225602000, name: 'github.copilot.skill.invoked', attributes: { 'github.copilot.skill.name': 'fixture-flow' } }]
  }];
  const { rows, nativeSpans: count } = sessionWaterfall([], nativeSpans);
  assert.equal(count, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].label, 'skill: fixture-flow');
  assert.equal(rows[1].start, 1767225602000);
  assert.match(renderSessionWaterfall([], 'fixture', { nativeSpans }), /skill: fixture-flow/);
});
