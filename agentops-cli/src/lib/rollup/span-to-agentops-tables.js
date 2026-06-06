const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { tableNames } = require('../demo/agentops-demo-data');
const { sensitiveContentAttributes } = require('../schema/agentops-attributes');

function stableHash(value, prefix = 'h') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function readJsonlRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

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
  return row.name || row.Name || row.operation || attr(attrs, ['gen_ai.operation.name', 'operation'], 'span');
}

function timestamp(row, index, baseTime) {
  const value = row.TimeGenerated || row.timestamp || row.time || row.startTime;
  if (value && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return new Date(baseTime.getTime() + index * 1000).toISOString();
}

function failed(row, attrs) {
  const status = row.Status ?? row.status?.code ?? row.status ?? row.ResultCode ?? row.resultCode;
  const success = row.Success ?? row.success;
  if (success === false || String(success).toLowerCase() === 'false') return true;
  if (['failed', 'failure', 'error', 'blocked', 'degraded'].includes(String(status || '').toLowerCase())) return true;
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
    || Boolean(attr(attrs, ['mcp.method.name', 'mcp.session.id', 'mcp.server.name', 'agentops.mcp.server.hash'], ''))
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

function emptyTables() {
  return Object.fromEntries(tableNames.map(name => [name, []]));
}

function addEvent(tables, run, row, attrs, index, baseTime) {
  const op = operation(row, attrs);
  const tool = attr(attrs, ['gen_ai.tool.name', 'tool'], '');
  tables.AgentOpsEvents_CL.push({
    TimeGenerated: timestamp(row, index, baseTime),
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
    ModelActual: run.ModelActual,
    Status: failed(row, attrs) ? 'failed' : 'success',
    DurationMs: numberValue(row.DurationMs ?? row.durationMs ?? row.duration_ms),
    InputTokens: numberValue(attr(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens'], 0)),
    OutputTokens: numberValue(attr(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens'], 0)),
    EstimatedCostUsd: numberValue(attr(attrs, ['agentops.cost.estimated_usd'], 0)),
    PrivacyMode: run.PrivacyMode,
    ContentCaptureSignal: contentSignals(attrs).length > 0
  });
}

function rollupSpanRows(rows, options = {}) {
  const tables = emptyTables();
  const baseTime = options.baseTime ? new Date(options.baseTime) : new Date();
  const sessions = new Map();

  let currentSessionId = null;
  rows.forEach((row, index) => {
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
    const first = items[0];
    const runId = attr(first.attrs, ['agentops.run.id', 'agentops.wrapper.run_id'], stableHash(sessionId, 'run'));
    const traceId = first.row.OperationId || first.row.TraceId || stableHash(`${sessionId}:trace`, 'trace');
    const repoHash = attr(first.attrs, ['agentops.repo.hash'], stableHash(options.repo || 'unknown-repo', 'repo'));
    const branchHash = attr(first.attrs, ['agentops.branch.hash'], stableHash(options.branch || 'unknown-branch', 'branch'));
    const agentName = attr(first.attrs, ['agentops.agent.name', 'gen_ai.agent.name'], '');
    const skillName = firstAttr(items, ['agentops.skill.name', 'github.copilot.skill.name']);
    const parentAgentName = firstAttr(items, ['agentops.parent_agent.name', 'agentops.parent.agent.name']);
    const subAgentName = firstAttr(items, ['agentops.sub_agent.name', 'agentops.child_agent.name']);
    const delegationId = firstAttr(items, ['agentops.delegation.id']);
    const model = attr(first.attrs, ['agentops.model.actual', 'gen_ai.response.model', 'gen_ai.request.model'], '');
    const started = timestamp(first.row, first.index, baseTime);
    const ended = timestamp(items.at(-1).row, items.at(-1).index, baseTime);
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
    const tools = new Set();

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

    for (const item of items) {
      const { row, attrs, index } = item;
      const op = operation(row, attrs);
      const tool = attr(attrs, ['gen_ai.tool.name', 'tool'], '');
      const rowFailed = failed(row, attrs);
      const signals = contentSignals(attrs);

      inputTokens += numberValue(attr(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens'], 0));
      outputTokens += numberValue(attr(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens'], 0));
      reasoningTokens += numberValue(attr(attrs, ['gen_ai.usage.reasoning.output_tokens'], 0));
      cacheReadTokens += numberValue(attr(attrs, ['agentops.cache.read_input_tokens', 'gen_ai.usage.cache_read.input_tokens', 'CacheReadTokens', 'CacheRead'], 0));
      cacheCreationTokens += numberValue(attr(attrs, ['agentops.cache.creation_input_tokens', 'gen_ai.usage.cache_creation.input_tokens', 'CacheCreationTokens'], 0));
      tokensRemoved += numberValue(attr(attrs, ['agentops.context.tokens_removed', 'github.copilot.tokens_removed', 'TokensRemoved'], 0));
      permissionWaitMs += numberValue(attr(attrs, ['agentops.permission.wait_ms', 'github.copilot.permission.wait_ms', 'PermissionWaitMs'], 0));
      contextWindowPct = Math.max(contextWindowPct, numberValue(attr(attrs, ['agentops.context.window_pct', 'github.copilot.context.window_pct', 'ContextWindowPct'], 0)));
      estimatedCostUsd += numberValue(attr(attrs, ['agentops.cost.estimated_usd'], 0));
      if (rowFailed) failures += 1;

      if (op === 'execute_tool' || tool) {
        const risk = riskForTool(tool);
        const allowed = boolValue(attr(attrs, ['agentops.mcp.allowed'], true));
        toolCount += 1;
        tools.add(String(tool || 'tool'));
        if (rowFailed) toolFailureCount += 1;
        if (allowed === false) toolDeniedCount += 1;
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
          DurationMs: numberValue(row.DurationMs ?? row.durationMs ?? row.duration_ms),
          ErrorType: String(attr(attrs, ['error.type', 'exception.type', 'error'], '')),
          OutputSizeBytes: numberValue(attr(attrs, ['agentops.mcp.result_size_bytes'], 0)),
          AgentName: run.AgentName,
          ArgsSchemaHash: String(attr(attrs, ['agentops.mcp.args_schema_hash'], stableHash(`${tool}:schema`, 'schema')))
        });

        if (isMcpSpan(op, attrs, tool)) {
          const serverName = String(attr(attrs, ['mcp.server.name'], mcpServerFromTool(tool) || 'unknown-mcp'));
          const resultSize = numberValue(attr(attrs, ['agentops.mcp.result_size_bytes'], 0));
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
            ToolName: String(mcpToolName(tool || attr(attrs, ['gen_ai.tool.name'], 'tool'))),
            ToolType: risk,
            ToolRisk: String(attr(attrs, ['agentops.mcp.tool.risk'], risk)),
            Allowed: allowed,
            DeniedReason: allowed ? '' : String(attr(attrs, ['agentops.mcp.denied_reason'], 'policy_denied')),
            Sandboxed: boolValue(attr(attrs, ['agentops.mcp.sandboxed'], false)),
            Status: rowFailed ? 'failed' : 'success',
            DurationMs: numberValue(row.DurationMs ?? row.durationMs ?? row.duration_ms),
            OutputSizeBytes: resultSize,
            ResultSizeBytes: resultSize,
            ArgsSchemaHash: String(attr(attrs, ['agentops.mcp.args_schema_hash'], stableHash(`${serverName}:${tool}:schema`, 'schema')))
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

      addEvent(tables, run, row, attrs, index, baseTime);
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
    run.FilesEditedCount = [...tools].filter(tool => /edit|write|patch/i.test(tool)).length;
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

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    runs: tables.AgentOpsRunSummary_CL.length,
    tables,
    table_counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]))
  };
}

function writeTables(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = {};
  for (const table of tableNames) {
    const file = path.join(outDir, `${table}.jsonl`);
    fs.writeFileSync(file, `${result.tables[table].map(row => JSON.stringify(row)).join('\n')}\n`);
    files[table] = file;
  }
  const manifest = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    generated_at: result.generated_at,
    runs: result.runs,
    table_counts: result.table_counts,
    files
  }, null, 2)}\n`);
  return { out_dir: outDir, manifest, files };
}

module.exports = {
  readJsonlRows,
  rollupSpanRows,
  writeTables
};
