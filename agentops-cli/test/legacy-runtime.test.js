const assert = require('node:assert/strict');
const test = require('node:test');

test('legacy runtime module exposes the legacy CLI surface', () => {
  const runtime = require('../src/lib/legacy-runtime');

  assert.equal(typeof runtime.main, 'function');
  assert.equal(typeof runtime.latestSummaryFromArgs, 'function');
  assert.equal(typeof runtime.validateAzure, 'function');
  assert.equal(typeof runtime.agentopsSetupGuide, 'function');
  assert.equal(typeof runtime.benchmarkReport, 'function');
});
