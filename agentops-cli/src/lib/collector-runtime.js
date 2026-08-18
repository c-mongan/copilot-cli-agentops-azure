const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { collectorConfigPath, collectorHome } = require('./paths');
const { collectorHealthUrl } = require('./collector-endpoints');
const { makePoisonAttributes } = require('./privacy');
const { run } = require('./shell');
const { sleep } = require('./timing');

function pidFile() {
  return path.join(collectorHome, 'otelcol.pid');
}

function logFile() {
  return path.join(collectorHome, 'otelcol.log');
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidFile(), 'utf8').trim());
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findCollectorProcessByConfig(configPath, binaryPath = null) {
  if (process.platform === 'win32' || !configPath) return null;
  const result = run('ps', ['-axo', 'pid=,command='], { timeout: 5000 });
  if (result.status !== 0) return null;
  const lines = String(result.stdout || '').split('\n');
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (
      pid !== process.pid
      && (!binaryPath || command.includes(binaryPath))
      && command.includes('--config')
      && command.includes(configPath)
      && processAlive(pid)
    ) {
      return pid;
    }
  }
  return null;
}

function findManagedCollectorProcess(binaryPath, configPath) {
  return findCollectorProcessByConfig(configPath, binaryPath);
}

function healthCheck(url = collectorHealthUrl, timeoutMs = 1000) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode });
    });
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', error => resolve({ ok: false, error: error.message }));
  });
}

async function waitForHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = await healthCheck();
  while (!last.ok && Date.now() < deadline) {
    await sleep(250);
    last = await healthCheck();
  }
  return last;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function otlpValue(value) {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { intValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  return { stringValue: String(value) };
}

function otlpAttributes(attributes) {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function postJson(url, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      },
      timeout: 5000
    }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, error: error.message }));
    request.end(body);
  });
}

