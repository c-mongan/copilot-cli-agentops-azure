const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const builtinTools = new Set(['bash', 'skill', 'report_intent', 'read_file', 'run_in_terminal', 'glob']);

function safeName(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:/@*-]+$/.test(trimmed) ? trimmed : fallback;
}

function stableHash(value, prefix = 'hash') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function defaultSessionEventsPath(sessionId, home = os.homedir()) {
  const safeSessionId = safeName(sessionId);
  if (!safeSessionId) throw new Error('session id is required');
  return path.join(home, '.copilot', 'session-state', safeSessionId, 'events.jsonl');
}

function readCopilotSessionEvents(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function toolRisk(toolName = '', mcpServer = '') {
  const value = `${toolName} ${mcpServer}`.toLowerCase();
  if (value.includes('delete') || value.includes('remove') || value.includes('destroy')) return 'destructive';
  if (value.includes('write') || value.includes('edit') || value.includes('patch')) return 'write-file';
  if (value.includes('secret') || value.includes('keyvault') || value.includes('credential')) return 'secret-access';
  if (value.includes('browser') || value.includes('playwright')) return 'browser-control';
  if (value.includes('bash') || value.includes('shell') || value.includes('terminal')) return 'shell';
  if (mcpServer) return 'read-only';
  return 'unknown';
}

function inferMcpServer(toolRequest = {}) {
  const explicit = safeName(toolRequest.mcpServerName || toolRequest.mcp_server_name || '');
  if (explicit) return explicit;
  const name = safeName(toolRequest.name || '');
  if (name.startsWith('azure-mcp-')) return 'azure-mcp';
  if (name.startsWith('mcp__')) return safeName(name.replace(/^mcp__([^_]+)__.*$/, '$1'));
  if (name.includes('/')) return safeName(name.split('/')[0]);
  return '';
}

function inferMcpTool(toolRequest = {}) {
  const explicit = safeName(toolRequest.mcpToolName || toolRequest.mcp_tool_name || '');
  if (explicit) return explicit;
  const name = safeName(toolRequest.name || '');
  if (name.startsWith('azure-mcp-')) return safeName(name.slice('azure-mcp-'.length));
  if (name.startsWith('mcp__')) return safeName(name.replace(/^mcp__.+?__(.+)$/, '$1'));
  if (name.includes('/')) return safeName(name.split('/').slice(1).join('/'));
  return name;
}

function eventBase(event, activeAgent, sessionId, index) {
  return {
    agent: activeAgent || 'github-copilot-cli',
    session: sessionId,
    custom: {
      'agentops.custom.source': 'copilot-session-enricher',
      'agentops.custom.local_event_index': index
    },
    attributes: {
      'agentops.surface': 'cli',
      'agentops.privacy.mode': 'strict',
      'agentops.content_capture.mode': 'off',
      'content.capture.enabled': false,
      'gen_ai.conversation.id': sessionId
    }
  };
}

function enrichCopilotSessionEvents(events = [], options = {}) {
  const sessionId = options.sessionId || 'unknown-session';
  const rows = [];
  let activeAgent = safeName(options.agent || '');

  events.forEach((entry, index) => {
    const type = entry.type || '';
    const data = entry.data || {};

    if (type === 'subagent.selected') {
      const agentName = safeName(data.agentName || data.agentDisplayName || '', activeAgent || 'copilot-agent');
      activeAgent = agentName;
      rows.push({
        ...eventBase(entry, agentName, sessionId, index),
        event: 'agent.selected',
        agent: agentName,
        workflow: 'copilot-cli-session',
        step: 'select-agent',
        outcome: 'selected',
        custom: {
          ...eventBase(entry, agentName, sessionId, index).custom,
          'agentops.custom.tool_count': Array.isArray(data.tools) ? data.tools.length : 0
        },
        attributes: {
          ...eventBase(entry, agentName, sessionId, index).attributes,
          'agentops.agent.name': agentName,
          'agentops.agent.hash': stableHash(agentName, 'agent')
        }
      });
      return;
    }

    if (type === 'skill.invoked') {
      const skillName = safeName(data.name || '');
      if (!skillName) return;
      rows.push({
        ...eventBase(entry, activeAgent, sessionId, index),
        event: 'skill.invoked',
        workflow: 'copilot-cli-session',
        step: 'skill',
        outcome: 'success',
        attributes: {
          ...eventBase(entry, activeAgent, sessionId, index).attributes,
          'agentops.skill.name': skillName,
          'github.copilot.skill.name': skillName,
          'github.copilot.skill.plugin_name': safeName(data.pluginName || data.plugin_name || data.source || 'plugin'),
          'agentops.skill.hash': stableHash(skillName, 'skill')
        }
      });
      return;
    }

    if (type === 'assistant.message' && Array.isArray(data.toolRequests)) {
      for (const request of data.toolRequests) {
        const name = safeName(request.name || '');
        if (!name) continue;
        if (name === 'skill') {
          const skillName = safeName(request.arguments?.skill || request.intentionSummary || '');
          if (!skillName) continue;
          rows.push({
            ...eventBase(entry, activeAgent, sessionId, index),
            event: 'skill.requested',
            workflow: 'copilot-cli-session',
            step: 'skill',
            outcome: 'requested',
            attributes: {
              ...eventBase(entry, activeAgent, sessionId, index).attributes,
              'agentops.skill.name': skillName,
              'github.copilot.skill.name': skillName,
              'agentops.skill.hash': stableHash(skillName, 'skill')
            }
          });
          continue;
        }

        const mcpServer = inferMcpServer(request);
        const mcpTool = inferMcpTool(request);
        rows.push({
          ...eventBase(entry, activeAgent, sessionId, index),
          event: mcpServer ? 'mcp.tools.call' : 'tool.call',
          workflow: 'copilot-cli-session',
          step: mcpServer ? 'mcp-tool' : 'tool',
          outcome: 'requested',
          attributes: {
            ...eventBase(entry, activeAgent, sessionId, index).attributes,
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': name,
            'gen_ai.tool.type': mcpServer ? 'mcp' : (builtinTools.has(name) ? 'builtin' : 'custom'),
            ...(mcpServer ? {
              'agentops.mcp.server': mcpServer,
              'agentops.mcp.tool': mcpTool,
              'agentops.mcp.server.hash': stableHash(mcpServer, 'mcp_server'),
              'agentops.mcp.allowed': true,
              'agentops.mcp.tool.risk': toolRisk(name, mcpServer)
            } : {})
          }
        });
      }
      return;
    }

    if (type === 'tool.execution_complete') {
      const name = safeName(data.toolName || '');
      if (!name) return;
      rows.push({
        ...eventBase(entry, activeAgent, sessionId, index),
        event: 'tool.completed',
        workflow: 'copilot-cli-session',
        step: 'tool',
        outcome: data.success === false ? 'failed' : 'success',
        attributes: {
          ...eventBase(entry, activeAgent, sessionId, index).attributes,
          'gen_ai.operation.name': name === 'skill' ? 'skill' : 'execute_tool',
          'gen_ai.tool.name': name,
          'gen_ai.tool.type': builtinTools.has(name) ? 'builtin' : 'custom',
          ...(data.success === false ? { 'error.type': 'tool_failed' } : {})
        }
      });
      return;
    }

    if (type === 'hook.start') {
      const hookType = safeName(data.hookType || '');
      if (!hookType) return;
      rows.push({
        ...eventBase(entry, activeAgent, sessionId, index),
        event: 'hook.started',
        workflow: 'copilot-cli-session',
        step: hookType,
        outcome: 'started',
        attributes: {
          ...eventBase(entry, activeAgent, sessionId, index).attributes,
          'github.copilot.hook.type': hookType,
          'gen_ai.operation.name': 'hook'
        }
      });
    }
  });

  return rows;
}

module.exports = {
  defaultSessionEventsPath,
  enrichCopilotSessionEvents,
  inferMcpServer,
  inferMcpTool,
  readCopilotSessionEvents,
  safeName,
  toolRisk
};
