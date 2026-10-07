// Single adapter between AgentOps span records and the OpenTelemetry GenAI
// semantic conventions. Every gen_ai.* key, span name and span kind used by the
// OTLP export lives here, so a future semconv rename touches only this file.
//
// Pinned to semantic-conventions v1.41.0: the last tagged release that still
// carries the GenAI docs (later tags moved them to the unreleased
// open-telemetry/semantic-conventions-genai repository).

const SEMCONV_VERSION = '1.41.0';
const SCHEMA_URL = `https://opentelemetry.io/schemas/${SEMCONV_VERSION}`;
const SCOPE_NAME = 'agentops.genai-export';

const SPAN_KIND = Object.freeze({ INTERNAL: 1, SERVER: 2, CLIENT: 3 });
const STATUS_CODE = Object.freeze({ UNSET: 0, OK: 1, ERROR: 2 });

const ATTR = Object.freeze({
  OPERATION_NAME: 'gen_ai.operation.name',
  PROVIDER_NAME: 'gen_ai.provider.name',
  // Deprecated in favour of gen_ai.provider.name; emitted as an alias because
  // older Azure Monitor agent views and KQL still key on it.
  SYSTEM: 'gen_ai.system',
  AGENT_NAME: 'gen_ai.agent.name',
  CONVERSATION_ID: 'gen_ai.conversation.id',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  CACHE_READ_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
  CACHE_CREATION_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
  TOOL_TYPE: 'gen_ai.tool.type',
  ERROR_TYPE: 'error.type'
});

// Opt-in content attributes. The adapter never emits these: AgentOps exports
// metadata only, and the local ledger it reads does not hold content.
const CONTENT_ATTRIBUTES = Object.freeze([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.prompt',
  'gen_ai.completion'
]);

// Namespaced extras. Nothing outside gen_ai.*, error.type and agentops.* is set.
const AGENTOPS_ATTR = Object.freeze({
  RUN_ID: 'agentops.run.id',
  AGENT_NAME_SOURCE: 'agentops.agent.name_source',
  SEMCONV_VERSION: 'agentops.semconv.version',
  MCP_SERVER_NAME: 'agentops.mcp.server',
  PARENT_TOOL_CALL_ID: 'agentops.parent_tool_call.id'
});

const OPERATIONS = Object.freeze({
  invoke_agent: { kind: SPAN_KIND.INTERNAL, nameKey: 'agent' },
  create_agent: { kind: SPAN_KIND.CLIENT, nameKey: 'agent' },
  chat: { kind: SPAN_KIND.CLIENT, nameKey: 'model' },
  text_completion: { kind: SPAN_KIND.CLIENT, nameKey: 'model' },
  generate_content: { kind: SPAN_KIND.CLIENT, nameKey: 'model' },
  embeddings: { kind: SPAN_KIND.CLIENT, nameKey: 'model' },
  execute_tool: { kind: SPAN_KIND.INTERNAL, nameKey: 'tool' }
});

const DEFAULT_AGENT_NAME = 'GitHub Copilot CLI';
const SAFE_VALUE = /^[\p{L}\p{N}_][\p{L}\p{N} _.:/@()+-]{0,127}$/u;
const HEX_TRACE = /^[0-9a-f]{32}$/;
const HEX_SPAN = /^[0-9a-f]{16}$/;

function safeString(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return SAFE_VALUE.test(text) ? text : '';
}

function tokenCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nanoseconds(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const whole = Math.floor(milliseconds);
  return BigInt(whole) * 1000000n + BigInt(Math.round((milliseconds - whole) * 1000000));
}

function spanTiming(span) {
  const start = nanoseconds(span.start);
  if (start === null) return null;
  let duration = null;
  if (typeof span.durationNs === 'string' && /^\d+$/.test(span.durationNs)) duration = BigInt(span.durationNs);
  else if (Number.isSafeInteger(span.durationNs) && span.durationNs >= 0) duration = BigInt(span.durationNs);
  else if (Number.isFinite(span.end) && span.end >= span.start) duration = nanoseconds(span.end) - start;
  if (duration === null || duration < 0n) return null;
  return { start, end: start + duration };
}

