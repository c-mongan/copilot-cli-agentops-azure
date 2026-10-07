const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STUB_LOG_ENV,
  createSandbox,
  hermeticEnv,
  prependPath,
  sideEffects
} = require('../../scripts/run-cli-tests');
const { isAgentOpsShim } = require('../src/lib/copilot-resolver');
const { commandCandidates } = require('../src/lib/shell');

test('hermetic runner points HOME, caches and PATH at a throwaway sandbox', t => {
  const sandbox = createSandbox();
  t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }));
  const env = hermeticEnv(sandbox, { PATH: '/usr/bin', COPILOT_CLI_BIN: '/real/copilot', HOME: '/real/home' }, 'linux');

  assert.equal(env.HOME, sandbox.home);
  assert.equal(env.USERPROFILE, sandbox.home);
  assert.equal(env.COPILOT_CLI_BIN, undefined);
  assert.equal(env[STUB_LOG_ENV], sandbox.log);
  assert.ok(env.npm_config_cache.startsWith(sandbox.root));
  assert.ok(env.AZURE_CONFIG_DIR.startsWith(sandbox.root));
  assert.equal(env.PATH.split(path.delimiter)[0], sandbox.bin);
});

test('hermetic runner keeps the Windows Path key casing when prepending stubs', () => {
  const env = prependPath({ Path: 'C:\\Windows' }, 'C:\\stubs', 'win32');
  assert.deepEqual(Object.keys(env), ['Path']);
  assert.ok(env.Path.startsWith('C:\\stubs'));
});

test('hermetic runner stubs win PATH lookup and are not mistaken for product shims', t => {
  const sandbox = createSandbox();
  t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }));
  for (const name of ['az', 'azd', 'copilot']) {
    const [first] = commandCandidates(name, { pathValue: `${sandbox.bin}${path.delimiter}${process.env.PATH || ''}` });
    assert.equal(path.dirname(first), sandbox.bin);
  }
  const copilotStub = commandCandidates('copilot', { pathValue: sandbox.bin })[0];
  assert.equal(isAgentOpsShim(copilotStub, {}), false, 'the resolver would otherwise skip to the real Copilot CLI');
});

test('hermetic runner reports stub invocations and guarded HOME writes', { skip: process.platform === 'win32' && 'POSIX stub execution' }, t => {
  const sandbox = createSandbox();
  t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }));
  assert.deepEqual(sideEffects(sandbox), { invocations: [], homeWrites: [] });

  const result = childProcess.spawnSync('az', ['group', 'exists', '--name', 'rg'], {
    env: hermeticEnv(sandbox),
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stubbed for hermetic tests/);
  fs.mkdirSync(path.join(sandbox.home, '.azure'));

  const effects = sideEffects(sandbox);
  assert.deepEqual(effects.invocations, ['az group exists --name rg']);
  assert.deepEqual(effects.homeWrites, ['.azure']);
});
