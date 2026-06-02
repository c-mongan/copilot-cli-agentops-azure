#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'agentops-cli');
const packageJsonPath = path.join(packageDir, 'package.json');
const args = new Set(process.argv.slice(2));

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function runPackDryRun() {
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = childProcess.spawnSync(npmBin, ['pack', '--dry-run', '--json'], {
    cwd: packageDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.error?.message || result.stderr || result.stdout || `npm pack exited ${result.status}`).trim()
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || '[]');
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      ok: true,
      files: Array.isArray(pack?.files) ? pack.files.map(file => file.path.replaceAll('\\', '/')).sort() : [],
      filename: pack?.filename || null,
      unpackedSize: pack?.unpackedSize || null,
      entryCount: pack?.entryCount || null
    };
  } catch (error) {
    return { ok: false, error: `could not parse npm pack --dry-run output: ${error.message}` };
  }
}

function checkCliPublish(options = {}) {
  const pkg = readPackageJson();
  const failures = [];
  const warnings = [];

  const requiredFields = ['name', 'version', 'description', 'files', 'bin', 'license', 'engines'];
  for (const field of requiredFields) {
    if (pkg[field] === undefined || pkg[field] === null || pkg[field] === '') failures.push(`package.json missing ${field}`);
  }

  if (pkg.name !== 'copilot-agentops-cli') failures.push('package name must stay copilot-agentops-cli');
  if (pkg.bin?.agentops !== 'src/index.js') failures.push('bin.agentops must point to src/index.js');
  if (!Array.isArray(pkg.files) || !pkg.files.includes('src') || !pkg.files.includes('README.md')) {
    failures.push('files must include src and README.md');
  }
  if (!String(pkg.engines?.node || '').includes('>=20')) failures.push('engines.node must require Node >=20');

  const binPath = path.join(packageDir, pkg.bin?.agentops || '');
  if (!fs.existsSync(binPath)) failures.push('bin target src/index.js is missing');
  if (fs.existsSync(binPath)) {
    const binText = fs.readFileSync(binPath, 'utf8');
    if (!binText.startsWith('#!/usr/bin/env node')) failures.push('bin target must keep the node shebang');
    try {
      fs.accessSync(binPath, fs.constants.X_OK);
    } catch {
      failures.push('bin target must be executable');
    }
  }

  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    warnings.push('CLI package has runtime dependencies; review supply-chain impact before publishing');
  }

  const pack = options.skipPack ? { ok: true, files: [] } : runPackDryRun();
  if (!pack.ok) failures.push(pack.error);

  const expectedFiles = [
    'README.md',
    'package.json',
    'src/index.js',
    'src/legacy.js',
    'src/lib/privacy.js',
    'src/lib/security-audit.js',
    'src/commands/collector.js',
    'src/commands/dashboard.js',
    'src/commands/copilot.js'
  ];
  const forbiddenFiles = [
    'package-lock.json',
    'test/index.test.js',
    'test/commands.test.js',
    'test/core-helpers.test.js'
  ];
  if (pack.ok && !options.skipPack) {
    const files = new Set(pack.files);
    for (const file of expectedFiles) {
      if (!files.has(file)) failures.push(`npm package is missing ${file}`);
    }
    for (const file of forbiddenFiles) {
      if (files.has(file)) failures.push(`npm package should not include ${file}`);
    }
  }

  return {
    ok: failures.length === 0,
    package: {
      name: pkg.name,
      version: pkg.version,
      bin: pkg.bin?.agentops || null,
      node: pkg.engines?.node || null
    },
    pack,
    checks: {
      expected_files: expectedFiles,
      forbidden_files: forbiddenFiles
    },
    failures,
    warnings,
    next: failures.length === 0
      ? 'AgentOps CLI package publish readiness passed.'
      : 'Fix CLI package metadata or pack contents before publishing.'
  };
}

if (require.main === module) {
  const result = checkCliPublish({ skipPack: args.has('--no-pack') });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AgentOps CLI publish check: ${result.ok ? 'ok' : 'failed'}\n`);
    for (const failure of result.failures) process.stdout.write(`- failed: ${failure}\n`);
    for (const warning of result.warnings) process.stdout.write(`- warning: ${warning}\n`);
    if (result.pack?.filename) process.stdout.write(`- pack: ${result.pack.filename}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkCliPublish
};