function operationOf(span) {
  const declared = String(span.operation || '').trim();
  const known = name => Object.prototype.hasOwnProperty.call(OPERATIONS, name);
  if (known(declared)) return declared;
  const prefix = String(span.spanName || '').split(' ')[0];
  return known(prefix) ? prefix : '';
}

/**
 * Map AgentOps span records (from readSessionSpanRows / readSessionOtelSpans)
 * to semconv GenAI spans. Unknown operations are skipped, duplicate
 * traceId:spanId pairs are dropped (first record wins, failure is sticky), and
 * only allow-listed metadata attributes are produced.
 */
function toGenAiSpans(spans = [], context = {}) {
  const sessionId = safeString(context.sessionId);
  const runId = safeString(context.runId);
  const overrideAgent = safeString(context.agentName);
  const byIdentity = new Map();
  const stats = { input: 0, mapped: 0, duplicates: 0, skipped: 0, invalid: 0, skippedOperations: Object.create(null) };
  for (const span of spans) {
    stats.input += 1;
    const operation = operationOf(span || {});
    if (!operation) {
      stats.skipped += 1;
      // Bounded metadata label so a summary can say what was left out and why.
      const label = safeString(span?.operation) || safeString(String(span?.spanName || '').split(' ')[0]) || 'unknown';
      const keys = Object.keys(stats.skippedOperations);
      const key = keys.includes(label) || keys.length < 10 ? label : 'other';
      stats.skippedOperations[key] = (stats.skippedOperations[key] || 0) + 1;
      continue;
    }
    const traceId = String(span.traceId || '').toLowerCase();
    const spanId = String(span.spanId || '').toLowerCase();
    const parentSpanId = String(span.parentSpanId || '').toLowerCase();
    const timing = spanTiming(span);
    if (!HEX_TRACE.test(traceId) || !HEX_SPAN.test(spanId) || (parentSpanId && !HEX_SPAN.test(parentSpanId)) || !timing) {
      stats.invalid += 1;
      continue;
    }
    const identity = `${traceId}:${spanId}`;
    const existing = byIdentity.get(identity);
    if (existing) {
      stats.duplicates += 1;
      if (span.failed && existing.status.code !== STATUS_CODE.ERROR) {
        existing.status = { code: STATUS_CODE.ERROR };
        const errorType = safeString(span.errorType) || '_OTHER';
        existing.attributes[ATTR.ERROR_TYPE] = errorType;
      }
      continue;
    }

    const nativeAgent = span.agent && span.agent !== 'native OTel' ? safeString(span.agent) : '';
    const agentName = overrideAgent || nativeAgent || DEFAULT_AGENT_NAME;
    const agentNameSource = overrideAgent ? 'override' : nativeAgent ? 'native' : 'default';
    const provider = safeString(span.provider);
    const requestModel = safeString(span.modelRequested) || (operation === 'invoke_agent' ? '' : safeString(span.model));
    const responseModel = safeString(span.modelActual);
    const toolName = safeString(span.toolName);
    const toolCallId = safeString(span.toolCallId);
    // A shell non-zero exit is exported as an error span with a bounded error.type,
    // even though Copilot reported the tool call as successful.
    const errorType = span.failed ? (safeString(span.errorType) || '_OTHER')
      : span.errorType === 'shell_nonzero_exit' ? 'shell_nonzero_exit' : '';

    const attributes = { [ATTR.OPERATION_NAME]: operation };
    if (provider) { attributes[ATTR.PROVIDER_NAME] = provider; attributes[ATTR.SYSTEM] = provider; }
    if (sessionId) attributes[ATTR.CONVERSATION_ID] = sessionId;
    attributes[ATTR.AGENT_NAME] = agentName;
    if (requestModel) attributes[ATTR.REQUEST_MODEL] = requestModel;
    if (responseModel) attributes[ATTR.RESPONSE_MODEL] = responseModel;
    for (const [key, value] of [
      [ATTR.INPUT_TOKENS, span.inputTokens],
      [ATTR.OUTPUT_TOKENS, span.outputTokens],
      [ATTR.CACHE_READ_TOKENS, span.cacheReadTokens],
      [ATTR.CACHE_CREATION_TOKENS, span.cacheWriteTokens]
    ]) {
      const count = tokenCount(value);
      if (count !== null) attributes[key] = count;
    }
    if (operation === 'execute_tool') {
      attributes[ATTR.TOOL_NAME] = toolName || 'unknown';
      if (toolCallId) attributes[ATTR.TOOL_CALL_ID] = toolCallId;
      attributes[ATTR.TOOL_TYPE] = safeString(span.mcpServerName) ? 'extension' : 'function';
      if (safeString(span.mcpServerName)) attributes[AGENTOPS_ATTR.MCP_SERVER_NAME] = safeString(span.mcpServerName);
      if (safeString(span.parentToolCallId)) attributes[AGENTOPS_ATTR.PARENT_TOOL_CALL_ID] = safeString(span.parentToolCallId);
    }
    if (errorType) attributes[ATTR.ERROR_TYPE] = errorType;
    if (runId) attributes[AGENTOPS_ATTR.RUN_ID] = runId;
    attributes[AGENTOPS_ATTR.AGENT_NAME_SOURCE] = agentNameSource;
    attributes[AGENTOPS_ATTR.SEMCONV_VERSION] = SEMCONV_VERSION;

    const config = OPERATIONS[operation];
    const nameSuffix = config.nameKey === 'agent' ? agentName
      : config.nameKey === 'model' ? requestModel
        : attributes[ATTR.TOOL_NAME];
    byIdentity.set(identity, {
      traceId,
      spanId,
      parentSpanId,
      name: nameSuffix ? `${operation} ${nameSuffix}` : operation,
      kind: config.kind,
      startTimeUnixNano: timing.start.toString(),
      endTimeUnixNano: timing.end.toString(),
      attributes,
      status: { code: errorType ? STATUS_CODE.ERROR : STATUS_CODE.UNSET }
    });
  }
  const result = [...byIdentity.values()].sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : BigInt(a.startTimeUnixNano) > BigInt(b.startTimeUnixNano) ? 1 : 0));
  stats.mapped = result.length;
  return { spans: result, stats };
}

