const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { setEnvForTest } = require('./support/env');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorInstallModules() {
  for (const relativePath of [
    'src/lib/paths.js',
    'src/lib/collector-runtime.js',
    'src/lib/collector-binary-release.js',
    'src/lib/collector-binary-install.js'
  ]) {
    const absolutePath = modulePath(relativePath);
    delete require.cache[require.resolve(absolutePath)];
  }
}

function withCollectorHome(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-binary-install-'));
  const collectorHome = path.join(tempDir, 'collector-home');
  const restoreEnv = setEnvForTest({ AGENTOPS_COLLECTOR_HOME: collectorHome });
  clearCollectorInstallModules();
  try {
    return fn(collectorHome);
  } finally {
    restoreEnv();
    clearCollectorInstallModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/usr/bin/env bash\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o755);
}

test('collector binary install helper validates an already installed binary', {
  skip: process.platform === 'win32' ? 'test fixture is a POSIX shell script, not a Windows executable' : false
}, async () => {
  await withCollectorHome(async () => {
    const { installedCollectorBinaryPath } = require(modulePath('src/lib/collector-binary-release.js'));
    const { installBinary } = require(modulePath('src/lib/collector-binary-install.js'));
    const binaryPath = installedCollectorBinaryPath();
    writeExecutable(binaryPath);

    const result = await installBinary({ privacy: 'strict' });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'install-binary');
    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.path, binaryPath);
    assert.equal(result.validation.ok, true);
    assert.match(result.validation.command, /validate --config/);
  });
});

test('collector binary install helper uninstalls binaries and purges runtime files', () => {
  withCollectorHome(collectorHome => {
    const { installedCollectorBinaryPath } = require(modulePath('src/lib/collector-binary-release.js'));
    const { logFile, pidFile } = require(modulePath('src/lib/collector-runtime.js'));
    const { uninstallBinary } = require(modulePath('src/lib/collector-binary-install.js'));
    const binaryPath = installedCollectorBinaryPath();
    let stoppedOptions = null;
    writeExecutable(binaryPath);
    fs.writeFileSync(pidFile(), '123\n');
    fs.writeFileSync(logFile(), 'collector logs');

    const result = uninstallBinary({ privacy: 'relaxed', purge: true }, {
      stopCollector(options) {
        stoppedOptions = options;
        return { ok: true, mode: 'binary', stopped: false };
      }
    });

    assert.deepEqual(stoppedOptions, { mode: 'binary', privacy: 'relaxed' });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'uninstall-binary');
    assert.deepEqual(result.removed, [binaryPath]);
    assert.equal(result.collectorHome, collectorHome);
    assert.equal(fs.existsSync(binaryPath), false);
    assert.equal(fs.existsSync(pidFile()), false);
    assert.equal(fs.existsSync(logFile()), false);
  });
});
