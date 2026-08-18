#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkReleaseDistribution } = require('./check-release-distribution');

const root = path.resolve(__dirname, '..');
const cliName = 'copilot-agentops-cli';

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: 'utf8',
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function executable(file, text) {
  fs.writeFileSync(file, text, { mode: 0o755 });
}

function sanitizedEnvironment(paths) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(AGENTOPS|AZURE|APPLICATIONINSIGHTS|COPILOT|OTEL)_/.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    PATH: `${paths.installBin}:${paths.realBin}:${paths.prefixBin}:${process.env.PATH || '/usr/bin:/bin'}`,
    AGENTOPS_BIN_DIR: paths.installBin,
    AGENTOPS_HOME: paths.agentopsHome,
    AGENTOPS_COLLECTOR_HOME: paths.collectorHome,
    AGENTOPS_CONFIG_PATH: paths.config,
    AGENTOPS_DURABLE_SPOOL_DIR: paths.spool,
    COPILOT_HOME: paths.copilotHome,
    FAKE_COPILOT_ARGS_FILE: paths.fakeArgs
  };
}

function derivedVersionArtifact(baseArtifact, tempDir, version) {
  const extractDir = path.join(tempDir, `package-${version}`);
  fs.mkdirSync(extractDir, { recursive: true });
  const extracted = run('tar', ['-xzf', baseArtifact, '-C', extractDir]);
  if (!extracted.ok) throw new Error(extracted.stderr || 'could not extract base CLI artifact');
  const packageDir = path.join(extractDir, 'package');
  const packageFile = path.join(packageDir, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  metadata.version = version;
  fs.writeFileSync(packageFile, `${JSON.stringify(metadata, null, 2)}\n`);
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tempDir], { cwd: packageDir });
  if (!packed.ok) throw new Error(packed.stderr || packed.stdout || 'could not pack derived CLI artifact');
  const detail = JSON.parse(packed.stdout)[0];
  return path.join(tempDir, detail.filename);
}

function commandStep(steps, name, command, args, options = {}, validate = result => result.ok) {
  const result = run(command, args, options);
  const ok = Boolean(validate(result));
  steps.push({
    name,
    ok,
    status: result.status,
    error: ok ? null : (result.error || result.stderr || result.stdout || `command exited ${result.status}`).trim()
  });
  return result;
}

function recursiveText(directory) {
  if (!fs.existsSync(directory)) return '';
  const chunks = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(recursiveText(file));
    else if (entry.isFile() && fs.statSync(file).size <= 2 * 1024 * 1024) chunks.push(fs.readFileSync(file, 'utf8'));
  }
  return chunks.join('\n');
}

