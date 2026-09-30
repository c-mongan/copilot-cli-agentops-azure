const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { renderDelivery, runDeliveryCommand } = require('../src/lib/delivery-command');
const { initializeSessionOutbox, readSessionOutbox } = require('../src/lib/copilot/session-delivery-outbox');

function fakeDelivery() {
  return {
    status: () => ({ pending: 2, quarantined: 0 }),
    async drain(ids, options) {
      assert.deepEqual(ids, []);
      assert.equal(options.cloud.subscriptionId, '11111111-1111-4111-8111-111111111111');
      return {
        ok: true,
        configured: true,
        state: 'local_pending',
        result: { acknowledged: 1, status: { pending: 1, quarantined: 0 } }
      };
    }
  };
}

test('delivery drain is preview-only without explicit yes', async () => {
  let created = 0;
  const result = await runDeliveryCommand(['drain'], {
    createDelivery() { created += 1; return fakeDelivery(); },
    config: {}
  });
  assert.equal(created, 1);
  assert.equal(result.executed, false);
  assert.match(renderDelivery(result), /No Azure request was made/);
});

test('delivery status explains local queue, Azure acceptance, and the next action in plain language', () => {
  const empty = renderDelivery({
    action: 'status',
    state: 'azure_acknowledged',
    pending: 0,
    quarantined: 0,
    expired: 0,
    acknowledged_cumulative: 4,
    overflow_cumulative: 0,
    sessionPending: 0,
    sessionAccepted: 7,
    sessionRuns: 1,
    directory: '/tmp/agentops-delivery'
  });
  assert.doesNotMatch(empty, /azure_acknowledged|State:/);
  assert.match(empty, /Local queue: nothing waiting/);
  assert.match(empty, /Accepted by Azure ingestion: 4 total/);
  assert.match(empty, /Copilot session batches accepted by Azure: 7 total/);
  assert.match(empty, /does not by itself prove the events are searchable yet/);
  assert.match(empty, /Next: no delivery action is needed/);

  const waitingSessions = renderDelivery({
    action: 'status', pending: 0, quarantined: 0, expired: 0,
    sessionPending: 2, sessionRuns: 1, directory: '/tmp/agentops-delivery'
  });
  assert.match(waitingSessions, /2 session batch\(es\) waiting to send/);
  assert.match(waitingSessions, /Copilot session batches waiting: 2 \(1 run\)/);

  const waiting = renderDelivery({
    action: 'status',
    state: 'local_pending',
    pending: 2,
    quarantined: 0,
    expired: 0,
    directory: '/tmp/agentops-delivery'
  });
  assert.match(waiting, /2 receipt events waiting to send/);
  assert.match(waiting, /agentops delivery drain to preview/);
});

test('empty drain preview says there is nothing to send', () => {
  const output = renderDelivery({ action: 'drain', executed: false, before: { pending: 0 } });
  assert.match(output, /Nothing is waiting, so there is nothing to send/);
  assert.doesNotMatch(output, /Run with --yes/);

  const sessionOutput = renderDelivery({ action: 'drain', executed: false, before: { pending: 0, sessionPending: 1 } });
  assert.match(sessionOutput, /1 session batch/);
  assert.match(sessionOutput, /Run with --yes only after reviewing/);
  assert.doesNotMatch(sessionOutput, /Nothing is waiting/);
});

test('delivery drain passes exact configured destination only after yes', async () => {
  const result = await runDeliveryCommand(['drain', '--yes'], {
    createDelivery: fakeDelivery,
    env: {},
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    }
  });
  assert.equal(result.executed, true);
  assert.equal(result.result.acknowledged, 1);
});

test('delivery drain passes run and event scope through to lifecycle and session delivery', async () => {
  let drainOptions;
  let sessionOptions;
  const result = await runDeliveryCommand(['drain', '--yes', '--run-id', 'run-selected', '--event-id', 'event-selected'], {
    createDelivery() {
      return {
        status: () => ({ pending: 9 }),
        async drain(ids, options) {
          assert.deepEqual(ids, ['event-selected']);
          drainOptions = options;
          return { state: 'azure_acknowledged', result: { acknowledged: 1, pending: 0, expired: 0, quarantined: 0 } };
        }
      };
    },
    agentopsHome: '/tmp/agentops-scoped-drain-test',
    drainSessions(options) {
      sessionOptions = options;
      return { acknowledged: 1, pending: 0, skippedTarget: 0, skippedBusy: 0 };
    },
    env: {},
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    }
  });
  assert.equal(drainOptions.runId, 'run-selected');
  assert.deepEqual(drainOptions.eventIds, ['event-selected']);
  assert.equal(sessionOptions.runId, 'run-selected');
  assert.equal(result.state, 'azure_acknowledged');
  assert.match(renderDelivery(result), /Scope: run run-selected and event event-selected/);
});

