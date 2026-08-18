const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  commandShellQuote,
  durationToMs,
  parseSmokeArgs,
  realCopilotSmokeArgs,
  realCopilotSmokeCommand
} = require('../src/lib/smoke-cli');

test('smoke CLI helpers parse durations flags and real Copilot commands', () => {
  const args = parseSmokeArgs([
    '--dry-run',
    '--endpoint',
    'http://collector.example:4318/',
    '--id',
    'smoke-123',
    '--last',
    '30m',
    '--real-copilot',
    '--open-browser',
    '--timeout',
    '9s',
    '--wait',
    '5s',
    '--poll',
    '500ms',
    '--no-verify',
    '--json'
  ]);

  assert.deepEqual(args, {
    dryRun: true,
    endpoint: 'http://collector.example:4318/',
    id: 'smoke-123',
    last: '30m',
    realCopilot: true,
    openBrowser: true,
    copilotTimeoutMs: 9000,
    verify: false,
    waitMs: 5000,
    pollMs: 500,
    json: true
  });

  assert.equal(parseSmokeArgs([]).last, '2h');
  assert.equal(durationToMs('2m'), 120000);
  assert.equal(durationToMs('', 42), 42);
  assert.throws(() => durationToMs('7d'), /duration must look like/);
  assert.throws(() => parseSmokeArgs(['--last']), /--last requires a duration/);

  assert.equal(commandShellQuote('plain/path'), 'plain/path');
  assert.equal(commandShellQuote("two words's"), "'two words'\\''s'");
  assert.deepEqual(realCopilotSmokeArgs().slice(0, 5), ['--no-ask-user', '--no-remote', '--no-remote-export', '--add-dir', '.']);
  assert.match(realCopilotSmokeCommand(), /^copilot --no-ask-user --no-remote --no-remote-export --add-dir \./);
  assert.match(realCopilotSmokeCommand(), /'Do not edit files\. Run pwd and ls docs \| head, then summarize\.'/);
});

test('smoke CLI uses shared option parsing helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'smoke-cli.js'), 'utf8');
  assert.doesNotMatch(source, /function optionValue\(/);
});
