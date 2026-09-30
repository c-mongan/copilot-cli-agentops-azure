const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { canonicalJson, createDurableEvidenceSpool } = require('../src/lib/azure/durable-evidence-spool');

function tempSpool(t, options = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-durable-spool-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = path.join(parent, 'queue');
  return { directory, spool: createDurableEvidenceSpool({ directory, ...options }) };
}

function row(sequence = 1) {
  return {
    RunId: 'run-safe-1',
    SessionId: 'session-safe-1',
    Sequence: sequence,
    EventName: 'tool.completed',
    ToolName: 'shell.test',
    Status: 'passed',
    PrivacyMode: 'strict',
    ContentCaptureMode: 'off'
  };
}

test('durable evidence spool writes atomic private metadata-only segments', {
  skip: process.platform === 'win32'
}, t => {
  const { directory, spool } = tempSpool(t);
  const queued = spool.enqueue(row());

  assert.equal(queued.status, 'pending');
  assert.match(queued.event_id, /^event_/);
  assert.equal(queued.row_hash.length, 64);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(queued.file).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
  const persisted = JSON.parse(fs.readFileSync(queued.file, 'utf8'));
  assert.equal(persisted.row.EventId, queued.event_id);
  assert.equal(persisted.row.Sequence, 1);
  assert.equal(persisted.row.PrivacyMode, 'strict');
  assert.equal(persisted.row.ContentCaptureMode, 'off');
});

test('durable evidence spool preserves precise cost without illegal Azure type coercion', t => {
  const { spool } = tempSpool(t);
  const fractional = spool.enqueue({ ...row(1), EstimatedCostUsd: 0.125 });
  const fractionalRow = JSON.parse(fs.readFileSync(fractional.file, 'utf8')).row;
  assert.equal(fractionalRow.EstimatedCostUsdReal, 0.125);
  assert.equal(Object.hasOwn(fractionalRow, 'EstimatedCostUsd'), false);

  const integer = spool.enqueue({ ...row(2), EstimatedCostUsd: 2 });
  const integerRow = JSON.parse(fs.readFileSync(integer.file, 'utf8')).row;
  assert.equal(integerRow.EstimatedCostUsd, 2);
  assert.equal(integerRow.EstimatedCostUsdReal, 2);
});

test('durable evidence spool rejects poison, unknown fields, and nested payloads', t => {
  const { spool } = tempSpool(t);

  assert.throws(() => spool.enqueue({ ...row(), Prompt: 'SECRET_PROMPT' }), /non-allowlisted.*Prompt/);
  assert.throws(() => spool.enqueue({ ...row(), ToolName: { arguments: 'SECRET_TOOL_ARGS' } }), /must be scalar metadata/);
  assert.throws(() => spool.enqueue({ ...row(), RunId: '' }), /requires RunId/);
  assert.throws(() => spool.enqueue({ ...row(), DurationMs: 'slow' }), /DurationMs must be a non-negative integer/);
  assert.throws(() => spool.enqueue({ ...row(), SecretLike: 'false' }), /SecretLike must be boolean/);
  assert.throws(() => spool.enqueue({ ...row(), TimeGenerated: 'yesterday-ish' }), /valid datetime/);
  assert.throws(() => spool.enqueue(row(), { table: 'UnsafeContent_CL' }), /table is not allowlisted/);
  assert.equal(spool.status().pending, 0);
});

test('durable evidence spool accepts only canonical tables and safe storage bounds', t => {
  const { directory, spool } = tempSpool(t);
  assert.throws(
    () => spool.enqueue(row(), { table: 'AgentOpsLooksSafeButIsNot_CL' }),
    /table is not allowlisted/
  );
  assert.throws(() => createDurableEvidenceSpool({ directory, maxBytes: -1 }), /maxBytes/);
  assert.throws(
    () => createDurableEvidenceSpool({ directory, ttlMs: 31 * 24 * 60 * 60 * 1000 }),
    /ttlMs/
  );
  assert.throws(() => spool.enqueue(row(), { table: 'AgentOpsRunSummary_CL' }), /not allowlisted/);
  assert.throws(() => spool.enqueue({ ...row(), SpanId: 'not-in-events-schema' }), /non-allowlisted.*SpanId/);
});

