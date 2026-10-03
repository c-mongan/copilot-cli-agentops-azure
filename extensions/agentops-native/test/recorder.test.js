const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureCollector, reportReceipt, reportHtml, startRecorder } = require('../src/recorder');
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-extension-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('installer verifies release before extracting and isolates its binary', async t => {
  const dir = temporary(t); const events = [];
  const release = { collectorPackageInfo: () => ({ version: '1.2.3', binaryName: 'otelcol', fileName: 'release.tar.gz', checksumFileName: 'checksums', url: 'archive', checksumUrl: 'checksum' }), downloadFile: async (url, file) => { events.push(url); fs.writeFileSync(file, 'fixture'); }, verifyChecksum: () => { events.push('verify'); return { ok: true }; } };
  const binary = await ensureCollector(dir, { release, spawnSync: (command, args) => { events.push('extract'); assert.equal(command, 'tar'); fs.writeFileSync(path.join(args[3], 'otelcol'), 'fixture binary'); return { status: 0 }; } });
  assert.deepEqual(events, ['archive', 'checksum', 'verify', 'extract']);
  assert.equal(binary, path.join(dir, 'bin', '1.2.3', 'otelcol'));
  assert.equal(await ensureCollector(dir, { release }), binary);
  release.collectorPackageInfo = () => ({ version: '2.0.0', binaryName: 'otelcol', fileName: 'release.tar.gz', checksumFileName: 'checksums', url: 'archive', checksumUrl: 'checksum' });
  release.verifyChecksum = () => ({ ok: false });
  await assert.rejects(ensureCollector(dir, { release, spawnSync: () => { throw new Error('must not extract'); } }), /checksum/);
});
test('strict Collector is scoped to extension storage', async () => {
  let options;
  await startRecorder('/fixture/storage', { ensureCollector: async () => '/fixture/binary', startScopedStrictCollector: async o => { options = o; return {}; } });
  assert.equal(options.agentopsHome, '/fixture/storage');
  assert.equal(options.tempRoot, '/fixture/storage/receipts');
  assert.equal(options.findCollectorBinary().path, '/fixture/binary');
});
test('receipt report preserves unknown values and never renders content', t => {
  const dir = temporary(t), file = path.join(dir, 'receipt.jsonl');
  fs.writeFileSync(file, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: '00112233445566778899aabbccddeeff', spanId: '0011223344556677', name: '<script>secret prompt https://private/path</script>', startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000', attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'chat' } }, { key: 'gen_ai.conversation.id', value: { stringValue: 'secret conversation' } }, { key: 'gen_ai.usage.input_tokens', value: { intValue: '12' } }] }] }] }] }) + '\n');
  const report = reportReceipt(file);
  assert.equal(report.nativeSpanCount, 1); assert.equal(report.parsedSpans, 1); assert.equal(report.inputTokens, 12); assert.equal(report.outputTokens, null);
  const html = reportHtml(report);
  assert.match(html, /coverage: unknown/); assert.doesNotMatch(html, /secret|https:\/\/private|<script>/);
  assert.match(html, /default-src 'none'/);
  const link = path.join(dir, 'link'); fs.symlinkSync(file, link); assert.throws(() => reportReceipt(link), /symlinks/);
});
test('token totals exclude aggregate root and deduplicate spans; partial totals stay unknown', t => {
  const dir = temporary(t), file = path.join(dir, 'receipt.jsonl');
  const span = (id, op, tokens) => ({ traceId: '00112233445566778899aabbccddeeff', spanId: id, name: op, startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000', attributes: [{ key: 'gen_ai.conversation.id', value: { stringValue: 'fixture' } }, { key: 'gen_ai.operation.name', value: { stringValue: op } }, ...(tokens === undefined ? [] : [{ key: 'gen_ai.usage.input_tokens', value: { intValue: String(tokens) } }])] });
  const write = spans => fs.writeFileSync(file, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }));
  const chat = span('0011223344556677', 'chat', 12);
  write([span('0011223344556678', 'invoke_agent', 12), chat, chat]);
  assert.equal(reportReceipt(file).inputTokens, 12);
  write([chat, span('0011223344556679', 'chat')]);
  assert.equal(reportReceipt(file).inputTokens, null);
});
test('managed worker has an owner IPC channel and confirms stop before returning', async () => {
  const { EventEmitter } = require('node:events');
  const worker = new EventEmitter(); worker.connected = true; worker.exitCode = null;
  const messages = [];
  worker.send = message => {
    messages.push(message.type);
    queueMicrotask(() => {
      if (message.type === 'start') worker.emit('message', { type: 'ready', endpoint: 'http://127.0.0.1:12345', receiptPath: '/fixture/receipt', pid: 123 });
      else { worker.exitCode = 0; worker.emit('exit', 0); }
    });
  };
  const recorder = await startRecorder('/fixture/storage', { ensureCollector: async () => '/fixture/binary', fork: (file, args, options) => {
    assert.match(file, /recorder-worker\.js$/); assert.deepEqual(args, []);
    assert.equal(options.stdio[3], 'ipc'); assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1'); return worker;
  } });
  await recorder.stop({ remove: false });
  assert.deepEqual(messages, ['start', 'stop']); assert.equal((await recorder.exited).code, 0);
});
test('cached binary rejects group or world write access', async t => {
  if (process.platform === 'win32') return;
  const dir = temporary(t), bin = path.join(dir, 'bin', '1.2.3', 'otelcol');
  fs.mkdirSync(path.dirname(bin), { recursive: true }); fs.writeFileSync(bin, 'fixture'); fs.chmodSync(bin, 0o722);
  await assert.rejects(ensureCollector(dir, { release: { collectorPackageInfo: () => ({ version: '1.2.3', binaryName: 'otelcol' }) } }), /write access/);
});
test('profile lease excludes a live owner and durable state survives a new reader', t => {
  const { acquireProfileLease, releaseProfileLease, writeProfileState, readProfileState } = require('../src/recorder');
  const dir = temporary(t), lease = acquireProfileLease(dir);
  assert.throws(() => acquireProfileLease(dir), /owns native capture/);
  writeProfileState(dir, { optedIn: true, receiptPath: '/fixture/receipt' });
  assert.deepEqual(readProfileState(dir), { optedIn: true, receiptPath: '/fixture/receipt' });
  releaseProfileLease(lease); const next = acquireProfileLease(dir); releaseProfileLease(next);
});

test('stable endpoint reaches the Collector and malformed endpoints fail before installation', async () => {
  let received;
  await startRecorder('/fixture/storage', { endpoint: 'http://127.0.0.1:23456', ensureCollector: async () => '/fixture/binary', startScopedStrictCollector: async options => { received = options.receiverPort; return {}; } });
  assert.equal(received, 23456);
  for (const endpoint of ['https://127.0.0.1:23456', 'http://localhost:23456', 'http://127.0.0.1:023456', 'http://127.0.0.1:65536']) {
    await assert.rejects(startRecorder('/fixture/storage', { endpoint, ensureCollector: () => { throw new Error('must not install'); } }), /Saved Collector endpoint/);
  }
});

test('worker exit preserves the sampled local output-limit reason', async () => {
  const { EventEmitter } = require('node:events');
  const worker = new EventEmitter(); worker.connected = true; worker.exitCode = null;
  worker.send = message => queueMicrotask(() => {
    if (message.type === 'start') worker.emit('message', { type: 'ready', endpoint: 'http://127.0.0.1:12345' });
  });
  const active = await startRecorder('/fixture/storage', { ensureCollector: async () => '/fixture/binary', fork: () => worker });
  worker.emit('message', { type: 'stopped', reason: 'output_limit', bytes: 1024, maxOutputBytes: 512 });
  worker.exitCode = 0; worker.emit('exit', 0);
  const result = await active.exited;
  assert.equal(result.reason, 'output_limit'); assert.equal(result.bytes, 1024);
});

test('worker startup failure propagates retained storage quota reason', async () => {
  const { EventEmitter } = require('node:events');
  const worker = new EventEmitter(); worker.connected = true; worker.exitCode = null;
  worker.send = message => queueMicrotask(() => {
    if (message.type === 'start') worker.emit('message', { type: 'failed', reason: 'storage_limit' });
    else { worker.exitCode = 0; worker.emit('exit', 0); }
  });
  await assert.rejects(startRecorder('/fixture/storage', { ensureCollector: async () => '/fixture/binary', fork: () => worker }), { reason: 'storage_limit' });
});
