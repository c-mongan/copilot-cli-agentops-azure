'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_EVENTS = 100;
const DEFAULT_WARMUP = 10;
const MAX_EVENTS = 500;

function boundedCount(value, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_EVENTS);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summary(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    p50_ms: Number(percentile(values, 0.50).toFixed(3)),
    p95_ms: Number(percentile(values, 0.95).toFixed(3)),
    elapsed_ms: Number(total.toFixed(3)),
    throughput_events_per_second: total > 0
      ? Number(((values.length * 1000) / total).toFixed(2))
      : 0
  };
}

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function strictProcessors(canonicalConfigPath) {
  const canonical = fs.readFileSync(canonicalConfigPath, 'utf8').replace(/\r\n/g, '\n');
  const start = canonical.indexOf('processors:\n');
  const end = canonical.indexOf('\nexporters:', start);
  if (start < 0 || end < 0) throw new Error('canonical strict collector processors were not found');
  return canonical.slice(start, end).replace(
    '  batch: {}',
    '  batch:\n    timeout: 10ms\n    send_batch_size: 1\n    send_batch_max_size: 1'
  );
}

function benchmarkConfig({ canonicalConfigPath, receiverPort, healthPort, sinkPort }) {
  return `receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:${receiverPort}
extensions:
  health_check:
    endpoint: 127.0.0.1:${healthPort}
${strictProcessors(canonicalConfigPath)}
exporters:
  otlphttp/local:
    endpoint: http://127.0.0.1:${sinkPort}
    encoding: json
    compression: none
    retry_on_failure:
      enabled: false
service:
  extensions: [health_check]
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, transform/privacy_strict, batch]
      exporters: [otlphttp/local]
`;
}

function tracePayload(index) {
  const hex = index.toString(16).padStart(16, '0').slice(-16);
  return JSON.stringify({ resourceSpans: [{
    resource: { attributes: [
      { key: 'service.name', value: { stringValue: 'agentops-collector-benchmark' } },
      { key: 'benchmark.disallowed', value: { stringValue: 'must-be-removed' } }
    ] },
    scopeSpans: [{ scope: { name: 'agentops-collector-benchmark' }, spans: [{
      traceId: `0000000000000000${hex}`,
      spanId: hex,
      name: 'agentops.benchmark.event',
      startTimeUnixNano: String(1767225600000000000n + BigInt(index) * 1000000n),
      endTimeUnixNano: String(1767225600001000000n + BigInt(index) * 1000000n),
      attributes: [
        { key: 'agentops.custom_event_id', value: { stringValue: `benchmark-event-${index}` } },
        { key: 'agentops.event.sequence', value: { intValue: String(index + 1) } },
        { key: 'agentops.privacy.mode', value: { stringValue: 'strict' } },
        { key: 'agentops.content_capture.mode', value: { stringValue: 'off' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } },
        { key: 'benchmark.disallowed', value: { stringValue: 'must-be-removed' } }
      ],
      status: { code: 1 }
    }] }]
  }] });
}

function collectorBinaryPath(override) {
  return override || process.env.AGENTOPS_OTELCOL_BIN
    || path.join(os.homedir(), '.agentops', 'collector', 'bin', 'otelcol-contrib');
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runCollectorBenchmark(options = {}) {
  const events = boundedCount(options.events, DEFAULT_EVENTS);
  const warmup = boundedCount(options.warmup, DEFAULT_WARMUP);
  const binary = collectorBinaryPath(options.collectorBinary);
  if (!fs.existsSync(binary)) throw new Error(`otelcol-contrib not found at ${binary}`);
  const canonicalConfigPath = options.canonicalConfigPath
    || path.resolve(__dirname, '../../../collector/otelcol.local.strict.yaml');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-benchmark-'));
  const receiverPort = await freePort();
  const healthPort = await freePort();
  const sinkPort = await freePort();
  const configPath = path.join(temp, 'collector.yaml');
  fs.writeFileSync(configPath, benchmarkConfig({ canonicalConfigPath, receiverPort, healthPort, sinkPort }));
  const sinkReceipts = [];
  const sinkBodies = [];
  let collector;
  let sink;
  let output = '';
  try {
    sink = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        sinkReceipts.push(process.hrtime.bigint());
        sinkBodies.push(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise(resolve => sink.listen(sinkPort, '127.0.0.1', resolve));
    collector = childProcess.spawn(binary, ['--config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    collector.stdout.on('data', chunk => { output += chunk; });
    collector.stderr.on('data', chunk => { output += chunk; });
    const healthy = await waitFor(async () => {
      try { return (await fetch(`http://127.0.0.1:${healthPort}`)).ok; } catch { return false; }
    });
    if (!healthy) throw new Error(`collector did not become healthy: ${output.slice(-2000)}`);

    async function send(index) {
      const sinkIndex = sinkReceipts.length;
      const started = process.hrtime.bigint();
      const response = await fetch(`http://127.0.0.1:${receiverPort}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: tracePayload(index)
      });
      if (!response.ok) throw new Error(`collector receiver returned HTTP ${response.status}`);
      const acknowledged = process.hrtime.bigint();
      const delivered = await waitFor(() => sinkReceipts.length > sinkIndex, 5000);
      if (!delivered) throw new Error('local sink did not acknowledge the benchmark event');
      return {
        receiverMs: Number(acknowledged - started) / 1e6,
        sinkMs: Number(sinkReceipts[sinkIndex] - started) / 1e6
      };
    }

    for (let index = 0; index < warmup; index += 1) await send(index);
    sinkReceipts.length = 0;
    sinkBodies.length = 0;
    const receiverLatencies = [];
    const sinkLatencies = [];
    for (let index = 0; index < events; index += 1) {
      const result = await send(index + warmup);
      receiverLatencies.push(result.receiverMs);
      sinkLatencies.push(result.sinkMs);
    }
    const wire = sinkBodies.join('\n');
    if (wire.includes('benchmark.disallowed') || wire.includes('must-be-removed')) {
      throw new Error('strict privacy processor did not remove a disallowed synthetic metadata field');
    }
    if (!wire.includes('agentops.custom_event_id')) {
      throw new Error('local sink did not receive the allowlisted benchmark event identifier');
    }
    return {
      benchmark: 'agentops-otelcol-strict-local',
      methodology: {
        scope: 'OTLP/HTTP receiver through canonical strict privacy processors to local OTLP/HTTP sink acknowledgement',
        transport: 'loopback only; no Azure or external network writes',
        content_capture: 'off; synthetic metadata only',
        thresholds: 'none; measurements are descriptive',
        events,
        warmup_events: warmup,
        collector_binary: path.basename(binary)
      },
      receiver_acknowledgement: summary(receiverLatencies),
      local_sink_acknowledgement: summary(sinkLatencies),
      privacy_check: {
        sink_requests: sinkBodies.length,
        allowlisted_event_id_present: true,
        disallowed_metadata_removed: true
      }
    };
  } finally {
    await stopProcess(collector);
    if (sink) await new Promise(resolve => sink.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = {
  MAX_EVENTS,
  benchmarkConfig,
  boundedCount,
  collectorBinaryPath,
  percentile,
  runCollectorBenchmark,
  summary,
  tracePayload
};