test('durable evidence spool rejects symlink roots and segment symlinks', {
  skip: process.platform === 'win32'
}, t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-durable-symlink-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const target = path.join(parent, 'target');
  fs.mkdirSync(target);
  const rootLink = path.join(parent, 'queue-link');
  fs.symlinkSync(target, rootLink, 'dir');
  assert.throws(() => createDurableEvidenceSpool({ directory: rootLink }), /not a symlink/);

  const { directory, spool } = tempSpool(t);
  const outside = path.join(parent, 'outside.json');
  fs.writeFileSync(outside, '{}');
  fs.symlinkSync(outside, path.join(directory, '0001.pending.json'));
  assert.throws(() => spool.status(), /segment must be a regular file/);
});

test('durable evidence spool reports bounded overflow and TTL expiry', async t => {
  let clock = Date.parse('2026-08-03T12:00:00Z');
  const { spool } = tempSpool(t, { maxBytes: 1, ttlMs: 1000, now: () => clock });
  const overflow = spool.enqueue(row());
  assert.equal(overflow.status, 'overflow');
  assert.equal(spool.status().overflow, 1);

  const second = tempSpool(t, { maxBytes: 100000, ttlMs: 1000, now: () => clock }).spool;
  second.enqueue(row());
  clock += 1001;
  const drained = await second.drain(async () => ({ status: 200 }));
  assert.equal(drained.expired, 1);
  assert.equal(drained.status.expired, 1);
  assert.equal(drained.status.pending, 0);
});

test('durable delivery drain scopes lifecycle uploads by run and event ID', async t => {
  const { spool } = tempSpool(t);
  const firstRun = spool.enqueue({ ...row(1), RunId: 'run-scope-a' });
  const secondRun = spool.enqueue({ ...row(2), RunId: 'run-scope-b' });
  const anotherFirstRun = spool.enqueue({ ...row(3), RunId: 'run-scope-a' });
  const sent = [];

  const runDrain = await spool.drain(async evidence => {
    sent.push(evidence.EventId);
    return { status: 204 };
  }, { runId: 'run-scope-a' });

  assert.deepEqual(new Set(sent), new Set([firstRun.event_id, anotherFirstRun.event_id]));
  assert.equal(runDrain.scope_matched, 2);
  assert.equal(runDrain.skipped_scope, 1);
  assert.equal(runDrain.status.pending, 1);
  assert.equal(fs.existsSync(secondRun.file), true);

  sent.length = 0;
  const eventDrain = await spool.drain(async evidence => {
    sent.push(evidence.EventId);
    return { status: 204 };
  }, { eventIds: [secondRun.event_id] });
  assert.deepEqual(sent, [secondRun.event_id]);
  assert.equal(eventDrain.scope_matched, 1);
  assert.equal(eventDrain.status.pending, 0);
});

test('scoped restart recovery preserves stale claims from other runs and events', async t => {
  const { directory, spool } = tempSpool(t, { claimLeaseMs: 20 });
  const interrupted = spool.enqueue({ ...row(1), RunId: 'run-recovery-a' });
  const otherRun = spool.enqueue({ ...row(2), RunId: 'run-recovery-b' });

  await assert.rejects(spool.drain(async () => ({ status: 204 }), {
    afterUploadBeforeAck() { throw new Error('simulated process exit after remote acceptance'); }
  }), /simulated process exit/);
  await new Promise(resolve => setTimeout(resolve, 35));

  const restarted = createDurableEvidenceSpool({ directory, claimLeaseMs: 20 });
  const selectedRunUploads = [];
  const runDrain = await restarted.drain(async evidence => {
    selectedRunUploads.push(evidence.EventId);
    return { status: 204 };
  }, { runId: 'run-recovery-b' });
  assert.deepEqual(selectedRunUploads, [otherRun.event_id]);
  assert.equal(runDrain.recovered, 0);
  assert.equal(runDrain.acknowledged, 1);
  assert.equal(restarted.status().uploading, 1);
  assert.equal(fs.existsSync(interrupted.file.replace('.pending.json', '.uploading.json')), true);

  const unrelatedEventDrain = await restarted.drain(async () => {
    assert.fail('a different event ID must not recover or upload the stale claim');
  }, { eventIds: ['event-not-selected'] });
  assert.equal(unrelatedEventDrain.recovered, 0);
  assert.equal(restarted.status().uploading, 1);

  const selectedEventUploads = [];
  const eventDrain = await restarted.drain(async evidence => {
    selectedEventUploads.push(evidence.EventId);
    return { status: 204 };
  }, { eventIds: [interrupted.event_id] });
  assert.deepEqual(selectedEventUploads, [interrupted.event_id]);
  assert.equal(eventDrain.recovered, 1);
  assert.equal(eventDrain.acknowledged, 1);
  assert.equal(restarted.status().pending, 0);
  assert.equal(restarted.status().uploading, 0);
});

