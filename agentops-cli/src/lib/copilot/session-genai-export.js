const childProcess = require('node:child_process');
const crypto = require('node:crypto');
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
const { SHELL_NONZERO_EXIT, enrichSpansWithSessionToolContext, readSessionSpanRows } = require('./session-span-export');
const { isDenialCode, outcomeSummaryText, sessionStatusSignals } = require('./run-status');

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const CHILD_ENV = 'AGENTOPS_GENAI_EXPORT_CONNECTION_STRING';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const EXPORT_MARKER_VERSION = 1;
const EXPORT_MARKER_MAX_BYTES = 4 * 1024 * 1024;
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
  return { source, events, spans: fillSessionCacheTokens(enrichSpansWithSessionToolContext(spans, events), events) };
}

// Copilot reports prompt-cache writes only in the session shutdown totals, not
// on chat or invoke_agent spans. When the single root invoke_agent span carries
// the same session input total, copy the cache totals onto it so the export
// includes gen_ai.usage.cache_read/cache_creation.input_tokens.
function fillSessionCacheTokens(spans, events = []) {
  const shutdown = [...events].reverse().find(event => event?.type === 'session.shutdown' && event.data?.modelMetrics);
  if (!shutdown) return spans;
  const totals = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const metrics of Object.values(shutdown.data.modelMetrics || {})) {
    for (const key of Object.keys(totals)) totals[key] += Number(metrics?.usage?.[key]) || 0;
  }
  const roots = spans.filter(span => span.operation === 'invoke_agent' && !span.parentSpanId);
  if (roots.length !== 1) return spans;
  const root = roots[0];
  if (root.inputTokens !== null && root.inputTokens !== undefined && Number(root.inputTokens) !== totals.inputTokens) return spans;
  const filled = { ...root };
  if ((root.cacheReadTokens === null || root.cacheReadTokens === undefined) && totals.cacheReadTokens) filled.cacheReadTokens = totals.cacheReadTokens;
  if ((root.cacheWriteTokens === null || root.cacheWriteTokens === undefined) && totals.cacheWriteTokens) filled.cacheWriteTokens = totals.cacheWriteTokens;
  return spans.map(span => (span === root ? filled : span));
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

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Identifies the destination by a one-way hash only. The endpoint URL and the
// connection string are never written to the marker.
function exportDestination(options = {}) {
  if (options.connectionStringEnv) {
    const value = connectionStringFromEnv(options.connectionStringEnv, options.env || process.env);
    return { kind: 'azure-monitor', hash: sha256(`agentops-export-otel\u0000azure-monitor\u0000${value}`) };
  }
  if (options.endpoint) return { kind: 'otlp-http', hash: sha256(`agentops-export-otel\u0000otlp-http\u0000${tracesUrl(options.endpoint)}`) };
  return null;
}

function exportMarkerPath(home, sessionId, runId, destinationHash) {
  const key = sha256(`${sessionId}\u0000${runId}\u0000${destinationHash}`).slice(0, 32);
  return path.join(home || defaultAgentopsHome, 'exports', 'otel', `${key}.json`);
}

function exportedSpanIdentity(span) {
  return sha256(`${span.traceId}:${span.spanId}`).slice(0, 32);
}

// A missing, unreadable or mismatched marker counts as "not exported yet".
function readExportMarker(file, { sessionId, runId, destination }) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { return null; }
  if (!stat.isFile() || stat.size > EXPORT_MARKER_MAX_BYTES) return null;
  let marker;
  try { marker = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (marker?.schema_version !== EXPORT_MARKER_VERSION || marker.session_id !== sessionId || marker.run_id !== runId
    || marker.destination_hash !== destination.hash || !Array.isArray(marker.span_identities)) return null;
  return marker;
}

function writeExportMarker(file, marker) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
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

const SKIP_REASON = 'not a GenAI operation (invoke_agent, chat or execute_tool)';

