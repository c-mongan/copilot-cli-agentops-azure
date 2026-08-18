const {
  normalizeMode,
  normalizePrivacy
} = require('./collector-options');
const {
  findRunningBinaryCollector,
  findRunningLocalCollector,
  findRunningNativeCollector,
  stopBinaryCollector,
  stopNativeAzureCollector,
  stopLocalCollector
} = require('./collector-binary-runtime');
const { stopDockerCollector } = require('./collector-docker-runtime');
const { findCollectorBinary: defaultFindCollectorBinary, resolveAutoMode: defaultResolveAutoMode } = require('./collector-discovery');

function stopCollector({
  options = {},
  resolveAutoMode = defaultResolveAutoMode,
  findCollectorBinary = defaultFindCollectorBinary,
  stopDocker = stopDockerCollector,
  stopBinary = stopBinaryCollector,
  env = process.env
} = {}) {
  const mode = normalizeMode(options.mode || env.AGENTOPS_COLLECTOR_MODE || 'auto');
  if (mode === 'auto') {
    const binary = findCollectorBinary();
    if (binary.ok) {
      const local = findRunningLocalCollector(binary.path);
      if (local) return stopLocalCollector({ privacy: local.privacy, findCollectorBinary });
      const native = findRunningNativeCollector(binary.path);
      if (native) return stopNativeAzureCollector({ findCollectorBinary });
      const managedBinary = findRunningBinaryCollector(binary.path);
      if (managedBinary) return stopBinaryCollector({ privacy: managedBinary.privacy, findCollectorBinary });
    }
  }
  const resolved = mode === 'auto' ? resolveAutoMode(env) : { mode };
  const target = resolved.mode || mode;
  if (target === 'docker') {
    return stopDocker({ privacy: options.privacy || 'strict' });
  }
  if (target === 'local') {
    const privacy = normalizePrivacy(options.privacy || env.AGENTOPS_PRIVACY_MODE || 'strict');
    return stopLocalCollector({ privacy, findCollectorBinary });
  }
  if (target === 'binary') {
    const privacy = normalizePrivacy(options.privacy || env.AGENTOPS_PRIVACY_MODE || 'strict');
    return stopBinary({ privacy, findCollectorBinary });
  }
  if (target === 'azure-native') return stopNativeAzureCollector({ findCollectorBinary });
  return { ok: true, mode: target, stopped: false, detail: 'No managed collector runtime selected.' };
}

module.exports = {
  stopCollector
};
