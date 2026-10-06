'use strict';
// Dependency-free, read-only JSON-line MCP fixture. No filesystem/network tools.
const { Transform } = require('node:stream');
const MAX_LINE = 64 * 1024;
const tools = [
  { name: 'status', description: 'Return synthetic incident status', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'unavailable', description: 'Return a planted synthetic tool failure', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];
function respond(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  if (!Object.hasOwn(message, 'id')) return null;
  const reply = { jsonrpc: '2.0', id: message.id };
  const error = (code, text) => ({ ...reply, error: { code, message: text } });
  if (message.method === 'initialize') return { ...reply, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agentops-pattern-fixture', version: '1.0.0' } } };
  if (message.method === 'ping') return { ...reply, result: {} };
  if (message.method === 'tools/list') return { ...reply, result: { tools } };
  if (message.method !== 'tools/call') return error(-32601, 'Method not found');
  const { name, arguments: args = {} } = message.params || {};
  if (!tools.some(tool => tool.name === name) || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) return error(-32602, 'Invalid tool or arguments');
  return { ...reply, result: { content: [{ type: 'text', text: name === 'status' ? 'SYNTHETIC-INCIDENT-312: probe available; release unknown' : 'SYNTHETIC_MCP_UNAVAILABLE' }], isError: name === 'unavailable' } };
}
function serve(input, output) {
  let pending = Buffer.alloc(0);
  const lines = new Transform({ transform(chunk, encoding, callback) {
    pending = Buffer.concat([pending, chunk]);
    let newline;
    while ((newline = pending.indexOf(10)) >= 0) {
      if (newline > MAX_LINE) return callback(new Error('MCP line exceeds 64 KiB'));
      const line = pending.subarray(0, newline).toString('utf8');
      pending = pending.subarray(newline + 1);
      if (!line.trim()) continue;
      let reply;
      try { reply = respond(JSON.parse(line)); } catch { reply = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
      if (reply) output.write(JSON.stringify(reply) + '\n');
    }
    if (pending.length > MAX_LINE) return callback(new Error('MCP line exceeds 64 KiB'));
    callback();
  } });
  input.pipe(lines);
  return lines;
}
if (require.main === module) serve(process.stdin, process.stdout).on('error', error => { console.error(error.message); process.exitCode = 1; process.stdin.destroy(); });
module.exports = { respond, serve };
