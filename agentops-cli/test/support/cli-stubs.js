const childProcess = require('node:child_process');
const path = require('node:path');

const { STUBBED_COMMANDS, prependPath, writeCliStubs } = require('../../../scripts/run-cli-tests');

const STUBBED_CLIS = new Set(STUBBED_COMMANDS);

function isStubbedCli(command) {
  return STUBBED_CLIS.has(path.basename(String(command)).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase());
}

// Behaves like an installed but signed-out az/azd/copilot/gh so in-process tests
// never reach the real CLIs; other commands still run normally.
function signedOutCliSpawnSync(calls = []) {
  return (command, args = [], options) => {
    if (!isStubbedCli(command)) return childProcess.spawnSync(command, args, options);
    calls.push([command, args]);
    const stderr = `${command} is stubbed in tests`;
    return { pid: 0, status: 1, signal: null, stdout: '', stderr, output: [null, '', stderr], error: undefined };
  };
}

// Env for spawned CLI processes with silent failing az/azd/copilot/gh stubs,
// written into binDir, first on PATH.
function signedOutCliEnv(binDir, extra = {}, baseEnv = process.env) {
  writeCliStubs(binDir, { log: false });
  return prependPath({ ...baseEnv, ...extra }, binDir);
}

module.exports = { signedOutCliEnv, signedOutCliSpawnSync };
