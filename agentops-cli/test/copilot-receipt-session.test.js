const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  changedCopilotSession,
  snapshotCopilotSessions,
  summarizeSessionEvents
} = require('../src/lib/copilot/receipt-session');

test('receipt session summary extracts only safe operational metadata', () => {
  const summary = summarizeSessionEvents([
    { type: 'session.start', data: { sessionId: 'session-safe', context: { cwd: '/private/repo' } } },
    { type: 'session.model_change', data: { newModel: 'gpt-5.6-sol' } },
    { type: 'assistant.message', data: { content: 'SECRET_FAKE_VALUE', toolRequests: [{ name: 'skill', arguments: { name: 'private' } }, { name: 'read_file', arguments: { path: '/secret' } }] } },
    { type: 'session.shutdown', data: {
      totalNanoAiu: 12600000000,
      totalApiDurationMs: 2012,
      tokenDetails: { input: { tokenCount: 3 }, cache_read: { tokenCount: 5 }, cache_write: { tokenCount: 20 }, output: { tokenCount: 8 } },
      codeChanges: { filesModified: ['secret.js'], linesAdded: 4, linesRemoved: 2 }
    } }
  ]);

  assert.deepEqual(summary, {
    sessionId: 'session-safe',
    model: 'gpt-5.6-sol',
    inputTokens: 28,
    outputTokens: 8,
    aiCredits: 12.6,
    apiDurationMs: 2012,
    tools: ['skill', 'read_file'],
    filesModified: 1,
    linesAdded: 4,
    linesRemoved: 2
  });
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|private|secret\.js|\/secret/);
});

test('changed session detection selects the newest created or updated event stream', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-receipt-session-'));
  const root = path.join(home, '.copilot', 'session-state');
  fs.mkdirSync(path.join(root, 'session-a'), { recursive: true });
  const file = path.join(root, 'session-a', 'events.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'session.start', data: { sessionId: 'session-a' } })}\n`);
  const before = snapshotCopilotSessions(root);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'session.model_change', data: { newModel: 'gpt-5.6-sol' } })}\n`);
  const now = new Date(Date.now() + 1000);
  fs.utimesSync(file, now, now);

  const summary = changedCopilotSession(before, root);
  assert.equal(summary.sessionId, 'session-a');
  assert.equal(summary.model, 'gpt-5.6-sol');
});
