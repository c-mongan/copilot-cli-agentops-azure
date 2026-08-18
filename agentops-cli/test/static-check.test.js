const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { checkRequiredNonEmptyFiles, checkV2IngestionSchema, walk } = require('../../scripts/static-check');

test('static check rejects missing and empty required files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-static-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'empty.js'), '   \n');
  fs.writeFileSync(path.join(root, 'working.js'), 'module.exports = {};\n');

  assert.deepEqual(checkRequiredNonEmptyFiles(root, ['missing.js', 'empty.js', 'working.js']), [
    { file: 'missing.js', error: 'required file is missing' },
    { file: 'empty.js', error: 'required file is empty' }
  ]);
});

test('static check includes the v2 AgentOpsEvents immutable schema contract', () => {
  assert.deepEqual(checkV2IngestionSchema(path.resolve(__dirname, '../..')), []);
});

test('static check ignores transient package asset copies while packaging runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-static-package-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'agentops-cli', 'actioner'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agentops-cli', 'src', 'fixtures'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agentops-cli', 'actioner', 'README.md'), '[missing](not-present.md)\n');
    fs.writeFileSync(path.join(root, 'agentops-cli', 'src', 'fixtures', 'generated.json'), '{"generated":true}\n');
    fs.writeFileSync(path.join(root, 'agentops-cli', 'src', 'index.js'), 'module.exports = {};\n');

    const files = walk(root, [], root).map(file => path.relative(root, file).replaceAll('\\', '/'));
    assert.deepEqual(files, ['agentops-cli/src/index.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
