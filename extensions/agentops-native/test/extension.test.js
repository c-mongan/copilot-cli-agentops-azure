const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../src/extension');
function fixture({ trusted = true, remote, optedIn = false, answer = 'Connect', failSettings = false, profile, storageScheme = 'file', collectorExit } = {}) {
  const events = [], saved = {}, env = new Map();
  const vscode = { StatusBarAlignment: { Left: 1 }, ViewColumn: { One: 1 }, env: { remoteName: remote }, workspace: { isTrusted: trusted }, window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    showInformationMessage: async message => { events.push('consent'); events.push(['message', message]); return answer; }, showWarningMessage: async () => events.push('blocked'), showErrorMessage: async () => events.push('error'),
    createTerminal: options => ({ show: () => events.push(['terminal', options]), sendText: text => events.push(['send', text]) }),
    createWebviewPanel: () => ({ webview: {} })
  } };
  const context = { globalStorageUri: { scheme: storageScheme, fsPath: '/private/extension' }, globalState: { get: () => ({ optedIn }), update: async (key, state) => { Object.assign(saved, state); events.push('persist'); } }, environmentVariableCollection: { clear: () => env.clear(), replace: (key, value) => env.set(key, value) } };
  const deps = { profile: profile || { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} }, settings: { disconnectNativeSettings: async () => events.push('restore'), connectNativeSettings: async () => { events.push('settings'); return { connected: !failSettings }; }, nativeTerminalEnvironment: () => ({ COPILOT_OTEL_ENABLED: 'true' }) }, startRecorder: async () => { events.push('start'); return { exited: collectorExit, endpoint: 'http://127.0.0.1:12345', receiptPath: '/private/receipt', stop: async options => events.push(['stop', options]) }; } };
  return { controller: createController(vscode, context, deps), events, saved, env };
}
test('no install or settings changes before consent; unsupported workspaces are blocked', async () => {
  for (const options of [{ answer: undefined }, { trusted: false }, { remote: 'ssh-remote' }]) {
    // Use Cancel rather than an omitted answer because fixture has a default.
    const f = fixture(options.answer === undefined && options.trusted === undefined && options.remote === undefined ? { answer: 'Cancel' } : options);
    await f.controller.connect(false);
    assert.ok(!f.events.includes('start')); assert.ok(!f.events.includes('settings'));
  }
});
test('connect once sets opt-in and terminal env; disconnect retains receipts and clears opt-in', async () => {
  const f = fixture(); await f.controller.connect(false);
  assert.equal(f.saved.optedIn, true); assert.equal(f.env.get('COPILOT_OTEL_ENABLED'), 'true');
  assert.ok(f.events.indexOf('consent') < f.events.indexOf('start'));
  await f.controller.startCopilotTerminal(); assert.deepEqual(f.events.find(e => Array.isArray(e) && e[0] === 'send'), ['send', 'copilot']);
  await f.controller.disconnect(); assert.equal(f.saved.optedIn, false); assert.equal(f.env.size, 0);
  assert.deepEqual(f.events.find(e => Array.isArray(e) && e[0] === 'stop'), ['stop', { remove: false }]);
});
test('unsupported native settings block before Collector download and name the missing setting', async () => {
  let released = 0;
  const messages = [];
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async () => 'Connect', showErrorMessage: async message => messages.push(message) } };
  const context = { globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  let started = false, settingsChanged = false;
  const controller = createController(vscode, context, { env: {}, profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease: () => { released++; } }, settings: { inspectNativeStatus: () => ({ blockers: [{ key: 'github.copilot.chat.otel.enabled', reason: 'unsupported_setting' }] }), connectNativeSettings: async () => { settingsChanged = true; return { connected: true }; }, disconnectNativeSettings: async () => {}, nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => { started = true; } });
  await controller.connect(false);
  assert.equal(started, false); assert.equal(settingsChanged, false); assert.equal(released, 1);
  assert.match(messages[0], /github\.copilot\.chat\.otel\.enabled/); assert.match(messages[0], /Nothing was downloaded/);
});
test('telemetry environment overrides block before Collector download and name the variable', async () => {
  let released = 0;
  const messages = [];
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async () => 'Connect', showErrorMessage: async message => messages.push(message) } };
  const context = { globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  let started = false, settingsChanged = false;
  const controller = createController(vscode, context, { env: {}, profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease: () => { released++; } }, settings: { inspectNativeStatus: () => ({ blockers: [{ key: 'OTEL_EXPORTER_OTLP_HEADERS', reason: 'environment_override' }] }), connectNativeSettings: async () => { settingsChanged = true; return { connected: true }; }, disconnectNativeSettings: async () => {}, nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => { started = true; } });
  await controller.connect(false);
  assert.equal(started, false); assert.equal(settingsChanged, false); assert.equal(released, 1);
  assert.match(messages[0], /OTEL_EXPORTER_OTLP_HEADERS/); assert.match(messages[0], /Nothing was downloaded/);
});
test('preflight leaves endpoint-value checks to connect, where the real Collector endpoint is known', async () => {
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async () => 'Connect', showErrorMessage: async () => {} } };
  const context = { globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  let started = false;
  const controller = createController(vscode, context, { env: {}, profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} }, settings: { inspectNativeStatus: () => ({ blockers: [{ key: 'OTEL_EXPORTER_OTLP_ENDPOINT', reason: 'environment_override' }] }), connectNativeSettings: async () => ({ connected: true }), disconnectNativeSettings: async () => {}, nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => { started = true; return { endpoint: 'http://127.0.0.1:4318', receiptPath: '/fixture/r.jsonl', stop: async () => {} }; } });
  await controller.connect(false).catch(() => {});
  assert.equal(started, true);
});
test('blocked native settings name the setting and reason, and log the failure', async () => {
  const messages = [], logged = [];
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), createOutputChannel: () => ({ appendLine: line => logged.push(line), dispose() {} }), showInformationMessage: async () => 'Connect', showErrorMessage: async message => messages.push(message) } };
  const context = { subscriptions: [], globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  const controller = createController(vscode, context, { env: {}, profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} }, settings: { inspectNativeStatus: () => ({ blockers: [] }), connectNativeSettings: async () => ({ connected: false, blockers: [{ key: 'github.copilot.chat.otel.otlpEndpoint', reason: 'unsafe_prior_setting' }] }), disconnectNativeSettings: async () => {}, nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => ({ endpoint: 'http://127.0.0.1:4318', receiptPath: '/fixture/r.jsonl', stop: async () => {} }) });
  await assert.rejects(controller.connect(false));
  assert.match(messages[0], /github\.copilot\.chat\.otel\.otlpEndpoint \(unsafe_prior_setting\)/);
  assert.match(logged[0], /Connect failed: .*unsafe_prior_setting/);
  assert.equal(context.subscriptions.length, 1);
});
test('failed native settings stops Collector; deactivation stops but preserves opted-in reconnect', async () => {
  const f = fixture({ failSettings: true }); await assert.rejects(f.controller.connect(false));
  assert.equal(f.saved.optedIn, false); assert.equal(f.env.size, 0); assert.ok(f.events.some(e => Array.isArray(e) && e[0] === 'stop'));
  const connected = fixture({ optedIn: true }); await connected.controller.connect(true); await connected.controller.dispose();
  assert.equal(connected.saved.optedIn, true); assert.equal(connected.env.size, 0); assert.ok(!connected.events.includes('consent'));
});
test('settings restore failure does not leave Collector running', async () => {
  let stopped = false, restoreCalls = 0;
  const f = fixture();
  // Exercise the same lifecycle with an adapter that fails only after connection.
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async () => 'Connect' } };
  const context = { globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  const controller = createController(vscode, context, { profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} }, settings: { disconnectNativeSettings: async () => { restoreCalls++; throw new Error('durable restore failed'); }, connectNativeSettings: async () => ({ connected: true }), nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => ({ endpoint: 'http://127.0.0.1:1', receiptPath: '/fixture/receipt', stop: async () => { stopped = true; } }) });
  await controller.connect(false); await assert.rejects(controller.disconnect(), /durable restore/); assert.equal(stopped, true);
  await f.controller.dispose();
});
test('second window cannot restore or start while another window owns capture', async () => {
  let leased = false, persisted;
  const profile = { readProfileState: () => persisted ? JSON.parse(JSON.stringify(persisted)) : null, writeProfileState: (storage, state) => { persisted = JSON.parse(JSON.stringify(state)); }, acquireProfileLease: () => { if (leased) throw new Error('owned'); leased = true; return {}; }, releaseProfileLease: () => { leased = false; } };
  const first = fixture({ profile }), second = fixture({ profile });
  await first.controller.connect(false); await second.controller.connect(false); await second.controller.dispose();
  assert.ok(!second.events.includes('restore')); assert.ok(!second.events.includes('start')); assert.equal(leased, true);
  await first.controller.disconnect(); assert.equal(leased, false);
});

