const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { agentopsHome: defaultAgentopsHome } = require('../paths');
const { findCollectorBinary } = require('../collector-discovery');
const { waitForHealthUrl } = require('../collector-runtime');
const { sleep } = require('../timing');
const { CONTENT_ATTRIBUTES, SEMCONV_VERSION, safeString: safeAgentName, toGenAiSpans, toOtlpTraceRequest } = require('../otel/genai-semconv');
const { defaultSessionEventsPath, readCopilotSessionEvents } = require('./session-enricher');
const { defaultReceiptFiles, readSessionOtelSpans } = require('./session-otel');
const { enrichSpansWithSessionToolContext, readSessionSpanRows } = require('./session-span-export');

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const CHILD_ENV = 'AGENTOPS_GENAI_EXPORT_CONNECTION_STRING';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const packageVersion = require('../../../package.json').version;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

function loadSessionSpans(options = {}) {
  const { sessionId, runId } = options;
  if (options.agentName && !safeAgentName(options.agentName)) throw new Error('--agent-name must be 1-128 letters, digits, spaces or _.:/@()+- characters');
  if (!ID_PATTERN.test(sessionId || '')) throw new Error('export-otel requires a valid <session-id>');
  if (!ID_PATTERN.test(runId || '')) throw new Error('export-otel requires a valid --run-id <id>');
  let events = [];
  const eventsFile = options.eventsFile || defaultSessionEventsPath(sessionId);
  if (fs.existsSync(eventsFile)) events = readCopilotSessionEvents(eventsFile);

  let source = 'agentops-run-ledger';
  let spans = [];
  if (!options.otelFiles?.length) {
    const runDirectory = path.join(options.agentopsHome || defaultAgentopsHome, 'runs', runId);
    spans = readSessionSpanRows(runDirectory, runId, sessionId).spans;
  }
  if (!spans.length) {
    source = 'native-otel-receipt';
    const files = options.otelFiles?.length ? options.otelFiles : defaultReceiptFiles();
    spans = readSessionOtelSpans(sessionId, files, { runId }).spans;
  }
  return { source, spans: enrichSpansWithSessionToolContext(spans, events) };
}

function tracesUrl(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('--endpoint must be an http(s) OTLP/HTTP URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--endpoint must be an http(s) OTLP/HTTP URL');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('--endpoint over plain http is only allowed for a loopback Collector; use https for remote endpoints');
  }
  if (url.username || url.password) throw new Error('--endpoint must not embed credentials');
  if (!url.pathname.endsWith('/v1/traces')) url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/traces`;
  return url.toString();
}

async function postOtlpJson(endpoint, body, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > MAX_BODY_BYTES) throw new Error('OTLP payload exceeds the 4 MiB export bound');
  const response = await fetchImpl(tracesUrl(endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`OTLP endpoint rejected the export: HTTP ${response.status}`);
  let partial = null;
  try { partial = JSON.parse(text || '{}').partialSuccess || null; } catch {}
  if (partial && Number(partial.rejectedSpans || 0) > 0) {
    throw new Error(`OTLP endpoint rejected ${partial.rejectedSpans} span(s)`);
  }
  return { status: response.status, bytes: Buffer.byteLength(payload) };
}

function azureMonitorConfig(ports) {
  const deletes = CONTENT_ATTRIBUTES.map(key => `      - key: ${key}\n        action: delete`).join('\n');
  return `receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:${ports.receiver}
extensions:
  health_check:
    endpoint: 127.0.0.1:${ports.health}
processors:
  attributes/no_content:
    actions:
${deletes}
  batch:
    timeout: 1s
exporters:
  azuremonitor:
    connection_string: \${env:${CHILD_ENV}}
service:
  telemetry:
    metrics:
      level: none
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [attributes/no_content, batch]
      exporters: [azuremonitor]
`;
}

function connectionStringFromEnv(envName, env = process.env) {
  if (!ENV_NAME.test(envName || '')) throw new Error('--appinsights-connection-string-env requires an environment variable NAME (not the value)');
  const value = String(env[envName] || '').trim();
  if (!value) throw new Error(`environment variable ${envName} is empty; export the Application Insights connection string into it first`);
  if (!/(^|;)\s*InstrumentationKey=/i.test(value)) throw new Error(`environment variable ${envName} does not look like an Application Insights connection string`);
  return value;
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await sleep(100);
  }
  return false;
}

async function startAzureMonitorCollector(options = {}) {
  const connectionString = connectionStringFromEnv(options.connectionStringEnv, options.env || process.env);
  const binary = (options.findCollectorBinary || findCollectorBinary)();
  if (!binary.ok) throw new Error(`Cannot start a Collector for Azure Monitor export: ${binary.error || 'otelcol-contrib not found'}`);
  const root = path.join(options.agentopsHome || defaultAgentopsHome, 'scoped-collectors');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(root, 'genai-export-'));
  const ports = { receiver: await freePort(), health: await freePort() };
  const configPath = path.join(directory, 'otelcol.genai-azuremonitor.yaml');
  const logPath = path.join(directory, 'collector.log');
  // The config references the connection string through an env var only, so it never touches disk.
  fs.writeFileSync(configPath, azureMonitorConfig(ports), { mode: 0o600 });
  const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', [CHILD_ENV]: connectionString };
  const logFd = fs.openSync(logPath, 'a', 0o600);
  const child = (options.spawn || childProcess.spawn)(binary.path, ['--config', configPath], { stdio: ['ignore', logFd, logFd], env });
  fs.closeSync(logFd);
  let spawnError = null;
  child.on?.('error', error => { spawnError = error; });
  const stop = async ({ keep = false } = {}) => {
    if (child.pid) {
      try { child.kill('SIGTERM'); } catch {}
      if (!(await waitForExit(child.pid, options.stopGraceMs ?? 20000))) {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const exportErrors = log.split(/\r?\n/).filter(line => /\berror\b/i.test(line) && /azuremonitor|export/i.test(line)).length;
    if (!keep) fs.rmSync(directory, { recursive: true, force: true });
    return { exportErrors, retainedLog: keep ? logPath : null };
  };
  const health = await (options.waitForHealthUrl || waitForHealthUrl)(`http://127.0.0.1:${ports.health}`, 15000);
  if (spawnError || !health.ok) {
    await stop({ keep: true });
    throw new Error('Azure Monitor export Collector did not become healthy; log retained under the AgentOps scoped-collectors directory');
  }
  return { endpoint: `http://127.0.0.1:${ports.receiver}`, stop, pid: child.pid };
}

