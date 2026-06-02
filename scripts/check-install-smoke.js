#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkReleaseDistribution } = require('./check-release-distribution');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, commandArgs, options = {}) {
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null
  };
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function commandRecord(name, result, validate = () => true) {
  const parsed = parseJson(result.stdout);
  const valid = validate({ result, parsed });
  return {
    name,
    ok: Boolean(valid),
    status: result.status,
    error: valid ? null : (result.error || result.stderr || result.stdout || `command exited ${result.status}`).trim(),
    parsed
  };
}

function installedAgentopsPath(prefix) {
  return process.platform === 'win32'
    ? path.join(prefix, 'agentops.cmd')
    : path.join(prefix, 'bin', 'agentops');
}

function checkInstallSmoke(options = {}) {
  const tempDir = options.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-install-smoke-'));
  const artifactsDir = path.join(tempDir, 'artifacts');
  const prefix = path.join(tempDir, 'prefix');
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(prefix, { recursive: true });

  const distribution = checkReleaseDistribution({ outDir: artifactsDir, skipDocs: options.skipDocs });
  const cliArtifact = distribution.artifacts.find(artifact => artifact.package === 'cli' && artifact.ok);
  const failures = [];
  const commands = [];

  if (!distribution.ok) failures.push(...distribution.failures);
  if (!cliArtifact) failures.push('CLI artifact was not generated');

  if (cliArtifact) {
    const install = run(npmBin(), ['install', '-g', '--prefix', prefix, cliArtifact.path]);
    commands.push({
      name: 'npm install -g packed CLI',
      ok: install.ok,
      status: install.status,
      error: install.ok ? null : (install.error || install.stderr || install.stdout || `npm install exited ${install.status}`).trim()
    });
    if (!install.ok) failures.push(commands.at(-1).error);

    const agentops = installedAgentopsPath(prefix);
    if (!fs.existsSync(agentops)) {
      failures.push(`installed agentops command not found: ${agentops}`);
    } else {
      const env = {
        AGENTOPS_CONFIG_PATH: path.join(tempDir, 'config.json'),
        AGENTOPS_COPILOT_HOME: path.join(tempDir, 'copilot-home'),
        AGENTOPS_HOME: path.join(tempDir, 'agentops-home'),
        AGENTOPS_COLLECTOR_HOME: path.join(tempDir, 'collector-home')
      };

      commands.push(commandRecord('agentops --help', run(agentops, ['--help'], { env }), ({ result }) => (
        result.status === 0 && result.stdout.includes('Core commands:')
      )));
      commands.push(commandRecord('agentops doctor --local-only --json', run(agentops, ['doctor', '--local-only', '--json'], { env }), ({ result, parsed }) => (
        result.status === 0 && parsed?.ok === true
      )));
      commands.push(commandRecord('agentops dashboard verify', run(agentops, ['dashboard', 'verify'], { env }), ({ result }) => (
        result.status === 0 && result.stdout.includes('"ok": true')
      )));
      commands.push(commandRecord('agentops security audit --json', run(agentops, ['security', 'audit', '--json'], { env }), ({ result, parsed }) => (
        result.status === 0 && parsed?.ok === true
      )));
      commands.push(commandRecord('agentops collector validate --mode none --json', run(agentops, ['collector', 'validate', '--mode', 'none', '--privacy', 'strict', '--json'], { env }), ({ parsed }) => (
        parsed?.artifact_validation?.ok === true
      )));
      commands.push(commandRecord('agentops plugin install --dry-run --json', run(agentops, ['plugin', 'install', '--dry-run', '--json'], { env }), ({ result, parsed }) => (
        result.status === 0 && parsed?.agents?.agents?.length >= 1 && parsed?.skills?.skills?.length >= 1
      )));
    }
  }

  for (const command of commands) {
    if (!command.ok) failures.push(`${command.name} failed: ${command.error}`);
  }

  return {
    ok: failures.length === 0,
    tempDir,
    prefix,
    artifact: cliArtifact ? {
      filename: cliArtifact.filename,
      size: cliArtifact.size,
      sha256: cliArtifact.sha256
    } : null,
    commands,
    failures,
    next: failures.length === 0
      ? 'Fresh install smoke passed for the packed AgentOps CLI.'
      : 'Fix package runtime assets or installed command behavior before release.'
  };
}

if (require.main === module) {
  const result = checkInstallSmoke({ skipDocs: args.has('--skip-docs') });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AgentOps install smoke: ${result.ok ? 'ok' : 'failed'}\n`);
    for (const command of result.commands) process.stdout.write(`- ${command.name}: ${command.ok ? 'ok' : 'failed'}\n`);
    for (const failure of result.failures) process.stdout.write(`- failed: ${failure}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  checkInstallSmoke,
  installedAgentopsPath
};
