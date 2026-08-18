const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { collectorConfigPath, collectorHome } = require('./paths');
const { collectorConfigPathsFor, privacyModes } = require('./collector-options');
const { resolveConnectionString } = require('./collector-connection');
const {
  findCollectorProcessByConfig,
  findManagedCollectorProcess,
  healthCheck,
  logFile,
  pidFile,
  processAlive,
  readPid,
  waitForHealth
} = require('./collector-runtime');

function binaryConfigPath(privacy) {
  return collectorConfigPath({ target: 'binary', privacy });
}

function nativeConfigPaths(privacy = 'strict') {
  return collectorConfigPathsFor('azure-native', privacy);
}

function localConfigPath(privacy) {
  return collectorConfigPath({ target: 'local', privacy });
}

function findRunningBinaryCollector(binaryPath = null) {
  for (const privacy of privacyModes) {
    const config = binaryConfigPath(privacy);
    const pid = binaryPath ? findManagedCollectorProcess(binaryPath, config) : findCollectorProcessByConfig(config);
    if (pid) return { pid, privacy, config };
  }
  return null;
}

function findRunningLocalCollector(binaryPath = null) {
  for (const privacy of privacyModes) {
    const config = localConfigPath(privacy);
    const pid = binaryPath ? findManagedCollectorProcess(binaryPath, config) : findCollectorProcessByConfig(config);
    if (pid) return { pid, privacy, config };
  }
  return null;
}

function findRunningNativeCollector(binaryPath = null) {
  const config = nativeConfigPaths('strict').at(-1);
  const pid = binaryPath ? findManagedCollectorProcess(binaryPath, config) : findCollectorProcessByConfig(config);
  return pid ? { pid, privacy: 'strict', config } : null;
}

function missingBinaryResolver() {
  return { ok: false, error: 'Collector binary resolver was not provided.' };
}

function ensurePrivateDir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function ensurePrivateFile(filePath) {
  const handle = fs.openSync(filePath, 'a', 0o600);
  fs.closeSync(handle);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function endpointIsAzureMonitorOtlp(value) {
  try {
    const parsed = new URL(String(value));
    const pathname = parsed.pathname.toLowerCase();
    return parsed.protocol === 'https:'
      && parsed.hostname.endsWith('.ingest.monitor.azure.com')
      && pathname.includes('/datacollectionrules/')
      && pathname.includes('/streams/');
  } catch {
    return false;
  }
}

function nativeEndpointEnvironment(env = process.env) {
  const names = [
    'AZURE_MONITOR_OTLP_TRACES_ENDPOINT',
    'AZURE_MONITOR_OTLP_LOGS_ENDPOINT',
    'AZURE_MONITOR_OTLP_METRICS_ENDPOINT'
  ];
  const missing = names.filter(name => !env[name]);
  if (missing.length > 0) return { ok: false, error: `Native Azure OTLP requires: ${missing.join(', ')}.` };
  const dcrResourceId = String(env.AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID || '');
  if (!/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Insights\/dataCollectionRules\/[^/]+$/i.test(dcrResourceId)) {
    return { ok: false, error: 'Native Azure OTLP requires AGENTOPS_AZURE_OTLP_DCR_RESOURCE_ID from the selected OTLP Connection Info.' };
  }
  const configuredSubscription = String(env.AGENTOPS_AZURE_SUBSCRIPTION_ID || env.AZURE_SUBSCRIPTION_ID || '').toLowerCase();
  if (configuredSubscription && !dcrResourceId.toLowerCase().startsWith(`/subscriptions/${configuredSubscription}/`)) {
    return { ok: false, error: 'Native Azure OTLP DCR resource ID is outside the configured Azure subscription.' };
  }
  if (env.AGENTOPS_APPROVE_NATIVE_OTLP !== 'yes') {
    return { ok: false, error: 'Native Azure OTLP is explicitly gated. Set AGENTOPS_APPROVE_NATIVE_OTLP=yes after reviewing the target and endpoint evidence.' };
  }
  const invalid = names.filter(name => !endpointIsAzureMonitorOtlp(env[name]));
  if (invalid.length > 0) return { ok: false, error: `Native Azure OTLP endpoint guard rejected: ${invalid.join(', ')}.` };
  return { ok: true };
}

async function startBinaryCollector({ privacy = 'strict', findCollectorBinary } = {}) {
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  if (!binary.ok) return { ok: false, mode: 'binary', error: binary.error };
  const connection = resolveConnectionString();
  if (!connection.ok) return { ok: false, mode: 'binary', error: connection.error };
  const config = binaryConfigPath(privacy);
  if (!fs.existsSync(config)) return { ok: false, mode: 'binary', error: `Collector config not found: ${config}` };
  ensurePrivateDir(collectorHome);
  const storageDir = path.join(collectorHome, 'queue');
  ensurePrivateDir(storageDir);
  ensurePrivateFile(logFile());
  const currentHealth = await healthCheck();
  const discoveredPid = findManagedCollectorProcess(binary.path, config);
  const runningPid = discoveredPid;
  if (currentHealth.ok) {
    if (runningPid) fs.writeFileSync(pidFile(), `${runningPid}\n`);
    if (runningPid) {
      try { fs.chmodSync(pidFile(), 0o600); } catch {}
      return {
        ok: true,
        mode: 'binary',
        privacyMode: privacy,
        alreadyRunning: true,
        pid: runningPid,
        pidFile: pidFile(),
        logFile: logFile(),
        config
      };
    }
    return {
      ok: false,
      mode: 'binary',
      privacyMode: privacy,
      error: 'The Collector health endpoint is already in use by an unmanaged runtime; stop it before starting binary mode.'
    };
  }

  const out = fs.openSync(logFile(), 'a', 0o600);
  const child = childProcess.spawn(binary.path, ['--config', config], {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      APPLICATIONINSIGHTS_CONNECTION_STRING: connection.value,
      AGENTOPS_OTEL_STORAGE_DIR: storageDir
    }
  });
  try { fs.closeSync(out); } catch {}
  child.unref();
  fs.writeFileSync(pidFile(), `${child.pid}\n`, { mode: 0o600 });
  try { fs.chmodSync(pidFile(), 0o600); } catch {}
  const health = await waitForHealth();
  return {
    ok: health.ok,
    mode: 'binary',
    privacyMode: privacy,
    pid: child.pid,
    pidFile: pidFile(),
    logFile: logFile(),
    config,
    health,
    error: health.ok ? null : 'Collector process started, but health endpoint did not become ready.'
  };
}

