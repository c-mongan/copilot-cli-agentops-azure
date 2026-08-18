const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  fileIncludes,
  requiredFilesCheck
} = require('../src/lib/product-audit-checks');

test('product audit check helpers inspect files relative to a root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-product-audit-checks-'));
  fs.mkdirSync(path.join(tempRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'docs', 'audit.md'), 'Run-Centric UI\nTrace waterfall\n');

  assert.equal(fileIncludes('docs/audit.md', ['Run-Centric UI', 'Trace waterfall'], tempRoot), true);
  assert.equal(fileIncludes('docs/audit.md', ['missing term'], tempRoot), false);
  assert.equal(fileIncludes('docs/missing.md', ['Run-Centric UI'], tempRoot), false);

  assert.deepEqual(requiredFilesCheck('audit-files', [
    'docs/audit.md',
    'docs/missing.md'
  ], tempRoot), {
    name: 'audit-files',
    ok: false,
    evidence: ['docs/audit.md'],
    missing: ['docs/missing.md']
  });
});
