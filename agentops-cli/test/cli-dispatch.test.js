const assert = require('node:assert/strict');
const test = require('node:test');

const { commandSuggestion, createCliMain } = require('../src/lib/cli-dispatch');

function createHarness(overrides = {}) {
  const calls = [];
  let stdout = '';
  let stderr = '';
  const legacy = {
    main(args) {
      calls.push(['legacy', args]);
      return 'legacy-result';
    },
    latestSummaryFromArgs(args) {
      calls.push(['latestSummaryFromArgs', args]);
      return { ok: true, args };
    }
  };
  const commands = {
    statusCommand(args) {
      calls.push(['status', args]);
      return 'status-result';
    },
    collectorCommand(args) {
      calls.push(['collector', args]);
      return 'collector-result';
    },
    recommendCommand(args) {
      calls.push(['recommend', args]);
      return 'recommend-result';
    }
  };
  const main = createCliMain({
    commands: { ...commands, ...overrides.commands },
    coreCommands: ['setup', 'smoke'],
    experimentalCommands: new Set(['benchmark']),
    legacy: { ...legacy, ...overrides.legacy },
    stderr: { write(chunk) { stderr += String(chunk); } },
    stdout: { write(chunk) { stdout += String(chunk); } },
    usage: overrides.usage || (() => 'usage text\n')
  });

  return {
    calls,
    main,
    stderr: () => stderr,
    stdout: () => stdout
  };
}

test('createCliMain writes help through injected stdout', async () => {
  const harness = createHarness();

  await harness.main(['--help']);

  assert.equal(harness.stdout(), 'usage text\n');
  assert.deepEqual(harness.calls, []);
});

test('createCliMain exposes focused command help without dispatching the command', async () => {
  const calls = [];
  const harness = createHarness({
    usage(command) {
      calls.push(command);
      return `help for ${command || 'all'}\n`;
    }
  });

  await harness.main(['help', 'status']);

  assert.equal(harness.stdout(), 'help for status\n');
  assert.deepEqual(calls, ['status']);
  assert.deepEqual(harness.calls, []);
});

test('createCliMain routes legacy core command help without invoking the command', async () => {
  const calls = [];
  const main = createCliMain({
    commands: {},
    coreCommands: ['validate-azure'],
    legacy: {
      main(args) {
        calls.push(args);
      }
    },
    stdout: { write(chunk) { calls.push(['stdout', String(chunk)]); } },
    usage(command) { return `help for ${command}\n`; }
  });

  await main(['validate-azure', '--help']);

  assert.deepEqual(calls, [['stdout', 'help for validate-azure\n']]);
});

test('createCliMain routes direct commands and collector aliases', async () => {
  const harness = createHarness();

  assert.equal(await harness.main(['status', '--json']), 'status-result');
  assert.equal(await harness.main(['start', '--json']), 'collector-result');

  assert.deepEqual(harness.calls, [
    ['status', ['--json']],
    ['collector', ['start', '--json']]
  ]);
});

test('createCliMain routes coverage as a direct core command', async () => {
  const calls = [];
  const main = createCliMain({
    commands: { coverageCommand: args => calls.push(args) },
    coreCommands: ['coverage'],
    legacy: { main() { throw new Error('legacy path should not run'); } },
    usage: () => ''
  });
  await main(['coverage', '--repo', '.', '--json']);
  assert.deepEqual(calls, [['--repo', '.', '--json']]);
});

test('createCliMain keeps recommend V2 routing and legacy fallback', async () => {
  const harness = createHarness();

  assert.equal(await harness.main(['recommend', 'latest', '--runs', 'runs.jsonl']), 'recommend-result');
  assert.equal(await harness.main(['recommend', 'latest']), 'legacy-result');

  assert.deepEqual(harness.calls, [
    ['recommend', ['latest', '--runs', 'runs.jsonl']],
    ['legacy', ['recommend', 'latest']]
  ]);
});

test('createCliMain routes experimental commands with a migration warning', async () => {
  const harness = createHarness();

  assert.equal(await harness.main(['benchmark', 'list']), 'legacy-result');

  assert.match(harness.stderr(), /agentops benchmark is experimental now/);
  assert.deepEqual(harness.calls, [
    ['legacy', ['benchmark', 'list']]
  ]);
});

test('unknown commands suggest a close useful command and always point to help', async () => {
  const harness = createHarness();

  await assert.rejects(harness.main(['setpu']), /Did you mean "agentops setup"\? Run "agentops --help"/);
  await assert.rejects(harness.main(['definitely-unrelated']), /Run "agentops --help" to see the core commands/);
  assert.equal(commandSuggestion('statsu', ['setup', 'status']), 'status');
});
