const { byteSize, contentSignal, stableHash } = require('./privacy');
const { createSafeEventNormalizer } = require('./event-envelope');

const sessionEventTypes = [
  'assistant.turn_start',
  'assistant.intent',
  'assistant.reasoning',
  'assistant.reasoning_delta',
  'assistant.message',
  'assistant.message_delta',
  'assistant.turn_end',
  'assistant.usage',
  'assistant.streaming_delta',
  'permission.requested',
  'permission.completed',
  'user_input.requested',
  'user_input.completed',
  'elicitation.requested',
  'elicitation.completed',
  'tool.execution_start',
  'tool.execution_partial_result',
  'tool.execution_progress',
  'tool.execution_complete',
  'tool.user_requested',
  'subagent.started',
  'subagent.completed',
  'subagent.failed',
  'subagent.selected',
  'subagent.deselected',
  'skill.invoked',
  'session.context_changed',
  'session.idle',
  'session.title_changed',
  'session.usage_info',
  'session.session_limits_changed',
  'session.usage_checkpoint',
  'session.compaction_start',
  'session.compaction_complete',
  'session.task_complete',
  'session.shutdown',
  'session.error',
  'abort',
  'user.message',
  'system.message',
  'external_tool.requested',
  'external_tool.completed',
  'exit_plan_mode.requested',
  'exit_plan_mode.completed',
  'command.queued',
  'command.completed',
  'session_limits_exhausted.requested',
  'session_limits_exhausted.completed'
];

const contentKeys = new Set([
  'content', 'message', 'reasoning', 'reasoningText', 'reasoningOpaque',
  'encryptedContent', 'deltaContent', 'intent', 'summary', 'summaryContent',
  'prompt', 'question', 'args', 'arguments', 'result', 'output', 'partialOutput',
  'progressMessage', 'toolRequests', 'title', 'path', 'cwd', 'gitRoot', 'repository',
  'branch', 'checkpointPath', 'stack', 'error', 'errorMessage', 'errorReason',
  'permissionRequest', 'requestedSchema', 'choices', 'attachments', 'planContent',
  'actions', 'transformedContent', 'metadata', 'agentDescription'
]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeName(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).slice(0, 200);
}

function droppedContent(data = {}) {
  const observed = [];
  for (const [key, value] of Object.entries(data)) {
    if (!contentKeys.has(key) || value === undefined || value === null || byteSize(value) === 0) continue;
    observed.push({ key, signal: contentSignal(value, key) });
  }
  return {
    observed: observed.length > 0,
    bytes: observed.reduce((total, item) => total + byteSize(data[item.key]), 0),
    secretLike: observed.some(item => item.signal.secretLike)
  };
}

