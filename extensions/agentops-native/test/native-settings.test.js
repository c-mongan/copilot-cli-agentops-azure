'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectNativeSettings, disconnectNativeSettings, nativeTerminalEnvironment,
  inspectNativeStatus } = require('../src/native-settings');

const endpoint = 'http://127.0.0.1:4318';
const prefix = 'github.copilot.chat.otel.';
const keys = ['enabled', 'exporterType', 'protocol', 'otlpEndpoint', 'captureContent', 'captureIdentity'].map(key => prefix + key);
function fixture(extraKeys = []) {
  const registered = [...keys, ...extraKeys];
  const globals = {};
  const overrides = {};
  const writes = [];
  const defaults = key => /\.(enabled|captureContent|captureIdentity)$/.test(key) ? false :
    key.endsWith('.exporterType') ? 'otlp-http' : key.endsWith('.otlpEndpoint') ? '' : 'http/protobuf';
  const config = {
    inspect(key) { return registered.includes(key) ? { key, defaultValue: defaults(key), globalValue: globals[key], ...overrides[key] } :
      { key, defaultValue: undefined, globalValue: undefined }; },
    get(key) { return overrides[key]?.workspaceValue ?? globals[key]; },
    async update(key, value, target) {
      writes.push({ key, value, target });
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
  };
  const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => config } };
  const state = {};
  const saves = [];
  const persistState = async value => { saves.push(JSON.parse(JSON.stringify(value))); };
  return { vscode, state, persistState, globals, overrides, writes, saves, config };
}

test('connect saves restore data before writing and disconnect restores undefined and prior values', async () => {
  const f = fixture();
  f.globals[prefix + 'enabled'] = false;
  const update = f.config.update;
  f.config.update = async (...args) => { assert.equal(f.saves.length, 1); return update(...args); };
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  assert.equal(result.connected, true);
  assert.equal(result.telemetryObserved, false);
  assert.deepEqual(f.writes.slice(0, 2).map(item => item.key), [prefix + 'captureContent', prefix + 'captureIdentity']);
  assert.equal(f.writes.at(-1).key, prefix + 'enabled');
  assert.equal(f.globals[prefix + 'protocol'], 'http/json');
  assert.equal(f.saves[0].settingsSnapshot.entries[1].hadValue, false);
  f.config.update = update;
  await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(f.globals, { [prefix + 'enabled']: false });
  assert.equal(f.state.settingsSnapshot, undefined);
});

test('disconnect preserves subsequent user edits', async () => {
  const f = fixture();
  await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  f.globals[prefix + 'otlpEndpoint'] = 'http://127.0.0.1:9000';
  const result = await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(result.preserved, [prefix + 'otlpEndpoint']);
  assert.equal(f.globals[prefix + 'otlpEndpoint'], 'http://127.0.0.1:9000');
});

test('workspace, policy, environment and absent settings block without exposing values or writing', async () => {
  for (const setup of [
    f => { f.overrides[prefix + 'captureContent'] = { workspaceValue: true }; },
    f => { f.overrides[prefix + 'enabled'] = { policyValue: true }; },
    f => { const inspect = f.config.inspect; f.config.inspect = key => key.endsWith('protocol') ? undefined : inspect(key); }
  ]) {
    const f = fixture(); setup(f);
    const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
    assert.equal(result.connected, false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.saves.length, 0);
  }
  const f = fixture();
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint,
    env: { OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=secret-canary', OTEL_RESOURCE_ATTRIBUTES: 'user.name=private' } });
  assert.equal(result.connected, false);
  assert.equal(JSON.stringify(result).includes('secret-canary'), false);
  assert.equal(f.writes.length, 0);
});

test('Copilot null-device file exporter sentinel does not block, other paths do', async () => {
  const sentinel = inspectNativeStatus(fixture().vscode, { endpoint, env: { COPILOT_OTEL_FILE_EXPORTER_PATH: require('os').devNull } });
  assert.equal(sentinel.blockers.some(item => item.reason === 'environment_override'), false);
  const real = inspectNativeStatus(fixture().vscode, { endpoint, env: { COPILOT_OTEL_FILE_EXPORTER_PATH: '/tmp/spans.jsonl' } });
  assert.ok(real.blockers.some(item => item.key === 'COPILOT_OTEL_FILE_EXPORTER_PATH' && item.reason === 'environment_override'));
  const f = fixture();
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: { COPILOT_OTEL_FILE_EXPORTER_PATH: require('os').devNull } });
  assert.equal(result.connected, true);
});

