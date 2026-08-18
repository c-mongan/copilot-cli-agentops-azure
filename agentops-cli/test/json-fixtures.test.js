const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeJsonlFixture } = require('./support/json-fixtures');

test('test JSON fixture helper owns JSONL file writing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-json-fixtures-'));
  const file = writeJsonlFixture(path.join(dir, 'rows.jsonl'), [{ id: 1 }, { id: 2 }]);

  assert.equal(file, path.join(dir, 'rows.jsonl'));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"id":1}\n{"id":2}\n');

  for (const testFile of [
    'core-helpers.test.js',
    'index.test.js',
    'recommendation-files.test.js',
    'triage-packet.test.js',
    'v2-ask-context.test.js',
    'v2-open-links.test.js'
  ]) {
    const source = fs.readFileSync(path.join(__dirname, testFile), 'utf8');
    assert.doesNotMatch(source, /function writeJsonl\(/, testFile);
    assert.doesNotMatch(source, /rows\.map\(row => JSON\.stringify\(row\)\)/, testFile);
  }
});
