const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { superviseProcess } = require('../src/lib/copilot/process-supervisor');
const { spawn } = require('node:child_process');

test('supervision preserves child exit and removes signal handlers', async () => {
  const signals = new EventEmitter();
  const result = await superviseProcess(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }, {}, { signals });
  assert.equal(result.status, 7);
  assert.equal(result.collectorFailed, false);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('collector death cancels a running process without blocking and reports lost capture', async () => {
  let exit;
  const exited = new Promise(resolve => { exit = resolve; });
  const signals = new EventEmitter();
  const pending = superviseProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], { stdio: 'ignore' }, { exited }, { signals, graceMs: 100 });
  setTimeout(exit, 40);
  const result = await pending;
  assert.equal(result.collectorFailed, true);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('cancellation forwards signal and escalates when child ignores it', { skip: process.platform === 'win32' }, async () => {
  const signals = new EventEmitter();
  const pending = superviseProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},100)'], { stdio: ['ignore','ignore','ignore','ipc'] }, {}, { signals, graceMs: 80, spawn: (...args) => { const child=spawn(...args); child.once('message', () => signals.emit('SIGTERM')); return child; } });
  const result = await pending;
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.collectorFailed, false);
});

test('spawn errors settle and leave no signal handlers', async () => {
  const signals = new EventEmitter();
  const result = await superviseProcess('/nonexistent/agentops-command', [], { stdio: 'ignore' }, {}, { signals });
  assert.equal(result.error.code, 'ENOENT');
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('budget abort uses supervised cancellation and kills an ignoring child', { skip: process.platform === 'win32' }, async () => {
  const controller = new AbortController();
  const pending = superviseProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},100)'], { stdio: ['ignore','ignore','ignore','ipc'] }, {}, { abortSignal: controller.signal, graceMs: 80, spawn: (...args) => { const child=spawn(...args); child.once('message', () => controller.abort()); return child; } });
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(result.signal, 'SIGKILL');
});

test('cooperative zero-exit cancellation is still recorded as cancelled', { skip: process.platform === 'win32' }, async () => {
  const signals = new EventEmitter();
  const result = await superviseProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>process.exit(0));process.send("ready");setInterval(()=>{},100)'], { stdio: ['ignore','ignore','ignore','ipc'] }, {}, { signals, spawn: (...args) => { const child=spawn(...args); child.once('message', () => signals.emit('SIGTERM')); return child; } });
  assert.equal(result.status, 0);
  assert.equal(result.cancelled, true);
});

test('cancellation kills owned descendants after a cooperative launcher exits', { skip: process.platform === 'win32' }, async () => {
  const controller = new AbortController();
  let descendantPid;
  const script = `const {spawn}=require('node:child_process');
    process.on('SIGTERM',()=>process.exit(0));
    const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},100)'],{stdio:['ignore','ignore','ignore','ipc']});
    child.once('message',()=>process.send(child.pid));`;
  const result = await superviseProcess(process.execPath, ['-e', script], { stdio: ['ignore','ignore','ignore','ipc'] }, {}, {
    abortSignal: controller.signal, graceMs: 100,
    spawn: (...args) => { const child = spawn(...args); child.once('message', pid => { descendantPid = pid; controller.abort(); }); return child; }
  });
  assert.equal(result.cancelled, true);
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt++) {
    try { process.kill(descendantPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(alive, false, 'owned descendant must not continue work after cancellation');
});

test('pre-aborted supervision never spawns model work', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await superviseProcess('unused', [], {}, {}, { abortSignal: controller.signal, spawn: () => { throw new Error('must not spawn'); } });
  assert.equal(result.aborted, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.error, undefined);
});