test('Copilot-normalized endpoint in the host environment does not block reconnect, other ports do', async () => {
  const copilotWritten = { COPILOT_OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: endpoint + '/', OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false' };
  const same = inspectNativeStatus(fixture().vscode, { endpoint, env: copilotWritten });
  assert.equal(same.blockers.some(item => item.reason === 'environment_override'), false);
  const other = inspectNativeStatus(fixture().vscode, { endpoint, env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9999/' } });
  assert.ok(other.blockers.some(item => item.key === 'OTEL_EXPORTER_OTLP_ENDPOINT' && item.reason === 'environment_override'));
  const invalid = inspectNativeStatus(fixture().vscode, { endpoint, env: { COPILOT_OTEL_ENDPOINT: 'not a url' } });
  assert.ok(invalid.blockers.some(item => item.key === 'COPILOT_OTEL_ENDPOINT'));
  const f = fixture();
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: copilotWritten });
  assert.equal(result.connected, true);
});

test('failed update rolls back prior owned writes', async () => {
  const f = fixture();
  const update = f.config.update;
  let count = 0;
  f.config.update = async (...args) => { if (++count === 3) throw new Error('private provider error'); return update(...args); };
  await assert.rejects(connectNativeSettings(f.vscode, { ...f, endpoint, env: {} }), /Owned settings were restored/);
  assert.deepEqual(f.globals, {});
  assert.equal(f.state.settingsSnapshot, undefined);
});

test('failed durable save does not change user settings', async () => {
  const f = fixture();
  await assert.rejects(connectNativeSettings(f.vscode, { ...f, endpoint, env: {},
    persistState: async () => { throw new Error('disk'); } }), /disk/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.state.settingsSnapshot, undefined);
});

test('terminal environment is loopback JSON with capture off; existing terminals are not claimed', () => {
  const env = nativeTerminalEnvironment(endpoint);
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json');
  assert.equal(env.COPILOT_OTEL_CAPTURE_CONTENT, 'false');
  assert.equal(env.COPILOT_OTEL_CAPTURE_IDENTITY, 'false');
  assert.equal(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, 'false');
  for (const invalid of ['https://127.0.0.1:4318', 'http://localhost:4318', 'http://127.0.0.1:4318/',
    'http://127.0.0.1:4318/v1/traces', 'http://user:secret@127.0.0.1:4318', 'http://127.0.0.1:4318?token=secret']) {
    assert.throws(() => nativeTerminalEnvironment(invalid));
  }
  const f = fixture();
  const status = inspectNativeStatus(f.vscode, { endpoint, env: {} });
  assert.equal(status.externalTerminalsConfigured, false);
  assert.equal(status.existingTerminalsConfigured, false);
});

test('reconnect retains original snapshot and refuses an endpoint change', async () => {
  const f = fixture();
  await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  const before = JSON.stringify(f.state);
  assert.equal((await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} })).connected, true);
  assert.equal(JSON.stringify(f.state), before);
  await assert.rejects(connectNativeSettings(f.vscode, { ...f, endpoint: 'http://127.0.0.1:9000', env: {} }), /Disconnect/);
});

test('complete Agent Host settings configure together; partial support skips every host setting', async () => {
  const hostPrefix = 'chat.agentHost.otel.';
  // VS Code leaves chat.agentHost.otel.otlpProtocol unregistered, so it must not be required or written.
  const hostKeys = ['enabled', 'exporterType', 'otlpEndpoint', 'captureContent', 'captureIdentity'].map(key => hostPrefix + key);
  const f = fixture(hostKeys);
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  assert.equal(result.agentHostConfigured, true);
  assert.equal(f.globals[hostPrefix + 'otlpEndpoint'], endpoint);
  assert.equal(hostPrefix + 'otlpProtocol' in f.globals, false);
  assert.equal(f.state.settingsSnapshot.entries.length, 11);
  assert.deepEqual(f.writes.slice(0, 4).map(item => item.key), [prefix + 'captureContent', prefix + 'captureIdentity',
    hostPrefix + 'captureContent', hostPrefix + 'captureIdentity']);
  assert.deepEqual(f.writes.slice(-2).map(item => item.key), [prefix + 'enabled', hostPrefix + 'enabled']);
  await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(f.globals, {});
  const partial = fixture(hostKeys.filter(key => !key.endsWith('captureContent')));
  const partialResult = await connectNativeSettings(partial.vscode, { ...partial, endpoint, env: {} });
  assert.equal(partialResult.connected, true);
  assert.equal(partialResult.agentHostSupported, false);
  assert.equal(partialResult.agentHostConfigured, false);
  assert.equal(partialResult.partialHostUnsupported, true);
  assert.equal(partial.writes.length, 6);
  assert.ok(partial.writes.every(item => item.key.startsWith(prefix)));
  assert.equal(inspectNativeStatus(fixture().vscode, { endpoint, env: {} }).agentHostSupported, false);
});

