'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { qualify } = require('../qualify-safe-metrics');
test('real pinned Collector preserves exact approved metrics through both privacy passes', { timeout: 15000 }, async () => {
  const proof = await qualify();
  assert.equal(proof.approvedMetricCount, 3);
  assert.equal(proof.approvedSpanCount, 9);
  assert.equal(proof.approvedLogCount, 1);
  assert.equal(proof.doubleTransform, true);
  assert.equal(proof.canaryAbsent, true);
});
