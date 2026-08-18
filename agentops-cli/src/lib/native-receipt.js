const fs = require('node:fs');
const path = require('node:path');

const { optionValue } = require('./args');
const { collectorHome } = require('./paths');

const RECEIPT_PATH_ENV = 'AGENTOPS_OTEL_RECEIPT_PATH';
const DEFAULT_RECEIPT_PATH = path.join(collectorHome, 'native-receipt.jsonl');
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;

const SAFE_ATTRIBUTE_KEYS = new Set([
  'service.name',
  'service.namespace',
  'service.version',
  'telemetry.sdk.name',
  'telemetry.sdk.language',
  'telemetry.sdk.version',
  'agent.framework',
  'agent.runtime',
  'agentops.run.id',
  'agentops.session.id',
  'agentops.surface',
  'agentops.privacy.mode',
  'agentops.content_capture.mode',
  'agentops.content_capture.signal',
  'agentops.event.name',
  'agentops.event.sequence',
  'agentops.outcome',
  'agentops.status',
  'agentops.run.status',
  'agentops.session.status',
  'agentops.agent.name',
  'agentops.mcp.server',
  'agentops.mcp.tool',
  'agentops.mcp.allowed',
  'agentops.cost.estimated_usd',
  'agentops.duration.ms',
  'agentops.content.dropped_bytes',
  'agentops.tools.count',
  'agentops.files.edited_count',
  'agentops.lines.added',
  'agentops.lines.removed',
  'agentops.cli.agent',
  'agentops.cli.model',
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.conversation.id',
  'gen_ai.tool.name',
  'gen_ai.tool.type',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'github.copilot.interaction_id',
  'github.copilot.cost',
  'github.copilot.aiu',
  'github.copilot.success',
  'github.copilot.hook.type',
  'github.copilot.shutdown_type',
  'github.copilot.abort_reason',
  'error.type',
  'exception.type',
  'http.status_code'
]);

const CONTENT_ATTRIBUTE_KEYS = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'github.copilot.message',
  'http.request.body.content',
  'http.response.body.content',
  'url.full',
  'code.filepath',
  'prompt',
  'completion',
  'tool.arguments',
  'tool.result'
]);

const TERMINAL_OUTCOMES = new Map([
  ['completed', 'TASK_COMPLETED'],
  ['complete', 'TASK_COMPLETED'],
  ['success', 'TASK_COMPLETED'],
  ['succeeded', 'TASK_COMPLETED'],
  ['ok', 'TASK_COMPLETED'],
  ['failed', 'FAILED'],
  ['failure', 'FAILED'],
  ['error', 'FAILED'],
  ['errored', 'FAILED']
]);

const TERMINAL_EVENT_STATUSES = new Map([
  ['agentops.run.end', 'TASK_COMPLETED'],
  ['agentops.run.complete', 'TASK_COMPLETED'],
  ['agentops.run.completed', 'TASK_COMPLETED'],
  ['agentops.run.failed', 'FAILED'],
  ['agentops.session.end', 'SESSION_COMPLETED'],
  ['agentops.session.complete', 'SESSION_COMPLETED'],
  ['agentops.session.completed', 'SESSION_COMPLETED'],
  ['agentops.session.failed', 'FAILED'],
  ['session.task_complete', 'TASK_COMPLETED'],
  ['github.copilot.session.task_complete', 'TASK_COMPLETED'],
  ['session.idle', 'PROCESSING_STOPPED'],
  ['github.copilot.session.idle', 'PROCESSING_STOPPED']
]);

