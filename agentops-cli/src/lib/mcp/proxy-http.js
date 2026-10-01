const { classifyMcpToolRisk } = require('./risk-classifier');
const { argsSchemaHash, jsonByteSize, stableHashJson } = require('./redactor');
const { injectTraceContext } = require('./trace-context');

function jsonRpcId(message = {}) {
  return message.id === undefined || message.id === null ? '' : String(message.id);
}

function toolNameFromMessage(message = {}) {
  return String(message.params?.name || message.params?.tool || message.params?.toolName || 'unknown-tool');
}

function createMcpHttpProxyObserver(options = {}) {
  const serverName = options.serverName || 'unknown-mcp';
  const runId = options.runId || `run_mcp_http_${Date.now()}`;
  const sessionId = options.sessionId || `mcp_http_session_${Date.now()}`;
  const traceId = options.traceId || stableHashJson(`${runId}:trace`, 'trace');
  const pending = new Map();
  const rows = [];

  function emitRow(request, { status, errorType = '', outputResult = undefined }) {
    const row = {
      TimeGenerated: new Date().toISOString(),
      RunId: runId,
      TraceId: traceId,
      SpanId: request.spanId,
      McpSessionId: sessionId,
      McpServerName: serverName,
      McpServerHash: stableHashJson(serverName, 'mcp_server'),
      McpClientName: options.clientName || 'http-client',
      McpTransport: options.transport || 'http',
      ToolName: request.toolName,
      ToolType: request.risk,
      ToolRisk: request.risk,
      Allowed: request.allowed,
      DeniedReason: '',
      Sandboxed: Boolean(options.sandboxed),
      Status: status,
      DurationMs: Math.max(0, Date.now() - request.started),
      OutputSizeBytes: jsonByteSize(outputResult),
      ResultSizeBytes: jsonByteSize(outputResult),
      ArgsSchemaHash: request.argsSchemaHash,
      ErrorType: errorType
    };
    rows.push(row);
    if (options.onObservation) options.onObservation(row);
    return row;
  }

  function observeCancellation(message) {
    const requestId = message.params?.requestId;
    if (requestId === undefined || requestId === null) return { message, observed: false };
    const key = String(requestId);
    if (!pending.has(key)) return { message, observed: false };
    const request = pending.get(key);
    pending.delete(key);
    emitRow(request, { status: 'cancelled' });
    return { message, observed: false };
  }

  function observeRequest(message = {}) {
    if (!message) return { message, observed: false };
    if (message.method === 'notifications/cancelled') return observeCancellation(message);
    if (message.method !== 'tools/call') return { message, observed: false };
    const toolName = toolNameFromMessage(message);
    const context = injectTraceContext(message);
    const id = jsonRpcId(message) || context.context.spanId;
    pending.set(id, {
      started: Date.now(),
      spanId: context.context.spanId,
      toolName,
      risk: classifyMcpToolRisk(toolName),
      argsSchemaHash: argsSchemaHash(message.params?.arguments || message.params?.args || {}),
      allowed: true
    });
    return { message: context.message, observed: true, id };
  }

  function observeResponse(message = {}) {
    const id = jsonRpcId(message);
    if (!id || !pending.has(id)) return null;
    const request = pending.get(id);
    pending.delete(id);
    const failed = Boolean(message.error);
    return emitRow(request, {
      status: failed ? 'failed' : 'success',
      errorType: failed ? String(message.error?.code || 'mcp_error') : '',
      outputResult: message.result
    });
  }

  function observeExchange(request = {}, response = {}) {
    const observed = observeRequest(request);
    return {
      request: observed.message,
      observed: observed.observed,
      row: observeResponse(response)
    };
  }

  return {
    observeExchange,
    observeRequest,
    observeResponse,
    rows
  };
}

module.exports = {
  createMcpHttpProxyObserver
};