test('event-only drain does not include per-run session outboxes', async () => {
  let drainOptions;
  let sessionDrainCalled = false;
  const result = await runDeliveryCommand(['drain', '--yes', '--event-id', 'event-only'], {
    createDelivery() {
      return {
        status: () => ({ pending: 4 }),
        async drain(ids, options) {
          assert.deepEqual(ids, ['event-only']);
          drainOptions = options;
          return { state: 'azure_acknowledged', result: { acknowledged: 1, pending: 0, expired: 0, quarantined: 0 } };
        }
      };
    },
    drainSessions() { sessionDrainCalled = true; throw new Error('event-only scope must not drain session batches'); },
    env: {},
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    }
  });
  assert.equal(drainOptions.runId, null);
  assert.deepEqual(drainOptions.eventIds, ['event-only']);
  assert.equal(sessionDrainCalled, false);
  assert.equal(result.state, 'azure_acknowledged');
});

test('scoped delivery preview names its scope and makes no upload call', async () => {
  let drainCalled = false;
  const result = await runDeliveryCommand(['drain', '--run-id', 'run-preview'], {
    createDelivery() {
      return {
        status: () => ({ pending: 20 }),
        async drain() { drainCalled = true; throw new Error('preview must not drain'); }
      };
    },
    agentopsHome: '/tmp/agentops-scoped-preview-test',
    env: {},
    config: {}
  });
  assert.equal(result.executed, false);
  assert.equal(drainCalled, false);
  assert.match(renderDelivery(result), /Scope: run run-preview/);
  assert.match(renderDelivery(result), /apply will send only the selected scope/);
  assert.match(renderDelivery(result), /Queue totals below are local status counts/);
});

test('delivery drain also resumes per-run session batches with the selected target', async () => {
  let sessions;
  const result = await runDeliveryCommand(['drain', '--yes'], {
    createDelivery() {
      return {
        status: () => ({ pending: 0 }),
        async drain() { return { ok: true, configured: true, state: 'azure_acknowledged', result: { acknowledged: 0, status: { pending: 0 } } }; }
      };
    },
    agentopsHome: '/tmp/agentops-session-delivery-test',
    drainSessions(options) {
      sessions = options;
      return { acknowledged: 1, pending: 0, skippedTarget: 0, streams: [] };
    },
    env: {},
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    }
  });
  assert.equal(sessions.agentopsHome, '/tmp/agentops-session-delivery-test');
  assert.equal(sessions.cloud.subscriptionId, '11111111-1111-4111-8111-111111111111');
  assert.equal(sessions.cloud.logsIngestionEndpoint, 'https://safe.ingest.monitor.azure.com');
  assert.equal(sessions.cloud.dcrImmutableId, 'dcr-safe');
  assert.equal(result.sessions.acknowledged, 1);
  assert.equal(result.state, 'azure_acknowledged');
});

test('delivery drain with yes still makes no request when destination is incomplete', async () => {
  const result = await runDeliveryCommand(['drain', '--yes'], {
    createDelivery: fakeDelivery,
    env: {},
    config: { subscriptionId: '11111111-1111-4111-8111-111111111111' }
  });
  assert.equal(result.executed, false);
  assert.match(result.error, /missing logs ingestion endpoint, DCR immutable ID/);
});

