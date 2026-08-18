const assert = require('node:assert/strict');
const test = require('node:test');

test('CLI surface exposes public command lists and help text', () => {
  const { coreCommands, experimentalCommands, usage } = require('../src/lib/cli-surface');

  assert.ok(coreCommands.includes('collector'));
  assert.ok(coreCommands.includes('triage'));
  assert.ok(experimentalCommands.has('benchmark'));
  assert.ok(experimentalCommands.has('saved-view'));

  const help = usage();
  assert.match(help, /collector start\|stop\|status\|validate\|smoke\|install-binary\|uninstall-binary/);
  assert.match(help, /agentops experimental <old-command>/);
  assert.doesNotMatch(help, /benchmark list/);
});
