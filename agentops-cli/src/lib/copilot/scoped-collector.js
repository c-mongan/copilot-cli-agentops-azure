const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { agentopsHome, collectorConfigPath } = require('../paths');
const { findCollectorBinary } = require('../collector-discovery');
const { waitForHealthUrl } = require('../collector-runtime');
const { run } = require('../shell');
const { sleep } = require('../timing');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function scopedConfig(source, ports) {
  let config = source;
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

async function startScopedStrictCollector(options = {}) {
  const resolveBinary = options.findCollectorBinary || findCollectorBinary;
  const binary = resolveBinary();
  if (!binary.ok) throw new Error(`Cannot start the per-run strict Collector: ${binary.error || 'Collector binary unavailable'}`);

  const ports = {
    4318: await freePort(),
    4317: await freePort(),
    4319: await freePort(),
    13133: await freePort(),
    telemetry: await freePort()
  };
  const tempRoot = options.tempRoot || path.join(options.agentopsHome || agentopsHome, 'scoped-collectors');
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(tempRoot, 0o700); } catch {}
  const directory = fs.mkdtempSync(path.join(tempRoot, 'run-'));
  try { fs.chmodSync(directory, 0o700); } catch {}
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
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error(`Per-run strict Collector config validation failed: ${(validate.stderr || validate.stdout || `exit ${validate.status}`).trim().slice(0, 500)}`);
  }

  const logFd = fs.openSync(logPath, 'a', 0o600);
  const spawn = options.spawn || childProcess.spawn;
  const child = spawn(binary.path, ['--config', configPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env
  });
  fs.closeSync(logFd);
  if (!child.pid) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error('Per-run strict Collector did not start a process.');
  }
  child.unref();
  const endpoint = `http://127.0.0.1:${ports[4318]}`;
  const healthUrl = `http://127.0.0.1:${ports[13133]}`;
  const health = await (options.waitForHealthUrl || waitForHealthUrl)(healthUrl, 8000);
  if (!health.ok) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    if (!(await waitForExit(child.pid))) {
      try { process.kill(child.pid, 'SIGKILL'); } catch {}
      await waitForExit(child.pid, 1000);
    }
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error('Per-run strict Collector started but its unique loopback health endpoint did not become ready.');
  }

  let stopped = false;
  return {
    endpoint,
    receiptPath,
    configPath,
    directory,
    pid: child.pid,
    async stop({ remove = true } = {}) {
      if (!stopped) {
        stopped = true;
        try { process.kill(child.pid, 'SIGTERM'); } catch {}
        if (!(await waitForExit(child.pid))) {
          try { process.kill(child.pid, 'SIGKILL'); } catch {}
          await waitForExit(child.pid, 1000);
        }
      }
      if (remove) fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

module.exports = { freePort, scopedConfig, startScopedStrictCollector };
