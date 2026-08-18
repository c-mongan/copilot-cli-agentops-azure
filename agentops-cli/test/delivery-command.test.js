const assert = require('node:assert/strict');
const test = require('node:test');

const { renderDelivery, runDeliveryCommand } = require('../src/lib/delivery-command');

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
    directory: '/tmp/agentops-delivery'
  });
  assert.doesNotMatch(empty, /azure_acknowledged|State:/);
  assert.match(empty, /Local queue: nothing waiting/);
  assert.match(empty, /Accepted by Azure ingestion: 4 total/);
  assert.match(empty, /does not by itself prove the events are searchable yet/);
  assert.match(empty, /Next: no delivery action is needed/);

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

test('delivery drain with yes still makes no request when destination is incomplete', async () => {
  const result = await runDeliveryCommand(['drain', '--yes'], {
    createDelivery: fakeDelivery,
    env: {},
    config: { subscriptionId: '11111111-1111-4111-8111-111111111111' }
  });
  assert.equal(result.executed, false);
  assert.match(result.error, /missing logs ingestion endpoint, DCR immutable ID/);
});
