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
  'evals',
  'fixtures',
  'grafana',
  'infra',
  'instrumentation',
  'kql',
  'packages',
  'plugin',
  'scripts',
  'workbooks'
];
const assetFiles = [
  'LICENSE',
  'azure.yaml',
  'install-agentops.ps1',
  'install-agentops.sh',
  'uninstall-agentops.ps1',
  'uninstall-agentops.sh'
];
// Only the local protected-receipt grader and its pure dependencies ship.
// Exclude trial workspaces, public datasets, answer keys, and model runners.
const evaluationAssets = new Set([
  'evals/diagnostics/common.js',
  'evals/stockpilot/scripts/heldout.js',
  'evals/stockpilot/scripts/full-corpus.js',
  'evals/stockpilot/graders/index.js',
  'evals/stockpilot/graders/tasks.json'
]);
const workbookAssets = new Set(['workbooks/agentops-workbook.json', 'workbooks/agentops-enterprise-workbook.json']);
// Windows may report the same directory as an 8.3 short name or a long name;
// fall back to real paths so allow-list checks never see an escaping path.
function repoRelative(src) {
  const escapes = value => value === '..' || value.startsWith('..' + path.sep) || path.isAbsolute(value);
  let relative = path.relative(root, src);
  if (escapes(relative)) {
    try { relative = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(src)); } catch { return null; }
  }
  return escapes(relative) ? null : relative.replaceAll('\\', '/');
}

function shouldCopy(src) {
  const relative = repoRelative(src);
  if (relative === null) return false;
  if (relative === 'workbooks') return true;
  if (relative.startsWith('workbooks/')) return workbookAssets.has(relative);
  // The enterprise qualification helper is repository-only operator tooling.
  if (relative === 'scripts/qualify-enterprise-evidence.js') return false;
  if (relative === 'evals' || relative.startsWith('evals/')) return evaluationAssets.has(relative) || [...evaluationAssets].some(file => file.startsWith(relative + '/'));
  if (relative.split('/').includes('node_modules')) return false;
  if (relative.split('/').includes('__pycache__') || relative.endsWith('.pyc')) return false;
  if (relative.startsWith('instrumentation/') && path.basename(relative).startsWith('test_')) return false;
  if (relative.split('/').some(segment => segment === 'test' || segment === 'tests') || path.basename(relative) === 'package-lock.json') return false;
  if (relative.endsWith('.tgz')) return false;
  if (relative.startsWith('docs/images/') && relative !== 'docs/images/agentops-architecture-dataflow.png') return false;
  if (relative.startsWith('docs/screenshots/')) return false;
  if (relative.startsWith('scripts/check-') && relative !== 'scripts/check-runtime-matrix.js') return false;
  if (['scripts/coverage-check.js', 'scripts/run-cli-tests.js', 'scripts/static-check.js'].includes(relative)) return false;
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
