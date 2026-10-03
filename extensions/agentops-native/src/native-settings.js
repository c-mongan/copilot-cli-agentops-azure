'use strict';

const PREFIX = 'github.copilot.chat.otel.';
const HOST_PREFIX = 'chat.agentHost.otel.';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Native OTel keys have explicit defaults. inspect() can also return an object for an unknown key.
const isRegistered = info => !!info && info.defaultValue !== undefined;

function safePriorValue(key, value) {
  if (value === undefined) return true;
  if (/\.(enabled|captureContent|captureIdentity)$/.test(key)) return typeof value === 'boolean';
  if (key.endsWith('.exporterType')) return ['otlp-http', 'file', 'console'].includes(value);
  if (/\.(protocol|otlpProtocol)$/.test(key)) return ['http/json', 'http/protobuf', 'grpc'].includes(value);
  if (key.endsWith('.otlpEndpoint')) {
    if (typeof value !== 'string' || value.length > 512) return false;
    if (value === '') return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        !url.search && !url.hash && ['/', '/v1/traces'].includes(url.pathname);
    } catch { return false; }
  }
  return false;
}

function validateSnapshot(snapshot) {
  if (!Array.isArray(snapshot.entries)) throw new Error('The saved native settings record is invalid.');
  const desired = settings(snapshot.endpoint, snapshot.entries.some(item => item.key?.startsWith(HOST_PREFIX)));
  if (snapshot.version !== 1 || !Array.isArray(snapshot.entries) ||
      snapshot.entries.length !== Object.keys(desired).length ||
      new Set(snapshot.entries.map(item => item.key)).size !== snapshot.entries.length ||
      snapshot.entries.some(item => !(item.key in desired) || !equal(item.ownedValue, desired[item.key]) ||
        typeof item.hadValue !== 'boolean' || !safePriorValue(item.key, item.value) ||
        (item.hadValue && item.value === undefined))) {
    throw new Error('The saved native settings record is invalid.');
  }
}

function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); }
  catch { throw new Error('Use a literal http://127.0.0.1:port endpoint.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      endpoint !== `http://127.0.0.1:${url.port}`) {
    throw new Error('Use a literal http://127.0.0.1:port endpoint.');
  }
  return endpoint;
}

function settings(endpoint, includeAgentHost = false) {
  validateEndpoint(endpoint);
  const desired = {
    [`${PREFIX}captureContent`]: false,
    [`${PREFIX}captureIdentity`]: false
  };
  if (includeAgentHost) Object.assign(desired, {
    [`${HOST_PREFIX}captureContent`]: false,
    [`${HOST_PREFIX}captureIdentity`]: false
  });
  Object.assign(desired, {
    [`${PREFIX}exporterType`]: 'otlp-http',
    [`${PREFIX}protocol`]: 'http/json',
    [`${PREFIX}otlpEndpoint`]: endpoint
  });
  if (includeAgentHost) Object.assign(desired, {
    [`${HOST_PREFIX}exporterType`]: 'otlp-http',
    [`${HOST_PREFIX}otlpProtocol`]: 'http/json',
    [`${HOST_PREFIX}otlpEndpoint`]: endpoint
  });
  // Establish privacy and routing before enabling either native exporter.
  desired[`${PREFIX}enabled`] = true;
  if (includeAgentHost) desired[`${HOST_PREFIX}enabled`] = true;
  return desired;
}

function registeredSettings(vscode, endpoint) {
  const all = settings(endpoint, true);
  const config = vscode.workspace.getConfiguration();
  const hostKeys = Object.keys(all).filter(key => key.startsWith(HOST_PREFIX));
  const hostCount = hostKeys.filter(key => isRegistered(config.inspect(key))).length;
  return { desired: settings(endpoint, hostCount === hostKeys.length),
    agentHostSupported: hostCount === hostKeys.length,
    partialHost: hostCount > 0 && hostCount < hostKeys.length };
}

function nativeTerminalEnvironment(endpoint) {
  validateEndpoint(endpoint);
  return {
    COPILOT_OTEL_ENABLED: 'true',
    COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http',
    COPILOT_OTEL_ENDPOINT: endpoint,
    COPILOT_OTEL_CAPTURE_CONTENT: 'false',
    COPILOT_OTEL_CAPTURE_IDENTITY: 'false',
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false'
  };
}

function environmentBlockers(env, endpoint) {
  const wanted = nativeTerminalEnvironment(endpoint);
  const blockers = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue;
    if ((key in wanted && String(value) !== wanted[key]) ||
        (/^(OTEL_|COPILOT_OTEL_)/.test(key) && !(key in wanted))) {
      blockers.push({ key, reason: 'environment_override' });
    }
  }
  return blockers;
}

