const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createWrapperDelivery } = require('../src/lib/copilot/wrapper-delivery');

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-wrapper-delivery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('wrapper delivery fsyncs canonical lifecycle evidence and deduplicates restart', t => {
  const directory = tempDirectory(t);
  const event = { RunId: 'run-safe', SessionId: 'session-safe', EventName: 'agentops.run.start', Reason: 'SECRET' };
  const first = createWrapperDelivery({ directory }).record(event, { sequence: 1, timeGenerated: '2026-08-03T12:00:00.000Z' });
  const second = createWrapperDelivery({ directory }).record(event, { sequence: 1, timeGenerated: '2026-08-03T12:00:00.000Z' });
  assert.equal(first.state, 'local_pending');
  assert.equal(second.queued.status, 'deduplicated');
  assert.doesNotMatch(fs.readFileSync(first.queued.file, 'utf8'), /SECRET|Reason/);
});

test('wrapper delivery remains pending without cloud config', async t => {
  const delivery = createWrapperDelivery({ directory: tempDirectory(t), env: {} });
  const recorded = delivery.record({ RunId: 'run-safe', SessionId: 'session-safe', EventName: 'agentops.run.end', ExitCode: 0 }, { sequence: 2 });
  const drained = await delivery.drain([recorded.evidence.EventId], { cloud: {} });
  assert.equal(drained.configured, false);
  assert.equal(drained.state, 'local_pending');
});

test('wrapper delivery reports Azure acceptance only for the exact acknowledged event', async t => {
  const directory = tempDirectory(t);
  const delivery = createWrapperDelivery({ directory, env: { AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: '11111111-1111-4111-8111-111111111111' } });
  const recorded = delivery.record({ RunId: 'run-safe', SessionId: 'session-safe', EventName: 'agentops.run.end', ExitCode: 0 }, { sequence: 2 });
  let tokenCalls = 0;
  const drained = await delivery.drain([recorded.evidence.EventId], {
    cloud: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    },
    spawnSync() { return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' }; },
    tokenProvider: async () => `token-${++tokenCalls}`,
    fetchImpl: async () => ({ status: 204, headers: {}, body: { cancel: async () => {} } })
  });
  assert.equal(drained.state, 'azure_acknowledged');
  assert.equal(drained.result.acknowledged, 1);
});

test('operator drain reports Azure acceptance when every claimed row was accepted', async t => {
  const directory = tempDirectory(t);
  const delivery = createWrapperDelivery({ directory, env: { AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: '11111111-1111-4111-8111-111111111111' } });
  delivery.record(
    { RunId: 'run-operator', SessionId: 'session-operator', EventName: 'agentops.run.start' },
    { sequence: 1 }
  );
  const drained = await delivery.drain([], {
    cloud: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://safe.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-safe'
    },
    spawnSync() { return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' }; },
    tokenProvider: async () => 'token',
    fetchImpl: async () => ({ status: 204, headers: {}, body: { cancel: async () => {} } })
  });
  assert.equal(drained.state, 'azure_acknowledged');
  assert.equal(drained.result.status.pending, 0);
});
