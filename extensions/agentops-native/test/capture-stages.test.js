'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureStages, stagesText } = require('../src/capture-stages');
const byId = stages => Object.fromEntries(stages.map(stage => [stage.id, stage]));

test('stages stay separate and never infer a later stage from an earlier one', () => {
  const stages = captureStages();
  assert.deepEqual(stages.map(stage => stage.id), ['collector', 'nativeReceipt', 'scriptReceipt', 'upload', 'cloudReadback']);
  const s = byId(stages);
  assert.equal(s.collector.state, 'off'); assert.equal(s.nativeReceipt.state, 'none'); assert.equal(s.scriptReceipt.state, 'none');
  assert.equal(s.upload.state, 'not-attempted'); assert.equal(s.cloudReadback.state, 'unverified');
  const accepted = byId(captureStages({ collector: { connected: true }, report: { nativeSpanCount: 0, librarySpanCount: 0 }, upload: { acknowledged: 3, refused: 0 } }));
  assert.equal(accepted.nativeReceipt.state, 'none'); assert.equal(accepted.upload.state, 'accepted'); assert.equal(accepted.cloudReadback.state, 'unverified');
});

test('receipt counts, read failures and stop reasons map to explicit states', () => {
  const received = byId(captureStages({ collector: { connected: true }, report: { nativeSpanCount: 4, librarySpanCount: 2 }, script: { started: true, exitCode: 0 } }));
  assert.equal(received.nativeReceipt.state, 'received'); assert.equal(received.nativeReceipt.count, 4);
  assert.equal(received.scriptReceipt.state, 'received'); assert.match(received.scriptReceipt.detail, /exited successfully. 2 library spans/);
  const unreadable = byId(captureStages({ collector: { stopReason: 'output_limit' }, reportError: true, script: { started: true, exitCode: 1 } }));
  assert.equal(unreadable.collector.state, 'stopped'); assert.equal(unreadable.nativeReceipt.state, 'unknown');
  assert.equal(unreadable.scriptReceipt.state, 'unknown'); assert.match(unreadable.scriptReceipt.detail, /exited with an error/);
  assert.equal(byId(captureStages({ collector: { stopReason: 'storage_limit' } })).collector.state, 'blocked');
  assert.equal(byId(captureStages({ collector: { busy: true, connected: true } })).collector.state, 'starting');
  assert.equal(byId(captureStages({ report: { nativeSpanCount: -1, librarySpanCount: 'x' } })).nativeReceipt.state, 'unknown');
});

test('upload results are validated and unavailable publishing is explicit', () => {
  assert.equal(byId(captureStages({ upload: { failed: true } })).upload.state, 'failed');
  assert.equal(byId(captureStages({ upload: { acknowledged: 0, refused: 2 } })).upload.state, 'none');
  assert.equal(byId(captureStages({ upload: { acknowledged: '5', refused: 0 } })).upload.state, 'unknown');
  const off = byId(captureStages({ upload: 'unavailable' }));
  assert.equal(off.upload.state, 'unavailable'); assert.equal(off.cloudReadback.state, 'unavailable');
  assert.equal(stagesText(captureStages()), 'Local Collector: off. Native Copilot receipt: none. Project script receipt: none. Azure upload acceptance: not-attempted. Azure cloud readback: unverified.');
});
