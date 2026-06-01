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

  function observeRequest(message = {}) {
    if (!message || message.method !== 'tools/call') return { message, observed: false };
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
      Status: failed ? 'failed' : 'success',
      DurationMs: Math.max(0, Date.now() - request.started),
      OutputSizeBytes: jsonByteSize(message.result),
      ResultSizeBytes: jsonByteSize(message.result),
      ArgsSchemaHash: request.argsSchemaHash,
      ErrorType: failed ? String(message.error?.code || 'mcp_error') : ''
    };
    rows.push(row);
    if (options.onObservation) options.onObservation(row);
    return row;
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
