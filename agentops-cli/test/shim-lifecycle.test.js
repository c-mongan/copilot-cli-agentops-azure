const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function run(script, args, env) {
  return spawnSync('/bin/bash', [path.join(root, script), ...args], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
}

function powershellCommand() {
  for (const command of process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh', 'powershell']) {
    const probe = spawnSync(command, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

function runPowerShell(command, script, args, env) {
  return spawnSync(command, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, script),
    ...args
  ], {
    cwd: root,
    env,
    encoding: 'utf8'
  });
}

test('macOS/Linux shim lifecycle installs transparent routing and restores the original Copilot path', {
  skip: process.platform === 'win32' ? 'POSIX shell fixture is not executable on Windows' : false
}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-shim-lifecycle-'));
  const installDir = path.join(temp, 'installed-bin');
  const realBin = path.join(temp, 'real-bin');
  fs.mkdirSync(realBin, { recursive: true });
  const realCopilot = path.join(realBin, 'copilot');
  fs.writeFileSync(realCopilot, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  const installedCopilot = path.join(installDir, 'copilot');
  fs.mkdirSync(installDir, { recursive: true });
  const original = '#!/usr/bin/env bash\necho ORIGINAL_COPILOT\n';
  fs.writeFileSync(installedCopilot, original, { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: temp,
    AGENTOPS_BIN_DIR: installDir,
    PATH: `${installDir}:${realBin}:/usr/bin:/bin`
  };

  try {
    const installed = run('scripts/install-copilot-agentops-shim.sh', ['--shadow-copilot'], env);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(fs.realpathSync.native(path.join(installDir, 'agentops')), path.join(root, 'agentops-cli', 'src', 'index.js'));
    assert.equal(fs.realpathSync.native(path.join(installDir, 'copilot-agentops')), path.join(root, 'scripts', 'copilot-agentops'));
    const shadow = fs.readFileSync(installedCopilot, 'utf8');
    assert.match(shadow, /# AgentOps managed shadow shim/);
    assert.match(shadow, new RegExp(`COPILOT_CLI_BIN="${realCopilot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.equal(fs.readFileSync(`${installedCopilot}.agentops-original`, 'utf8'), original);

    const removed = run('scripts/uninstall-copilot-agentops-shim.sh', [], env);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    for (const name of ['agentops', 'copilot-agentops', 'agentops-codex']) {
      assert.equal(fs.existsSync(path.join(installDir, name)), false, `${name} should be removed`);
    }
    assert.equal(fs.readFileSync(installedCopilot, 'utf8'), original);
    assert.equal(fs.existsSync(`${installedCopilot}.agentops-original`), false);
    assert.equal(fs.existsSync(realCopilot), true, 'the original Copilot CLI must be preserved');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Windows PowerShell shadow lifecycle preserves and restores a pre-existing Copilot command byte-for-byte', {
  skip: powershellCommand() ? false : 'PowerShell is unavailable on this host; exercised on Windows/PowerShell CI'
}, () => {
  const powershell = powershellCommand();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-powershell-shim-lifecycle-'));
  const installDir = path.join(temp, 'installed-bin');
  const realBin = path.join(temp, 'real-bin');
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(realBin, { recursive: true });

  const original = '@echo off\r\necho ORIGINAL_COPILOT %*\r\n';
  const installedCopilot = path.join(installDir, 'copilot.cmd');
  fs.writeFileSync(installedCopilot, original, 'ascii');

  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(realBin, 'copilot.cmd'), '@echo off\r\nexit /b 0\r\n', 'ascii');
  } else {
    const realCopilot = path.join(realBin, 'copilot');
    fs.writeFileSync(realCopilot, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });
  }

  const env = {
    ...process.env,
    AGENTOPS_BIN_DIR: installDir,
    PATH: [installDir, realBin, process.env.PATH].filter(Boolean).join(path.delimiter)
  };

  try {
    const installed = runPowerShell(powershell, 'scripts/install-copilot-agentops-shim.ps1', [
      '-ShadowCopilot', '-InstallDir', installDir
    ], env);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.match(fs.readFileSync(installedCopilot, 'ascii'), /REM AgentOps managed shadow shim/);
    assert.equal(fs.readFileSync(`${installedCopilot}.agentops-original`, 'ascii'), original);

    const removed = runPowerShell(powershell, 'scripts/uninstall-copilot-agentops-shim.ps1', [
      '-InstallDir', installDir
    ], env);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    assert.equal(fs.readFileSync(installedCopilot, 'ascii'), original);
    assert.equal(fs.existsSync(`${installedCopilot}.agentops-original`), false);
    for (const name of ['agentops.cmd', 'copilot-agentops.cmd', 'agentops-codex.cmd']) {
      assert.equal(fs.existsSync(path.join(installDir, name)), false, `${name} should be removed`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('PowerShell shim scripts carry an ownership marker and refuse unsafe backup overwrite', () => {
  const install = fs.readFileSync(path.join(root, 'scripts', 'install-copilot-agentops-shim.ps1'), 'utf8');
  const uninstall = fs.readFileSync(path.join(root, 'scripts', 'uninstall-copilot-agentops-shim.ps1'), 'utf8');

  assert.match(install, /REM AgentOps managed shadow shim/);
  assert.match(install, /copilot\.cmd\.agentops-original/);
  assert.match(install, /Refusing to overwrite/);
  assert.match(uninstall, /Preserved non-AgentOps copilot command/);
  assert.match(uninstall, /Cannot restore the original Copilot command/);
  assert.match(uninstall, /Restored original copilot command/);
});