const STATUS_PRIORITY = Object.freeze({
  OBSERVED: 1,
  PROCESSING_STOPPED: 2,
  SESSION_COMPLETED: 3,
  TASK_COMPLETED: 4,
  FAILED: 5
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isSecretLike(value) {
  return /(?:secret|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|credential|private[_-]?key|gh[pousr]_|sk-[A-Za-z0-9]|connectionstring)/i.test(value);
}

function safeIdentifier(value, maxLength = 200) {
  const text = stringValue(value).trim();
  if (!text || text.length > maxLength || isSecretLike(text)) return '';
  if (/^[a-z][a-z\d+.-]{1,20}:\/\//i.test(text) || /[?#=%\s]/.test(text)) return '';
  return /^[A-Za-z0-9_.:/@+-]+$/.test(text) ? text : '';
}

function safeEnum(value) {
  const text = safeIdentifier(value, 80);
  return text ? text.toLowerCase() : '';
}

function numberValue(value) {
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeOtlpValue(value) {
  if (!isObject(value)) return undefined;
  if (Object.hasOwn(value, 'stringValue')) return stringValue(value.stringValue);
  if (Object.hasOwn(value, 'boolValue')) return Boolean(value.boolValue);
  if (Object.hasOwn(value, 'intValue')) return numberValue(value.intValue);
  if (Object.hasOwn(value, 'doubleValue')) return numberValue(value.doubleValue);
  return undefined;
}

function safeAttributes(attributes = []) {
  const values = {};
  let contentSignal = false;
  if (!Array.isArray(attributes)) return { values, contentSignal };

  for (const attribute of attributes) {
    if (!isObject(attribute) || typeof attribute.key !== 'string') continue;
    const key = attribute.key;
    if (CONTENT_ATTRIBUTE_KEYS.has(key)) {
      contentSignal = true;
      continue;
    }
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue;
    const value = decodeOtlpValue(attribute.value);
    if (value !== undefined) values[key] = value;
  }

  return { values, contentSignal };
}

function mergeAttributes(...maps) {
  return Object.assign({}, ...maps.filter(isObject));
}

function timestampToIso(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const milliseconds = BigInt(value) / 1000000n;
      return new Date(Number(milliseconds)).toISOString();
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds = numeric > 100000000000 ? numeric / 1000000 : numeric * 1000;
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function latestTime(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(right) > new Date(left) ? right : left;
}

function earliestTime(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(right) < new Date(left) ? right : left;
}

function safeListAdd(list, value) {
  const safe = safeIdentifier(value);
  if (safe && !list.includes(safe)) list.push(safe);
}

function lifecycleStatus(attributes, signalName = '', status = null) {
  const eventName = safeEnum(attributes['agentops.event.name']) || safeEnum(signalName);
  const outcome = safeEnum(attributes['agentops.outcome'])
    || safeEnum(attributes['agentops.status'])
    || safeEnum(attributes['agentops.run.status'])
    || safeEnum(attributes['agentops.session.status']);
  const outcomeStatus = TERMINAL_OUTCOMES.get(outcome);
  if (outcomeStatus) return outcomeStatus;
  const eventStatus = TERMINAL_EVENT_STATUSES.get(eventName);
  if (!eventStatus) return null;
  const statusCode = safeEnum(status?.code) || safeEnum(attributes['http.status_code']);
  return ['error', 'status_code_error'].includes(statusCode) ? 'FAILED' : eventStatus;
}

function hasError(attributes, status) {
  const statusCode = safeEnum(status?.code);
  return statusCode === 'status_code_error'
    || statusCode === 'error'
    || Boolean(safeIdentifier(attributes['error.type']) || safeIdentifier(attributes['exception.type']));
}

function eventLifecycleStatus(events = []) {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!isObject(event)) continue;
    const eventName = safeEnum(event.name);
    const attributes = safeAttributes(event.attributes).values;
    const hookType = safeEnum(attributes['github.copilot.hook.type']);
    if (eventName === 'github.copilot.hook.end' && hookType === 'agentstop') return 'PROCESSING_STOPPED';
    if (TERMINAL_EVENT_STATUSES.has(eventName)) return TERMINAL_EVENT_STATUSES.get(eventName);
    if (eventName === 'github.copilot.session.shutdown' || eventName === 'session.shutdown') {
      const shutdownType = safeEnum(attributes['github.copilot.shutdown_type']);
      return ['error', 'abort', 'timeout'].includes(shutdownType) ? 'FAILED' : 'SESSION_COMPLETED';
    }
    if (eventName === 'github.copilot.session.abort' || eventName === 'session.abort') return 'FAILED';
  }
  return null;
}

function preferStatus(current, candidate) {
  if (!candidate) return current;
  if (!current || (STATUS_PRIORITY[candidate] || 0) >= (STATUS_PRIORITY[current] || 0)) return candidate;
  return current;
}

function telemetryRecord(kind, item, resourceAttributes, inheritedContentSignal = false, extra = {}) {
  const itemAttributes = safeAttributes(item?.attributes).values;
  const itemContent = safeAttributes(item?.attributes).contentSignal;
  const attributes = mergeAttributes(resourceAttributes, itemAttributes);
  const spanName = kind === 'span' ? safeIdentifier(item?.name) : '';
  const metricName = safeIdentifier(extra.metricName);
  const operation = safeIdentifier(attributes['gen_ai.operation.name']) || metricName;
  const tool = safeIdentifier(attributes['gen_ai.tool.name'] || attributes['agentops.mcp.tool']);
  const sessionId = safeIdentifier(attributes['agentops.session.id'])
    || safeIdentifier(attributes['gen_ai.conversation.id'])
    || safeIdentifier(attributes['github.copilot.interaction_id']);
  const traceId = safeIdentifier(item?.traceId, 64);
  const start = timestampToIso(item?.startTimeUnixNano ?? item?.start_time_unix_nano ?? item?.timeUnixNano);
  const end = timestampToIso(item?.endTimeUnixNano ?? item?.end_time_unix_nano ?? item?.observedTimeUnixNano ?? item?.timeUnixNano);
  const metricValue = numberValue(extra.metricValue);
  const inputTokens = numberValue(attributes['gen_ai.usage.input_tokens'])
    || (/input.*token/i.test(metricName) ? metricValue : 0);
  const outputTokens = numberValue(attributes['gen_ai.usage.output_tokens'])
    || (/output.*token/i.test(metricName) ? metricValue : 0);
  const credits = numberValue(attributes['github.copilot.cost'] || attributes['agentops.cost.estimated_usd'])
    || (/(?:cost|credit|aiu)/i.test(metricName) ? metricValue : 0);
  const contentSignal = inheritedContentSignal || itemContent || attributes['agentops.content_capture.signal'] === true || attributes['agentops.content_capture.signal'] === 'true';
  const terminal = lifecycleStatus(attributes, spanName, item?.status)
    || eventLifecycleStatus(item?.events);

  return {
    kind,
    sessionId,
    traceId,
    start,
    end,
    operation,
    tool,
    model: safeIdentifier(attributes['gen_ai.response.model']) || safeIdentifier(attributes['gen_ai.request.model']) || safeIdentifier(attributes['agentops.cli.model']),
    agent: safeIdentifier(attributes['agentops.agent.name']) || safeIdentifier(attributes['agentops.cli.agent']),
    runId: safeIdentifier(attributes['agentops.run.id']),
    inputTokens,
    outputTokens,
    credits,
    contentSignal,
    contentDroppedBytes: numberValue(attributes['agentops.content.dropped_bytes']),
    failed: kind === 'span' && hasError(attributes, item?.status),
    terminal,
    safePrivacyMode: safeEnum(attributes['agentops.privacy.mode']),
    safeContentMode: safeEnum(attributes['agentops.content_capture.mode'])
  };
}

function resourceAttributes(resource) {
  return safeAttributes(resource?.attributes).values;
}

function requestRecords(request) {
  const records = [];
  const spans = Array.isArray(request?.resourceSpans) ? request.resourceSpans : [];
  for (const resourceSpan of spans) {
    const resource = resourceAttributes(resourceSpan?.resource);
    const contentSignal = safeAttributes(resourceSpan?.resource?.attributes).contentSignal;
    const scopes = resourceSpan?.scopeSpans || resourceSpan?.scope_spans || [];
    for (const scope of Array.isArray(scopes) ? scopes : []) {
      for (const span of Array.isArray(scope?.spans) ? scope.spans : []) {
        records.push(telemetryRecord('span', span, resource, contentSignal));
      }
    }
  }

  const metrics = Array.isArray(request?.resourceMetrics) ? request.resourceMetrics : [];
  for (const resourceMetric of metrics) {
    const resource = resourceAttributes(resourceMetric?.resource);
    const contentSignal = safeAttributes(resourceMetric?.resource?.attributes).contentSignal;
    const scopes = resourceMetric?.scopeMetrics || resourceMetric?.scope_metrics || [];
    for (const scope of Array.isArray(scopes) ? scopes : []) {
      for (const metric of Array.isArray(scope?.metrics) ? scope.metrics : []) {
        const metricName = safeIdentifier(metric?.name);
        const points = metric?.sum?.dataPoints || metric?.gauge?.dataPoints || metric?.histogram?.dataPoints || [];
        for (const point of Array.isArray(points) ? points : []) {
        records.push(telemetryRecord('metric', point, resource, contentSignal, {
          metricName,
          metricValue: point?.asInt ?? point?.asDouble ?? point?.value
        }));
        }
      }
    }
  }

  const logs = Array.isArray(request?.resourceLogs) ? request.resourceLogs : [];
  for (const resourceLog of logs) {
    const resource = resourceAttributes(resourceLog?.resource);
    const contentSignal = safeAttributes(resourceLog?.resource?.attributes).contentSignal;
    const scopes = resourceLog?.scopeLogs || resourceLog?.scope_logs || [];
    for (const scope of Array.isArray(scopes) ? scopes : []) {
      for (const log of Array.isArray(scope?.logRecords) ? scope.logRecords : (Array.isArray(scope?.log_records) ? scope.log_records : [])) {
        records.push(telemetryRecord('log', log, resource, contentSignal));
      }
    }
  }

  return records;
}

function isOtlpRequest(value) {
  return isObject(value) && ['resourceSpans', 'resourceMetrics', 'resourceLogs'].some(key => Object.hasOwn(value, key));
}

function parseFileObjects(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const objects = [];
  let malformedLines = 0;
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (isObject(value)) objects.push(value);
    } catch {
      malformedLines += 1;
    }
  }
  if (objects.length === 0 && lines.length > 0) {
    try {
      const value = JSON.parse(text);
      if (isObject(value)) {
        objects.push(value);
        malformedLines = 0;
      }
    } catch {}
  }
  return { objects, malformedLines };
}

function emptyReceipt(status = 'UNOBSERVED', reason = 'NO_NATIVE_OTLP_RECORDS') {
  return {
    status,
    observed: false,
    reason,
    session_id: null,
    run_id: null,
    trace_id: null,
    started: null,
    ended: null,
    duration_ms: null,
    operations: [],
    tools: [],
    models: [],
    agents: [],
    tool_calls: 0,
    failures: 0,
    failed_tools: 0,
    input_tokens: 0,
    output_tokens: 0,
    credits: 0,
    privacy_mode: 'strict',
    content_capture_mode: 'off',
    content_signal: false,
    content_dropped_bytes: 0,
    export_state: 'LOCAL_ONLY',
    data_missing: ['safe native OTLP processing/task completion signal']
  };
}

function deriveReceipt(records) {
  if (!records.length) return emptyReceipt();
  const groups = new Map();
  records.forEach((record, index) => {
    const key = record.sessionId || record.traceId || 'unknown-session';
    if (!groups.has(key)) groups.set(key, { key, records: [], index });
    groups.get(key).records.push(record);
  });

  const grouped = [...groups.values()];
  const candidates = grouped.some(group => group.key !== 'unknown-session')
    ? grouped.filter(group => group.key !== 'unknown-session')
    : grouped;
  const selected = candidates.sort((left, right) => {
    const leftEnd = left.records.reduce((latest, record) => latestTime(latest, record.end), null);
    const rightEnd = right.records.reduce((latest, record) => latestTime(latest, record.end), null);
    if (leftEnd && rightEnd) return new Date(rightEnd) - new Date(leftEnd);
    if (rightEnd) return 1;
    if (leftEnd) return -1;
    return right.index - left.index;
  })[0];

  const receipt = emptyReceipt('OBSERVED', 'NO_SAFE_COMPLETION_SIGNAL');
  receipt.observed = true;
  receipt.session_id = selected.records.map(record => record.sessionId).find(Boolean) || null;
  receipt.trace_id = selected.records.map(record => record.traceId).find(Boolean) || null;
  receipt.run_id = selected.records.map(record => record.runId).find(Boolean) || null;
  receipt.started = selected.records.reduce((earliest, record) => earliestTime(earliest, record.start), null);
  receipt.ended = selected.records.reduce((latest, record) => latestTime(latest, record.end), null);
  receipt.duration_ms = receipt.started && receipt.ended
    ? Math.max(0, new Date(receipt.ended) - new Date(receipt.started))
    : null;

  for (const record of selected.records) {
    safeListAdd(receipt.operations, record.operation);
    safeListAdd(receipt.tools, record.tool);
    safeListAdd(receipt.models, record.model);
    safeListAdd(receipt.agents, record.agent);
    if (record.kind === 'span' && (record.tool || record.operation === 'execute_tool')) receipt.tool_calls += 1;
    if (record.failed) {
      receipt.failures += 1;
      if (record.tool || record.operation === 'execute_tool') receipt.failed_tools += 1;
    }
    receipt.input_tokens += record.inputTokens;
    receipt.output_tokens += record.outputTokens;
    receipt.credits += record.credits;
    receipt.content_signal ||= record.contentSignal;
    receipt.content_dropped_bytes += record.contentDroppedBytes;
    if (record.safePrivacyMode) receipt.privacy_mode = record.safePrivacyMode.toUpperCase();
    if (record.safeContentMode) receipt.content_capture_mode = record.safeContentMode;
    receipt.status = preferStatus(receipt.status, record.terminal);
  }

  if (receipt.status === 'OBSERVED' && receipt.failures > 0) receipt.status = 'FAILED';
  receipt.reason = receipt.status === 'OBSERVED' ? 'NO_SAFE_COMPLETION_SIGNAL' : null;
  receipt.data_missing = [];
  if (!receipt.session_id) receipt.data_missing.push('session id');
  if (!receipt.started || !receipt.ended) receipt.data_missing.push('complete timestamps');
  if (receipt.status === 'OBSERVED') receipt.data_missing.push('safe native OTLP processing/task completion signal');
  return receipt;
}

function readNativeReceiptFile(filePath) {
  if (!filePath) return { selected: false, recognized: false, ok: false };
  const resolvedPath = path.resolve(filePath);
  let text;
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error('not a file');
    if (stat.size > MAX_RECEIPT_BYTES) {
      return {
        selected: true,
        recognized: true,
        ok: false,
        source: 'native-local-file',
        status: 'UNOBSERVED',
        reason: 'FILE_TOO_LARGE',
        receipt: emptyReceipt('UNOBSERVED', 'FILE_TOO_LARGE')
      };
    }
    text = fs.readFileSync(resolvedPath, 'utf8');
  } catch {
    return {
      selected: true,
      recognized: true,
      ok: false,
      source: 'native-local-file',
      status: 'UNOBSERVED',
      reason: 'FILE_UNREADABLE',
      receipt: emptyReceipt('UNOBSERVED', 'FILE_UNREADABLE')
    };
  }

  const parsed = parseFileObjects(text);
  const nativeRequests = parsed.objects.filter(isOtlpRequest);
  if (nativeRequests.length === 0) {
    const malformedNativeFile = parsed.malformedLines > 0 && parsed.objects.length === 0;
    return {
      selected: true,
      recognized: malformedNativeFile,
      ok: false,
      source: 'native-local-file',
      status: 'UNOBSERVED',
      reason: malformedNativeFile ? 'MALFORMED_NATIVE_FILE' : 'NO_NATIVE_OTLP_RECORDS',
      receipt: emptyReceipt('UNOBSERVED', malformedNativeFile ? 'MALFORMED_NATIVE_FILE' : 'NO_NATIVE_OTLP_RECORDS')
    };
  }

  const records = nativeRequests.flatMap(requestRecords);
  const receipt = deriveReceipt(records);
  return {
    selected: true,
    recognized: true,
    ok: true,
    source: 'native-local-file',
    status: receipt.status,
    reason: receipt.reason || null,
    receipt,
    malformed_records: parsed.malformedLines
  };
}

