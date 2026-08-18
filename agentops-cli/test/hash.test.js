const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { hashText, prefixedHash, prefixedHashOrEmpty } = require('../src/lib/hash');

test('hashText returns a stable sha256 hex digest', () => {
  assert.equal(hashText('agentops'), '0a8b23877a34bfeb350af602abf8a5c5b662e6fafd8b26b34acd52ada8699b30');
});

test('prefixed hash helpers preserve empty-value semantics', () => {
  assert.equal(prefixedHash('agentops', 'repo'), 'repo_0a8b23877a34bfeb');
  assert.equal(prefixedHash(undefined, 'repo'), 'repo_eb045d78d2731073');
  assert.equal(prefixedHashOrEmpty(undefined, 'repo'), 'repo_e3b0c44298fc1c14');
});

test('hash callers use shared helpers instead of local sha256 bodies', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'src/saved-views.js',
    'src/lib/collector-binary-release.js',
    'src/lib/mcp/redactor.js',
    'src/lib/otel/genai-normalizer.js',
    'src/lib/otel/mcp-normalizer.js'
  ];

  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /node:crypto|createHash\('sha256'\)/, file);
  }
});
