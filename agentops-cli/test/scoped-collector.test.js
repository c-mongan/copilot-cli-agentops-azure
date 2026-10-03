const assert = require('node:assert/strict');
const test = require('node:test');

const { scopedConfig } = require('../src/lib/copilot/scoped-collector');

test('per-run Collector config binds every receiver and telemetry listener to unique loopback ports', () => {
  const template = [
    'receivers:',
    '  otlp:',
    '    protocols:',
    '      http:',
    '        endpoint: 127.0.0.1:4318',
    '      grpc:',
    '        endpoint: 127.0.0.1:4317',
    '  otlp/receipt:',
    '    protocols:',
    '      http:',
    '        endpoint: 127.0.0.1:4319',
    'extensions:',
    '  health_check:',
    '    endpoint: 127.0.0.1:13133',
    'processors:',
    '  transform/privacy_strict: {}',
    'exporters:',
    '  file/receipt: {}',
    'service:',
    '  pipelines: {}',
    ''
  ].join('\n');
  const output = scopedConfig(template, { 4318: 20001, 4317: 20002, 4319: 20003, 13133: 20004, telemetry: 20005 });
  assert.match(output, /endpoint: 127\.0\.0\.1:20001/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20002/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20003/);
  assert.match(output, /endpoint: 127\.0\.0\.1:20004/);
  assert.match(output, /host: 127\.0\.0\.1\n\s+port: 20005/);
  assert.match(output, /transform\/privacy_strict/);
  assert.match(output, /file\/receipt/);
  assert.doesNotMatch(output, /127\.0\.0\.1:(4317|4318|4319|13133)/);
});

test('per-run Collector config refuses a template missing strict redaction or receipt export', () => {
  const template = ['endpoint: 127.0.0.1:4318', 'endpoint: 127.0.0.1:4317', 'endpoint: 127.0.0.1:4319', 'endpoint: 127.0.0.1:13133', 'service:', ''].join('\n');
  assert.throws(() => scopedConfig(template, { 4318: 20001, 4317: 20002, 4319: 20003, 13133: 20004, telemetry: 20005 }), /strict privacy processor and local receipt exporter/);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { startScopedStrictCollector } = require('../src/lib/copilot/scoped-collector');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'template.yaml');
  fs.writeFileSync(templatePath, ['127.0.0.1:4318', '127.0.0.1:4317', '127.0.0.1:4319', '127.0.0.1:13133', 'transform/privacy_strict', 'file/receipt', 'service:', ''].join('\n'));
  return { root, options: { tempRoot: root, templatePath, findCollectorBinary: () => ({ ok: true, path: process.execPath }), spawnSync: () => ({ status: 0 }), ...overrides } };
}

test('pre-aborted collector setup never resolves binary or creates files', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(startScopedStrictCollector({ abortSignal: controller.signal, findCollectorBinary: () => { throw new Error('must not resolve'); } }), { name: 'AbortError' });
});