function commandMetadata(data = {}) {
  const args = data.args || data.arguments || {};
  const raw = typeof args === 'object'
    ? (args.command || args.cmd || args.script || (Array.isArray(args.argv) ? args.argv.join(' ') : ''))
    : '';
  const commandText = raw || data.command || data.permissionRequest?.fullCommandText || '';
  if (typeof commandText !== 'string' || !commandText.trim()) return {};
  const first = commandText.trim().split(/\s+/)[0].replace(/^['"]|['"]$/g, '');
  const command = first.split('/').pop();
  if (!/^[A-Za-z0-9._+-]{1,100}$/.test(command)) return {};
  const fields = { CommandName: command };
  if (/\.(?:sh|bash|zsh|ps1|py|js|mjs|cjs|ts)$/i.test(command)) fields.ScriptName = command;
  const tokens = commandText.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const interpreter = command.toLowerCase();
  if (['node', 'python', 'python3', 'bash', 'zsh', 'sh', 'pwsh', 'powershell'].includes(interpreter)) {
    const token = tokens.slice(1).find(item => !item.startsWith('-'));
    const script = token ? token.replace(/^['"]|['"]$/g, '').split('/').pop() : '';
    if (/^[A-Za-z0-9._+-]{1,100}\.(?:sh|bash|zsh|ps1|py|js|mjs|cjs|ts)$/i.test(script)) fields.ScriptName = script;
  } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(interpreter) && tokens[1] === 'run') {
    const task = String(tokens[2] || '').replace(/^['"]|['"]$/g, '');
    if (/^[A-Za-z0-9._:+-]{1,100}$/.test(task)) fields.ScriptName = `${interpreter}:run:${task}`;
  }
  return fields;
}

function statusFor(type, data = {}) {
  if (type.endsWith('.failed') || type === 'session.error' || data.success === false) return 'failed';
  if (type === 'abort') return 'aborted';
  if (type.endsWith('_start') || type.endsWith('.started') || type.endsWith('.requested') || type.endsWith('.queued')) return 'started';
  if (type === 'permission.completed') return safeName(data.permissionDecision || data.decision || data.result?.kind, 'completed');
  return 'completed';
}

function createAgentOpsSessionObserver(options = {}) {
  const context = {
    runId: options.runId || stableHash(`${Date.now()}:${Math.random()}`, 'run'),
    sessionId: options.sessionId || stableHash(`${Date.now()}:session`, 'session'),
    traceId: options.traceId || stableHash(`${Date.now()}:trace`, 'trace'),
    privacyMode: options.privacyMode || 'strict',
    contentCaptureMode: options.captureContent ? 'redacted' : 'off'
  };
  const emit = typeof options.emit === 'function' ? options.emit : () => {};
  const normalizeEvent = options.normalizeEvent || createSafeEventNormalizer({ context });
  const starts = new Map();

  function observe(event = {}) {
    const type = safeName(event.type, 'unknown');
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const time = timestamp(event.timestamp);
    const eventId = stableHash(event.id || `${context.sessionId}:${type}:${time}`, 'event');
    const parentEventId = event.parentId ? stableHash(event.parentId, 'event') : '';
    const toolCallId = data.toolCallId || data.parentToolCallId || '';
    const identity = toolCallId || data.requestId || data.agentId || data.agentName || data.name || type;
    const startKey = `${type.replace(/(?:_start|_complete|\.started|\.completed|\.failed|\.requested|\.queued)$/, '')}:${identity}`;
    const eventTimeMs = new Date(time).getTime();
    const started = starts.get(startKey);
    const duration = number(data.durationMs || data.duration) || (started ? Math.max(0, eventTimeMs - started.time) : 0);
    const content = droppedContent(data);
    const permission = data.permissionRequest && typeof data.permissionRequest === 'object' ? data.permissionRequest : {};
    const toolName = safeName(data.toolName || data.name || permission.toolName || started?.toolName);
    const mcpServerName = safeName(data.mcpServerName || permission.serverName || started?.mcpServerName);
    const mcpToolName = safeName(data.mcpToolName || permission.toolName || started?.mcpToolName);
    const command = Object.keys(commandMetadata(data)).length ? commandMetadata(data) : (started?.command || {});
    // The official SDK repeats usage totals on several lifecycle events. Keep
    // one canonical accounting row so Azure/dashboard sums do not double count.
    const usage = type === 'assistant.usage' ? data : {};
    const row = {
      TimeGenerated: time,
      EventId: eventId,
      ParentEventId: parentEventId,
      RunId: context.runId,
      SessionId: context.sessionId,
      TraceId: context.traceId,
      Surface: 'sdk',
      SchemaVersion: '2',
      EventName: type,
      SpanName: type,
      Status: statusFor(type, data),
      AgentName: safeName(event.agentId || data.agentName || data.agentId),
      ParentAgentName: safeName(data.parentAgentName || data.parentAgentId),
      SubAgentName: type.startsWith('subagent.') ? safeName(data.agentName || data.agentId || data.name) : '',
      SkillName: type === 'skill.invoked' ? safeName(data.name || data.skillName) : '',
      ToolName: toolName,
      McpServerName: mcpServerName,
      McpToolName: mcpToolName,
      ModelActual: safeName(data.model || data.currentModel || started?.model),
      InputTokens: number(usage.inputTokens),
      OutputTokens: number(usage.outputTokens),
      ReasoningTokens: number(usage.reasoningTokens),
      CacheReadTokens: number(usage.cacheReadTokens),
      CacheWriteTokens: number(usage.cacheWriteTokens),
      TotalTokens: number(usage.totalTokens),
      TotalToolCalls: number(usage.totalToolCalls),
      CopilotCost: number(usage.cost),
      EstimatedCostUsd: options.usdPerCostUnit ? number(usage.cost) * number(options.usdPerCostUnit) : 0,
      DurationMs: Math.round(duration),
      PermissionKind: type === 'permission.requested' ? safeName(permission.kind) : '',
      PermissionDecision: type === 'permission.completed' ? safeName(data.permissionDecision || data.decision || data.result?.kind) : '',
      ErrorType: type === 'session.error' ? safeName(data.errorType, 'error') : '',
      PremiumRequests: number(usage.totalPremiumRequests),
      TotalNanoAiu: number(usage.totalNanoAiu),
      ApiDurationMs: number(usage.totalApiDurationMs),
      LinesAdded: number(data.codeChanges?.linesAdded),
      LinesRemoved: number(data.codeChanges?.linesRemoved),
      FilesModified: number(data.codeChanges?.filesModified),
      ContentCaptureSignal: content.observed,
      ContentDroppedBytes: content.bytes,
      ContentAction: content.observed ? 'dropped' : 'none',
      SecretLike: content.secretLike,
      PrivacyMode: context.privacyMode,
      ContentCaptureMode: context.contentCaptureMode,
      RepoHash: data.repository ? stableHash(data.repository, 'repo') : '',
      BranchHash: data.branch ? stableHash(data.branch, 'branch') : '',
      WorkingDirectoryHash: data.cwd ? stableHash(data.cwd, 'cwd') : '',
      ...command
    };
    if (type.endsWith('_start') || type.endsWith('.started') || type.endsWith('.requested')) {
      starts.set(startKey, {
        time: eventTimeMs,
        toolName,
        mcpServerName,
        mcpToolName,
        model: row.ModelActual,
        command
      });
    } else if (type.endsWith('_complete') || type.endsWith('.completed') || type.endsWith('.failed')) {
      starts.delete(startKey);
    }
    const normalized = normalizeEvent(row);
    emit(normalized);
    if (type === 'session.shutdown' || type === 'session.error') starts.clear();
    return normalized;
  }

  function attach(session) {
    if (!session || typeof session.on !== 'function') throw new Error('AgentOps session observer requires a Copilot session with session.on()');
    const handler = event => observe(event);
    const result = session.on(handler);
    let detach = () => {};
    if (typeof result === 'function') detach = result;
    else if (result && typeof result.dispose === 'function') detach = () => result.dispose();
    else if (typeof session.off === 'function') detach = () => session.off(handler);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      detach();
      starts.clear();
    };
  }

  return { attach, observe, context: { ...context }, eventTypes: [...sessionEventTypes] };
}

module.exports = { createAgentOpsSessionObserver, sessionEventTypes };
