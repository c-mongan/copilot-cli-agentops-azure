const path = require('node:path');

const { optionValue } = require('../lib/args');
const { proxyStdio } = require('../lib/mcp/proxy-stdio');

function splitCommand(args) {
  const separator = args.indexOf('--');
  if (separator === -1 || separator === args.length - 1) {
    throw new Error('mcp-proxy requires -- <server command> [args...]');
  }
  return args.slice(separator + 1);
}

function mcpProxyCommand(args = []) {
  const serverName = optionValue(args, '--server-name', 'unknown-mcp');
  const outFile = path.resolve(optionValue(args, '--out', path.join(process.cwd(), '.agentops', 'mcp-proxy', 'AgentOpsMcpCalls_CL.jsonl')));
  const commandAndArgs = splitCommand(args);
  return proxyStdio({
    serverName,
    outFile,
    command: commandAndArgs[0],
    args: commandAndArgs.slice(1),
    sandboxed: args.includes('--sandboxed')
  });
}

module.exports = {
  mcpProxyCommand,
  splitCommand
};
