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
