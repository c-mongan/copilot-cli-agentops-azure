const assert = require('node:assert/strict');
const test = require('node:test');

const { asArray, isPlainObject, isStringArray } = require('../src/lib/type-predicates');

test('type predicates identify plain objects and string arrays', () => {
  assert.equal(isPlainObject({ ok: true }), true);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isStringArray(['one', 'two']), true);
  assert.equal(isStringArray(['one', 2]), false);
  assert.deepEqual(asArray(['one']), ['one']);
  assert.deepEqual(asArray(null), []);
});
