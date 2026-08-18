const assert = require('node:assert/strict');
const test = require('node:test');

const { canonicalWrapperEvidence } = require('../src/lib/copilot/wrapper-evidence');
const { safeWrapperEvent } = require('../src/lib/copilot/wrapper-envelope');

test('wrapper lifecycle evidence is deterministic ordered and strict metadata only', () => {
  const raw = {
    RunId: 'wrapper_run_safe',
    SessionId: 'wrapper_session_safe',
    EventName: 'agentops.run.end',
    ExitCode: 0,
    Reason: 'SECRET reason must not persist',
    Error: 'SECRET error must not persist',
    Prompt: 'SECRET prompt must not persist'
  };
  const first = canonicalWrapperEvidence(raw, { sequence: 2, timeGenerated: '2026-08-03T12:00:00.000Z' });
  const again = canonicalWrapperEvidence(raw, { sequence: 2, timeGenerated: '2026-08-03T12:00:00.000Z' });

  assert.deepEqual(first, again);
  assert.equal(first.Sequence, 2);
  assert.equal(first.Status, 'success');
  assert.equal(first.PrivacyMode, 'strict');
  assert.equal(first.ContentCaptureMode, 'off');
  assert.doesNotMatch(JSON.stringify(first), /SECRET|Reason|Error|Prompt/);
});

test('wrapper lifecycle evidence gives distinct stable IDs and safe statuses', () => {
  const base = { RunId: 'run-safe', SessionId: 'session-safe' };
  const start = canonicalWrapperEvidence({ ...base, EventName: 'agentops.run.start' }, { sequence: 1 });
  const end = canonicalWrapperEvidence({ ...base, EventName: 'agentops.run.end', ExitCode: 2 }, { sequence: 2 });
  const fallback = canonicalWrapperEvidence({ ...base, EventName: 'agentops.wrapper.fallback_unobserved' }, { sequence: 3 });
  assert.notEqual(start.EventId, end.EventId);
  assert.equal(start.Status, 'started');
  assert.equal(end.Status, 'failed');
  assert.equal(fallback.Status, 'unobserved');
});

test('wrapper lifecycle evidence rejects unsafe identity event and sequence', () => {
  assert.throws(() => canonicalWrapperEvidence({ RunId: 'unsafe\nrun', SessionId: 'safe', EventName: 'agentops.run.start' }, { sequence: 1 }), /safe RunId/);
  assert.throws(() => canonicalWrapperEvidence({ RunId: 'safe', SessionId: 'safe', EventName: 'unknown' }, { sequence: 1 }), /Unsupported/);
  assert.throws(() => canonicalWrapperEvidence({ RunId: 'safe', SessionId: 'safe', EventName: 'agentops.run.start' }, { sequence: 0 }), /positive sequence/);
});

test('local wrapper JSONL projection never stores raw error text', () => {
  const row = safeWrapperEvent({
    EventName: 'agentops.collector.start_failed',
    RunId: 'run-safe',
    SessionId: 'session-safe',
    Reason: 'SECRET path /private/source/file.js'
  });
  assert.equal(row.ReasonCategory, 'collector_start_failed');
  assert.doesNotMatch(JSON.stringify(row), /SECRET|private|source|Reason":/);
});
