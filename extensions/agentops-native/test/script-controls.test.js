'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createScriptControls } = require('../src/script-controls');

function fixture(overrides = {}) {
  const messages = [];
  const calls = [];
  const folder = { name: 'project', uri: { scheme: 'file', fsPath: '/approved/project' } };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [folder] }, env: {}, ProgressLocation: { Notification: 15 },
    window: {
      showWarningMessage: async message => { messages.push(message); },
      showErrorMessage: async message => { messages.push(message); },
      showInformationMessage: async (message, options) => { messages.push(message); return options?.modal ? 'Run selected script' : undefined; },
      showOpenDialog: async () => [{ scheme: 'file', fsPath: '/approved/project/app.cjs' }],
      showInputBox: async () => process.execPath,
      showQuickPick: async choices => choices[0],
      withProgress: async (_options, run) => run({}, { onCancellationRequested: callback => { calls.push({ cancel: callback }); return { dispose() {} }; } })
    }
  };
  const prepare = input => { calls.push({ prepare: input }); return { supported: true, command: input.executable, args: ['--require', '/owned/bootstrap.cjs', input.entry], cwd: input.projectRoot, env: { OTEL_METRICS_EXPORTER: 'none' }, requirements: [] }; };
  const spawn = (command, args, options) => { calls.push({ spawn: { command, args, options } }); const child = new EventEmitter(); child.kill = () => { process.nextTick(() => child.emit('close', null, 'SIGTERM')); }; process.nextTick(() => child.emit('close', overrides.exitCode || 0)); return child; };
  const controls = createScriptControls(vscode, { captureContext: () => ({ endpoint: 'http://127.0.0.1:4318', runId: 'run' }), prepareAutoInstrumentation: prepare, spawn, env: { SAFE: 'original' }, isElectronRuntime: () => true, ...overrides });
  return { vscode, messages, calls, controls };
}

test('approved selected script uses argv process and does not claim telemetry receipt', async () => {
  const f = fixture(); const result = await f.controls.startSelectedScript();
  assert.equal(result.exitCode, 0);
  const invocation = f.calls.find(c => c.spawn).spawn;
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ['ignore', 'ignore', 'ignore']);
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(f.calls.find(c => c.prepare).prepare.electronRuntime, true);
  assert.equal(invocation.options.env.SAFE, 'original');
  assert.equal(f.calls.find(c => c.prepare).prepare.projectRoot, '/approved/project');
  assert.match(f.messages.at(-1), /Azure delivery is unverified/);
});
test('untrusted, remote and capture-off paths do not execute probes or programs', async () => {
  const a = fixture(); a.vscode.workspace.isTrusted = false;
  assert.equal((await a.controls.startSelectedScript()).reason, 'workspace'); assert.equal(a.calls.length, 0);
  const b = fixture(); b.vscode.env.remoteName = 'ssh';
  assert.equal((await b.controls.startSelectedScript()).reason, 'workspace'); assert.equal(b.calls.length, 0);
  const c = fixture({ captureContext: () => undefined });
  assert.equal((await c.controls.startSelectedScript()).reason, 'capture-off'); assert.equal(c.calls.length, 0);
});
test('missing requirements never spawn or install packages', async () => {
  let spawned = false;
  const f = fixture({ prepareAutoInstrumentation: () => ({ supported: false, requirements: ['opentelemetry-sdk'] }), spawn: () => { spawned = true; } });
  assert.equal((await f.controls.startSelectedScript()).reason, 'requirements'); assert.equal(spawned, false);
  assert.match(f.messages.at(-1), /No packages were installed/);
});
test('declined consent and changed capture state block execution', async () => {
  const f = fixture(); f.vscode.window.showInformationMessage = async () => 'Cancel';
  assert.equal((await f.controls.startSelectedScript()).reason, 'cancelled'); assert.equal(f.calls.length, 0);
  let count = 0; const g = fixture({ captureContext: () => ({ endpoint: ++count === 1 ? 'http://127.0.0.1:4318' : 'http://127.0.0.1:4319' }) });
  assert.equal((await g.controls.startSelectedScript()).reason, 'state-changed'); assert.equal(g.calls.length, 0);
});
test('plan and spawn failures show fixed errors without exposing exception data', async () => {
  const f = fixture({ prepareAutoInstrumentation: () => { throw new Error('PRIVATE_CANARY'); } });
  assert.equal((await f.controls.startSelectedScript()).reason, 'invalid-plan'); assert.ok(!f.messages.join(' ').includes('PRIVATE_CANARY'));
  const g = fixture({ spawn: () => { throw new Error('PRIVATE_CANARY'); } });
  assert.equal((await g.controls.startSelectedScript()).reason, 'spawn'); assert.ok(!g.messages.join(' ').includes('PRIVATE_CANARY'));
});
test('cancellation supervises only the selected process and reports possible span loss', async () => {
  let child;
  const f = fixture({ spawn: () => { child = new EventEmitter(); child.kill = signal => { process.nextTick(() => child.emit('close', null, signal)); }; return child; } });
  const pending = f.controls.startSelectedScript();
  await new Promise(resolve => setImmediate(resolve));
  f.calls.find(c => c.cancel).cancel();
  const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.signal, 'SIGTERM');
  assert.match(f.messages.at(-1), /Buffered spans can be lost/);
});
test('ES module selection, Python interpreter and unsupported TypeScript are explicit', async () => {
  const f = fixture(); f.vscode.window.showOpenDialog = async () => [{ scheme: 'file', fsPath: '/approved/project/app.mjs' }];
  await f.controls.startSelectedScript(); assert.equal(f.calls.find(c => c.prepare).prepare.mode, 'esm');
  const g = fixture(); g.vscode.window.showOpenDialog = async () => [{ scheme: 'file', fsPath: '/approved/project/app.py' }]; g.vscode.window.showInputBox = async () => '/approved/project/.venv/bin/python';
  await g.controls.startSelectedScript(); assert.equal(g.calls.find(c => c.prepare).prepare.runtime, 'python'); assert.equal(g.calls.find(c => c.spawn).spawn.options.env.ELECTRON_RUN_AS_NODE, undefined);
  const h = fixture(); h.vscode.window.showOpenDialog = async () => [{ scheme: 'file', fsPath: '/approved/project/app.ts' }];
  assert.equal((await h.controls.startSelectedScript()).reason, 'unsupported-entry'); assert.equal(h.calls.length, 0);
});