test('setup cancellation terminates harmless child and removes run artifacts', async t => {
  const controller = new AbortController();
  let child;
  const { root, options } = fixture(t, {
    abortSignal: controller.signal,
    spawn: () => {
      child = spawn(process.execPath, ['-e', 'process.send("ready");setInterval(()=>{},100)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      t.after(() => child.kill('SIGKILL'));
      child.once('message', () => controller.abort());
      return child;
    },
    waitForHealthUrl: () => new Promise(() => {})
  });
  await assert.rejects(startScopedStrictCollector(options), { name: 'AbortError' });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.deepEqual(fs.readdirSync(root), ['template.yaml']);
});

test('health rejection and spawn throw remove scoped setup artifacts', async t => {
  for (const failSpawn of [true, false]) {
    const { root, options } = fixture(t, {
      spawn: () => {
        if (failSpawn) throw new Error('spawn failed');
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { stdio: 'ignore' });
        t.after(() => child.kill('SIGKILL'));
        return child;
      },
      waitForHealthUrl: () => { throw new Error('health failed'); }
    });
    await assert.rejects(startScopedStrictCollector(options), failSpawn ? /spawn failed/ : /health failed/);
    assert.deepEqual(fs.readdirSync(root), ['template.yaml']);
  }
});

test('collector death during readiness does not await stalled health', async t => {
  const { root, options } = fixture(t, {
    spawn: () => spawn(process.execPath, ['-e', 'process.exit(9)'], { stdio: 'ignore' }),
    waitForHealthUrl: () => new Promise(() => {})
  });
  await assert.rejects(startScopedStrictCollector(options), /exited during setup/);
  assert.deepEqual(fs.readdirSync(root), ['template.yaml']);
});

test('concurrent stop waits for the same bounded termination before removal', async t => {
  const child = new EventEmitter();
  child.pid = 123;
  child.unref = () => {};
  const kills = [];
  child.kill = signal => kills.push(signal);
  let release;
  const { root, options } = fixture(t, {
    spawn: () => child,
    waitForHealthUrl: async () => ({ ok: true }),
    waitForExit: () => new Promise(resolve => { release = resolve; })
  });
  const collector = await startScopedStrictCollector(options);
  const first = collector.stop({ remove: false });
  const second = collector.stop();
  assert.equal(fs.existsSync(collector.directory), true);
  release(true);
  await Promise.all([first, second]);
  await collector.stop();
  assert.deepEqual(kills, ['SIGTERM']);
  assert.deepEqual(fs.readdirSync(root), ['template.yaml']);
});

test('failed bounded shutdown retains artifacts and reports failure', async t => {
  const child = new EventEmitter();
  child.pid = 123;
  child.unref = () => {};
  const kills = [];
  const waits = [];
  child.kill = signal => kills.push(signal);
  const { options } = fixture(t, {
    spawn: () => child,
    waitForHealthUrl: async () => ({ ok: true }),
    stopGraceMs: 10, killGraceMs: 20,
    waitForExit: async (pid, timeout) => { waits.push(timeout); return false; }
  });
  const collector = await startScopedStrictCollector(options);
  await assert.rejects(collector.stop(), /did not exit after bounded shutdown/);
  assert.equal(fs.existsSync(collector.directory), true);
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(waits, [10, 20]);
});

test('real default readiness poll releases the subprocess event loop on exit or abort', t => {
  const { root, options } = fixture(t);
  const modulePath = require.resolve('../src/lib/copilot/scoped-collector');
  for (const mode of ['exit', 'abort']) {
    const script = `
      const {spawn}=require('node:child_process');
      const {startScopedStrictCollector}=require(${JSON.stringify(modulePath)});
      const controller=new AbortController();
      const started=Date.now();
      startScopedStrictCollector({
        tempRoot:${JSON.stringify(root)}, templatePath:${JSON.stringify(options.templatePath)},
        abortSignal:controller.signal,
        findCollectorBinary:()=>({ok:true,path:process.execPath}),
        spawnSync:()=>({status:0}),
        spawn:()=>{
          const child=spawn(process.execPath,['-e',${JSON.stringify(mode === 'exit' ? 'process.exit(9)' : 'process.send("ready");setInterval(()=>{},100)')}],{stdio:['ignore','ignore','ignore','ipc']});
          if(${JSON.stringify(mode)}==='abort') child.once('message',()=>controller.abort());
          return child;
        }
      }).then(()=>{process.exitCode=2;},error=>{console.log(error.name+': '+error.message);});
      process.once('beforeExit',()=>console.log('drained='+String(Date.now()-started)));
    `;
    const result = require('node:child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 2500 });
    assert.equal(result.error, undefined, 'losing health poll must not retain timers or sockets until its eight-second deadline');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, mode === 'exit' ? /exited during setup/ : /AbortError/);
    const drained = Number(/drained=(\d+)/.exec(result.stdout)?.[1]);
    assert.ok(drained < 2000, `default poll retained event loop for ${drained}ms`);
  }
});

test('abort destroys an active stalled health socket', async t => {
  const net = require('node:net');
  const { waitForHealthUrl } = require('../src/lib/collector-runtime');
  const controller = new AbortController();
  let socket;
  const server = net.createServer(connection => { socket = connection; connection.on('data', () => controller.abort()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { socket?.destroy(); server.close(); });
  const closed = new Promise(resolve => server.once('connection', connection => connection.once('end', () => { connection.end(); resolve(); })));
  const result = await waitForHealthUrl(`http://127.0.0.1:${server.address().port}`, 8000, { signal: controller.signal });
  assert.deepEqual(result, { ok: false, error: 'aborted' });
  await closed;
  await new Promise(resolve => server.close(resolve));
});

test('saved receiver port is retained and occupied ports fail before Collector spawn', async t => {
  const net = require('node:net');
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => occupied.close());
  const receiverPort = occupied.address().port;
  let spawned = false;
  const { options } = fixture(t, { receiverPort, spawn: () => { spawned = true; throw new Error('must not spawn'); } });
  await assert.rejects(startScopedStrictCollector(options), { code: 'EADDRINUSE' });
  assert.equal(spawned, false);
  await new Promise(resolve => occupied.close(resolve));
  const child = new EventEmitter(); child.pid = process.pid; child.unref = () => {}; child.kill = () => {};
  const active = await startScopedStrictCollector({ ...options, spawn: () => child, waitForHealthUrl: async () => ({ ok: true }), waitForExit: async () => true });
  assert.equal(active.endpoint, `http://127.0.0.1:${receiverPort}`);
  await active.stop();
  for (const receiverPort of [0, 1023, 65536, '23456', NaN]) await assert.rejects(startScopedStrictCollector({ receiverPort }), /receiver port/);
});

test('local receipt and debug log growth stop capture with a retained output-limit reason', async t => {
  for (const target of ['receipt', 'log']) {
    let child;
    const { options } = fixture(t, {
      maxOutputBytes: 512, outputPollMs: 10,
      spawn: (binary, args, config) => {
        child = spawn(process.execPath, ['-e', target === 'receipt'
          ? "require('node:fs').writeFileSync(process.env.AGENTOPS_OTEL_RECEIPT_PATH,'x'.repeat(1024));setInterval(()=>{},100)"
          : "process.stderr.write('x'.repeat(1024));setInterval(()=>{},100)"], config);
        t.after(() => child.kill('SIGKILL'));
        return child;
      }, waitForHealthUrl: async () => ({ ok: true })
    });
    const active = await startScopedStrictCollector(options);
    let timer;
    const deadline = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('output monitor did not stop Collector')), 2000); });
    const result = await Promise.race([active.exited, deadline]).finally(() => clearTimeout(timer));
    assert.equal(result.reason, 'output_limit'); assert.equal(result.maxOutputBytes, 512); assert.ok(result.bytes >= 1024);
    assert.equal(fs.existsSync(active.receiptPath), true);
    await active.stop({ remove: false });
  }
});

