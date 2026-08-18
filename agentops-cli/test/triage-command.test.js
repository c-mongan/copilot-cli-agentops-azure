const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTriage,
  renderTriage,
  triageCommand,
  writeTriage
} = require('../src/lib/triage-command');

test('triage command library preserves command and packet exports', () => {
  assert.equal(typeof buildTriage, 'function');
  assert.equal(typeof renderTriage, 'function');
  assert.equal(typeof triageCommand, 'function');
  assert.equal(typeof writeTriage, 'function');
});