function otlpValue(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return { intValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return { stringValue: String(value) };
}

function otlpAttributes(attributes) {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

/** Build an OTLP/HTTP JSON ExportTraceServiceRequest. */
function toOtlpTraceRequest(genAiSpans, resource = {}, scopeVersion = '') {
  const resourceAttributes = { 'service.name': 'github-copilot-cli', ...resource };
  return {
    resourceSpans: [{
      resource: { attributes: otlpAttributes(resourceAttributes) },
      schemaUrl: SCHEMA_URL,
      scopeSpans: [{
        scope: { name: SCOPE_NAME, version: scopeVersion },
        schemaUrl: SCHEMA_URL,
        spans: genAiSpans.map(span => ({
          traceId: span.traceId,
          spanId: span.spanId,
          ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          name: span.name,
          kind: span.kind,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: otlpAttributes(span.attributes),
          status: span.status
        }))
      }]
    }]
  };
}

module.exports = {
  AGENTOPS_ATTR,
  ATTR,
  CONTENT_ATTRIBUTES,
  DEFAULT_AGENT_NAME,
  OPERATIONS,
  SCHEMA_URL,
  SCOPE_NAME,
  SEMCONV_VERSION,
  SPAN_KIND,
  STATUS_CODE,
  safeString,
  toGenAiSpans,
  toOtlpTraceRequest
};
