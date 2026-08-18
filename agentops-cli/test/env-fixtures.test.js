const assert = require('node:assert/strict');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

test('setEnvForTest restores existing and missing environment variables', () => {
  const cleanup = setEnvForTest({
    AGENTOPS_TEST_EXISTING: 'before',
    AGENTOPS_TEST_MISSING: undefined
  });

  try {
    const restore = setEnvForTest({
      AGENTOPS_TEST_EXISTING: 'after',
      AGENTOPS_TEST_MISSING: 'created'
    });

    assert.equal(process.env.AGENTOPS_TEST_EXISTING, 'after');
    assert.equal(process.env.AGENTOPS_TEST_MISSING, 'created');

    restore();

    assert.equal(process.env.AGENTOPS_TEST_EXISTING, 'before');
    assert.equal(process.env.AGENTOPS_TEST_MISSING, undefined);
  } finally {
    cleanup();
  }
});

test('collector tests use shared env restore helper', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = [
    'collector-status.test.js',
    'collector-binary-install.test.js',
    'collector-binary-runtime.test.js',
    'commands.test.js',
    'doctor-summary.test.js',
    'azure-validation-runtime.test.js'
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /const originalHome = process\.env\.AGENTOPS_COLLECTOR_HOME/);
    assert.doesNotMatch(source, /const original(ConfigPath|Fallback|EventsPath|Path) = process\.env/);
    assert.doesNotMatch(source, /if \(original(Home|Connection) === undefined\) delete process\.env/);
    assert.doesNotMatch(source, /if \(original(ConfigPath|Fallback|EventsPath) === undefined\) delete process\.env/);
  }
});
