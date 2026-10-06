const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { inferMcpServer, inferMcpTool } = require('./session-enricher');

const eventTypes = new Set([
  'session.start', 'session.shutdown', 'session.model_change',
  'assistant.turn_start', 'assistant.turn_end',
  'tool.execution_start', 'tool.execution_complete',
  'hook.start', 'hook.end',
  'subagent.started', 'subagent.completed', 'subagent.failed',
  'subagent.selected', 'skill.invoked', 'skill.context_delivered_ref'
]);

function eventId(sessionId, index, type) {
  const digest = crypto.createHash('sha256').update(`${sessionId}:${index}:${type}`).digest('hex').slice(0, 24);
  return `session_event_${digest}`;
}

function safeText(value, maximum = 200) {
  return typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : '';
}

// Resolves `value` to a repo-relative path only when it stays inside repoRoot
// (no absolute escape, no `../` traversal). Declaration-agnostic: callers decide
// whether the resolved path needs to be in a reference manifest.
function safeRepoRelativePath(value, repoRoot) {
  const input = safeText(value, 2048);
  if (!input) return '';
  const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(repoRoot, input);
  const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return '';
  return relative;
}

function safeRepoPath(value, repoRoot, referencePaths) {
  const relative = safeRepoRelativePath(value, repoRoot);
  return relative && referencePaths.has(relative) ? relative : '';
}