async function startNativeAzureCollector({ privacy = 'strict', findCollectorBinary, env = process.env } = {}) {
  if (privacy !== 'strict') return { ok: false, mode: 'azure-native', error: 'azure-native mode only supports strict privacy mode.' };
  const endpointGate = nativeEndpointEnvironment(env);
  if (!endpointGate.ok) return { ok: false, mode: 'azure-native', error: endpointGate.error };
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  if (!binary.ok) return { ok: false, mode: 'azure-native', error: binary.error };
  const configs = nativeConfigPaths(privacy);
  const missingConfig = configs.find(config => !fs.existsSync(config));
  if (missingConfig) return { ok: false, mode: 'azure-native', error: `Collector config not found: ${missingConfig}` };
  ensurePrivateDir(collectorHome);
  const storageDir = path.join(collectorHome, 'native-azure-queue');
  const receiptPath = path.join(collectorHome, 'native-azure-receipt.jsonl');
  ensurePrivateDir(storageDir);
  ensurePrivateFile(receiptPath);
  ensurePrivateFile(logFile());
  const currentHealth = await healthCheck();
  const identityConfig = configs.at(-1);
  const discoveredPid = findManagedCollectorProcess(binary.path, identityConfig);
  if (currentHealth.ok) {
    if (discoveredPid) {
      fs.writeFileSync(pidFile(), `${discoveredPid}\n`, { mode: 0o600 });
      try { fs.chmodSync(pidFile(), 0o600); } catch {}
      return { ok: true, mode: 'azure-native', privacyMode: privacy, alreadyRunning: true, pid: discoveredPid, pidFile: pidFile(), logFile: logFile(), receiptPath, config: identityConfig, configPaths: configs };
    }
    return { ok: false, mode: 'azure-native', privacyMode: privacy, error: 'The Collector health endpoint is already in use by an unmanaged runtime; stop it before starting azure-native mode.' };
  }

  const out = fs.openSync(logFile(), 'a', 0o600);
  const child = childProcess.spawn(binary.path, configs.flatMap(config => ['--config', config]), {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...env,
      AGENTOPS_OTEL_STORAGE_DIR: storageDir,
      AGENTOPS_OTEL_RECEIPT_PATH: receiptPath
    }
  });
  try { fs.closeSync(out); } catch {}
  child.unref();
  fs.writeFileSync(pidFile(), `${child.pid}\n`, { mode: 0o600 });
  try { fs.chmodSync(pidFile(), 0o600); } catch {}
  const health = await waitForHealth();
  return { ok: health.ok, mode: 'azure-native', privacyMode: privacy, pid: child.pid, pidFile: pidFile(), logFile: logFile(), receiptPath, config: identityConfig, configPaths: configs, health, error: health.ok ? null : 'Native Azure Collector process started, but health endpoint did not become ready.' };
}

