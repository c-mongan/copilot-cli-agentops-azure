const path = require('node:path');

const { writeJsonFile, writeJsonlFile } = require('../command-output');
const { tableNames } = require('../demo/agentops-demo-data');
const { prefixedHashOrEmpty: stableHash } = require('../hash');
const { AGENTOPS_SCHEMA_VERSION, sensitiveContentAttributes } = require('../schema/agentops-attributes');
const { readJsonlRows } = require('../json');
const { isSpanTelemetryRow, operationFromRow, telemetryTime } = require('../session-row-utils');

function rowAttributes(row) {
  const attrs = row.attributes || row.Properties || row.properties || {};
  if (typeof attrs !== 'string') return attrs;
  try {
    return JSON.parse(attrs);
  } catch {
    return {};
  }
}

function attr(attrs, keys, fallback = '') {
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== '') return attrs[key];
  }
  return fallback;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function boolValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function operation(row, attrs) {
  return operationFromRow(row, attrs);
}

function timestamp(row, index, baseTime) {
  const value = telemetryTime(row.TimeGenerated || row.timestamp || row.time || row.startTime);
  if (value && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return new Date(baseTime.getTime() + index * 1000).toISOString();
}

function endTimestamp(row, index, baseTime) {
  const value = telemetryTime(row.endTime || row.EndTime || row.end_time);
  if (value && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return timestamp(row, index, baseTime);
}

function rowDurationMs(row, index, baseTime) {
  const explicit = numberValue(row.DurationMs ?? row.durationMs ?? row.duration_ms);
  if (explicit > 0) return explicit;
  const start = new Date(timestamp(row, index, baseTime)).getTime();
  const end = new Date(endTimestamp(row, index, baseTime)).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function failed(row, attrs) {
  const status = row.Status ?? row.status?.code ?? row.status ?? row.ResultCode ?? row.resultCode;
  const success = row.Success ?? row.success;
  if (success === false || String(success).toLowerCase() === 'false') return true;
  if (['failed', 'failure', 'error', 'blocked', 'degraded'].includes(String(status || '').toLowerCase())) return true;
  const outcome = String(attr(attrs, ['agentops.outcome', 'agentops.outcome.status'], '')).toLowerCase();
  if (/failed|failure|error|blocked|denied|aborted/.test(outcome)) return true;
  return Boolean(attr(attrs, ['error.type', 'exception.type', 'error'], ''));
}

function riskForTool(tool) {
  const value = String(tool || '').toLowerCase();
  if (/secret|keychain|credential|token|ssh/.test(value)) return 'secret-access';
  if (/rm|delete|destroy|remove|drop/.test(value)) return 'destructive';
  if (/browser|playwright/.test(value)) return 'browser-control';
  if (/shell|bash|terminal|exec/.test(value)) return 'shell';
  if (/write|edit|patch/.test(value)) return 'write-file';
  if (/http|fetch|curl|network/.test(value)) return 'network';
  return 'read-only';
}

function mcpServerFromTool(tool) {
  const value = String(tool || '');
  const mcpMatch = value.match(/^mcp__([^_]+)__/);
  if (mcpMatch) return mcpMatch[1];
  if (value.includes('/')) return value.split('/')[0];
  if (value.startsWith('azure-mcp')) return 'azure-mcp';
  return '';
}

function mcpToolName(tool) {
  const value = String(tool || '');
  const mcpMatch = value.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];
  if (value.includes('/')) return value.split('/').slice(1).join('/') || value;
  return value;
}

function isMcpSpan(op, attrs, tool) {
  return op === 'mcp.tools.call'
    || Boolean(attr(attrs, ['agentops.mcp.server', 'agentops.mcp.tool', 'mcp.method.name', 'mcp.session.id', 'mcp.server.name', 'agentops.mcp.server.hash'], ''))
    || /^mcp__[^_]+__/.test(String(tool || ''));
}

function githubBool(attrs, keys) {
  return boolValue(attr(attrs, keys, false));
}

function firstAttr(items, keys, fallback = '') {
  for (const item of items) {
    const value = attr(item.attrs, keys, '');
    if (value !== '') return value;
  }
  return fallback;
}

function contentSignals(attrs) {
  return sensitiveContentAttributes
    .filter(key => attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== '')
    .map(key => ({
      kind: key.includes('tool') ? 'tool_args' : key.includes('body') ? 'body' : key.includes('url') ? 'url' : 'prompt',
      attribute: key
    }));
}

function sdkContentSignal(attrs) {
  if (!boolValue(attr(attrs, ['agentops.content_capture.signal'], false))) return null;
  return {
    kind: String(attr(attrs, ['agentops.content.kind'], 'metadata')),
    action: String(attr(attrs, ['agentops.content.action'], 'dropped')),
    droppedBytes: numberValue(attr(attrs, ['agentops.content.dropped_bytes'], 0)),
    secretLike: boolValue(attr(attrs, ['agentops.content.secret_like'], false))
  };
}

function emptyTables() {
  return Object.fromEntries(tableNames.map(name => [name, []]));
}

function addEvent(tables, run, row, attrs, index, baseTime, sequence) {
  const op = operation(row, attrs);
  const tool = attr(attrs, ['gen_ai.tool.name', 'tool'], '');
  const rawEventId = row.Id || row.id || row.SpanId || row.spanId || `${run.RunId}:${sequence}:${op}`;
  const rawParentId = row.ParentId || row.parentId || row.ParentSpanId || row.parentSpanId || '';
  const explicitEventId = attr(attrs, ['agentops.custom_event_id'], '');
  const explicitParentId = attr(attrs, ['agentops.parent_event_id'], '');
  const safeSignal = sdkContentSignal(attrs);
  tables.AgentOpsEvents_CL.push({
    TimeGenerated: timestamp(row, index, baseTime),
    Sequence: numberValue(attr(attrs, ['agentops.event.sequence'], sequence)) || sequence,
    EventId: String(explicitEventId || stableHash(rawEventId, 'event')),
    ParentEventId: String(explicitParentId || (rawParentId ? stableHash(rawParentId, 'event') : '')),
    RunId: run.RunId,
    SessionId: run.SessionId,
    TraceId: run.TraceId,
    Surface: run.Surface,
    EventName: op,
    SpanName: row.Name || row.name || op,
    AgentName: run.AgentName,
    SkillName: run.SkillName || '',
    ParentAgentName: run.ParentAgentName || '',
    SubAgentName: run.SubAgentName || '',
    DelegationId: run.DelegationId || '',
    ToolName: tool,
    McpServerName: String(attr(attrs, ['agentops.mcp.server', 'mcp.server.name'], '')),
    McpToolName: String(attr(attrs, ['agentops.mcp.tool'], '')),
    CommandName: String(attr(attrs, ['agentops.command.name'], '')),
    ScriptName: String(attr(attrs, ['agentops.script.name'], '')),
    ModelActual: run.ModelActual,
    Status: failed(row, attrs) ? 'failed' : 'success',
    DurationMs: rowDurationMs(row, index, baseTime),
    InputTokens: numberValue(attr(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens'], 0)),
    OutputTokens: numberValue(attr(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens'], 0)),
    ReasoningTokens: numberValue(attr(attrs, ['gen_ai.usage.reasoning.output_tokens'], 0)),
    CacheReadTokens: numberValue(attr(attrs, ['gen_ai.usage.cache_read.input_tokens'], 0)),
    CacheWriteTokens: numberValue(attr(attrs, ['gen_ai.usage.cache_creation.input_tokens'], 0)),
    TotalTokens: numberValue(attr(attrs, ['gen_ai.usage.total_tokens'], 0)),
    TotalToolCalls: numberValue(attr(attrs, ['agentops.tools.count'], 0)),
    CopilotCost: numberValue(attr(attrs, ['github.copilot.cost'], 0)),
    EstimatedCostUsd: numberValue(attr(attrs, ['agentops.cost.estimated_usd'], 0)),
    PermissionKind: String(attr(attrs, ['agentops.permission.kind'], '')),
    PermissionDecision: String(attr(attrs, ['agentops.permission.decision'], '')),
    ErrorType: String(attr(attrs, ['error.type', 'exception.type'], '')),
    PremiumRequests: numberValue(attr(attrs, ['github.copilot.premium_requests'], 0)),
    TotalNanoAiu: numberValue(attr(attrs, ['github.copilot.aiu.nano'], 0)),
    ApiDurationMs: numberValue(attr(attrs, ['agentops.api.duration_ms'], 0)),
    LinesAdded: numberValue(attr(attrs, ['agentops.lines.added'], 0)),
    LinesRemoved: numberValue(attr(attrs, ['agentops.lines.removed'], 0)),
    FilesModified: numberValue(attr(attrs, ['agentops.files.edited_count'], 0)),
    PrivacyMode: run.PrivacyMode,
    ContentCaptureSignal: Boolean(safeSignal || contentSignals(attrs).length > 0),
    ContentDroppedBytes: safeSignal?.droppedBytes || 0,
    ContentAction: safeSignal?.action || '',
    SecretLike: safeSignal?.secretLike || false,
    ContentCaptureMode: String(attr(attrs, ['agentops.content_capture.mode'], run.ContentCaptureMode)),
    RepoHash: String(attr(attrs, ['agentops.repo.hash'], run.RepoHash)),
    BranchHash: String(attr(attrs, ['agentops.branch.hash'], run.BranchHash)),
    WorkingDirectoryHash: String(attr(attrs, ['agentops.workspace.hash'], ''))
  });
}

function rollupSpanRows(rows, options = {}) {
  const tables = emptyTables();
  const baseTime = options.baseTime ? new Date(options.baseTime) : new Date();
  const sessions = new Map();

  let currentSessionId = null;
  rows.filter(isSpanTelemetryRow).forEach((row, index) => {
    const attrs = rowAttributes(row);
    let sessionId = row.SessionId
      || row.session
      || row.conversation
      || attr(attrs, ['agentops.session.id', 'agentops.wrapper.session_id', 'gen_ai.conversation.id', 'github.copilot.interaction_id'], 'unknown-session');
    if (sessionId === 'unknown-session' && currentSessionId) sessionId = currentSessionId;
    if (sessionId !== 'unknown-session') currentSessionId = sessionId;
    if (!sessions.has(sessionId)) sessions.set(sessionId, []);
    sessions.get(sessionId).push({ row, attrs, index });
  });

  for (const [sessionId, items] of sessions.entries()) {
    items.sort((left, right) => (
      new Date(timestamp(left.row, left.index, baseTime)).getTime()
      - new Date(timestamp(right.row, right.index, baseTime)).getTime()
    ));
    const first = items[0];
    const runId = attr(first.attrs, ['agentops.run.id', 'agentops.wrapper.run_id'], stableHash(sessionId, 'run'));
    const traceId = first.row.OperationId || first.row.TraceId || first.row.traceId || stableHash(`${sessionId}:trace`, 'trace');
    const repoHash = firstAttr(items, ['agentops.repo.hash'], stableHash(options.repo || 'unknown-repo', 'repo'));
    const branchHash = firstAttr(items, ['agentops.branch.hash'], stableHash(options.branch || 'unknown-branch', 'branch'));
    const agentName = firstAttr(items, ['agentops.agent.name', 'gen_ai.agent.name', 'gen_ai.agent.id']);
    const skillName = firstAttr(items, ['agentops.skill.name', 'github.copilot.skill.name']);
    const parentAgentName = firstAttr(items, ['agentops.parent_agent.name', 'agentops.parent.agent.name']);
    const subAgentName = firstAttr(items, ['agentops.sub_agent.name', 'agentops.child_agent.name']);
    const delegationId = firstAttr(items, ['agentops.delegation.id']);
    const model = firstAttr(items, ['agentops.model.actual', 'gen_ai.response.model', 'gen_ai.request.model']);
    const started = timestamp(first.row, first.index, baseTime);
    const ended = items
      .map(item => endTimestamp(item.row, item.index, baseTime))
      .sort((left, right) => new Date(right) - new Date(left))[0];
    const durationMs = Math.max(0, new Date(ended).getTime() - new Date(started).getTime());

    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let tokensRemoved = 0;
    let permissionWaitMs = 0;
    let contextWindowPct = 0;
    let estimatedCostUsd = 0;
    let toolCount = 0;
    let toolFailureCount = 0;
    let toolDeniedCount = 0;
    let failures = 0;
    let privacyDrops = 0;
    let directFilesModified = 0;
    const tools = new Set();
    const chatItems = items.filter(item => operation(item.row, item.attrs) === 'chat');
    const usageItems = chatItems.length > 0
      ? chatItems
      : (() => {
          const invokeItems = items.filter(item => operation(item.row, item.attrs) === 'invoke_agent');
          return invokeItems.length > 0
            ? invokeItems
            : items.filter(item => operation(item.row, item.attrs) === 'assistant.usage');
        })();

    const run = {
      TimeGenerated: ended,
      RunId: runId,
      SessionId: sessionId,
      TraceId: traceId,
      Surface: String(attr(first.attrs, ['agentops.surface'], options.surface || 'cli')),
      RepoHash: repoHash,
      BranchHash: branchHash,
      TaskType: String(attr(first.attrs, ['agentops.task.type'], 'unknown')),
      AgentName: String(agentName),
      SkillName: String(skillName),
      ParentAgentName: String(parentAgentName),
      SubAgentName: String(subAgentName),
      DelegationId: String(delegationId),
      ModelRequested: String(attr(first.attrs, ['agentops.model.requested', 'gen_ai.request.model'], model)),
      ModelActual: String(model),
      PrivacyMode: 'strict',
      ContentCaptureMode: 'off',
      ContentCaptureSignal: false
    };

    for (const [sequenceIndex, item] of items.entries()) {
      const { row, attrs, index } = item;
      const op = operation(row, attrs);
      const tool = attr(attrs, ['gen_ai.tool.name', 'tool'], '');
      const rowFailed = failed(row, attrs);
      const signals = contentSignals(attrs);
      const safeSignal = sdkContentSignal(attrs);
      const eventName = String(attr(attrs, ['agentops.event.name'], op));
      const permissionDecision = String(attr(attrs, ['agentops.permission.decision'], '')).toLowerCase();
      const permissionDenied = /denied|reject|blocked/.test(permissionDecision);
      const toolLifecycleStart = eventName === 'tool.execution_start';

      if (usageItems.includes(item)) {
        inputTokens += numberValue(attr(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens'], 0));
        outputTokens += numberValue(attr(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens'], 0));
        reasoningTokens += numberValue(attr(attrs, ['gen_ai.usage.reasoning.output_tokens'], 0));
        cacheReadTokens += numberValue(attr(attrs, ['agentops.cache.read_input_tokens', 'gen_ai.usage.cache_read.input_tokens', 'CacheReadTokens', 'CacheRead'], 0));
        cacheCreationTokens += numberValue(attr(attrs, ['agentops.cache.creation_input_tokens', 'gen_ai.usage.cache_creation.input_tokens', 'CacheCreationTokens'], 0));
        const explicitCost = numberValue(attr(attrs, ['agentops.cost.estimated_usd'], 0));
        const credits = numberValue(attr(attrs, ['github.copilot.cost'], 0));
        estimatedCostUsd += explicitCost || credits * 0.01;
      }
      tokensRemoved += numberValue(attr(attrs, ['agentops.context.tokens_removed', 'github.copilot.tokens_removed', 'TokensRemoved'], 0));
      permissionWaitMs += numberValue(attr(attrs, ['agentops.permission.wait_ms', 'github.copilot.permission.wait_ms', 'PermissionWaitMs'], 0));
      contextWindowPct = Math.max(contextWindowPct, numberValue(attr(attrs, ['agentops.context.window_pct', 'github.copilot.context.window_pct', 'ContextWindowPct'], 0)));
      directFilesModified = Math.max(directFilesModified, numberValue(attr(attrs, ['agentops.files.edited_count'], 0)));
      if (rowFailed) failures += 1;
      if (permissionDenied) toolDeniedCount += 1;

      if ((op === 'execute_tool' || tool) && !toolLifecycleStart) {
        const risk = riskForTool(tool);
        const allowed = !permissionDenied && boolValue(attr(attrs, ['agentops.mcp.allowed'], true));
        toolCount += 1;
        tools.add(String(tool || 'tool'));
        if (rowFailed) toolFailureCount += 1;
        if (allowed === false && !permissionDenied) toolDeniedCount += 1;
        tables.AgentOpsToolCalls_CL.push({
          TimeGenerated: timestamp(row, index, baseTime),
          RunId: runId,
          TraceId: traceId,
          SpanId: row.Id || row.id || stableHash(`${runId}:tool:${index}`, 'span'),
          Surface: run.Surface,
          ToolName: String(tool || 'tool'),
          ToolType: risk,
          ToolRisk: risk,
          Allowed: allowed,
          DeniedReason: allowed ? '' : String(attr(attrs, ['agentops.mcp.denied_reason'], 'policy_denied')),
          Status: rowFailed ? 'failed' : 'success',
          DurationMs: rowDurationMs(row, index, baseTime),
          ErrorType: String(attr(attrs, ['error.type', 'exception.type', 'error'], '')),
          OutputSizeBytes: numberValue(attr(attrs, ['agentops.tool.result_size_bytes', 'agentops.mcp.result_size_bytes'], 0)),
          AgentName: run.AgentName,
          ArgsSchemaHash: String(attr(attrs, ['agentops.tool.args_schema_hash', 'agentops.mcp.args_schema_hash'], stableHash(`${tool}:schema`, 'schema')))
        });

        if (isMcpSpan(op, attrs, tool)) {
          const serverName = String(attr(attrs, ['agentops.mcp.server', 'mcp.server.name'], mcpServerFromTool(tool) || 'unknown-mcp'));
          const resultSize = numberValue(attr(attrs, ['agentops.tool.result_size_bytes', 'agentops.mcp.result_size_bytes'], 0));
          tables.AgentOpsMcpCalls_CL.push({
            TimeGenerated: timestamp(row, index, baseTime),
            RunId: runId,
            TraceId: traceId,
            SpanId: row.Id || row.id || stableHash(`${runId}:mcp:${index}`, 'span'),
            McpSessionId: String(attr(attrs, ['mcp.session.id'], stableHash(`${sessionId}:mcp`, 'mcp_session'))),
            McpServerName: serverName,
            McpServerHash: String(attr(attrs, ['agentops.mcp.server.hash'], stableHash(serverName, 'mcp_server'))),
            McpClientName: String(attr(attrs, ['mcp.client.name'], 'unknown-client')),
            McpTransport: String(attr(attrs, ['mcp.transport'], 'unknown')),
            Surface: run.Surface,
            AgentName: run.AgentName,
            ToolName: String(attr(attrs, ['agentops.mcp.tool'], mcpToolName(tool || attr(attrs, ['gen_ai.tool.name'], 'tool')))),
            ToolType: risk,
            ToolRisk: String(attr(attrs, ['agentops.mcp.tool.risk'], risk)),
            Allowed: allowed,
            DeniedReason: allowed ? '' : String(attr(attrs, ['agentops.mcp.denied_reason'], 'policy_denied')),
            Sandboxed: boolValue(attr(attrs, ['agentops.mcp.sandboxed'], false)),
            Status: rowFailed ? 'failed' : 'success',
            DurationMs: rowDurationMs(row, index, baseTime),
            OutputSizeBytes: resultSize,
            ResultSizeBytes: resultSize,
            ArgsSchemaHash: String(attr(attrs, ['agentops.tool.args_schema_hash', 'agentops.mcp.args_schema_hash'], stableHash(`${serverName}:${tool}:schema`, 'schema')))
          });
        }
      }

      for (const signal of signals) {
        privacyDrops += 1;
        tables.AgentOpsPrivacy_CL.push({
          TimeGenerated: timestamp(row, index, baseTime),
          RunId: runId,
          TraceId: traceId,
          PrivacyMode: 'strict',
          ContentKind: signal.kind,
          Observed: true,
          Action: 'dropped',
          DroppedCount: 1,
          RedactedCount: 0,
          LeakDetected: false
        });
      }
      if (safeSignal) {
        privacyDrops += 1;
        tables.AgentOpsPrivacy_CL.push({
          TimeGenerated: timestamp(row, index, baseTime),
          RunId: runId,
          TraceId: traceId,
          PrivacyMode: String(attr(attrs, ['agentops.privacy.mode'], 'strict')),
          ContentKind: safeSignal.kind,
          Observed: true,
          Action: safeSignal.action,
          DroppedCount: 1,
          RedactedCount: safeSignal.action === 'redacted' ? 1 : 0,
          LeakDetected: false
        });
      }

      addEvent(tables, run, row, attrs, index, baseTime, sequenceIndex + 1);
    }

    run.ContentCaptureMode = privacyDrops > 0 ? 'signal_only' : 'off';
    run.ContentCaptureSignal = privacyDrops > 0;
    run.OutcomeStatus = failures > 0 ? 'failed' : 'success';
    run.OutcomeReason = failures > 0 ? 'span_failure' : 'completed';
    run.DurationMs = durationMs;
    run.InputTokens = inputTokens;
    run.OutputTokens = outputTokens;
    run.ReasoningTokens = reasoningTokens;
    run.CacheReadTokens = cacheReadTokens;
    run.CacheCreationTokens = cacheCreationTokens;
    run.ContextWindowPct = contextWindowPct;
    run.TokensRemoved = tokensRemoved;
    run.PermissionWaitMs = permissionWaitMs;
    run.EstimatedCostUsd = Number(estimatedCostUsd.toFixed(4));
    run.ToolCount = toolCount;
    run.ToolFailureCount = toolFailureCount;
    run.ToolDeniedCount = toolDeniedCount;
    run.TestsRan = [...tools].some(tool => /test|lint|typecheck/i.test(tool));
    run.TestsPassed = run.TestsRan && toolFailureCount === 0;
    run.FilesReadCount = [...tools].filter(tool => /read/i.test(tool)).length;
    run.FilesEditedCount = directFilesModified || [...tools].filter(tool => /edit|write|patch/i.test(tool)).length;
    run.PrOpened = items.some(item => githubBool(item.attrs, ['agentops.pr.opened', 'github.pr.opened', 'github.pull_request.opened']));
    run.PrNumberHash = String(attr(items.find(item => attr(item.attrs, ['agentops.pr.number_hash', 'github.pr.number_hash'], ''))?.attrs || {}, ['agentops.pr.number_hash', 'github.pr.number_hash'], ''));
    run.CiStatus = String(attr(items.find(item => attr(item.attrs, ['agentops.ci.status', 'github.ci.status'], ''))?.attrs || {}, ['agentops.ci.status', 'github.ci.status'], run.PrOpened ? 'unknown' : 'not_run'));
    run.EvalOverall = failures > 0 ? 50 : 85;
    run.RiskScore = Math.min(100, toolFailureCount * 20 + toolDeniedCount * 30 + privacyDrops * 15);
    tables.AgentOpsRunSummary_CL.push(run);

    if (run.PrOpened || items.some(item => attr(item.attrs, ['agentops.ci.status', 'github.ci.status', 'agentops.pr.number_hash'], ''))) {
      const outcomeAttrs = items.find(item => (
        githubBool(item.attrs, ['agentops.pr.opened', 'github.pr.opened', 'github.pull_request.opened'])
        || attr(item.attrs, ['agentops.ci.status', 'github.ci.status', 'agentops.pr.number_hash', 'github.pr.number_hash'], '')
      ))?.attrs || {};
      tables.AgentOpsGithubOutcomes_CL.push({
        TimeGenerated: ended,
        RunId: runId,
        RepoHash: repoHash,
        BranchHash: branchHash,
        PrOpened: run.PrOpened,
        PrNumberHash: run.PrNumberHash || String(attr(outcomeAttrs, ['agentops.pr.number_hash', 'github.pr.number_hash'], stableHash(`${runId}:pr`, 'pr'))),
        PrMerged: githubBool(outcomeAttrs, ['agentops.pr.merged', 'github.pr.merged', 'github.pull_request.merged']),
        PrClosed: githubBool(outcomeAttrs, ['agentops.pr.closed', 'github.pr.closed', 'github.pull_request.closed']),
        PrReverted: githubBool(outcomeAttrs, ['agentops.pr.reverted', 'github.pr.reverted']),
        CiStatus: run.CiStatus,
        ReviewCommentCount: numberValue(attr(outcomeAttrs, ['agentops.pr.review_comment_count', 'github.review_comment_count'], 0)),
        CommitCount: numberValue(attr(outcomeAttrs, ['agentops.pr.commit_count', 'github.commit_count'], 0)),
        FilesChangedCount: numberValue(attr(outcomeAttrs, ['agentops.pr.files_changed_count', 'github.files_changed_count'], run.FilesEditedCount))
      });
    }

    tables.AgentOpsEval_CL.push({
      TimeGenerated: ended,
      RunId: runId,
      TraceId: traceId,
      RepoHash: repoHash,
      ModelActual: run.ModelActual,
      TaskType: run.TaskType,
      EvalOverall: run.EvalOverall,
      TestDiscipline: run.FilesEditedCount > 0 && !run.TestsRan ? 35 : 80,
      Security: privacyDrops > 0 ? 65 : 90,
      ToolEfficiency: toolFailureCount > 0 ? 50 : 85,
      ContextEfficiency: contextWindowPct >= 90 || tokensRemoved > 0 ? 52 : 84,
      Reliability: failures > 0 ? 45 : 90,
      CodeOutcome: 60,
      EvalBucket: run.EvalOverall >= 80 ? 'good' : 'review'
    });
  }

  tables.AgentOpsCollectorHealth_CL.push({
    TimeGenerated: new Date().toISOString(),
    Component: 'span-to-run-summary',
    CheckName: 'exporter-health',
    Status: 'healthy',
    Detail: 'Local JSONL rollup completed without exporter errors.',
    LastSpanReceived: tables.AgentOpsEvents_CL.at(-1)?.TimeGenerated || '',
    LastExportSuccess: new Date().toISOString(),
    ExportErrors: 0,
    ExportFailureReason: '',
    ExportFailureAction: '',
    PrivacyPoisonOk: true,
    DroppedContentCount: tables.AgentOpsPrivacy_CL.reduce((total, row) => total + row.DroppedCount, 0),
    CollectorMode: 'local',
    PrivacyMode: 'strict',
    OtlpEndpoint: 'local-jsonl',
    AzureConfigured: false,
    GrafanaConfigured: false,
    DashboardVersion: 'v2',
    SchemaVersion: '2'
  });

  for (const tableRows of Object.values(tables)) {
    for (const row of tableRows) {
      if (row.SchemaVersion === undefined) row.SchemaVersion = AGENTOPS_SCHEMA_VERSION;
    }
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    runs: tables.AgentOpsRunSummary_CL.length,
    tables,
    table_counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))
  };
}

function writeTables(result, outDir) {
  const files = {};
  for (const table of tableNames) {
    const file = path.join(outDir, `${table}.jsonl`);
    writeJsonlFile(file, result.tables[table], { trailingNewline: true });
    files[table] = file;
  }
  const manifest = path.join(outDir, 'manifest.json');
  writeJsonFile(manifest, {
    generated_at: result.generated_at,
    runs: result.runs,
    table_counts: result.table_counts,
    files
  });
  return { out_dir: outDir, manifest, files };
}

module.exports = {
  readJsonlRows,
  rollupSpanRows,
  writeTables
};