function attachmentReferencePaths(repoRoot) {
  const manifest = path.join(repoRoot, '.agentops', 'attachment.json');
  try {
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return new Set((value.architecture?.skills || []).flatMap(skill => skill.references || [])
      .map(reference => safeText(reference.path, 1024)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function attachmentSkillReferences(repoRoot) {
  const manifest = path.join(repoRoot, '.agentops', 'attachment.json');
  try {
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const references = new Map();
    for (const skill of value.architecture?.skills || []) {
      const skillName = safeText(skill.name, 200).replace(/^skill-/, '');
      if (!skillName) continue;
      for (const reference of skill.references || []) {
        const referencePath = safeText(reference.path, 1024);
        if (!referencePath) continue;
        references.set(referencePath, [...(references.get(referencePath) || []), skillName]);
      }
    }
    for (const [referencePath, skillNames] of references) {
      references.set(referencePath, [...new Set(skillNames)].sort((left, right) => left.localeCompare(right)));
    }
    return references;
  } catch {
    return new Map();
  }
}

// Parses a direct, single-file `cat <path>` shell read (successful, not compound)
// and returns the raw path argument it targeted, or '' if the command doesn't
// match that exact shape. Shared by the declared-reference check below and by
// the undeclared-but-safe-path check used only by the local waterfall engine.
function parseDirectCatPath(command, toolName, event) {
  if (toolName !== 'bash' || event.type !== 'tool.execution_complete') return '';
  const data = event.data || {};
  const exitCode = data.shellExecution?.exitCode;
  const succeeded = data.success === true || (data.success !== false && exitCode === 0);
  if (!succeeded) return '';
  const text = safeText(command, 8192).trim();
  const match = /^cat\s+(?:--\s+)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;&|<>`$()]+))\s*$/.exec(text);
  return match?.[1] || match?.[2] || match?.[3] || '';
}

function directShellReferenceRead(command, toolName, event, repoRoot, referencePaths) {
  return safeRepoPath(parseDirectCatPath(command, toolName, event), repoRoot, referencePaths);
}

// Undeclared-but-safe counterpart of directShellReferenceRead: resolves the same
// direct single-file `cat <path>` shape to a safe repo-relative path WITHOUT
// requiring it to be in the declared reference manifest. Used only by
// session-waterfall.js to surface "read observed, not a declared reference" rows
// locally (evidence: 'unsupported'). Deliberately NOT wired into operationFields/
// ReferenceName so the Azure telemetry CL export never leaks undeclared read paths.
function directShellPathRead(event, repoRoot, prior = {}) {
  const data = event.data || {};
  const toolName = safeText(data.toolName || prior.toolName || '');
  const args = data.arguments && typeof data.arguments === 'object' ? data.arguments : prior.arguments;
  const rawCommand = safeText(args?.command || data.shellExecution?.command || prior.shellExecution?.command || '', 8192);
  return safeRepoRelativePath(parseDirectCatPath(rawCommand, toolName, event), repoRoot);
}

// Mirrors the DurationNs null-preserving pattern used for spans: absent/unparseable
// stays null so "never measured" cannot be confused with a measured zero.
function nullableTokenCount(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function operationFields(event, repoRoot, referencePaths, prior = {}) {
  const data = event.data || {};
  const toolName = safeText(data.toolName || prior.toolName || '');
  const toolRequest = {
    name: toolName,
    mcpServerName: data.mcpServerName || data.mcp_server_name || prior.mcpServerName || prior.mcp_server_name || '',
    mcpToolName: data.mcpToolName || data.mcp_tool_name || prior.mcpToolName || prior.mcp_tool_name || ''
  };
  const mcpServerName = inferMcpServer(toolRequest);
  const args = data.arguments && typeof data.arguments === 'object' ? data.arguments : prior.arguments;
  const invocationPath = args && typeof args === 'object'
    ? args.path || args.filePath || args.file_path
    : '';
  const rawCommand = safeText(args?.command || data.shellExecution?.command || prior.shellExecution?.command || '', 8192);
  const referenceName = safeRepoPath(invocationPath, repoRoot, referencePaths)
    || directShellReferenceRead(rawCommand, toolName, event, repoRoot, referencePaths);
  const commandName = rawCommand ? path.basename(rawCommand.trim().split(/\s+/, 1)[0]) : '';
  const shellExitCode = Number.isSafeInteger(data.shellExecution?.exitCode) ? data.shellExecution.exitCode : null;
  const failed = event.type === 'tool.execution_complete' && (data.success === false || shellExitCode !== null && shellExitCode !== 0)
    || (event.type === 'hook.end' && data.success === false) || event.type === 'subagent.failed';
  const status = event.type === 'tool.execution_start' || event.type === 'hook.start' || event.type === 'subagent.started' || event.type === 'assistant.turn_start'
    ? 'started'
    : failed
      ? 'failed'
      : event.type === 'tool.execution_complete' || event.type === 'hook.end' || event.type === 'subagent.completed' || event.type === 'assistant.turn_end' || event.type === 'session.shutdown'
        ? 'completed'
        : 'observed';
  return {
    Status: status,
    ToolName: toolName,
    ToolCallId: safeText(data.toolCallId || '', 200),
    McpServerName: mcpServerName,
    McpToolName: mcpServerName ? inferMcpTool(toolRequest) : '',
    CommandName: commandName,
    ReferenceName: referenceName,
    ScriptName: '',
    AgentName: safeText(data.agentName || data.agentDisplayName || '', 200),
    SkillName: safeText(data.name || data.skillName || data.skill_name || (event.type === 'skill.context_delivered_ref' ? data.source : ''), 200).replace(/^skill-/, ''),
    SubAgentName: event.type.startsWith('subagent.') ? safeText(data.agentName || data.agentDisplayName || '', 200) : '',
    ParentAgentName: '',
    ExitCode: shellExitCode === null ? undefined : shellExitCode,
    // Producer-declared request. Launcher intent stays in sanitized run context.
    ModelRequested: safeText(data.requestedModel || '', 200),
    ModelActual: safeText(data.newModel || data.currentModel || data.model || '', 200),
    Provider: safeText(data.provider || '', 200),
    InputTokens: nullableTokenCount(data.tokenDetails?.input?.tokenCount),
    OutputTokens: nullableTokenCount(data.tokenDetails?.output?.tokenCount),
    CacheReadTokens: nullableTokenCount(data.tokenDetails?.cache_read?.tokenCount),
    CacheWriteTokens: nullableTokenCount(data.tokenDetails?.cache_write?.tokenCount),
    DurationMs: Number(data.durationMs || 0),
    ErrorType: status === 'failed' ? (event.type === 'subagent.failed' ? 'subagent_failed' : shellExitCode !== null && shellExitCode !== 0 ? 'shell_exit_code' : 'operation_failed') : ''
  };
}

function projectSessionEvents(events = [], { sessionId, runId, repoRoot = process.cwd(), referencePaths = attachmentReferencePaths(repoRoot) } = {}) {
  if (!/^[A-Za-z0-9_.:/@+-]{1,200}$/.test(String(sessionId || ''))) throw new Error('session event export requires a safe session ID');
  if (!/^[A-Za-z0-9_.:/@+-]{1,200}$/.test(String(runId || ''))) throw new Error('session event export requires a safe run ID');
  const root = path.resolve(repoRoot);
  const projected = events.map((event, index) => {
    const type = safeText(event?.type || '', 100);
    const timestamp = safeText(event?.timestamp || '', 80);
    return eventTypes.has(type) && /^\d{4}-\d{2}-\d{2}T/.test(timestamp) && Number.isFinite(Date.parse(timestamp))
      ? { event, index, type, id: eventId(sessionId, index, type) }
      : null;
  }).filter(Boolean);
  const eventIdsByRawId = new Map(projected.filter(item => item.event.id).map(item => [item.event.id, item.id]));
  const agentNames = new Map();
  const toolStarts = new Map();
  for (const { event } of projected) {
    if (event.agentId && (event.data?.agentName || event.data?.agentDisplayName)) {
      agentNames.set(event.agentId, safeText(event.data.agentDisplayName || event.data.agentName, 200));
    }
    if (event.type === 'tool.execution_start' && event.data?.toolCallId) {
      toolStarts.set(`${event.agentId || 'parent'}:${event.data.toolCallId}`, event.data);
    }
  }
  const rows = [];
  for (const { event, index, type, id } of projected) {
    const timestamp = event.timestamp;
    const toolContext = event.data?.toolCallId ? toolStarts.get(`${event.agentId || 'parent'}:${event.data.toolCallId}`) : null;
    const operation = operationFields(event, root, referencePaths, toolContext || {});
    if (operation.ExitCode === undefined) delete operation.ExitCode;
    const parentEventId = event.parentId ? eventIdsByRawId.get(event.parentId) || safeText(event.parentId, 200) : '';
    const agentId = safeText(event.agentId || '', 200);
    const parentToolCallId = safeText(event.data?.parentToolCallId || (type.startsWith('subagent.') ? event.data?.toolCallId : '') || toolContext?.parentToolCallId || '', 200);
    const parentAgentId = parentToolCallId
      ? safeText(projected.find(item => item.event.data?.toolCallId === parentToolCallId && item.event.agentId !== event.agentId)?.event.agentId || '', 200)
      : '';
    const parentAgentName = parentAgentId ? agentNames.get(parentAgentId) || '' : '';
    if (agentId && !operation.AgentName) operation.AgentName = agentNames.get(agentId) || '';
    operation.ParentAgentName = parentAgentName;
    rows.push({
      TimeGenerated: new Date(timestamp).toISOString(),
      Sequence: index + 1,
      EventId: id,
      ParentEventId: parentEventId,
      AgentId: agentId,
      ParentAgentId: parentAgentId,
      ParentToolCallId: parentToolCallId,
      RunId: runId,
      SessionId: sessionId,
      TraceId: '',
      EventName: type,
      SpanName: type,
      ...operation,
      InputTokens: operation.InputTokens === null ? null : (Number.isSafeInteger(operation.InputTokens) ? operation.InputTokens : null),
      OutputTokens: operation.OutputTokens === null ? null : (Number.isSafeInteger(operation.OutputTokens) ? operation.OutputTokens : null),
      CacheReadTokens: operation.CacheReadTokens === null ? null : (Number.isSafeInteger(operation.CacheReadTokens) ? operation.CacheReadTokens : null),
      CacheWriteTokens: operation.CacheWriteTokens === null ? null : (Number.isSafeInteger(operation.CacheWriteTokens) ? operation.CacheWriteTokens : null),
      DurationMs: Number.isSafeInteger(operation.DurationMs) ? operation.DurationMs : 0,
      ContentCaptureSignal: false,
      ContentCaptureMode: 'off',
      PrivacyMode: 'strict',
      Surface: 'cli',
      SchemaVersion: '2'
    });
  }
  return rows;
}

function writeSessionEvents(events, sessionId, runId, outputPath, options = {}) {
  if (!outputPath) throw new Error('copilot-session export-events requires --output <directory-or-jsonl>');
  const output = path.resolve(outputPath);
  const file = output.endsWith('.jsonl') ? output : path.join(output, 'AgentOpsEvents_CL.jsonl');
  const rows = projectSessionEvents(events, { ...options, sessionId, runId });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`, { flag: 'wx', mode: 0o600 });
  return { output: file, rows: rows.length };
}

module.exports = {
  attachmentReferencePaths,
  attachmentSkillReferences,
  directShellPathRead,
  eventId,
  operationFields,
  projectSessionEvents,
  safeRepoPath,
  writeSessionEvents
};