test('durable evidence prune is preview-first and deletes only old held segments', async t => {
  const { directory, spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  await spool.drain(async () => ({ status: 400 }));
  const heldName = fs.readdirSync(directory).find(name => name.endsWith('.quarantined.json'));
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
  fs.utimesSync(path.join(directory, heldName), new Date(old), new Date(old));
  const recent = spool.enqueue(row(2));

  assert.ok(queued.event_id);
  assert.throws(() => spool.pruneHeld({ olderThanDays: 29 }), /30 to 365 days/);
  const preview = spool.pruneHeld({ olderThanDays: 30 });
  assert.equal(preview.applied, false);
  assert.equal(preview.candidates.length, 1);
  assert.equal(fs.existsSync(path.join(directory, heldName)), true);

  const applied = spool.pruneHeld({ olderThanDays: 30, apply: true });
  assert.equal(applied.removed.length, 1);
  assert.equal(fs.existsSync(path.join(directory, heldName)), false);
  assert.equal(fs.existsSync(recent.file), true);
  assert.equal(spool.status().pending, 1);
});

test('durable evidence spool retries network and retryable HTTP failures and honors Retry-After', async t => {
  let calls = 0;
  const sleeps = [];
  const { spool } = tempSpool(t, { sleep: async ms => sleeps.push(ms), now: () => 1000 });
  const queued = spool.enqueue(row());

  const drained = await spool.drain(async () => {
    calls += 1;
    if (calls === 1) throw new Error('network unavailable');
    if (calls === 2) return { status: 429, headers: { 'Retry-After': '3' } };
    return { status: 204 };
  }, { maxAttempts: 3 });

  assert.equal(drained.acknowledged, 1);
  assert.deepEqual(drained.acknowledged_event_ids, [queued.event_id]);
  assert.equal(drained.status.acknowledged, 1);
  assert.equal(drained.status.pending, 0);
  assert.deepEqual(sleeps, [250, 3000]);
});

test('durable evidence spool caps retry controls and keeps auth failures pending', async t => {
  const sleeps = [];
  const { spool } = tempSpool(t, { sleep: async ms => sleeps.push(ms) });
  spool.enqueue(row());
  const drained = await spool.drain(async () => ({ status: 403, headers: { 'retry-after': '999999' } }), { maxAttempts: 2 });
  assert.equal(drained.pending, 1);
  assert.equal(drained.quarantined, 0);
  assert.deepEqual(sleeps, [60000]);
  await assert.rejects(spool.drain(async () => ({ status: 503 }), { maxAttempts: 11 }), /maxAttempts/);
  await assert.rejects(spool.drain(async () => ({ status: 503 }), { maxAttempts: Infinity }), /maxAttempts/);
});

test('durable evidence spool leaves exhausted transient failures pending and quarantines permanent 4xx', async t => {
  const { spool } = tempSpool(t, { sleep: async () => {} });
  spool.enqueue(row(1));
  spool.enqueue(row(2));
  let item = 0;

  const drained = await spool.drain(async () => {
    item += 1;
    return item <= 2 ? { status: 503 } : { status: 400 };
  }, { maxAttempts: 2 });

  assert.equal(drained.pending, 1);
  assert.equal(drained.quarantined, 1);
  assert.equal(drained.status.pending, 1);
  assert.equal(drained.status.quarantined, 1);
});

test('held evidence review omits payloads and only requeues valid non-expired quarantined rows', async t => {
  let clock = Date.parse('2026-08-03T12:00:00Z');
  const { directory, spool } = tempSpool(t, { now: () => clock, ttlMs: 60_000 });
  const queued = spool.enqueue(row());
  await spool.drain(async () => ({ status: 400 }));
  const held = spool.inspectHeld({ eventId: queued.event_id });
  assert.equal(held.length, 1);
  assert.equal(held[0].integrity, 'valid');
  assert.equal(held[0].requeueable, true);
  assert.equal(Object.hasOwn(held[0], 'row'), false);
  assert.equal(Object.hasOwn(held[0], 'ToolName'), false);

  const requeued = spool.requeueHeld(queued.event_id);
  assert.equal(requeued.status, 'pending');
  assert.equal(spool.status().pending, 1);
  assert.equal(spool.inspectHeld().length, 0);
  const retried = await spool.drain(async () => ({ status: 204 }));
  assert.equal(retried.acknowledged, 1);

  const expired = spool.enqueue(row(2));
  await spool.drain(async () => ({ status: 400 }));
  clock += 60_001;
  assert.equal(spool.inspectHeld({ eventId: expired.event_id })[0].requeueable, false);
  assert.equal(spool.requeueHeld(expired.event_id).status, 'expired');
  assert.equal(spool.inspectHeld({ eventId: expired.event_id })[0].state, 'quarantined');
});

test('held evidence requeue refuses corrupted rows and conflicting pending identities', async t => {
  const { directory, spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  await spool.drain(async () => ({ status: 400 }));
  const heldFile = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.quarantined.json')));
  const segment = JSON.parse(fs.readFileSync(heldFile, 'utf8'));
  segment.row.ToolName = 'tampered';
  fs.writeFileSync(heldFile, JSON.stringify(segment));
  assert.equal(spool.inspectHeld({ eventId: queued.event_id })[0].integrity, 'invalid');
  assert.equal(spool.requeueHeld(queued.event_id).status, 'invalid');
  assert.equal(fs.existsSync(heldFile), true);

  const conflictCase = tempSpool(t);
  const original = conflictCase.spool.enqueue(row());
  await conflictCase.spool.drain(async () => ({ status: 400 }));
  conflictCase.spool.enqueue({ ...row(2), EventId: original.event_id, ToolName: 'shell.different' });
  assert.equal(conflictCase.spool.requeueHeld(original.event_id).status, 'conflict');
  assert.equal(conflictCase.spool.status().quarantined, 1);
  assert.equal(conflictCase.spool.status().pending, 1);
});

test('durable evidence spool is restart-safe and deliberately permits duplicate resend before atomic ack', async t => {
  const { directory, spool } = tempSpool(t, { claimLeaseMs: 20 });
  const queued = spool.enqueue(row());
  const sent = [];

  await assert.rejects(spool.drain(async (evidence, context) => {
    sent.push([evidence.EventId, context.rowHash]);
    return { status: 200 };
  }, {
    afterUploadBeforeAck() { throw new Error('simulated process crash after remote acceptance'); }
  }), /simulated process crash/);
  assert.equal(spool.status().pending, 0);
  assert.equal(spool.status().uploading, 1);

  await new Promise(resolve => setTimeout(resolve, 30));

  const restarted = createDurableEvidenceSpool({ directory, claimLeaseMs: 20 });
  const drained = await restarted.drain(async (evidence, context) => {
    sent.push([evidence.EventId, context.rowHash]);
    return { status: 200 };
  });

  assert.equal(drained.acknowledged, 1);
  assert.equal(restarted.status().pending, 0);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[0][0], queued.event_id);
});

test('durable evidence spool deduplicates the same pending event across instances and restart', t => {
  const { directory, spool } = tempSpool(t);
  const first = spool.enqueue(row());
  const secondInstance = createDurableEvidenceSpool({ directory });
  const duplicate = secondInstance.enqueue(row());
  const restarted = createDurableEvidenceSpool({ directory });
  const restartDuplicate = restarted.enqueue(row());

  assert.equal(first.status, 'pending');
  assert.equal(duplicate.status, 'deduplicated');
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.file, first.file);
  assert.equal(restartDuplicate.status, 'deduplicated');
  assert.equal(restartDuplicate.row_hash, first.row_hash);
  assert.equal(restarted.status().pending, 1);
});