test('retained receipt quota blocks new capture without deleting files; unsafe paths fail closed', async t => {
  const { root, options } = fixture(t, { maxRetainedBytes: 1024, spawn: () => { throw new Error('must not start'); } });
  const run = path.join(root, 'run-retained'); fs.mkdirSync(run, { mode: 0o700 });
  const receipt = path.join(run, 'native-receipt.jsonl'); fs.writeFileSync(receipt, 'x'.repeat(512), { mode: 0o600 });
  fs.writeFileSync(path.join(run, 'collector.log'), 'x'.repeat(512), { mode: 0o600 });
  await assert.rejects(startScopedStrictCollector(options), { reason: 'storage_limit', code: 'AGENTOPS_STORAGE_LIMIT' });
  assert.equal(fs.readFileSync(receipt).length, 512);
  fs.unlinkSync(receipt); fs.symlinkSync(path.join(root, 'template.yaml'), receipt);
  await assert.rejects(startScopedStrictCollector(options), { reason: 'storage_scan_unsafe' });
  assert.equal(fs.lstatSync(receipt).isSymbolicLink(), true);
});


test('CRLF strict template keeps all scoped listeners and telemetry on loopback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../collector/otelcol.local.strict.yaml'), 'utf8');
  const template = source.replace(/\r?\n/g, '\r\n');
  const ports = { 4318: 20001, 4317: 20002, 4319: 20003, 13133: 20004, telemetry: 20005 };
  const output = scopedConfig(template, ports);
  assert.equal(output, scopedConfig(source.replace(/\r\n/g, '\n'), ports));
  for (const port of [20001, 20002, 20003, 20004]) assert.ok(output.includes(`endpoint: 127.0.0.1:${port}`));
  assert.match(output, /host: 127\.0\.0\.1\n\s+port: 20005/);
  assert.match(output, /transform\/privacy_strict/);
  assert.match(output, /file\/receipt/);
  assert.doesNotMatch(output, /127\.0\.0\.1:(4317|4318|4319|13133)/);
  assert.throws(() => scopedConfig(template.replaceAll('127.0.0.1:4318', '0.0.0.0:4318'), ports), /missing expected loopback binding/);
});