test('actual local vscode-userdata context can connect; other storage schemes remain blocked', async () => {
  const local = fixture({ storageScheme: 'vscode-userdata' });
  await local.controller.connect(false);
  assert.ok(local.events.includes('start'));
  await local.controller.disconnect();
  const other = fixture({ storageScheme: 'vscode-remote' });
  await other.controller.connect(false);
  assert.ok(!other.events.includes('start'));
});

// Use the real settings adapter here. A reload must not restore and rewrite startup settings.
test('host reload preserves native settings and restarts the same durable endpoint without settings writes', async () => {
  const nativeSettings = require('../src/native-settings');
  const desired = nativeSettings.nativeTerminalEnvironment('http://127.0.0.1:23456');
  const values = new Map(), writes = [], endpoints = [], messages = [];
  let durable, leased = false;
  const profile = { readProfileState: () => durable ? structuredClone(durable) : null, writeProfileState: (storage, state) => { durable = structuredClone(state); }, acquireProfileLease: () => { assert.equal(leased, false); leased = true; return {}; }, releaseProfileLease: () => { leased = false; } };
  const config = { inspect: key => key.startsWith('github.copilot.chat.otel.') ? ({ defaultValue: key.endsWith('enabled') ? false : '', globalValue: values.get(key) }) : undefined, get: key => values.get(key), update: async (key, value) => { assert.equal(durable.endpoint, 'http://127.0.0.1:23456'); writes.push(key); values.set(key, value); } };
  const vscode = { ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true, getConfiguration: () => config }, window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async message => { messages.push(message); return 'Connect'; } } };
  const context = () => ({ globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } });
  const deps = { profile, settings: nativeSettings, env: {}, startRecorder: async (storage, options) => { endpoints.push(options.endpoint); return { endpoint: options.endpoint || 'http://127.0.0.1:23456', receiptPath: '/fixture/receipt', stop: async () => {} }; }, reportReceipt: () => ({ nativeSpanCount: 0 }) };
  const first = createController(vscode, context(), deps);
  await first.connect(false); await first.status();
  assert.match(messages.at(-1), /Reload VS Code/);
  const snapshot = structuredClone(durable.settingsSnapshot), writeCount = writes.length;
  await first.dispose();
  assert.equal(durable.optedIn, true); assert.deepEqual(durable.settingsSnapshot, snapshot); assert.equal(writes.length, writeCount);
  assert.equal(values.get('github.copilot.chat.otel.otlpEndpoint'), desired.COPILOT_OTEL_ENDPOINT);
  const second = createController(vscode, context(), deps);
  await second.connect(true);
  assert.deepEqual(endpoints, [undefined, 'http://127.0.0.1:23456']); assert.equal(writes.length, writeCount);
  await second.disconnect();
  assert.equal(durable.optedIn, false); assert.equal(durable.settingsSnapshot, undefined);
  assert.ok([...values.values()].every(value => value === undefined));
});