function checkPackagedLifecycle(options = {}) {
  if (process.platform === 'win32') {
    return {
      ok: false,
      skipped: true,
      platform: process.platform,
      failures: ['POSIX packaged lifecycle gate is not a Windows proof; run the PowerShell/Windows lane separately.']
    };
  }

  const tempDir = options.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-packaged-lifecycle-'));
  const paths = {
    tempDir,
    artifacts: path.join(tempDir, 'artifacts'),
    prefix: path.join(tempDir, 'npm-prefix'),
    prefixBin: path.join(tempDir, 'npm-prefix', 'bin'),
    installBin: path.join(tempDir, 'installed-bin'),
    realBin: path.join(tempDir, 'real-bin'),
    agentopsHome: path.join(tempDir, 'agentops-home'),
    collectorHome: path.join(tempDir, 'collector-home'),
    copilotHome: path.join(tempDir, 'copilot-home'),
    config: path.join(tempDir, 'config.json'),
    spool: path.join(tempDir, 'delivery-spool'),
    fakeArgs: path.join(tempDir, 'fake-copilot-args.txt')
  };
  for (const directory of [paths.artifacts, paths.prefix, paths.installBin, paths.realBin, paths.agentopsHome, paths.copilotHome]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const fake = '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$@" >"${FAKE_COPILOT_ARGS_FILE}"\nprintf \'SAFE_FAKE_COPILOT_OK\\n\'\n';
  const originalCopilot = path.join(paths.installBin, 'copilot');
  const realCopilot = path.join(paths.realBin, 'copilot');
  executable(originalCopilot, fake);
  executable(realCopilot, fake);
  const originalBytes = fs.readFileSync(originalCopilot);
  const originalHash = sha256(originalBytes);
  const env = sanitizedEnvironment(paths);
  const failures = [];
  const steps = [];
  const poison = 'AGENTOPS_LIFECYCLE_POISON_7d3a91_prompt_must_not_persist';

  try {
    const distribution = checkReleaseDistribution({ outDir: paths.artifacts, skipDocs: true, requireGitIdentity: false });
    const base = distribution.artifacts.find(artifact => artifact.package === 'cli' && artifact.ok);
    if (!distribution.ok) failures.push(...distribution.failures);
    if (!base) throw new Error('CLI release artifact was not generated');
    const baseVersion = JSON.parse(fs.readFileSync(path.join(root, 'agentops-cli', 'package.json'), 'utf8')).version;
    const [major, minor, patch] = baseVersion.split('.').map(Number);
    const upgradeVersion = `${major}.${minor}.${patch + 1}`;
    const upgradeArtifact = derivedVersionArtifact(base.path, tempDir, upgradeVersion);

    commandStep(steps, `install packed CLI ${baseVersion}`, 'npm', ['install', '-g', '--prefix', paths.prefix, base.path], { env });
    const npmAgentops = path.join(paths.prefixBin, 'agentops');
    commandStep(steps, 'install transparent shadow from packed CLI', npmAgentops, ['install', '--shadow-copilot', '--no-collector'], { env });
    const backup = `${originalCopilot}.agentops-original`;
    if (!fs.existsSync(backup) || sha256(fs.readFileSync(backup)) !== originalHash) failures.push('pre-existing Copilot backup was not preserved byte-for-byte');

    const observed = commandStep(
      steps,
      'normal copilot strict metadata-only receipt',
      originalCopilot,
      ['--collector-mode', 'none', '--unsafe-no-collector', '--privacy', 'strict', '-p', poison],
      { env },
      result => result.ok && result.stdout.includes('SAFE_FAKE_COPILOT_OK')
        && result.stderr.includes('AgentOps receipt')
        && result.stderr.includes('AgentOps did not record prompts, answers, code, or tool payloads')
    );
    if (!observed.ok) failures.push('normal Copilot shadow did not invoke the safe fake command');
    const persisted = [paths.agentopsHome, paths.spool, paths.copilotHome, paths.installBin]
      .map(recursiveText).join('\n');
    if (persisted.includes(poison)) failures.push('prompt poison appeared in AgentOps-owned persisted files');
    const queueText = recursiveText(paths.spool);
    if (!queueText.includes('agentops.run.start') || !queueText.includes('agentops.run.end')) failures.push('ordered start/end lifecycle evidence was not durably queued');
    if (/prompt|answer|completion|tool.?payload/i.test(queueText)) failures.push('durable queue contains a content-like field name');

    commandStep(steps, `upgrade packed CLI to ${upgradeVersion}`, 'npm', ['install', '-g', '--prefix', paths.prefix, upgradeArtifact], { env });
    commandStep(steps, 'upgraded CLI remains executable', npmAgentops, ['--help'], { env }, result => result.ok && result.stdout.includes('Core commands:'));
    if (sha256(fs.readFileSync(backup)) !== originalHash) failures.push('upgrade changed the preserved Copilot backup');

    commandStep(steps, `downgrade packed CLI to ${baseVersion}`, 'npm', ['install', '-g', '--prefix', paths.prefix, base.path], { env });
    commandStep(steps, 'downgraded CLI remains executable', npmAgentops, ['--help'], { env }, result => result.ok && result.stdout.includes('Core commands:'));
    if (sha256(fs.readFileSync(backup)) !== originalHash) failures.push('downgrade changed the preserved Copilot backup');

    commandStep(steps, 'uninstall AgentOps lifecycle', npmAgentops, ['uninstall', '--keep-plugin', '--keep-collector', '--keep-binary'], { env });
    if (!fs.existsSync(originalCopilot) || sha256(fs.readFileSync(originalCopilot)) !== originalHash) failures.push('uninstall did not restore the pre-existing Copilot command byte-for-byte');
    if (fs.existsSync(backup)) failures.push('AgentOps backup remained after successful restoration');
    for (const name of ['agentops', 'copilot-agentops', 'agentops-codex']) {
      if (fs.existsSync(path.join(paths.installBin, name))) failures.push(`${name} still intercepts commands after uninstall`);
    }
    commandStep(steps, 'restored Copilot runs without AgentOps interception', originalCopilot, ['--version'], { env }, result => (
      result.ok && result.stdout.includes('SAFE_FAKE_COPILOT_OK') && !result.stderr.includes('AgentOps receipt')
    ));
    commandStep(steps, 'remove packed npm CLI', 'npm', ['uninstall', '-g', '--prefix', paths.prefix, cliName], { env });

    for (const step of steps) if (!step.ok) failures.push(`${step.name}: ${step.error}`);
    return {
      ok: failures.length === 0,
      platform: process.platform,
      scope: 'hermetic POSIX packaged CLI lifecycle; no Azure writes and no real user configuration',
      tempDir,
      versions: { baseline: baseVersion, upgrade: upgradeVersion, downgrade: baseVersion },
      privacy: { mode: 'strict', content_capture: false, poison_persisted: persisted.includes(poison) },
      restoration: { original_sha256: originalHash, restored_sha256: fs.existsSync(originalCopilot) ? sha256(fs.readFileSync(originalCopilot)) : null },
      steps,
      unproven_lanes: ['Windows PowerShell live lifecycle', 'Linux distribution matrix', 'WSL lifecycle', 'containerized clean-machine lifecycle'],
      failures
    };
  } catch (error) {
    failures.push(error.message);
    return { ok: false, platform: process.platform, tempDir, steps, failures };
  }
}

if (require.main === module) {
  const result = checkPackagedLifecycle();
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`AgentOps packaged lifecycle: ${result.ok ? 'ok' : result.skipped ? 'skipped' : 'failed'}\n`);
    for (const step of result.steps || []) process.stdout.write(`- ${step.name}: ${step.ok ? 'ok' : 'failed'}\n`);
    for (const failure of result.failures || []) process.stdout.write(`- failed: ${failure}\n`);
  }
  process.exit(result.ok || result.skipped ? 0 : 1);
}

module.exports = { checkPackagedLifecycle, derivedVersionArtifact, sanitizedEnvironment };
