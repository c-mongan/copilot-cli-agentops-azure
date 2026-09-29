const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { contentRowsFromSession, writeSessionContent } = require('../src/lib/copilot/session-content');

const events = [
  { type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'Why did the run fail?' } },
  { type: 'assistant.turn_start', timestamp: '2026-01-01T00:00:01Z', data: {} },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02Z', data: { toolCallId: 'call-a', toolName: 'view', arguments: { path: 'synthetic.txt' } } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03Z', data: { toolCallId: 'call-a', result: 'synthetic failure' } },
  { type: 'assistant.message', timestamp: '2026-01-01T00:00:04Z', data: { content: 'The timeout was too short.', model: 'test-model' } }
];

test('synthetic content export retains prompt, tool arguments/result, answer and schema', () => {
  const rows = contentRowsFromSession(events, 'session-test');
  assert.deepEqual(rows.map(row => row.ContentKind), ['prompt', 'tool_arguments', 'tool_result', 'response']);
  assert.equal(rows[2].ToolName, 'view');
  assert.equal(rows[2].ResponseText, 'synthetic failure');
  assert.ok(rows.every(row => row.CaptureMode === 'full' && row.SchemaVersion === '2'));
  assert.ok(rows.every(row => row.SessionId === 'session-test'));
  assert.doesNotMatch(JSON.stringify(rows), /call-a/);
});

test('synthetic content export creates a private non-overwriting JSONL file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-test-'));
  try {
    const output = path.join(directory, 'AgentOpsContent_CL.jsonl');
    assert.equal(writeSessionContent(events, 'session-test', output).rows, 4);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => writeSessionContent(events, 'session-test', output), /EEXIST/);
    assert.throws(() => writeSessionContent(events, 'session-test', path.join(directory, 'other.jsonl')), /AgentOpsContent_CL/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