function readNativeReceiptFromArgs(args = [], env = process.env) {
  const explicitPath = optionValue(args, ['--file', '--jsonl']);
  const envPath = env?.[RECEIPT_PATH_ENV] || null;
  const defaultPath = !explicitPath && !envPath && fs.existsSync(DEFAULT_RECEIPT_PATH)
    ? DEFAULT_RECEIPT_PATH
    : null;
  const filePath = explicitPath || envPath || defaultPath;
  const result = readNativeReceiptFile(filePath);
  return {
    ...result,
    selected_by: explicitPath ? 'cli' : envPath ? 'env' : defaultPath ? 'default' : null
  };
}

function nativeOpenResult(native, links = {}) {
  const configuredPrimary = links.primary_investigation_url || null;
  const cloudVerified = links.cloud_verified === true;
  return {
    ok: Boolean(native?.ok),
    source: native?.source || 'native-local-file',
    status: native?.status || 'UNOBSERVED',
    observed: Boolean(native?.receipt?.observed),
    reason: native?.reason || native?.receipt?.reason || null,
    receipt: native?.receipt || emptyReceipt(),
    links: {
      primary: cloudVerified ? configuredPrimary : null,
      primary_label: cloudVerified ? (links.primary_investigation_label || null) : null,
      configured_primary: configuredPrimary,
      configured_primary_label: links.primary_investigation_label || null,
      cloud_verified: cloudVerified,
      cloud_evidence: cloudVerified ? 'explicit-query-back' : 'not-query-verified',
      azure_agents_view: links.azure_agents_view_url || null,
      application_insights: links.application_insights_url || null,
      home: links.v2_home_url || null,
      latest_session: links.latest_session_url || null
    }
  };
}

