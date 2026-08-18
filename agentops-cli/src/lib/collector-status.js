const fs = require('node:fs');

const {
  composeFile,
  composeHasLocalhostBindings,
  dockerCliAvailable,
  dockerComposeAvailable,
  dockerDaemonAvailable,
  dockerProjectName
} = require('./collector-docker');
const { findRunningBinaryCollector, findRunningLocalCollector, findRunningNativeCollector } = require('./collector-binary-runtime');
const {
  collectorHealthUrl: healthUrl,
  otlpHttpEndpoint
} = require('./collector-endpoints');
const {
  findCollectorProcessByConfig,
  findManagedCollectorProcess,
  healthCheck,
  logFile,
  pidFile,
  processAlive,
  readPid
} = require('./collector-runtime');
const { defaultConfigPathFor, normalizeMode, normalizePrivacy } = require('./collector-options');

async function collectorStatus({
  options = {},
  findCollectorBinary,
  resolveAutoMode,
  configPathFor = defaultConfigPathFor,
  env = process.env
} = {}) {
  const requestedMode = normalizeMode(options.mode || env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = normalizePrivacy(options.privacy || env.AGENTOPS_PRIVACY_MODE || 'strict');
  const auto = requestedMode === 'auto' ? resolveAutoMode(env) : { mode: requestedMode, reason: 'explicit mode' };
  const health = await healthCheck();
  const binary = findCollectorBinary();
  const pid = readPid();
  const runningBinary = ['auto', 'binary'].includes(requestedMode) && binary.ok
    ? findRunningBinaryCollector(binary.path)
    : null;
  const runningLocal = ['auto', 'local'].includes(requestedMode) && binary.ok
    ? findRunningLocalCollector(binary.path)
    : null;
  const runningNative = ['auto', 'azure-native'].includes(requestedMode) && binary.ok
    ? findRunningNativeCollector(binary.path)
    : null;
  const runningManaged = runningLocal || runningNative || runningBinary;
  const effectiveMode = runningLocal ? 'local' : runningNative ? 'azure-native' : runningBinary ? 'binary' : auto.mode || requestedMode;
  const effectivePrivacy = runningManaged?.privacy || privacy;
  const configTarget = effectiveMode === 'binary' || effectiveMode === 'local' || effectiveMode === 'azure-native' ? effectiveMode : 'docker';
  const config = runningManaged?.config || configPathFor(configTarget, effectivePrivacy);
  const discoveredPid = effectiveMode === 'binary' || effectiveMode === 'local' || effectiveMode === 'azure-native'
    ? (runningManaged?.pid || (binary.path ? findManagedCollectorProcess(binary.path, config) : findCollectorProcessByConfig(config)))
    : null;
  const effectivePid = runningManaged?.pid || discoveredPid || null;
  const dockerAvailable = dockerCliAvailable();
  const daemonAvailable = dockerDaemonAvailable();
  const details = [];

  if (requestedMode === 'auto') details.push(`auto: ${auto.reason}`);
  if (!binary.ok) details.push(binary.error);
  if (!dockerAvailable) details.push('Docker CLI not found.');
  else if (!daemonAvailable) details.push('Docker daemon is not reachable.');
  if (!composeHasLocalhostBindings()) details.push('Docker Compose host bindings are not localhost-only.');
  if (pid && !processAlive(pid) && discoveredPid) details.push(`Binary PID file was stale; found running collector PID ${discoveredPid}.`);
  if (pid && !processAlive(pid) && health.ok && !discoveredPid) details.push('Binary PID file is stale, but the collector health endpoint is responding.');

  return {
    mode: requestedMode,
    effectiveMode,
    running: health.ok,
    endpoint: otlpHttpEndpoint,
    healthUrl,
    safeLocalhostBinding: composeHasLocalhostBindings(),
    privacyMode: effectivePrivacy,
    config: fs.existsSync(config)
      ? config
      : null,
    docker: {
      cli: dockerAvailable,
      compose: dockerComposeAvailable(),
      daemon: daemonAvailable,
      composeFile,
      projectName: dockerProjectName
    },
    binary: {
      ...binary,
      pid: effectivePid,
      pidFile: pidFile(),
      logFile: logFile(),
      running: Boolean(effectivePid),
      discoveredPid
    },
    health,
    details
  };
}

module.exports = {
  collectorStatus,
  healthUrl,
  otlpHttpEndpoint
};
