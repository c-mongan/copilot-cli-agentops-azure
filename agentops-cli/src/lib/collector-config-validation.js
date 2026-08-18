const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectorDir } = require('./paths');
const { collectorConfigPathsFor, defaultConfigPathFor, normalizeMode, normalizePrivacy } = require('./collector-options');
const { validateCollectorArtifacts } = require('./collector-artifacts');
const collectorRelease = require('./collector-release');
const { dockerDaemonAvailable } = require('./collector-docker');
const { run } = require('./shell');

function validateCollectorConfig({
  options = {},
  findCollectorBinary,
  resolveAutoMode,
  configPathFor = defaultConfigPathFor,
  configPathsFor = collectorConfigPathsFor,
  env = process.env
} = {}) {
  const mode = normalizeMode(options.mode || 'auto');
  const privacy = normalizePrivacy(options.privacy || 'strict');
  const artifactValidation = validateCollectorArtifacts();
  const resolved = mode === 'auto' ? resolveAutoMode(env) : { mode, reason: 'explicit mode' };
  if (!resolved.mode) return { ok: false, skipped: true, mode, privacyMode: privacy, artifact_validation: artifactValidation, error: resolved.reason };
  if (resolved.mode === 'none') return { ok: false, skipped: true, mode: 'none', artifact_validation: artifactValidation, error: 'No collector config is validated in none mode.' };

  const configs = configPathsFor(resolved.mode, privacy);
  const config = configPathFor(resolved.mode, privacy);
  const missingConfig = configs.find(candidate => !fs.existsSync(candidate));
  if (missingConfig) return { ok: false, mode: resolved.mode, privacyMode: privacy, config, configs, artifact_validation: artifactValidation, error: `Config not found: ${missingConfig}` };

  if (resolved.mode === 'binary' || resolved.mode === 'local' || resolved.mode === 'azure-native') {
    const binary = findCollectorBinary();
    if (!binary.ok) return { ok: false, skipped: true, mode: resolved.mode, privacyMode: privacy, config, artifact_validation: artifactValidation, error: binary.error };
    const tempRoot = path.join(os.tmpdir(), 'agentops-otel-local-validation');
    const collectorEnv = {
      AGENTOPS_OTEL_STORAGE_DIR: env.AGENTOPS_OTEL_STORAGE_DIR
        || (resolved.mode === 'local' ? path.join(tempRoot, 'storage') : path.join(os.tmpdir(), 'agentops-otel-queue'))
    };
    if (resolved.mode === 'local' || resolved.mode === 'azure-native') {
      collectorEnv.AGENTOPS_OTEL_RECEIPT_PATH = env.AGENTOPS_OTEL_RECEIPT_PATH
        || path.join(tempRoot, `${resolved.mode}-receipt.jsonl`);
    }
    const result = run(binary.path, ['validate', ...configs.flatMap(candidate => ['--config', candidate])], {
      timeout: 30000,
      env: collectorEnv
    });
    return {
      ok: result.status === 0 && artifactValidation.ok,
      mode: resolved.mode,
      privacyMode: privacy,
      config,
      configs,
      artifact_validation: artifactValidation,
      command: `${binary.path} validate ${configs.map(candidate => `--config ${candidate}`).join(' ')}`,
      error: result.status === 0 && artifactValidation.ok ? null : (artifactValidation.errors[0] || result.stderr || result.stdout || `collector validate exited ${result.status}`).trim()
    };
  }

  if (!dockerDaemonAvailable()) {
    return {
      ok: false,
      skipped: true,
      mode: 'docker',
      privacyMode: privacy,
      config,
      artifact_validation: artifactValidation,
      error: 'Docker daemon is not reachable; start Docker/OrbStack or use binary mode.'
    };
  }

  const image = env.AGENTOPS_OTELCOL_IMAGE || collectorRelease.collectorImage();
  const result = run('docker', [
    'run',
    '--rm',
    '-e',
    'AGENTOPS_OTEL_STORAGE_DIR=/tmp/agentops-otel-queue',
    '-v',
    `${collectorDir}:/etc/agentops:ro`,
    image,
    'validate',
    '--config',
    `/etc/agentops/${path.basename(config)}`
  ], { timeout: 60000 });
  return {
    ok: result.status === 0 && artifactValidation.ok,
    mode: 'docker',
    privacyMode: privacy,
    config,
    image,
    artifact_validation: artifactValidation,
    error: result.status === 0 && artifactValidation.ok ? null : (artifactValidation.errors[0] || result.stderr || result.stdout || `docker validate exited ${result.status}`).trim()
  };
}

module.exports = {
  validateCollectorConfig
};
