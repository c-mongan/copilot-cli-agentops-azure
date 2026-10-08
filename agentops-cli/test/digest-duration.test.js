const assert = require('node:assert/strict');
const test = require('node:test');

const { duration } = require('../src/lib/digest/format');

for (const [ms, expected] of [
  [null, 'n/a'],
  [undefined, 'n/a'],
  [Number.NaN, 'n/a'],
  [0, '0 ms'],
  [999.4, '999 ms'],
  [999.6, '1.0 s'],
  [9960, '10.0 s'],
  [59949, '59.9 s'],
  [59950, '1.0 min'],
  [59999, '1.0 min'],
  [3599499, '1.0 h'],
  [3569999, '59.5 min'],
  [3596999, '59.9 min'],
  [3597000, '1.0 h'],
  [7199999, '2.0 h'],
  [86399999, '24.0 h']
]) {
  test(`digest duration rounds before choosing the unit: ${ms}`, () => {
    assert.equal(duration(ms), expected);
  });
}

test('digest duration never shows a unit at its rollover value', () => {
  const bad = [];
  const check = ms => {
    const text = duration(ms);
    if (/^(1000 ms|60\.0 s|60\.0 min)$/.test(text)) bad.push(`${ms} -> ${text}`);
  };
  for (let ms = 0; ms < 26 * 3600000; ms += 97) check(ms);
  for (const edge of [1000, 60000, 3600000]) {
    for (let delta = -1; delta <= 1; delta += 0.001) check(edge + delta * 100);
  }
  assert.deepEqual(bad, []);
});