// Summary counts use the shared run-status rules (denial and shell non-zero exit
// need attention; they are not failed tool calls). Exported spans still carry
// OTel status ERROR for denials and non-zero exits, as semconv expects.
function summarise(genAi, events = []) {
  const operations = {};
  const fromSpans = { toolFailures: 0, denials: 0, nonZeroExits: 0, hookFailures: 0, subagentFailures: 0 };
  let errorSpans = 0;
  for (const span of genAi.spans) {
    const op = span.attributes['gen_ai.operation.name'];
    operations[op] = (operations[op] || 0) + 1;
    if (span.status.code === 2) errorSpans += 1;
    if (op !== 'execute_tool' || span.status.code !== 2) continue;
    const errorType = span.attributes['error.type'];
    if (errorType === SHELL_NONZERO_EXIT) fromSpans.nonZeroExits += 1;
    else if (isDenialCode(errorType)) fromSpans.denials += 1;
    else fromSpans.toolFailures += 1;
  }
  const hasToolEvents = events.some(event => event?.type === 'tool.execution_complete');
  const signals = hasToolEvents ? sessionStatusSignals(events) : fromSpans;
  const sum = (op, key) => genAi.spans
    .filter(span => span.attributes['gen_ai.operation.name'] === op)
    .reduce((total, span) => total + (span.attributes[key] || 0), 0);
  return {
    operations,
    failed_tools: signals.toolFailures,
    denied_tools: signals.denials,
    nonzero_exit_tools: signals.nonZeroExits,
    hook_failures: signals.hookFailures,
    subagent_failures: signals.subagentFailures,
    status_counts_source: hasToolEvents ? 'session-events' : 'exported-spans',
    otel_error_spans: errorSpans,
    trace_ids: [...new Set(genAi.spans.map(span => span.traceId))],
    tokens: {
      invoke_agent_input: sum('invoke_agent', 'gen_ai.usage.input_tokens'),
      invoke_agent_output: sum('invoke_agent', 'gen_ai.usage.output_tokens'),
      invoke_agent_cache_read: sum('invoke_agent', 'gen_ai.usage.cache_read.input_tokens'),
      invoke_agent_cache_creation: sum('invoke_agent', 'gen_ai.usage.cache_creation.input_tokens'),
      chat_input: sum('chat', 'gen_ai.usage.input_tokens'),
      chat_output: sum('chat', 'gen_ai.usage.output_tokens'),
      chat_cache_read: sum('chat', 'gen_ai.usage.cache_read.input_tokens'),
      chat_cache_creation: sum('chat', 'gen_ai.usage.cache_creation.input_tokens')
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
    native_spans_read: genAi.stats.input,
    spans: genAi.spans.length,
    duplicates_dropped: genAi.stats.duplicates,
    non_genai_skipped: genAi.stats.skipped,
    invalid_skipped: genAi.stats.invalid,
    skipped: [
      ...Object.entries(genAi.stats.skippedOperations || {}).map(([operation, count]) => ({ operation, count, reason: SKIP_REASON })),
      ...(genAi.stats.invalid ? [{ operation: 'invalid', count: genAi.stats.invalid, reason: 'missing or malformed trace id, span id or timing' }] : [])
    ],
    content_attributes: 'never-set',
    ...summarise(genAi, loaded.events)
  };
  if (options.output) {
    const output = path.resolve(options.output);
    fs.writeFileSync(output, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    result.output = output;
  }
  if (options.dryRun) return { ...result, delivery: 'dry-run' };
  const destination = exportDestination(options);
  if (!destination) {
    if (result.output) return { ...result, delivery: 'file' };
    throw new Error('export-otel requires --endpoint <otlp-http-url>, --appinsights-connection-string-env <VAR>, --output <file.json> or --dry-run');
  }

  // Re-running export for the same session, run and destination sends only spans
  // not already sent; --force re-sends everything.
  const markerFile = exportMarkerPath(options.agentopsHome, options.sessionId, options.runId, destination.hash);
  const previous = readExportMarker(markerFile, { sessionId: options.sessionId, runId: options.runId, destination });
  const alreadySent = new Set(options.force ? [] : previous?.span_identities || []);
  const pending = genAi.spans.filter(span => !alreadySent.has(exportedSpanIdentity(span)));
  const exportState = {
    destination_kind: destination.kind,
    already_exported: genAi.spans.length - pending.length,
    previously_exported_at: previous?.exported_at || null,
    forced: Boolean(options.force)
  };
  if (!pending.length) return { ...result, ...exportState, sent_spans: 0, delivery: 'skipped-already-exported', marker: markerFile };
  const sendRequest = pending.length === genAi.spans.length ? request : toOtlpTraceRequest(pending, {}, packageVersion);

  let delivered;
  if (destination.kind === 'azure-monitor') {
    const collector = await (options.startCollector || startAzureMonitorCollector)(options);
    let sent;
    try {
      sent = await postOtlpJson(collector.endpoint, sendRequest, options);
      await sleep(options.flushWaitMs ?? 3000);
    } catch (error) {
      await collector.stop({ keep: true });
      throw error;
    }
    const stopped = await collector.stop();
    if (stopped.exportErrors) throw new Error(`Azure Monitor exporter logged ${stopped.exportErrors} export error(s); spans may not have been ingested`);
    delivered = { delivery: 'azure-monitor-via-local-collector', http_status: sent.status, bytes: sent.bytes };
  } else {
    const sent = await postOtlpJson(options.endpoint, sendRequest, options);
    delivered = { delivery: 'otlp-http', http_status: sent.status, bytes: sent.bytes };
  }
  const identities = new Set(previous?.span_identities || []);
  for (const span of pending) identities.add(exportedSpanIdentity(span));
  // The spans are already delivered here, so a marker write failure is a warning, not an export failure.
  let marker = { marker: markerFile };
  try {
    writeExportMarker(markerFile, {
      schema_version: EXPORT_MARKER_VERSION,
      session_id: options.sessionId,
      run_id: options.runId,
      destination_kind: destination.kind,
      destination_hash: destination.hash,
      exported_at: new Date().toISOString(),
      span_identities: [...identities].sort()
    });
  } catch (error) {
    marker = { marker: null, marker_warning: `export marker not written (${error.code || 'error'}); a rerun will send these spans again` };
  }
  return { ...result, ...exportState, sent_spans: pending.length, ...delivered, ...marker };
}

function skippedText(skipped = []) {
  if (!skipped.length) return '';
  return ` · ${skipped.map(item => `${item.count} skipped (${item.operation}): ${item.reason}`).join('; ')}`;
}

function cacheText(read, creation) {
  if (!read && !creation) return '';
  return ` (cache read ${read || 0}, cache write ${creation || 0})`;
}

function renderGenAiExport(value) {
  const ops = Object.entries(value.operations).map(([op, count]) => `${op}=${count}`).join(' ');
  let resend = '';
  if (value.delivery === 'skipped-already-exported') {
    resend = `Already exported: all ${value.already_exported} spans were sent to this destination before${value.previously_exported_at ? ` (${value.previously_exported_at})` : ''}. Nothing sent. Use --force to re-send; the destination will store duplicate rows.`;
  } else if (value.already_exported) {
    resend = `Sent ${value.sent_spans} new spans; skipped ${value.already_exported} already exported to this destination.`;
  } else if (value.forced && value.previously_exported_at) {
    resend = `--force: re-sent all ${value.sent_spans} spans.`;
  }
  return [
    `GenAI OTLP export (semconv ${value.semconv_version}) · ${value.delivery}`,
    resend,
    `Session ${value.session_id} · run ${value.run_id} · source ${value.source}`,
    `Read ${value.native_spans_read ?? value.spans} native spans → exported ${value.spans} (${ops}) · duplicates dropped ${value.duplicates_dropped}${skippedText(value.skipped)}`,
    `${outcomeSummaryText({ toolFailures: value.failed_tools, denials: value.denied_tools, nonZeroExits: value.nonzero_exit_tools, hookFailures: value.hook_failures, subagentFailures: value.subagent_failures })}${value.otel_error_spans ? ` · ${value.otel_error_spans} span${value.otel_error_spans === 1 ? ' has' : 's have'} OTel status ERROR` : ''}`,
    `Tokens invoke_agent ${value.tokens.invoke_agent_input} in / ${value.tokens.invoke_agent_output} out${cacheText(value.tokens.invoke_agent_cache_read, value.tokens.invoke_agent_cache_creation)} · chat ${value.tokens.chat_input} in / ${value.tokens.chat_output} out${cacheText(value.tokens.chat_cache_read, value.tokens.chat_cache_creation)}`,
    value.output ? `OTLP JSON: ${value.output}` : '',
    value.marker_warning ? `Warning: ${value.marker_warning}` : '',
    'Metadata only: prompts, responses, tool arguments and results are never exported.'
  ].filter(Boolean).join('\n') + '\n';
}

module.exports = {
  azureMonitorConfig,
  connectionStringFromEnv,
  exportMarkerPath,
  exportSessionGenAi,
  fillSessionCacheTokens,
  loadSessionSpans,
  postOtlpJson,
  renderGenAiExport,
  startAzureMonitorCollector,
  tracesUrl
};