test('two concurrent spool instances claim once and do not corrupt shared state', async t => {
  const { directory, spool } = tempSpool(t, { claimLeaseMs: 30 });
  spool.enqueue(row());
  const secondInstance = createDurableEvidenceSpool({ directory, claimLeaseMs: 30 });
  let uploads = 0;
  const uploader = async () => {
    uploads += 1;
    await new Promise(resolve => setTimeout(resolve, 90));
    return { status: 204 };
  };

  const firstDrain = spool.drain(uploader);
  await new Promise(resolve => setTimeout(resolve, 50));
  const secondDrain = secondInstance.drain(uploader);
  const [first, second] = await Promise.all([firstDrain, secondDrain]);

  assert.equal(uploads, 1);
  assert.equal(first.acknowledged + second.acknowledged, 1);
  assert.equal(first.claimed + second.claimed, 1);
  assert.equal(spool.status().pending, 0);
  assert.equal(spool.status().uploading, 0);
  assert.equal(spool.status().acknowledged, 1);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
});

test('durable evidence spool quarantines corrupted segments before upload', async t => {
  const { spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  const segment = JSON.parse(fs.readFileSync(queued.file, 'utf8'));
  segment.row.ToolName = 'tampered';
  fs.writeFileSync(queued.file, JSON.stringify(segment), { mode: 0o600 });
  let uploaded = false;

  const drained = await spool.drain(async () => {
    uploaded = true;
    return { status: 200 };
  });

  assert.equal(uploaded, false);
  assert.equal(drained.quarantined, 1);
  assert.equal(drained.status.quarantined, 1);
});

test('durable evidence spool revalidates allowlisted metadata after restart even with a matching hash', async t => {
  const { spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  const segment = JSON.parse(fs.readFileSync(queued.file, 'utf8'));
  segment.row.Prompt = 'SECRET_PROMPT_AFTER_RESTART';
  segment.row_hash = crypto.createHash('sha256').update(canonicalJson(segment.row)).digest('hex');
  fs.writeFileSync(queued.file, JSON.stringify(segment), { mode: 0o600 });
  let uploaded = false;

  const drained = await spool.drain(async () => {
    uploaded = true;
    return { status: 200 };
  });

  assert.equal(uploaded, false);
  assert.equal(drained.quarantined, 1);
  assert.doesNotMatch(JSON.stringify(drained), /SECRET_PROMPT_AFTER_RESTART/);
});

test('durable evidence spool quarantines a non-canonical table after restart', async t => {
  const { spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  const segment = JSON.parse(fs.readFileSync(queued.file, 'utf8'));
  segment.table = 'AgentOpsLooksSafeButIsNot_CL';
  fs.writeFileSync(queued.file, JSON.stringify(segment), { mode: 0o600 });
  let uploaded = false;

  const drained = await spool.drain(async () => {
    uploaded = true;
    return { status: 200 };
  });

  assert.equal(uploaded, false);
  assert.equal(drained.quarantined, 1);
});

test('durable evidence spool authenticates immutable envelope metadata and fails closed on invalid TTL', async t => {
  const { spool } = tempSpool(t);
  const queued = spool.enqueue(row());
  const segment = JSON.parse(fs.readFileSync(queued.file, 'utf8'));
  segment.expires_at = 'not-a-date';
  fs.writeFileSync(queued.file, JSON.stringify(segment), { mode: 0o600 });
  let uploaded = false;
  const drained = await spool.drain(async () => { uploaded = true; return { status: 204 }; });
  assert.equal(uploaded, false);
  assert.equal(drained.quarantined, 1);
});