function renderNativeReceipt(result = {}) {
  const receipt = result.receipt || emptyReceipt();
  const lines = ['AgentOps native local receipt', ''];
  lines.push(`Observed: ${result.status || receipt.status || 'UNOBSERVED'}`);
  if (receipt.session_id) lines.push(`Session: ${receipt.session_id}`);
  if (receipt.run_id) lines.push(`Run: ${receipt.run_id}`);
  if (receipt.duration_ms !== null && receipt.duration_ms !== undefined) lines.push(`Duration: ${Math.round(receipt.duration_ms)}ms`);
  if (receipt.tools.length > 0 || receipt.tool_calls > 0) lines.push(`Tools: ${receipt.tools.join(', ') || 'unknown'} (${receipt.tool_calls} call${receipt.tool_calls === 1 ? '' : 's'}, ${receipt.failures} failure${receipt.failures === 1 ? '' : 's'})`);
  if (receipt.models.length > 0) lines.push(`Models: ${receipt.models.join(', ')}`);
  if (receipt.input_tokens || receipt.output_tokens || receipt.credits) lines.push(`Usage: ${receipt.input_tokens} input tokens, ${receipt.output_tokens} output tokens${receipt.credits ? `, ${receipt.credits} credits` : ''}`);
  lines.push(`Privacy: ${receipt.privacy_mode.toLowerCase()}, content returned: no${receipt.content_signal ? ' (signal detected and omitted)' : ''}`);
  lines.push(`Delivery: ${receipt.export_state.toLowerCase()}`);
  if (receipt.reason) lines.push(`Reason: ${receipt.reason}`);
  if (receipt.status === 'UNOBSERVED') {
    lines.push('No completion claim was made from the available native records.');
    lines.push('Next: agentops doctor --local-only');
  } else if (receipt.status === 'OBSERVED') {
    lines.push('Native telemetry was observed, but no safe processing-stop or task-complete signal was found.');
    lines.push('No task-success claim was made.');
  } else if (receipt.status === 'PROCESSING_STOPPED') {
    lines.push('Processing stopped; no task-success claim was made.');
  } else if (receipt.status === 'SESSION_COMPLETED') {
    lines.push('Session completion was observed; no task-success claim was made.');
  } else if (result.links?.primary) {
    lines.push(`Investigate: ${result.links.primary_label || 'Azure Monitor'} ${result.links.primary}`);
  }
  if (!result.links?.cloud_verified && result.links?.configured_primary) {
    lines.push('Cloud link: configured but not query-verified; no cloud-verified claim was made.');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  CONTENT_ATTRIBUTE_KEYS,
  DEFAULT_RECEIPT_PATH,
  RECEIPT_PATH_ENV,
  SAFE_ATTRIBUTE_KEYS,
  deriveReceipt,
  emptyReceipt,
  nativeOpenResult,
  parseFileObjects,
  readNativeReceiptFile,
  readNativeReceiptFromArgs,
  renderNativeReceipt,
  requestRecords,
  safeIdentifier,
  timestampToIso
};
