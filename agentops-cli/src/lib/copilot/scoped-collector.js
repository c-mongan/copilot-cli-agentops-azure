const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { agentopsHome, collectorConfigPath } = require('../paths');
const { findCollectorBinary } = require('../collector-discovery');
const { waitForHealthUrl } = require('../collector-runtime');
const { sleep } = require('../timing');

function freePort(requested = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function scopedConfig(source, ports) {
  let config = source.replace(/\r\n/g, '\n');
  for (const [port, replacement] of Object.entries(ports)) {
    if (port === 'telemetry') continue;
    const needle = `127.0.0.1:${port}`;
    if (!config.includes(needle)) throw new Error(`Strict Collector template is missing expected loopback binding ${needle}.`);
    config = config.replaceAll(needle, `127.0.0.1:${replacement}`);
  }
  if (!config.includes('transform/privacy_strict') || !config.includes('file/receipt')) {
    throw new Error('Scoped Collector requires the strict privacy processor and local receipt exporter.');
  }
  return config.replace(
    /service:\n/,
    `service:\n  telemetry:\n    metrics:\n      readers:\n        - pull:\n            exporter:\n              prometheus:\n                host: 127.0.0.1\n                port: ${ports.telemetry}\n`
  );
}

function waitForExit(pid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { return true; }
      await sleep(50);
    }
    return false;
  })();
}

function checkRetainedOutput(root, maxBytes) {
  let bytes = 0, count = 0;
  const limit = reason => Object.assign(new Error('Local Collector storage limit reached. Retained receipts were not deleted.'), { reason, code: 'AGENTOPS_STORAGE_LIMIT' });
  const directory = fs.opendirSync(root);
  try {
    let entry;
    while ((entry = directory.readSync())) {
      if (++count > 4096) throw limit('storage_scan_limit');
      if (!entry.name.startsWith('run-')) continue;
      const run = path.join(root, entry.name), stat = fs.lstatSync(run);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw limit('storage_scan_unsafe');
      for (const name of ['native-receipt.jsonl', 'collector.log']) {
        const file = path.join(run, name);
        let fileStat;
        try { fileStat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1 || (typeof process.getuid === 'function' && fileStat.uid !== process.getuid())) throw limit('storage_scan_unsafe');
        bytes += fileStat.size;
        if (!Number.isSafeInteger(bytes) || bytes >= maxBytes) throw limit('storage_limit');
      }
    }
  } finally { directory.closeSync(); }
}

