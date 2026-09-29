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
  assert.doesNotMatch(html, /<content>|<script>/);
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
