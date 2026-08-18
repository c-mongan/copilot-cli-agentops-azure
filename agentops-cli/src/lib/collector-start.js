const { normalizeMode, normalizePrivacy } = require('./collector-options');
const {
  findRunningBinaryCollector,
  findRunningLocalCollector,
  findRunningNativeCollector,
  startBinaryCollector,
  startNativeAzureCollector,
  startLocalCollector
} = require('./collector-binary-runtime');
const { findCollectorBinary: defaultFindCollectorBinary, resolveAutoMode: defaultResolveAutoMode } = require('./collector-discovery');
const { startDockerCollector } = require('./collector-docker-runtime');
const { healthCheck } = require('./collector-runtime');

async function startCollector({
  options = {},
  resolveAutoMode = defaultResolveAutoMode,
  findCollectorBinary = defaultFindCollectorBinary,
  startDocker = startDockerCollector,
  startBinary = startBinaryCollector,
  checkHealth = healthCheck,
  env = process.env
} = {}) {
  const mode = normalizeMode(options.mode || 'auto');
  const privacy = normalizePrivacy(options.privacy || 'strict');
  if (mode === 'auto') {
    const binary = findCollectorBinary();
    if (binary.ok) {
      const local = findRunningLocalCollector(binary.path);
      if (local) return { ok: true, mode: 'local', privacyMode: local.privacy, alreadyRunning: true, pid: local.pid, config: local.config };
      const native = findRunningNativeCollector(binary.path);
      if (native) return { ok: true, mode: 'azure-native', privacyMode: native.privacy, alreadyRunning: true, pid: native.pid, config: native.config };
      const managedBinary = findRunningBinaryCollector(binary.path);
      if (managedBinary) return { ok: true, mode: 'binary', privacyMode: managedBinary.privacy, alreadyRunning: true, pid: managedBinary.pid, config: managedBinary.config };
    }
  }
  const resolved = mode === 'auto' ? resolveAutoMode(env) : { mode, reason: 'explicit mode' };

  if (mode === 'none' || resolved.mode === 'none') {
    if (!options.unsafeNoCollector) {
      return {
        ok: false,
        mode: 'none',
        unsafe: true,
        error: 'Collector mode none requires AGENTOPS_ALLOW_NO_COLLECTOR=1 or --unsafe-no-collector.'
      };
    }
    return {
      ok: true,
      mode: 'none',
      unsafe: true,
      warning: 'No local collector is running; privacy scrubbing is not guaranteed.'
    };
  }

  if (!resolved.mode) {
    const currentHealth = await checkHealth();
    if (currentHealth.ok) {
      return {
        ok: true,
        mode,
        privacyMode: privacy,
        alreadyRunning: true,
        health: currentHealth,
        warning: 'Collector health endpoint is already responding; no new collector runtime was started.'
      };
    }
    return { ok: false, mode, error: resolved.reason };
  }

  if (resolved.mode === 'docker') return startDocker({ privacy });
  if (resolved.mode === 'local') return startLocalCollector({ privacy, findCollectorBinary });
  if (resolved.mode === 'binary') return startBinary({ privacy, findCollectorBinary });
  if (resolved.mode === 'azure-native') return startNativeAzureCollector({ privacy, findCollectorBinary, env });
  return { ok: false, mode, error: `Unsupported resolved collector mode: ${resolved.mode}` };
}

module.exports = {
  startCollector
};