function inspectNativeStatus(vscode, { endpoint, env = process.env } = {}) {
  const { desired, agentHostSupported, partialHost } = registeredSettings(vscode, endpoint);
  const blockers = environmentBlockers(env, endpoint);
  const scopes = [undefined, ...(vscode.workspace.workspaceFolders || []).map(folder => folder.uri)];
  let configured = true;
  for (const scope of scopes) {
    const config = vscode.workspace.getConfiguration(undefined, scope);
    for (const [key, value] of Object.entries(desired)) {
      const info = config.inspect(key);
      if (!isRegistered(info)) {
        blockers.push({ key, reason: 'unsupported_setting' });
        configured = false;
        continue;
      }
      if (info.policyValue !== undefined) blockers.push({ key, reason: 'managed_policy' });
      if (!safePriorValue(key, info.globalValue)) blockers.push({ key, reason: 'unsafe_prior_setting' });
      for (const field of ['workspaceValue', 'workspaceFolderValue', 'globalLanguageValue',
        'workspaceLanguageValue', 'workspaceFolderLanguageValue']) {
        if (info[field] !== undefined && !equal(info[field], value)) {
          blockers.push({ key, reason: 'scope_override' });
        }
      }
      if (!equal(config.get(key), value)) configured = false;
    }
  }
  const unique = [...new Map(blockers.map(item => [`${item.key}:${item.reason}`, item])).values()];
  return { supported: !unique.some(item => item.reason === 'unsupported_setting'),
    configured: configured && unique.length === 0, blockers: unique,
    agentHostSupported, agentHostConfigured: agentHostSupported && configured && unique.length === 0,
    partialHostUnsupported: partialHost,
    existingTerminalsConfigured: false, externalTerminalsConfigured: false,
    telemetryObserved: false };
}

async function restore(vscode, state, persistState) {
  const config = vscode.workspace.getConfiguration();
  const snapshot = state.settingsSnapshot;
  validateSnapshot(snapshot);
  const preserved = [];
  for (const item of [...snapshot.entries].reverse()) {
    const current = config.inspect(item.key);
    if (current && equal(current.globalValue, item.ownedValue)) {
      await config.update(item.key, item.hadValue ? item.value : undefined, vscode.ConfigurationTarget.Global);
    } else {
      preserved.push(item.key);
    }
  }
  delete state.settingsSnapshot;
  try { await persistState(state); }
  catch (error) { state.settingsSnapshot = snapshot; throw error; }
  return preserved;
}

async function connectNativeSettings(vscode, { endpoint, state, persistState, env = process.env } = {}) {
  if (!state || typeof persistState !== 'function') throw new Error('A durable state writer is required.');
  const { desired } = registeredSettings(vscode, endpoint);
  const status = inspectNativeStatus(vscode, { endpoint, env });
  if (status.blockers.length) return { ...status, connected: false };
  if (state.settingsSnapshot) {
    validateSnapshot(state.settingsSnapshot);
    if (state.settingsSnapshot.endpoint !== endpoint) throw new Error('Disconnect before changing the endpoint.');
    return { ...status, connected: status.configured };
  }
  const config = vscode.workspace.getConfiguration();
  state.settingsSnapshot = { version: 1, endpoint, entries: Object.entries(desired).map(([key, ownedValue]) => {
    const old = config.inspect(key).globalValue;
    return { key, ownedValue, hadValue: old !== undefined, ...(old !== undefined ? { value: old } : {}) };
  }) };
  try {
    await persistState(state);
  } catch (error) {
    delete state.settingsSnapshot;
    throw error;
  }
  try {
    for (const [key, value] of Object.entries(desired)) {
      // Check again because a workspace or policy can change during an async write.
      if (inspectNativeStatus(vscode, { endpoint, env }).blockers.length) throw new Error('Native settings changed during connection.');
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
    const finalStatus = inspectNativeStatus(vscode, { endpoint, env });
    if (!finalStatus.configured) throw new Error('Native settings are not effective.');
    return { ...finalStatus, connected: true };
  } catch (error) {
    try { await restore(vscode, state, persistState); }
    catch { throw new Error('Native settings update failed. Restore is incomplete; the durable snapshot is retained.'); }
    throw new Error('Native settings update failed. Owned settings were restored.');
  }
}

async function disconnectNativeSettings(vscode, { state, persistState } = {}) {
  if (!state?.settingsSnapshot) return { disconnected: true, preserved: [] };
  if (typeof persistState !== 'function') throw new Error('A durable state writer is required.');
  const preserved = await restore(vscode, state, persistState);
  return { disconnected: true, preserved };
}

module.exports = { connectNativeSettings, disconnectNativeSettings, nativeTerminalEnvironment, inspectNativeStatus };
