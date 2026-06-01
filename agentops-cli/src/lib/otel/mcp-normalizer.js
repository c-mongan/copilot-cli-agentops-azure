const crypto = require('node:crypto');

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function classifyMcpToolRisk(toolName = '', metadata = {}) {
  const text = `${toolName} ${metadata.description || ''}`.toLowerCase();
  if (/delete|remove|destroy|drop|reset|format|kill/.test(text)) return 'destructive';
  if (/shell|bash|powershell|terminal|exec|command/.test(text)) return 'shell';
  if (/secret|token|credential|keychain|env/.test(text)) return 'secret-access';
  if (/write|edit|patch|create|save/.test(text)) return 'write-file';
  if (/browser|click|navigate|page/.test(text)) return 'browser-control';
  if (/http|fetch|network|request/.test(text)) return 'network';
  return 'read-only';
}

function normalizeMcpAttributes(attributes = {}, options = {}) {
  const toolName = attributes['gen_ai.tool.name'] || attributes['mcp.tool.name'] || options.toolName || 'unknown';
  const serverName = attributes['mcp.server.name'] || options.serverName || 'unknown';
  const normalized = {
    ...attributes,
    'mcp.method.name': attributes['mcp.method.name'] || options.method || 'tools/call',
    'mcp.session.id': attributes['mcp.session.id'] || attributes['agentops.session.id'] || options.sessionId || '',
    'mcp.transport': attributes['mcp.transport'] || options.transport || 'stdio',
    'mcp.server.name': serverName,
    'mcp.client.name': attributes['mcp.client.name'] || options.clientName || 'agentops',
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': toolName,
    'agentops.mcp.server.hash': attributes['agentops.mcp.server.hash'] || hashJson({ serverName }),
    'agentops.mcp.tool.risk': attributes['agentops.mcp.tool.risk'] || classifyMcpToolRisk(toolName, options),
    'agentops.mcp.allowed': attributes['agentops.mcp.allowed'] ?? true,
    'agentops.mcp.sandboxed': attributes['agentops.mcp.sandboxed'] ?? Boolean(options.sandboxed)
  };

  if (options.argsSchema && !normalized['agentops.mcp.args_schema_hash']) {
    normalized['agentops.mcp.args_schema_hash'] = hashJson(options.argsSchema);
  }
  if (options.result !== undefined && !normalized['agentops.mcp.result_size_bytes']) {
    normalized['agentops.mcp.result_size_bytes'] = Buffer.byteLength(JSON.stringify(options.result));
  }

  return normalized;
}

module.exports = {
  classifyMcpToolRisk,
  normalizeMcpAttributes
};
