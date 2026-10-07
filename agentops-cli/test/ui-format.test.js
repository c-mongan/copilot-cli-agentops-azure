const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ui', 'assets', 'app.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in app.js`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) {
      return new Function(`${source.slice(start, i + 1)}; return ${name};`)();
    }
  }
  throw new Error(`unterminated ${name}`);
}

test('ui fmtDuration carries rounded seconds into minutes and hours', () => {
  const fmtDuration = extract('fmtDuration');
  assert.equal(fmtDuration(59600), '1 m 00 s');
  assert.equal(fmtDuration(17 * 60000 + 59600), '18 m 00 s');
  assert.equal(fmtDuration(61000), '1 m 01 s');
  assert.equal(fmtDuration(3599600), '1 h 00 m');
  assert.equal(fmtDuration(12 * 3600000 + 34 * 60000), '12 h 34 m');
  assert.equal(fmtDuration(44000), '44 s');
  assert.equal(fmtDuration(250), '250 ms');
});

test('ui tickLabel never renders 60s or 60m', () => {
  const tickLabel = extract('tickLabel');
  assert.equal(tickLabel(119700, 5000), '2m');
  assert.equal(tickLabel(90000, 5000), '1m 30s');
  assert.equal(tickLabel(7170000, 60000), '2h');
});