async function startScopedStrictCollector(options = {}) {
  const maxOutputBytes = options.maxOutputBytes ?? 12 * 1024 * 1024;
  const outputPollMs = options.outputPollMs ?? 1000;
  const maxRetainedBytes = options.maxRetainedBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || !Number.isSafeInteger(outputPollMs) || outputPollMs <= 0) throw new Error('Collector output limits must be positive integers.');
  const signal = options.abortSignal;
  const checkAbort = () => { if (signal?.aborted) throw Object.assign(new Error('Per-run Collector setup cancelled.'), { name: 'AbortError' }); };
  checkAbort();
  if (options.receiverPort !== undefined && (!Number.isSafeInteger(options.receiverPort) || options.receiverPort < 1024 || options.receiverPort > 65535)) throw new Error('Collector receiver port must be an integer from 1024 to 65535.');
  const resolveBinary = options.findCollectorBinary || findCollectorBinary;
  const binary = resolveBinary();
  if (!binary.ok) throw new Error(`Cannot start the per-run strict Collector: ${binary.error || 'Collector binary unavailable'}`);

  const ports = {
    4318: await freePort(options.receiverPort),
    4317: await freePort(),
    4319: await freePort(),
    13133: await freePort(),
    telemetry: await freePort()
  };
  checkAbort();
  const tempRoot = options.tempRoot || path.join(options.agentopsHome || agentopsHome, 'scoped-collectors');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(tempRoot, 0o700); } catch {}
  checkRetainedOutput(tempRoot, maxRetainedBytes);
  const directory = fs.mkdtempSync(path.join(tempRoot, 'run-'));
  try { fs.chmodSync(directory, 0o700); } catch {}
  let child;
  let logFd;
  let stopping;
  let onAbort, outputTimer, stopReason;
  const clearOutputMonitor = () => { clearInterval(outputTimer); outputTimer = undefined; };
  const healthController = new AbortController();
  const stop = async ({ remove = true } = {}) => {
    clearOutputMonitor();
    if (!stopping) stopping = (async () => {
      if (!child?.pid) return;
      try { child.kill('SIGTERM'); } catch {}
      const wait = options.waitForExit || waitForExit;
      if (!(await wait(child.pid, options.stopGraceMs ?? 4000))) {
        try { child.kill('SIGKILL'); } catch {}
        if (!(await wait(child.pid, options.killGraceMs ?? 1000))) {
          throw new Error('Per-run Collector did not exit after bounded shutdown; retained setup artifacts.');
        }
      }
    })();
    await stopping;
    if (remove) fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    const configPath = path.join(directory, 'otelcol.local.strict.yaml');
    const receiptPath = path.join(directory, 'native-receipt.jsonl');
    const logPath = path.join(directory, 'collector.log');
    const storageDir = path.join(directory, 'storage');
    fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });

    const templatePath = options.templatePath || collectorConfigPath({ target: 'local', privacy: 'strict' });
    const template = fs.readFileSync(templatePath, 'utf8');
    fs.writeFileSync(configPath, scopedConfig(template, ports), { mode: 0o600 });
    fs.writeFileSync(receiptPath, '', { mode: 0o600 });
    const env = {
      ...process.env,
      AGENTOPS_OTEL_STORAGE_DIR: storageDir,
      AGENTOPS_OTEL_RECEIPT_PATH: receiptPath
    };
    const validate = (options.spawnSync || childProcess.spawnSync)(binary.path, ['validate', '--config', configPath], {
      env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    if (validate.status !== 0) {
      throw new Error(`Per-run strict Collector config validation failed: ${(validate.stderr || validate.stdout || `exit ${validate.status}`).trim().slice(0, 500)}`);
    }

    checkAbort();
    logFd = fs.openSync(logPath, 'a', 0o600);
    const spawn = options.spawn || childProcess.spawn;
    child = spawn(binary.path, ['--config', configPath], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env
    });
    fs.closeSync(logFd);
    logFd = undefined;
    // Attach immediately: a Collector can fail between spawn and health readiness.
    const exited = new Promise(resolve => {
      child.once('exit', (code, signal) => { clearOutputMonitor(); resolve({ code, signal, ...stopReason }); });
      child.once('error', () => { clearOutputMonitor(); resolve({ code: null, signal: '', error: 'collector process error', ...stopReason }); });
    });
    if (!child.pid) {
      throw new Error('Per-run strict Collector did not start a process.');
    }
    // A sampled threshold stops capture and retains the receipt. A write burst can
    // overshoot the threshold before the next sample; this is not a hard disk cap.
    outputTimer = setInterval(() => {
      let bytes;
      try { bytes = fs.statSync(receiptPath).size + fs.statSync(logPath).size; }
      catch { stopReason = { reason: 'output_monitor_failed' }; }
      if (!stopReason && bytes < maxOutputBytes) return;
      stopReason ||= { reason: 'output_limit', bytes, maxOutputBytes };
      clearOutputMonitor();
      stop({ remove: false }).catch(() => {});
    }, outputPollMs);
    outputTimer.unref();
    const endpoint = `http://127.0.0.1:${ports[4318]}`;
    const healthUrl = `http://127.0.0.1:${ports[13133]}`;
    const cancelled = new Promise((resolve, reject) => {
      onAbort = () => reject(Object.assign(new Error('Per-run Collector setup cancelled.'), { name: 'AbortError' }));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    checkAbort();
    const health = await Promise.race([
      Promise.resolve().then(() => (options.waitForHealthUrl || waitForHealthUrl)(healthUrl, 8000, { signal: healthController.signal })),
      exited.then(() => { throw new Error('Per-run strict Collector exited during setup.'); }),
      cancelled
    ]);
    checkAbort();
    if (!health.ok) throw new Error('Per-run strict Collector started but its unique loopback health endpoint did not become ready.');
    signal?.removeEventListener('abort', onAbort);
    child.unref();
    return {
      endpoint,
      receiptPath,
      configPath,
      directory,
      pid: child.pid,
      exited,
      stop
    };
  } catch (error) {
    healthController.abort();
    if (logFd !== undefined) fs.closeSync(logFd);
    try { await stop(); } catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  } finally {
    healthController.abort();
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

module.exports = { freePort, scopedConfig, startScopedStrictCollector };
