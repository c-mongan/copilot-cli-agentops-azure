const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectorConfigPath, collectorHome } = require('./paths');
const { commandExists, isExecutable, run } = require('./shell');
const { logFile, pidFile } = require('./collector-runtime');
const {
  collectorPackageInfo,
  downloadFile,
  installedCollectorBinaryPath,
  verifyChecksum
} = require('./collector-binary-release');

function validateBinaryConfig(binaryPath, privacy = 'strict') {
  const config = collectorConfigPath({ target: 'binary', privacy });
  if (!fs.existsSync(config)) {
    return { ok: false, mode: 'binary', privacyMode: privacy, config, error: `Config not found: ${config}` };
  }
  const result = run(binaryPath, ['validate', '--config', config], { timeout: 30000 });
  return {
    ok: result.status === 0,
    mode: 'binary',
    privacyMode: privacy,
    config,
    command: `${binaryPath} validate --config ${config}`,
    error: result.status === 0 ? null : (result.stderr || result.stdout || `collector validate exited ${result.status}`).trim()
  };
}

async function installBinary(options = {}) {
  const packageInfo = collectorPackageInfo({ version: options.version });
  const destination = installedCollectorBinaryPath();
  const binDir = path.dirname(destination);
  const existing = isExecutable(destination);

  if (existing && !options.force) {
    const validation = validateBinaryConfig(destination, options.privacy || 'strict');
    return {
      ok: validation.ok !== false,
      action: 'install-binary',
      alreadyInstalled: true,
      path: destination,
      version: packageInfo.version,
      url: packageInfo.url,
      checksumUrl: packageInfo.checksumUrl,
      validation
    };
  }

  if (!commandExists('tar')) {
    return { ok: false, action: 'install-binary', error: 'The tar command is required to extract the Collector release archive.' };
  }

  fs.mkdirSync(binDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otelcol-install-'));
  const archive = path.join(tempDir, packageInfo.fileName);
  const checksums = path.join(tempDir, packageInfo.checksumFileName);
  try {
    await downloadFile(packageInfo.url, archive);
    await downloadFile(packageInfo.checksumUrl, checksums);
    const checksum = verifyChecksum({
      archive,
      checksumsText: fs.readFileSync(checksums, 'utf8'),
      fileName: packageInfo.fileName
    });
    if (!checksum.ok) {
      return {
        ok: false,
        action: 'install-binary',
        url: packageInfo.url,
        checksumUrl: packageInfo.checksumUrl,
        checksum,
        error: checksum.error
      };
    }
    const extract = run('tar', ['-xzf', archive, '-C', tempDir], { timeout: 60000 });
    if (extract.status !== 0) {
      return {
        ok: false,
        action: 'install-binary',
        url: packageInfo.url,
        error: (extract.stderr || extract.stdout || `tar exited ${extract.status}`).trim()
      };
    }

    const extracted = path.join(tempDir, packageInfo.binaryName);
    if (!fs.existsSync(extracted)) {
      return { ok: false, action: 'install-binary', url: packageInfo.url, error: `Release archive did not contain ${packageInfo.binaryName}.` };
    }
    fs.copyFileSync(extracted, destination);
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);

    const validation = validateBinaryConfig(destination, options.privacy || 'strict');
    return {
      ok: validation.ok === true,
      action: 'install-binary',
      alreadyInstalled: false,
      path: destination,
      version: packageInfo.version,
      url: packageInfo.url,
      checksumUrl: packageInfo.checksumUrl,
      checksum,
      validation,
      error: validation.ok === true ? null : validation.error
    };
  } catch (error) {
    return { ok: false, action: 'install-binary', url: packageInfo.url, error: error.message };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function uninstallBinary(options = {}, dependencies = {}) {
  const stopCollector = dependencies.stopCollector || (() => ({ ok: true, mode: 'binary', stopped: false }));
  const stopped = stopCollector({ mode: 'binary', privacy: options.privacy || 'strict' });
  const removed = [];
  for (const name of ['otelcol-contrib', 'otelcol-contrib.exe']) {
    const candidate = path.join(collectorHome, 'bin', name);
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate, { force: true });
      removed.push(candidate);
    }
  }
  fs.rmSync(pidFile(), { force: true });
  if (options.purge) {
    fs.rmSync(logFile(), { force: true });
    const binDir = path.join(collectorHome, 'bin');
    try {
      if (fs.existsSync(binDir) && fs.readdirSync(binDir).length === 0) fs.rmdirSync(binDir);
    } catch {}
  }
  return {
    ok: true,
    action: 'uninstall-binary',
    stopped,
    removed,
    purged: Boolean(options.purge),
    collectorHome
  };
}

module.exports = {
  installBinary,
  uninstallBinary,
  validateBinaryConfig
};
