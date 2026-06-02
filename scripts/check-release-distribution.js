#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

const packages = [
  {
    id: 'cli',
    name: 'copilot-agentops-cli',
    dir: path.join(root, 'agentops-cli'),
    checker: ['npm', ['--prefix', 'agentops-cli', 'run', 'publish:check', '--', '--json']],
    expectedPrefix: 'copilot-agentops-cli-'
  },
  {
    id: 'sdk',
    name: '@agentops/copilot-sdk',
    dir: path.join(root, 'packages', 'agentops-copilot-sdk'),
    checker: ['npm', ['--prefix', 'packages/agentops-copilot-sdk', 'run', 'publish:check', '--', '--json']],
    expectedPrefix: 'agentops-copilot-sdk-'
  }
];

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, commandArgs, options = {}) {
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null
  };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runPackageCheck(pkg) {
  const [command, commandArgs] = pkg.checker;
  const resolvedCommand = command === 'npm' ? npmBin() : command;
  const result = run(resolvedCommand, commandArgs);
  return {
    package: pkg.id,
    ok: result.ok,
    error: result.ok ? null : (result.error || result.stderr || result.stdout || `command exited ${result.status}`).trim()
  };
}

function packPackage(pkg, outDir) {
  const result = run(npmBin(), ['pack', '--json', '--pack-destination', outDir], { cwd: pkg.dir });
  if (!result.ok) {
    return {
      package: pkg.id,
      ok: false,
      error: (result.error || result.stderr || result.stdout || `npm pack exited ${result.status}`).trim()
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || '[]');
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    const filename = pack?.filename || '';
    const artifactPath = path.join(outDir, filename);
    return {
      package: pkg.id,
      ok: true,
      filename,
      path: artifactPath,
      size: fs.statSync(artifactPath).size,
      sha256: sha256(artifactPath)
    };
  } catch (error) {
    return {
      package: pkg.id,
      ok: false,
      error: `could not parse npm pack output: ${error.message}`
    };
  }
}

function docsEvidence() {
  const docs = [
    {
      file: 'docs/release-distribution.md',
      terms: ['check-release-distribution', 'SHA256', 'GitHub release', 'Homebrew']
    },
    {
      file: 'docs/release-checklist-v2.md',
      terms: ['check-release-distribution']
    },
    {
      file: 'docs/security-production-readiness-audit.md',
      terms: ['SHA256 checks']
    }
  ];
  const evidence = [];
  const failures = [];
  for (const doc of docs) {
    const relativePath = doc.file;
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) {
      failures.push(`${relativePath} is missing`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const missing = doc.terms.filter(term => !text.includes(term));
    evidence.push({ file: relativePath, missing });
    for (const term of missing) failures.push(`${relativePath} missing ${term}`);
  }
  return { ok: failures.length === 0, evidence, failures };
}

function checkReleaseDistribution(options = {}) {
  const outDir = options.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-release-'));
  fs.mkdirSync(outDir, { recursive: true });

  const packageChecks = packages.map(runPackageCheck);
  const artifacts = packages.map(pkg => packPackage(pkg, outDir));
  const docs = options.skipDocs ? { ok: true, evidence: [], failures: [] } : docsEvidence();
  const failures = [];

  for (const check of packageChecks) {
    if (!check.ok) failures.push(`${check.package} publish check failed: ${check.error}`);
  }
  for (const artifact of artifacts) {
    if (!artifact.ok) {
      failures.push(`${artifact.package} pack failed: ${artifact.error}`);
      continue;
    }
    const pkg = packages.find(candidate => candidate.id === artifact.package);
    if (!artifact.filename.startsWith(pkg.expectedPrefix) || !artifact.filename.endsWith('.tgz')) {
      failures.push(`${artifact.package} artifact name is unexpected: ${artifact.filename}`);
    }
    if (!artifact.sha256 || artifact.sha256.length !== 64) failures.push(`${artifact.package} SHA256 is invalid`);
    if (!artifact.size || artifact.size <= 0) failures.push(`${artifact.package} artifact is empty`);
  }
  failures.push(...docs.failures);

  return {
    ok: failures.length === 0,
    outDir,
    package_checks: packageChecks,
    artifacts,
    docs,
    failures,
    next: failures.length === 0
      ? 'Release distribution readiness passed. Use the SHA256 values for GitHub release assets and Homebrew formula updates.'
      : 'Fix package checks, artifact generation, or release documentation before publishing.'
  };
}

if (require.main === module) {
  const outArg = process.argv.find(arg => arg.startsWith('--out='));
  const result = checkReleaseDistribution({
    outDir: outArg ? path.resolve(outArg.slice('--out='.length)) : undefined,
    skipDocs: args.has('--skip-docs')
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AgentOps release distribution check: ${result.ok ? 'ok' : 'failed'}\n`);
    for (const artifact of result.artifacts) {
      if (artifact.ok) process.stdout.write(`- ${artifact.filename} sha256=${artifact.sha256}\n`);
    }
    for (const failure of result.failures) process.stdout.write(`- failed: ${failure}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkReleaseDistribution,
  docsEvidence,
  packPackage,
  runPackageCheck
};
