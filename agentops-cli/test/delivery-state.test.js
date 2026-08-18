const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deliveryStateFromEnqueue,
  receiptDeliveryText,
  summarizeDeliveryStatus
} = require('../src/lib/delivery-state');

test('delivery state maps only proven enqueue outcomes to saved locally', () => {
  assert.equal(deliveryStateFromEnqueue({ status: 'pending' }), 'local_pending');
  assert.equal(deliveryStateFromEnqueue({ status: 'deduplicated' }), 'local_pending');
  assert.equal(deliveryStateFromEnqueue({ status: 'overflow' }), 'overflow');
  assert.equal(deliveryStateFromEnqueue({ status: 'unknown' }), 'native_best_effort');
  assert.match(receiptDeliveryText('azure_acknowledged'), /accepted by Azure/);
  assert.doesNotMatch(receiptDeliveryText('azure_acknowledged'), /visible/i);
});

test('delivery status uses current-file severity and labels counters cumulative', () => {
  const summary = summarizeDeliveryStatus({
    pending: 2,
    uploading: 1,
    quarantined: 1,
    expired: 4,
    acknowledged: 8,
    overflow: 3
  });
  assert.equal(summary.state, 'quarantined');
  assert.equal(summary.pending, 3);
  assert.equal(summary.acknowledged_cumulative, 8);
  assert.equal(summary.overflow_cumulative, 3);
  assert.match(summary.headline, /3 waiting · 1 held for review · 4 expired/);
});

test('missing spool status remains honest native best effort', () => {
  assert.equal(summarizeDeliveryStatus().state, 'native_best_effort');
});

test('empty queue with prior endpoint acceptance reports accepted, never visible', () => {
  const summary = summarizeDeliveryStatus({ acknowledged: 4 });
  assert.equal(summary.state, 'azure_acknowledged');
  assert.doesNotMatch(summary.headline, /visible/i);
});
