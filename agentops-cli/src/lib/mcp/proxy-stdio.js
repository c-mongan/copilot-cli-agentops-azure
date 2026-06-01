const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { classifyMcpToolRisk } = require('./risk-classifier');
const { argsSchemaHash, jsonByteSize, stableHashJson } = require('./redactor');
const { injectTraceContext } = require('./trace-context');

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function createLineBuffer(onLine) {
  let pending = '';
  return chunk => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  };
}

function createMcpProxyObserver(options = {}) {
  const serverName = options.serverName || 'unknown-mcp';
  const runId = options.runId || `run_mcp_${Date.now()}`;
  const sessionId = options.sessionId || `mcp_session_${Date.now()}`;
  const traceId = options.traceId || stableHashJson(`${runId}:trace`, 'trace');
  const pending = new Map();
  const rows = [];

  function observeClientMessage(message) {
    if (!message || message.method !== 'tools/call') return { message, observed: false };
    const toolName = String(message.params?.name || message.params?.tool || 'unknown-tool');
    const context = injectTraceContext(message);
    const started = Date.now();
    pending.set(String(message.id), {
      started,
      spanId: context.context.spanId,
      toolName,
      risk: classifyMcpToolRisk(toolName),
      argsSchemaHash: argsSchemaHash(message.params?.arguments || message.params?.args || {}),
      allowed: true
    });
    return { message: context.message, observed: true };
  }

  function observeServerMessage(message) {
    if (!message || message.id === undefined || !pending.has(String(message.id))) return null;
    const request = pending.get(String(message.id));
    pending.delete(String(message.id));
    const failed = Boolean(message.error);
    const row = {
      TimeGenerated: new Date().toISOString(),
      RunId: runId,
      TraceId: traceId,
      SpanId: request.spanId,
      McpSessionId: sessionId,
      McpServerName: serverName,
      McpServerHash: stableHashJson(serverName, 'mcp_server'),
      McpClientName: options.clientName || 'mcp-client',
      McpTransport: 'stdio',
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

  return {
    observeClientMessage,
    observeServerMessage,
    rows
  };
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function proxyStdio(options = {}) {
  const command = options.command;
  const args = options.args || [];
  if (!command) throw new Error('mcp-proxy requires a command after --');

  const outFile = options.outFile || path.join(process.cwd(), '.agentops', 'mcp-proxy', 'AgentOpsMcpCalls_CL.jsonl');
  const observer = createMcpProxyObserver({
    ...options,
    onObservation: row => appendJsonl(outFile, row)
  });

  const child = childProcess.spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env
  });

  const handleClientLine = createLineBuffer(line => {
    const parsed = parseJsonLine(line);
    if (!parsed) {
      child.stdin.write(`${line}\n`);
      return;
    }
    const observed = observer.observeClientMessage(parsed);
    child.stdin.write(`${JSON.stringify(observed.message)}\n`);
  });

  const handleServerLine = createLineBuffer(line => {
    const parsed = parseJsonLine(line);
    if (parsed) observer.observeServerMessage(parsed);
    process.stdout.write(`${line}\n`);
  });

  process.stdin.on('data', handleClientLine);
  process.stdin.on('end', () => child.stdin.end());
  child.stdout.on('data', handleServerLine);
  child.on('exit', (code, signal) => {
    process.exitCode = code === null ? 1 : code;
    if (signal) process.stderr.write(`mcp-proxy child exited with signal ${signal}\n`);
  });
  child.on('error', error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

  return child;
}

module.exports = {
  createMcpProxyObserver,
  parseJsonLine,
  proxyStdio
};
