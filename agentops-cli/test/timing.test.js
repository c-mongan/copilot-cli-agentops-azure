const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { sleep } = require('../src/lib/timing');

test('shared timing helper owns sleep implementation', () => {
  assert.equal(typeof sleep, 'function');

  for (const file of [
    'src/telemetry.js',
    'src/lib/collector-runtime.js',
    'src/lib/e2e-runtime.js',
    'src/lib/smoke-runtime.js'
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /new Promise\(resolve => setTimeout\(resolve, ms\)\)/, file);
  }
});
