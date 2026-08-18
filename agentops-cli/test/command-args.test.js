const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { firstPositional, requiredOptionValue, optionValues: sharedOptionValues } = require('../src/lib/args');
const { durationToMs, optionValue, optionValues, parseLastArg } = require('../src/lib/cli-options');

test('firstPositional skips flag values and defaults to latest', () => {
  assert.equal(firstPositional(['--runs', 'runs.jsonl', '--json']), 'latest');
  assert.equal(firstPositional(['run-123', '--runs', 'runs.jsonl']), 'run-123');
  assert.equal(firstPositional(['--runs=runs.jsonl', 'run-456']), 'run-456');
});

test('shared CLI option helpers parse required values and durations', () => {
  const args = ['--name', 'demo', '--tag', 'one', '--tag', 'two', '--last', '24h'];

  assert.equal(optionValue(args, ['--name']), 'demo');
  assert.deepEqual(optionValues(args, '--tag'), ['one', 'two']);
  assert.equal(parseLastArg(args, '7d'), '24h');
  assert.equal(durationToMs('2m'), 120000);
  assert.equal(durationToMs('', 42), 42);

  assert.throws(() => optionValue(['--name'], ['--name']), /--name requires a value/);
  assert.throws(() => optionValues(['--tag'], '--tag'), /--tag requires a value/);
  assert.throws(() => parseLastArg(['--last'], '7d'), /--last requires a duration/);
  assert.throws(() => durationToMs('7d'), /duration must look like/);
});

test('args module owns required option parsing helpers', () => {
  assert.equal(requiredOptionValue(['--name', 'demo'], ['--name']), 'demo');
  assert.deepEqual(sharedOptionValues(['--tag', 'one', '--tag', 'two'], '--tag'), ['one', 'two']);
  assert.throws(() => requiredOptionValue(['--name'], ['--name']), /--name requires a value/);
  assert.throws(() => sharedOptionValues(['--tag'], '--tag'), /--tag requires a value/);
});

test('parseLastArg delegates required value lookup to shared args helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'cli-options.js'), 'utf8');
  assert.doesNotMatch(source, /args\.indexOf\('--last'\)/);
});
