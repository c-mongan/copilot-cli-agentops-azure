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

test('duration formatting rounds directly to display precision at hour boundaries', () => {
  const fmt = extract('fmtDuration');
  const tick = extract('tickLabel');
  assert.equal(fmt(3629600), '1 h 00 m');
  assert.equal(fmt(3630000), '1 h 01 m');
  assert.equal(tick(59600, 5000), '1m');
  assert.equal(tick(3629600, 5000), '1h');
  assert.equal(tick(3630000, 5000), '1h 1m');
});

for (const [ms, duration, tick] of [
  [59499, '59 s', '59 s'],
  [59500, '1 m 00 s', '1m'],
  [59950, '1 m 00 s', '1m'],
  [60000, '1 m 00 s', '1m'],
  [60499, '1 m 00 s', '1m'],
  [60500, '1 m 01 s', '1m 1s'],
  [3599499, '59 m 59 s', '59m 59s'],
  [3599500, '1 h 00 m', '1h'],
  [3600000, '1 h 00 m', '1h'],
  [3629499, '1 h 00 m', '1h'],
  [3629500, '1 h 00 m', '1h'],
  [3629999, '1 h 00 m', '1h'],
  [3630000, '1 h 01 m', '1h 1m'],
  [7169499, '1 h 59 m', '1h 59m'],
  [7169500, '1 h 59 m', '1h 59m'],
  [7169999, '1 h 59 m', '1h 59m'],
  [7170000, '2 h 00 m', '2h'],
  [7200000, '2 h 00 m', '2h']
]) {
  test(`ui fmtDuration rounds at the displayed precision: ${ms}ms`, () => {
    assert.equal(extract('fmtDuration')(ms), duration);
  });
  test(`ui tickLabel rounds at the displayed precision: ${ms}ms`, () => {
    assert.equal(extract('tickLabel')(ms, 5000), tick);
  });
}

test('ui duration labels preserve fine precision and missing values', () => {
  const fmtDuration = extract('fmtDuration');
  const tickLabel = extract('tickLabel');
  assert.equal(fmtDuration(1250), '1.3 s');
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(fmtDuration(value), '—');
  assert.equal(tickLabel(0, 5000), '0');
  assert.equal(tickLabel(59950, 500), '59950 ms');
});

test('spanIssue separates failed, denied and non-zero exit spans', () => {
  const spanIssue = extract('spanIssue');
  const issueNote = extract('issueNote');
  const tool = (status, attrs) => ({ kind: 'tool', status, attrs });
  assert.equal(spanIssue(tool('failed', { outcome: 'failure' })), 'failed');
  assert.equal(spanIssue(tool('denied', {})), 'denied');
  assert.equal(spanIssue(tool('ok', { exitCode: 1 })), 'nonzero');
  assert.equal(spanIssue(tool('ok', { outcome: 'nonzero_exit' })), 'nonzero');
  assert.equal(spanIssue(tool('ok', { exitCode: 0 })), null);
  assert.equal(spanIssue(tool('ok', { exitCode: '1' })), null);
  assert.equal(spanIssue({ kind: 'turn', status: 'ok', attrs: { exitCode: 1 } }), null);
  assert.equal(spanIssue({ kind: 'tool', status: 'ok' }), null);
  assert.equal(issueNote(tool('ok', { exitCode: 2 }), 'nonzero'), 'exit 2');
  assert.equal(issueNote(tool('ok', { outcome: 'nonzero_exit' }), 'nonzero'), 'non-zero exit');
  assert.equal(issueNote(tool('failed', { outcome: 'failure' }), 'failed'), 'failure');
  assert.equal(issueNote(tool('denied', {}), 'denied'), 'denied');
});