async function runtimePoisonSmoke({ privacy, findCollectorBinary } = {}) {
  if (privacy !== 'strict') return { status: 'skipped', reason: 'Runtime poison smoke only applies to strict privacy mode.' };
  const binary = typeof findCollectorBinary === 'function'
    ? findCollectorBinary()
    : { ok: false, error: 'Collector binary resolver was not provided.' };
  if (!binary.ok) return { status: 'skipped', reason: binary.error };

  const httpPort = await freePort();
  const grpcPort = await freePort();
  const healthPort = await freePort();
  const telemetryPort = await freePort();
  const receiptPort = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-smoke-'));
  const sourceConfig = collectorConfigPath({ target: 'local', privacy: 'strict' });
  const config = path.join(tempDir, 'otelcol.local.strict.yaml');
  const log = path.join(tempDir, 'otelcol.log');
  const configText = fs.readFileSync(sourceConfig, 'utf8').replace(/\r\n/g, '\n')
    .replace(/127\.0\.0\.1:4318/g, `127.0.0.1:${httpPort}`)
    .replace(/127\.0\.0\.1:4317/g, `127.0.0.1:${grpcPort}`)
    .replace(/127\.0\.0\.1:4319/g, `127.0.0.1:${receiptPort}`)
    .replace(/127\.0\.0\.1:13133/g, `127.0.0.1:${healthPort}`)
    .replace(
      /service:\n/,
      `service:\n  telemetry:\n    metrics:\n      readers:\n        - pull:\n            exporter:\n              prometheus:\n                host: 127.0.0.1\n                port: ${telemetryPort}\n`
    );
  fs.writeFileSync(config, configText);

  const storageDir = path.join(tempDir, 'storage');
  const receiptPath = path.join(tempDir, 'native-receipt.jsonl');
  fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  const collectorEnv = {
    ...process.env,
    AGENTOPS_OTEL_STORAGE_DIR: storageDir,
    AGENTOPS_OTEL_RECEIPT_PATH: receiptPath
  };
  const validateResult = run(binary.path, ['validate', '--config', config], {
    timeout: 30000,
    env: collectorEnv
  });
  if (validateResult.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return {
      status: 'failed',
      ok: false,
      error: (validateResult.stderr || validateResult.stdout || `collector validate exited ${validateResult.status}`).trim()
    };
  }

  const out = fs.openSync(log, 'a');
  const child = childProcess.spawn(binary.path, ['--config', config], {
    detached: true,
    stdio: ['ignore', out, out],
    env: collectorEnv
  });

  const cleanup = () => {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {}
    fs.closeSync(out);
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    const health = await waitForHealthUrl(`http://127.0.0.1:${healthPort}`, 5000);
    if (!health.ok) return { status: 'failed', ok: false, error: 'Temporary collector health endpoint did not become ready.', health };

    const poison = makePoisonAttributes();
    const now = BigInt(Date.now()) * 1000000n;
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: otlpAttributes({
            'service.name': 'agentops-poison-smoke',
            'service.namespace': 'copilot-agentops',
            'agent.framework': 'github-copilot',
            'agent.runtime': 'github-copilot-cli',
            'agentops.poison_id': poison['agentops.poison_id']
          })
        },
        scopeSpans: [{
          spans: [{
            traceId: crypto.randomBytes(16).toString('hex'),
            spanId: crypto.randomBytes(8).toString('hex'),
            name: `SECRET_SPAN_NAME_${poison['agentops.poison_id']}`,
            kind: 2,
            startTimeUnixNano: String(now),
            endTimeUnixNano: String(now + 1000000n),
            status: {
              code: 2,
              message: `SECRET_STATUS_MESSAGE_${poison['agentops.poison_id']}`
            },
            attributes: otlpAttributes(poison)
          }]
        }]
      }]
    };
    const post = await postJson(`http://127.0.0.1:${httpPort}/v1/traces`, payload);
    if (!post.ok) return { status: 'failed', ok: false, error: 'Poison OTLP POST failed.', post };
    const relayPost = await postJson(`http://127.0.0.1:${receiptPort}/v1/traces`, payload);
    if (!relayPost.ok) return { status: 'failed', ok: false, error: 'Poison receipt-relay POST failed.', relayPost };

    const deadline = Date.now() + 8000;
    let output = '';
    let receipt = '';
    while (Date.now() < deadline) {
      await sleep(250);
      output = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : '';
      if (output.includes(poison['agentops.poison_id']) && receipt.includes(poison['agentops.poison_id'])) break;
    }
    const leaked = Array.from(new Set([
      ...(output.match(/SECRET_[A-Z_]+/g) || []),
      ...(receipt.match(/SECRET_[A-Z_]+/g) || [])
    ]));
    const safeOutput = `${output}\n${receipt}`;
    return {
      status: leaked.length === 0 && safeOutput.includes(poison['agentops.poison_id']) ? 'passed' : 'failed',
      ok: leaked.length === 0 && safeOutput.includes(poison['agentops.poison_id']),
      poison_id: poison['agentops.poison_id'],
      leaked,
      safe_fields_present: {
        poison_id: safeOutput.includes(poison['agentops.poison_id']),
        operation: safeOutput.includes('gen_ai.operation.name'),
        model: safeOutput.includes('poison-model'),
        scrub_signal: safeOutput.includes('agentops.content_capture.signal')
      },
      log_bytes: Buffer.byteLength(output),
      receipt_bytes: Buffer.byteLength(receipt),
      receipt_relay: relayPost
    };
  } finally {
    cleanup();
  }
}

function waitForHealthUrl(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const check = async () => {
      const health = await healthCheck(url, 1000);
      if (health.ok || Date.now() >= deadline) return resolve(health);
      setTimeout(check, 250);
    };
    check();
  });
}

module.exports = {
  findCollectorProcessByConfig,
  findManagedCollectorProcess,
  freePort,
  healthCheck,
  logFile,
  otlpAttributes,
  otlpValue,
  pidFile,
  postJson,
  processAlive,
  readPid,
  runtimePoisonSmoke,
  waitForHealth,
  waitForHealthUrl
};
