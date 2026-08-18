const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  attributesForContext,
  canonicalSdkAttributes,
  forbiddenContentAttributes,
  strictCollectorFiles,
  syncStrictCollectorFiles
} = require('../../scripts/lib/strict-collector-attributes');

test('every strict collector path preserves the canonical safe SDK event attributes', () => {
  for (const file of strictCollectorFiles()) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const contexts = ['span', ...(/- context: log\n/.test(text) ? ['log'] : [])];
    for (const context of contexts) {
      const allowed = attributesForContext(text, context);
      assert.ok(allowed.length > 0, `${path.basename(file)} ${context}`);
      for (const attribute of canonicalSdkAttributes) {
        assert.ok(allowed.includes(attribute), `${path.basename(file)} ${context} drops ${attribute}`);
      }
      for (const forbidden of forbiddenContentAttributes) {
        assert.equal(allowed.includes(forbidden), false, `${path.basename(file)} ${context} allows ${forbidden}`);
      }
    }
  }
});

test('strict collector attribute synchronization is idempotent', () => {
  assert.deepEqual(syncStrictCollectorFiles({ write: false }).changed, []);
});
