const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { contentDeletionPreview, contentRowsFromSession, CONTENT_VALUE_MAX_BYTES, deleteSessionContent, writeSessionContent } = require('../src/lib/copilot/session-content');

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
  assert.equal(rows[1].ToolCallId, 'call-a');
  assert.equal(rows[2].ToolCallId, 'call-a');
  assert.equal(rows[0].ToolCallId, '');
  assert.equal(rows[3].ToolCallId, '');
  assert.equal(rows[2].ResponseText, 'synthetic failure');
  assert.ok(rows.every(row => row.CaptureMode === 'full' && row.SchemaVersion === '2'));
  assert.ok(rows.every(row => row.SessionId === 'session-test'));
  assert.ok(rows.every(row => row.RunId === 'session-test'));
  assert.ok(contentRowsFromSession(events, 'session-test', 'observed-run').every(row => row.RunId === 'observed-run'));
  assert.throws(() => contentRowsFromSession(events, 'session-test', 'bad run id'), /valid run ID/);
  assert.equal(rows.filter(row => row.ToolCallId === 'call-a').length, 2);
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

test('restricted content export redacts common secrets before persistence', () => {
  const privateEvents = [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: 'Authorization: Bearer bearer-canary PASSWORD=password-canary' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01Z', data: { toolCallId: 'call-secret', toolName: 'request', arguments: { api_key: 'key-canary', nested: { clientSecret: 'nested-canary' } } } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:02Z', data: { content: '{"api_key":"json-canary"}' } }
  ];
  const rows = contentRowsFromSession(privateEvents, 'session-test');
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /bearer-canary|password-canary|key-canary|nested-canary|json-canary/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.ok(rows.every(row => row.RedactionStatus === 'best_effort_redacted'));
});

test('oversized content is truncated with a visible marker instead of being silently dropped or kept whole', () => {
  const oversized = 'A'.repeat(CONTENT_VALUE_MAX_BYTES + 1024);
  const oversizedEvents = [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00Z', data: { content: oversized } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:01Z', data: { content: 'short reply', model: 'test-model' } }
  ];
  const rows = contentRowsFromSession(oversizedEvents, 'session-test');
  assert.equal(rows.length, 2);
  const [promptRow, responseRow] = rows;
  assert.equal(promptRow.Truncated, true);
  assert.ok(Buffer.byteLength(promptRow.PromptText) <= CONTENT_VALUE_MAX_BYTES);
  assert.ok(promptRow.PromptText.length < oversized.length);
  assert.equal(promptRow.ContentLength, Buffer.byteLength(promptRow.PromptText));
  assert.equal(responseRow.Truncated, false);
});

test('delete-content preview reports what would be removed without deleting anything', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-delete-'));
  try {
    const output = path.join(directory, 'AgentOpsContent_CL.jsonl');
    writeSessionContent(events, 'session-test', output, 'run-a');
    const preview = contentDeletionPreview(output, 'session-test', 'run-a');
    assert.equal(preview.exists, true);
    assert.equal(preview.rows, 4);
    assert.ok(fs.existsSync(output), 'preview must not delete the file');
    const deletePreview = deleteSessionContent(output, 'session-test', 'run-a');
    assert.equal(deletePreview.mode, 'preview');
    assert.equal(deletePreview.deleted, false);
    assert.ok(fs.existsSync(output), 'default (no confirm) must not delete the file');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('delete-content with confirm removes only the exact selected session/run file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-delete-confirm-'));
  try {
    const selected = path.join(directory, 'selected', 'AgentOpsContent_CL.jsonl');
    const other = path.join(directory, 'other', 'AgentOpsContent_CL.jsonl');
    fs.mkdirSync(path.dirname(selected), { recursive: true });
    fs.mkdirSync(path.dirname(other), { recursive: true });
    writeSessionContent(events, 'session-test', selected, 'run-a');
    writeSessionContent(events, 'session-test', other, 'run-b');
    const result = deleteSessionContent(selected, 'session-test', 'run-a', { confirm: true });
    assert.equal(result.mode, 'confirmed');
    assert.equal(result.deleted, true);
    assert.ok(!fs.existsSync(selected), 'the selected run file must be deleted');
    assert.ok(fs.existsSync(other), 'an unrelated run file must never be touched');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('delete-content refuses a file that is not exclusively the selected session/run', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-delete-mismatch-'));
  try {
    const output = path.join(directory, 'AgentOpsContent_CL.jsonl');
    writeSessionContent(events, 'session-test', output, 'run-a');
    assert.throws(() => contentDeletionPreview(output, 'session-test', 'run-other'), /not exclusive/);
    assert.throws(() => deleteSessionContent(output, 'session-test', 'run-other', { confirm: true }), /not exclusive/);
    assert.ok(fs.existsSync(output), 'a mismatched file must never be deleted');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('delete-content requires the AgentOpsContent_CL.jsonl file name and reports a missing file without throwing in preview mode', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-delete-naming-'));
  try {
    assert.throws(() => contentDeletionPreview(path.join(directory, 'other.jsonl'), 'session-test', 'run-a'), /AgentOpsContent_CL/);
    const missing = contentDeletionPreview(path.join(directory, 'AgentOpsContent_CL.jsonl'), 'session-test', 'run-a');
    assert.equal(missing.exists, false);
    assert.equal(missing.rows, 0);
    assert.throws(() => deleteSessionContent(path.join(directory, 'AgentOpsContent_CL.jsonl'), 'session-test', 'run-a', { confirm: true }), /not found/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