test('secret-like old endpoint and corrupted restore record cannot be persisted or applied', async () => {
  const f = fixture();
  f.globals[prefix + 'otlpEndpoint'] = 'https://collector.example/?token=private-canary';
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  assert.equal(result.connected, false);
  assert.equal(JSON.stringify(result).includes('private-canary'), false);
  assert.equal(f.saves.length, 0);
  delete f.globals[prefix + 'otlpEndpoint'];
  await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  f.state.settingsSnapshot.entries[0].key = 'unrelated.setting';
  const writes = f.writes.length;
  await assert.rejects(disconnectNativeSettings(f.vscode, f), /invalid/);
  assert.equal(f.writes.length, writes);
});

test('failed restore save retains the recovery record for retry', async () => {
  const f = fixture();
  await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  await assert.rejects(disconnectNativeSettings(f.vscode, { ...f,
    persistState: async () => { throw new Error('disk'); } }), /disk/);
  assert.ok(f.state.settingsSnapshot);
  await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(f.globals, {});
  assert.equal(f.state.settingsSnapshot, undefined);
});

test('unregistered inspect objects do not qualify Chat or Agent Host even with a stored global value', async () => {
  const f = fixture();
  const inspect = f.config.inspect;
  f.config.inspect = key => key === prefix + 'protocol' ? {
    key, defaultValue: undefined, globalValue: 'http/json'
  } : inspect(key);
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  assert.equal(result.supported, false);
  assert.equal(result.connected, false);
  assert.equal(result.agentHostSupported, false);
  assert.ok(result.blockers.some(item => item.key === prefix + 'protocol' && item.reason === 'unsupported_setting'));
  assert.equal(f.writes.length, 0);
  assert.equal(f.saves.length, 0);
});

test('a hidden Agent Host captureIdentity setting is optional unless a non-false value is stored', async () => {
  const hostPrefix = 'chat.agentHost.otel.';
  const hostKeys = ['enabled', 'exporterType', 'otlpEndpoint', 'captureContent'].map(key => hostPrefix + key);
  const f = fixture(hostKeys);
  const result = await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  assert.equal(result.agentHostConfigured, true);
  assert.equal(f.globals[hostPrefix + 'enabled'], true);
  assert.equal(hostPrefix + 'captureIdentity' in f.globals, false);
  assert.equal(f.state.settingsSnapshot.entries.length, 10);
  await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(f.globals, {});

  const unsafe = fixture(hostKeys);
  const inspect = unsafe.config.inspect;
  unsafe.config.inspect = key => key === hostPrefix + 'captureIdentity' ?
    { key, defaultValue: undefined, globalValue: true } : inspect(key);
  const unsafeResult = await connectNativeSettings(unsafe.vscode, { ...unsafe, endpoint, env: {} });
  assert.equal(unsafeResult.connected, true);
  assert.equal(unsafeResult.agentHostSupported, false);
  assert.ok(unsafe.writes.every(item => item.key.startsWith(prefix)));
});

test('a legacy snapshot that owns chat.agentHost.otel.otlpProtocol still restores', async () => {
  const hostPrefix = 'chat.agentHost.otel.';
  const hostKeys = ['enabled', 'exporterType', 'otlpEndpoint', 'captureContent', 'captureIdentity'].map(key => hostPrefix + key);
  const f = fixture([...hostKeys, hostPrefix + 'otlpProtocol']);
  await connectNativeSettings(f.vscode, { ...f, endpoint, env: {} });
  const entries = f.state.settingsSnapshot.entries;
  entries.splice(entries.findIndex(item => item.key === hostPrefix + 'otlpEndpoint'), 0,
    { key: hostPrefix + 'otlpProtocol', ownedValue: 'http/json', hadValue: false });
  f.globals[hostPrefix + 'otlpProtocol'] = 'http/json';
  await disconnectNativeSettings(f.vscode, f);
  assert.deepEqual(f.globals, {});
  assert.equal(f.state.settingsSnapshot, undefined);
});