test('output-limit exit stops capture and explains incomplete coverage', async () => {
  let resolve;
  const collectorExit = new Promise(done => { resolve = done; });
  const f = fixture({ collectorExit });
  await f.controller.connect(false);
  resolve({ reason: 'output_limit' });
  await new Promise(done => setImmediate(done));
  await f.controller.status();
  assert.equal(f.saved.optedIn, false); assert.equal(f.saved.lastStopReason, 'output_limit');
  assert.match(f.events.filter(event => Array.isArray(event) && event[0] === 'message').at(-1)[1], /12 MiB sampled size limit/);
  assert.match(f.events.filter(event => Array.isArray(event) && event[0] === 'message').at(-1)[1], /Stages: Local Collector: stopped\. .*Azure cloud readback: unverified\./);
});
test('an undismissed blocked toast does not stall the next connect, and granting trust clears Blocked', async () => {
  let trustHandler; const bar = { show() {}, dispose() {} }; let consent = 0;
  const workspace = { isTrusted: false, onDidGrantWorkspaceTrust: handler => { trustHandler = handler; return { dispose() {} }; } };
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace, window: { createStatusBarItem: () => bar, showWarningMessage: () => new Promise(() => {}), showInformationMessage: async () => { consent++; return 'Cancel'; } } };
  const context = { subscriptions: [], globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async () => {} }, environmentVariableCollection: { clear() {}, replace() {} } };
  const controller = createController(vscode, context, { profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} }, settings: { disconnectNativeSettings: async () => {}, connectNativeSettings: async () => ({ connected: true }), nativeTerminalEnvironment: () => ({}) }, startRecorder: async () => { throw new Error('not expected'); } });
  await controller.connect(false);
  assert.match(bar.text, /Blocked/); assert.equal(context.subscriptions.length, 1);
  workspace.isTrusted = true; trustHandler();
  assert.match(bar.text, /AgentOps: Off/);
  await controller.connect(false);
  assert.equal(consent, 1);
});
test('Agent Host settings trigger a local Agent Host restart on connect and on disconnect', async () => {
  const commands = [];
  const hostEntry = { key: 'chat.agentHost.otel.enabled', ownedValue: true, hadValue: false };
  let state;
  const vscode = { StatusBarAlignment: { Left: 1 }, env: {}, workspace: { isTrusted: true }, commands: { executeCommand: async id => commands.push(id) },
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showInformationMessage: async () => 'Connect', showErrorMessage: async () => {} } };
  const context = { globalStorageUri: { scheme: 'file', fsPath: '/fixture' }, globalState: { get: () => ({ optedIn: false }), update: async (key, value) => { state = value; } }, environmentVariableCollection: { clear() {}, replace() {} } };
  const controller = createController(vscode, context, { env: {}, profile: { readProfileState: () => null, writeProfileState() {}, acquireProfileLease: () => ({}), releaseProfileLease() {} },
    settings: { inspectNativeStatus: () => ({ blockers: [] }),
      connectNativeSettings: async (_, options) => { options.state.settingsSnapshot = { entries: [hostEntry] }; return { connected: true, agentHostConfigured: true }; },
      disconnectNativeSettings: async (_, options) => { delete options.state.settingsSnapshot; },
      nativeTerminalEnvironment: () => ({}) },
    startRecorder: async () => ({ endpoint: 'http://127.0.0.1:4318', receiptPath: '/fixture/r.jsonl', stop: async () => {} }) });
  await controller.connect(false);
  assert.deepEqual(commands, ['workbench.action.chat.restartLocalAgentHost']);
  assert.equal(state.optedIn, true);
  await controller.disconnect();
  assert.deepEqual(commands, ['workbench.action.chat.restartLocalAgentHost', 'workbench.action.chat.restartLocalAgentHost']);
});