function summarise(genAi) {
  const operations = {};
  let failedTools = 0;
  for (const span of genAi.spans) {
    const op = span.attributes['gen_ai.operation.name'];
    operations[op] = (operations[op] || 0) + 1;
    if (op === 'execute_tool' && span.status.code === 2) failedTools += 1;
  }
  const sum = (op, key) => genAi.spans
    .filter(span => span.attributes['gen_ai.operation.name'] === op)
    .reduce((total, span) => total + (span.attributes[key] || 0), 0);
  return {
    operations,
    failed_tools: failedTools,
    trace_ids: [...new Set(genAi.spans.map(span => span.traceId))],
    tokens: {
      invoke_agent_input: sum('invoke_agent', 'gen_ai.usage.input_tokens'),
      invoke_agent_output: sum('invoke_agent', 'gen_ai.usage.output_tokens'),
      chat_input: sum('chat', 'gen_ai.usage.input_tokens'),
      chat_output: sum('chat', 'gen_ai.usage.output_tokens')
    }
  };
}

async function exportSessionGenAi(options = {}) {
  const loaded = loadSessionSpans(options);
  const genAi = toGenAiSpans(loaded.spans, { sessionId: options.sessionId, runId: options.runId, agentName: options.agentName });
  if (!genAi.spans.length) throw new Error('session has no gen_ai spans (invoke_agent/chat/execute_tool) to export');
  const request = toOtlpTraceRequest(genAi.spans, {}, packageVersion);
  const result = {
    session_id: options.sessionId,
    run_id: options.runId,
    semconv_version: SEMCONV_VERSION,
    source: loaded.source,
    spans: genAi.spans.length,
    duplicates_dropped: genAi.stats.duplicates,
    non_genai_skipped: genAi.stats.skipped,
    invalid_skipped: genAi.stats.invalid,
    content_attributes: 'never-set',
    ...summarise(genAi)
  };
  if (options.output) {
    const output = path.resolve(options.output);
    fs.writeFileSync(output, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    result.output = output;
  }
  if (options.dryRun) return { ...result, delivery: 'dry-run' };
  if (options.connectionStringEnv) {
    const collector = await (options.startCollector || startAzureMonitorCollector)(options);
    let sent;
    try {
      sent = await postOtlpJson(collector.endpoint, request, options);
      await sleep(options.flushWaitMs ?? 3000);
    } catch (error) {
      await collector.stop({ keep: true });
      throw error;
    }
    const stopped = await collector.stop();
    if (stopped.exportErrors) throw new Error(`Azure Monitor exporter logged ${stopped.exportErrors} export error(s); spans may not have been ingested`);
    return { ...result, delivery: 'azure-monitor-via-local-collector', http_status: sent.status, bytes: sent.bytes };
  }
  if (!options.endpoint) {
    if (result.output) return { ...result, delivery: 'file' };
    throw new Error('export-otel requires --endpoint <otlp-http-url>, --appinsights-connection-string-env <VAR>, --output <file.json> or --dry-run');
  }
  const sent = await postOtlpJson(options.endpoint, request, options);
  return { ...result, delivery: 'otlp-http', http_status: sent.status, bytes: sent.bytes };
}

function renderGenAiExport(value) {
  const ops = Object.entries(value.operations).map(([op, count]) => `${op}=${count}`).join(' ');
  return [
    `GenAI OTLP export (semconv ${value.semconv_version}) · ${value.delivery}`,
    `Session ${value.session_id} · run ${value.run_id} · source ${value.source}`,
    `Spans ${value.spans} (${ops}) · duplicates dropped ${value.duplicates_dropped} · failed tools ${value.failed_tools}`,
    `Tokens invoke_agent ${value.tokens.invoke_agent_input} in / ${value.tokens.invoke_agent_output} out · chat ${value.tokens.chat_input} in / ${value.tokens.chat_output} out`,
    value.output ? `OTLP JSON: ${value.output}` : '',
    'Metadata only: prompts, responses, tool arguments and results are never exported.'
  ].filter(Boolean).join('\n') + '\n';
}

module.exports = {
  azureMonitorConfig,
  connectionStringFromEnv,
  exportSessionGenAi,
  loadSessionSpans,
  postOtlpJson,
  renderGenAiExport,
  startAzureMonitorCollector,
  tracesUrl
};
