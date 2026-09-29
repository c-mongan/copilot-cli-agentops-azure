#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'agentops-cli');
const lockDir = path.join(packageDir, '.package-assets.lock');

const assetDirs = [
  'actioner',
  'benchmark-judges',
  'benchmark-runners',
  'collector',
  'copilot',
  'docs',
  'examples',
  'fixtures',
  'grafana',
  'infra',
  'instrumentation',
  'kql',
  'packages',
  'plugin',
  'scripts'
];
const assetFiles = [
  'LICENSE',
  'azure.yaml',
  'install-agentops.ps1',
  'install-agentops.sh',
  'uninstall-agentops.ps1',
  'uninstall-agentops.sh'
];
function shouldCopy(src) {
  const relative = path.relative(root, src).replaceAll('\\', '/');
  if (relative.split('/').includes('node_modules')) return false;
  if (relative.split('/').includes('__pycache__') || relative.endsWith('.pyc')) return false;
  if (relative.startsWith('instrumentation/') && path.basename(relative).startsWith('test_')) return false;
  if (relative.split('/').some(segment => segment === 'test' || segment === 'tests') || path.basename(relative) === 'package-lock.json') return false;
  if (relative.endsWith('.tgz')) return false;
  if (relative.startsWith('docs/images/') && relative !== 'docs/images/agentops-architecture-dataflow.png') return false;
  if (relative.startsWith('docs/screenshots/')) return false;
  if (relative.startsWith('scripts/check-')) return false;
  if (relative === 'scripts/coverage-check.js' || relative === 'scripts/static-check.js') return false;
  return true;
}

function clean() {
  for (const dir of assetDirs) fs.rmSync(path.join(packageDir, dir), { recursive: true, force: true });
  for (const file of assetFiles) fs.rmSync(path.join(packageDir, file), { force: true });
  fs.rmSync(path.join(packageDir, 'src', 'fixtures'), { recursive: true, force: true });
  return { ok: true, action: 'clean', removed: [...assetDirs, ...assetFiles] };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      sleep(100);
    }
  }
  throw new Error(`Timed out waiting for package asset lock: ${lockDir}`);
}

function releaseLock() {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function copy() {
  acquireLock();
  try {
    clean();
    const copied = [];

    for (const dir of assetDirs) {
      const source = path.join(root, dir);
      const target = path.join(packageDir, dir);
      if (!fs.existsSync(source)) continue;
      fs.cpSync(source, target, { recursive: true, filter: shouldCopy });
      copied.push(dir);
    }

    for (const file of assetFiles) {
      const source = path.join(root, file);
      const target = path.join(packageDir, file);
      if (!fs.existsSync(source)) continue;
      fs.copyFileSync(source, target);
      copied.push(file);
    }

    return { ok: true, action: 'copy', copied };
  } catch (error) {
    clean();
    releaseLock();
    throw error;
  }
}

if (require.main === module) {
  const action = process.argv[2];
  if (action !== 'copy' && action !== 'clean') {
    process.stderr.write('Usage: prepare-cli-package-assets.js copy|clean\n');
    process.exit(2);
  }
  const result = action === 'copy' ? copy() : (() => {
    const cleaned = clean();
    releaseLock();
    return cleaned;
  })();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  clean,
  copy,
  releaseLock,
  shouldCopy
};
