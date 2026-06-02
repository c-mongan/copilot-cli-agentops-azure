#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'packages', 'agentops-copilot-sdk');
const packageJsonPath = path.join(packageDir, 'package.json');
const args = new Set(process.argv.slice(2));

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function isWildcardRange(value) {
  return !value || ['*', 'latest', 'x', 'X'].includes(String(value).trim());
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
      unpackedSize: pack?.unpackedSize || null
    };
  } catch (error) {
    return { ok: false, error: `could not parse npm pack --dry-run output: ${error.message}` };
  }
}

function checkSdkPublish(options = {}) {
  const pkg = readPackageJson();
  const failures = [];
  const warnings = [];

  const requiredFields = ['name', 'version', 'description', 'main', 'types', 'files', 'license', 'engines'];
  for (const field of requiredFields) {
    if (pkg[field] === undefined || pkg[field] === null || pkg[field] === '') failures.push(`package.json missing ${field}`);
  }

  if (pkg.name !== '@agentops/copilot-sdk') failures.push('package name must stay @agentops/copilot-sdk');
  if (pkg.main !== 'src/index.js') failures.push('main must point to src/index.js');
  if (pkg.types !== 'src/index.d.ts') failures.push('types must point to src/index.d.ts');
  if (!Array.isArray(pkg.files) || !pkg.files.includes('src') || !pkg.files.includes('examples')) {
    failures.push('files must include src and examples');
  }
  if (!String(pkg.engines?.node || '').includes('>=20')) failures.push('engines.node must require Node >=20');

  const copilotPeer = pkg.peerDependencies?.['@github/copilot-sdk'];
  if (isWildcardRange(copilotPeer)) {
    failures.push('@github/copilot-sdk peerDependency must use an intentional version range, not a wildcard');
  }
  if (pkg.peerDependenciesMeta?.['@github/copilot-sdk']?.optional !== true) {
    failures.push('@github/copilot-sdk peer dependency must remain optional');
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    warnings.push('SDK package has runtime dependencies; review supply-chain impact before publishing');
  }

  const pack = options.skipPack ? { ok: true, files: [] } : runPackDryRun();
  if (!pack.ok) failures.push(pack.error);

  const expectedFiles = [
    'package.json',
    'src/index.js',
    'src/index.d.ts',
    'src/createAgentOpsCopilotClient.js',
    'src/hooks.js',
    'src/otel.js',
    'src/privacy.js',
    'examples/basic-sdk-agent/index.js'
  ];
  const forbiddenFiles = [
    'package-lock.json',
    'test/adapter.test.js'
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
      peer: copilotPeer,
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
      ? 'SDK package publish readiness passed.'
      : 'Fix SDK package metadata or pack contents before publishing.'
  };
}

if (require.main === module) {
  const result = checkSdkPublish({ skipPack: args.has('--no-pack') });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AgentOps Copilot SDK publish check: ${result.ok ? 'ok' : 'failed'}\n`);
    for (const failure of result.failures) process.stdout.write(`- failed: ${failure}\n`);
    for (const warning of result.warnings) process.stdout.write(`- warning: ${warning}\n`);
    if (result.pack?.filename) process.stdout.write(`- pack: ${result.pack.filename}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkSdkPublish,
  isWildcardRange
};