async function startLocalCollector({ privacy = 'strict', findCollectorBinary } = {}) {
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  if (!binary.ok) return { ok: false, mode: 'local', error: binary.error };
  const config = localConfigPath(privacy);
  if (!fs.existsSync(config)) return { ok: false, mode: 'local', error: `Collector config not found: ${config}` };
  ensurePrivateDir(collectorHome);
  const storageDir = path.join(collectorHome, 'local-storage');
  const receiptPath = path.join(collectorHome, 'native-receipt.jsonl');
  ensurePrivateDir(storageDir);
  ensurePrivateFile(receiptPath);
  ensurePrivateFile(logFile());
  const currentHealth = await healthCheck();
  const pid = readPid();
  const discoveredPid = findManagedCollectorProcess(binary.path, config);
  const runningPid = processAlive(pid) && discoveredPid === pid ? pid : discoveredPid;
  if (currentHealth.ok) {
    if (runningPid) {
      fs.writeFileSync(pidFile(), `${runningPid}\n`, { mode: 0o600 });
      try { fs.chmodSync(pidFile(), 0o600); } catch {}
      return {
        ok: true,
        mode: 'local',
        privacyMode: privacy,
        alreadyRunning: true,
        pid: runningPid,
        pidFile: pidFile(),
        logFile: logFile(),
        receiptPath,
        config
      };
    }
    return {
      ok: false,
      mode: 'local',
      privacyMode: privacy,
      error: 'The loopback Collector health endpoint is already in use by another runtime; stop it before starting local strict mode.'
    };
  }

  const out = fs.openSync(logFile(), 'a', 0o600);
  const child = childProcess.spawn(binary.path, ['--config', config], {
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      AGENTOPS_OTEL_STORAGE_DIR: storageDir,
      AGENTOPS_OTEL_RECEIPT_PATH: receiptPath
    }
  });
  try { fs.closeSync(out); } catch {}
  child.unref();
  fs.writeFileSync(pidFile(), `${child.pid}\n`, { mode: 0o600 });
  try { fs.chmodSync(pidFile(), 0o600); } catch {}
  const health = await waitForHealth();
  return {
    ok: health.ok,
    mode: 'local',
    privacyMode: privacy,
    pid: child.pid,
    pidFile: pidFile(),
    logFile: logFile(),
    receiptPath,
    config,
    health,
    error: health.ok ? null : 'Local Collector process started, but health endpoint did not become ready.'
  };
}

function stopBinaryCollector({ privacy = 'strict', findCollectorBinary } = {}) {
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  const config = binaryConfigPath(privacy);
  const discoveredPid = binary.ok ? findManagedCollectorProcess(binary.path, config) : null;
  const targetPid = discoveredPid;
  if (!processAlive(targetPid)) return { ok: true, mode: 'binary', stopped: false, detail: 'No AgentOps collector PID is running.' };
  process.kill(targetPid, 'SIGTERM');
  fs.rmSync(pidFile(), { force: true });
  return { ok: true, mode: 'binary', stopped: true, pid: targetPid };
}

function stopLocalCollector({ privacy = 'strict', findCollectorBinary } = {}) {
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  const config = localConfigPath(privacy);
  const pid = readPid();
  const discoveredPid = binary.ok ? findManagedCollectorProcess(binary.path, config) : null;
  const targetPid = processAlive(pid) && discoveredPid === pid ? pid : discoveredPid;
  if (!processAlive(targetPid)) return { ok: true, mode: 'local', stopped: false, detail: 'No managed local collector PID is running.' };
  process.kill(targetPid, 'SIGTERM');
  fs.rmSync(pidFile(), { force: true });
  return { ok: true, mode: 'local', stopped: true, pid: targetPid };
}

function stopNativeAzureCollector({ findCollectorBinary } = {}) {
  const binary = typeof findCollectorBinary === 'function' ? findCollectorBinary() : missingBinaryResolver();
  const config = nativeConfigPaths('strict').at(-1);
  const discoveredPid = binary.ok ? findManagedCollectorProcess(binary.path, config) : null;
  if (!processAlive(discoveredPid)) return { ok: true, mode: 'azure-native', stopped: false, detail: 'No managed native Azure collector PID is running.' };
  process.kill(discoveredPid, 'SIGTERM');
  fs.rmSync(pidFile(), { force: true });
  return { ok: true, mode: 'azure-native', stopped: true, pid: discoveredPid };
}

module.exports = {
  binaryConfigPath,
  findRunningBinaryCollector,
  findRunningLocalCollector,
  findRunningNativeCollector,
  nativeConfigPaths,
  nativeEndpointEnvironment,
  localConfigPath,
  startBinaryCollector,
  startNativeAzureCollector,
  startLocalCollector,
  stopBinaryCollector,
  stopNativeAzureCollector,
  stopLocalCollector
};