test('delivery review exposes held metadata only and requeue requires explicit confirmation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delivery-review-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { createDurableEvidenceSpool } = require('../src/lib/azure/durable-evidence-spool');
  const spool = createDurableEvidenceSpool({ directory });
  const queued = spool.enqueue({ RunId: 'review-run', Sequence: 1, EventName: 'tool.failed', ToolName: 'shell.synthetic' });
  await spool.drain(async () => ({ status: 400 }));

  const reviewed = await runDeliveryCommand(['review', '--event-id', queued.event_id], { directory });
  assert.equal(reviewed.records[0].requeueable, true);
  assert.doesNotMatch(renderDelivery(reviewed), /shell\.synthetic/);

  const preview = await runDeliveryCommand(['requeue', '--event-id', queued.event_id], { directory });
  assert.equal(preview.executed, false);
  assert.equal(spool.status().quarantined, 1);

  const applied = await runDeliveryCommand(['requeue', '--event-id', queued.event_id, '--yes'], { directory });
  assert.equal(applied.result.status, 'pending');
  assert.equal(spool.status().pending, 1);
  assert.match(renderDelivery(applied), /pending local delivery/);
});

test('delivery review lists session outbox state without reading or rendering payloads', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delivery-session-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentopsHome = path.join(root, 'agentops-home');
  const runId = 'wrapper_run_reviewable';
  const runDirectory = path.join(agentopsHome, 'runs', runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsEvents_CL.jsonl'), '{"RunId":"wrapper_run_reviewable","EventName":"secret-content-must-not-render"}\n');
  initializeSessionOutbox(runDirectory, { runId, sessionId: 'session-reviewable' });

  const result = await runDeliveryCommand(['review', '--run-id', runId], { agentopsHome, directory: path.join(root, 'spool') });
  assert.deepEqual(result.sessionStreams, [{ runId, kind: 'events', rows: 1, status: 'pending' }]);
  const rendered = renderDelivery(result);
  assert.match(rendered, /wrapper_run_reviewable · events · pending · 1 row/);
  assert.doesNotMatch(rendered, /secret-content-must-not-render/);
});

test('delivery prune previews first and removes only expired held and accepted local artifacts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delivery-prune-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'spool');
  const agentopsHome = path.join(root, 'agentops-home');
  const { createDurableEvidenceSpool } = require('../src/lib/azure/durable-evidence-spool');
  const spool = createDurableEvidenceSpool({ directory });
  const queued = spool.enqueue({ RunId: 'prune-held-run', Sequence: 1, EventName: 'tool.failed', ToolName: 'shell.synthetic' });
  await spool.drain(async () => ({ status: 400 }));
  const heldFile = fs.readdirSync(directory).find(name => name.endsWith('.quarantined.json'));
  const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
  fs.utimesSync(path.join(directory, heldFile), new Date(old), new Date(old));

  const runId = 'wrapper_run_expired_cli';
  const runDirectory = path.join(agentopsHome, 'runs', runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsEvents_CL.jsonl'), '{"RunId":"wrapper_run_expired_cli"}\n');
  initializeSessionOutbox(runDirectory, { runId, sessionId: 'session-expired-cli' });
  const state = readSessionOutbox(runDirectory);
  state.updatedAt = new Date(old).toISOString();
  state.streams.events.status = 'azure_accepted';
  fs.writeFileSync(path.join(runDirectory, 'session-delivery.json'), JSON.stringify(state));

  const preview = await runDeliveryCommand(['prune', '--older-than', '30'], { directory, agentopsHome });
  assert.equal(preview.executed, false);
  assert.equal(preview.lifecycle.candidates.length, 1);
  assert.equal(preview.sessions.candidates.length, 1);
  assert.equal(fs.existsSync(path.join(directory, heldFile)), true);
  assert.equal(fs.existsSync(runDirectory), true);
  assert.match(renderDelivery(preview), /No local files were removed/);

  const applied = await runDeliveryCommand(['prune', '--older-than', '30', '--yes'], { directory, agentopsHome });
  assert.equal(applied.lifecycle.removed[0].event_id, queued.event_id);
  assert.equal(applied.sessions.removed[0].run_id, runId);
  assert.equal(fs.existsSync(path.join(directory, heldFile)), false);
  assert.equal(fs.existsSync(runDirectory), false);
});

test('empty delivery prune preview does not create local spool directories', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-delivery-prune-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'not-created-spool');
  const result = await runDeliveryCommand(['prune'], { directory, agentopsHome: path.join(root, 'no-agentops-home') });
  assert.equal(result.lifecycle.candidates.length, 0);
  assert.equal(result.sessions.candidates.length, 0);
  assert.equal(fs.existsSync(directory), false);
});
