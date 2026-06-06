const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { validateAgentRun } = require('../schema/agent-run-schema');
const { AGENTOPS_SCHEMA_VERSION } = require('../schema/agentops-attributes');

const tableNames = [
  'AgentOpsRunSummary_CL',
  'AgentOpsEvents_CL',
  'AgentOpsToolCalls_CL',
  'AgentOpsMcpCalls_CL',
  'AgentOpsPrivacy_CL',
  'AgentOpsEval_CL',
  'AgentOpsGithubOutcomes_CL',
  'AgentOpsInsights_CL',
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL',
  'AgentOpsCollectorHealth_CL',
  'AgentOpsContent_CL'
];

const baseScenarios = [
  {
    name: 'successful-test-writing-run',
    taskType: 'test',
    model: 'claude-opus-4.7',
    status: 'success',
    reason: 'tests_passed',
    duration: 78000,
    input: 92000,
    output: 18000,
    reasoning: 5200,
    cost: 0.48,
    tools: 8,
    failures: 0,
    denied: 0,
    testsRan: true,
    testsPassed: true,
    filesRead: 12,
    filesEdited: 3,
    risk: 18,
    eval: 92,
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'expensive-failed-run',
    taskType: 'review',
    model: 'gpt-5.5',
    status: 'failed',
    reason: 'tool_timeout',
    duration: 214000,
    input: 420000,
    output: 61000,
    reasoning: 42000,
    cost: 4.92,
    tools: 27,
    failures: 5,
    denied: 0,
    testsRan: true,
    testsPassed: false,
    filesRead: 38,
    filesEdited: 2,
    risk: 64,
    eval: 41,
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'failed' }
  },
  {
    name: 'policy-denied-secret-read',
    taskType: 'debug_ci',
    model: 'copilot-default',
    status: 'blocked',
    reason: 'policy_denied_secret_access',
    duration: 36000,
    input: 51000,
    output: 6000,
    reasoning: 1200,
    cost: 0.12,
    tools: 5,
    failures: 1,
    denied: 1,
    testsRan: false,
    testsPassed: false,
    filesRead: 4,
    filesEdited: 0,
    risk: 91,
    eval: 37,
    privacyDrops: 2,
    privacyKind: 'secret_like',
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'mcp-tool-failure',
    taskType: 'fix',
    model: 'claude-sonnet-4.5',
    status: 'failed',
    reason: 'mcp_tool_error',
    duration: 97000,
    input: 88000,
    output: 15000,
    reasoning: 3200,
    cost: 0.36,
    tools: 12,
    failures: 3,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 18,
    filesEdited: 1,
    risk: 58,
    eval: 48,
    mcp: { server: 'playwright', tool: 'browser-control', risk: 'browser-control', status: 'failed' },
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'edited-files-no-tests',
    taskType: 'refactor',
    model: 'copilot-default',
    status: 'success',
    reason: 'completed_without_tests',
    duration: 64000,
    input: 67000,
    output: 13000,
    reasoning: 1600,
    cost: 0.22,
    tools: 10,
    failures: 0,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 14,
    filesEdited: 4,
    risk: 52,
    eval: 55,
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'pr-opened-ci-failed',
    taskType: 'fix',
    model: 'claude-opus-4.7',
    status: 'success',
    reason: 'pr_opened_ci_failed',
    duration: 143000,
    input: 180000,
    output: 32000,
    reasoning: 11000,
    cost: 1.28,
    tools: 22,
    failures: 1,
    denied: 0,
    testsRan: true,
    testsPassed: false,
    filesRead: 29,
    filesEdited: 6,
    risk: 47,
    eval: 62,
    github: { opened: true, merged: false, closed: false, reverted: false, ci: 'failed' }
  },
  {
    name: 'pr-opened-and-merged',
    taskType: 'fix',
    model: 'claude-sonnet-4.5',
    status: 'success',
    reason: 'merged',
    duration: 126000,
    input: 132000,
    output: 28000,
    reasoning: 7200,
    cost: 0.82,
    tools: 19,
    failures: 0,
    denied: 0,
    testsRan: true,
    testsPassed: true,
    filesRead: 24,
    filesEdited: 5,
    risk: 22,
    eval: 95,
    github: { opened: true, merged: true, closed: false, reverted: false, ci: 'passed' }
  },
  {
    name: 'model-cost-regression',
    taskType: 'review',
    model: 'gpt-5.5',
    status: 'success',
    reason: 'cost_regression',
    duration: 158000,
    input: 310000,
    output: 49000,
    reasoning: 36000,
    cost: 3.74,
    tools: 15,
    failures: 0,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 41,
    filesEdited: 0,
    risk: 44,
    eval: 70,
    insight: 'cost-anomaly',
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'instruction-hash-regression',
    taskType: 'docs',
    model: 'copilot-default',
    status: 'success',
    reason: 'eval_regression_after_instruction_change',
    duration: 58000,
    input: 73000,
    output: 9000,
    reasoning: 1100,
    cost: 0.18,
    tools: 7,
    failures: 0,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 10,
    filesEdited: 2,
    risk: 39,
    eval: 49,
    insight: 'instruction-regression',
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'privacy-drop-success',
    taskType: 'explain',
    model: 'copilot-default',
    status: 'success',
    reason: 'content_dropped_before_export',
    duration: 31000,
    input: 44000,
    output: 7000,
    reasoning: 900,
    cost: 0.09,
    tools: 4,
    failures: 0,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 7,
    filesEdited: 0,
    risk: 28,
    eval: 82,
    privacyDrops: 6,
    privacyKind: 'prompt',
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  },
  {
    name: 'collector-export-issue',
    taskType: 'unknown',
    model: 'copilot-default',
    status: 'failed',
    reason: 'collector_export_error',
    duration: 45000,
    input: 21000,
    output: 3000,
    reasoning: 300,
    cost: 0.05,
    tools: 2,
    failures: 1,
    denied: 0,
    testsRan: false,
    testsPassed: false,
    filesRead: 3,
    filesEdited: 0,
    risk: 67,
    eval: 44,
    collectorError: true,
    github: { opened: false, merged: false, closed: false, reverted: false, ci: 'not_run' }
  }
];

function stableHash(value, prefix = 'h') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function chooseScenarios(options = {}) {
  return baseScenarios.filter(scenario => {
    if (!options.withFailures && scenario.status === 'failed') return false;
    if (!options.withPrivacyDrops && scenario.privacyDrops) return false;
    if (!options.withGithubOutcomes && scenario.github.opened) return false;
    return true;
  });
}

function contextProfile(scenario, index) {
  const profiles = {
    'expensive-failed-run': { contextPct: 94, cacheRead: 25000, cacheCreation: 16000, tokensRemoved: 36000, permissionWait: 18000 },
    'model-cost-regression': { contextPct: 89, cacheRead: 12000, cacheCreation: 22000, tokensRemoved: 18000, permissionWait: 3000 },
    'pr-opened-ci-failed': { contextPct: 81, cacheRead: 21000, cacheCreation: 6400, tokensRemoved: 4000, permissionWait: 7200 },
    'pr-opened-and-merged': { contextPct: 74, cacheRead: 29000, cacheCreation: 4500, tokensRemoved: 0, permissionWait: 2400 },
    'policy-denied-secret-read': { contextPct: 38, cacheRead: 2000, cacheCreation: 800, tokensRemoved: 0, permissionWait: 9000 },
    'mcp-tool-failure': { contextPct: 61, cacheRead: 9000, cacheCreation: 1800, tokensRemoved: 0, permissionWait: 5400 },
    'instruction-hash-regression': { contextPct: 68, cacheRead: 6000, cacheCreation: 900, tokensRemoved: 3500, permissionWait: 1100 }
  };
  const base = profiles[scenario.name] || { contextPct: 42, cacheRead: 3500, cacheCreation: 700, tokensRemoved: 0, permissionWait: 900 };
  return {
    ContextWindowPct: Math.min(100, base.contextPct + (index % 4) * 2),
    CacheReadTokens: base.cacheRead + index * 113,
    CacheCreationTokens: base.cacheCreation + index * 29,
    TokensRemoved: base.tokensRemoved,
    PermissionWaitMs: base.permissionWait
  };
}

function runAttributes(row) {
  return {
    'agentops.schema.version': '2',
    'agentops.run.id': row.RunId,
    'agentops.session.id': row.SessionId,
    'agentops.surface': row.Surface,
    'agentops.privacy.mode': row.PrivacyMode,
    'agentops.content_capture.mode': row.ContentCaptureMode,
    'agentops.content_capture.signal': row.ContentCaptureSignal,
    'agentops.repo.hash': row.RepoHash,
    'agentops.branch.hash': row.BranchHash,
    'agentops.task.type': row.TaskType,
    'agentops.outcome.status': row.OutcomeStatus,
    'agentops.duration.ms': row.DurationMs,
    'agentops.context.window_pct': row.ContextWindowPct,
    'agentops.context.tokens_removed': row.TokensRemoved,
    'agentops.cache.read_input_tokens': row.CacheReadTokens,
    'agentops.cache.creation_input_tokens': row.CacheCreationTokens,
    'agentops.permission.wait_ms': row.PermissionWaitMs,
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'github.copilot',
    'gen_ai.conversation.id': row.SessionId,
    'gen_ai.request.model': row.ModelRequested,
    'gen_ai.response.model': row.ModelActual,
    'gen_ai.usage.input_tokens': row.InputTokens,
    'gen_ai.usage.output_tokens': row.OutputTokens,
    'gen_ai.usage.reasoning.output_tokens': row.ReasoningTokens
  };
}

function addEvent(tables, time, run, eventName, fields = {}) {
  tables.AgentOpsEvents_CL.push({
    TimeGenerated: time,
    RunId: run.RunId,
    SessionId: run.SessionId,
    TraceId: run.TraceId,
    Surface: run.Surface,
    EventName: eventName,
    SpanName: fields.SpanName || eventName,
    AgentName: run.AgentName,
    SkillName: run.SkillName || '',
    ParentAgentName: run.ParentAgentName || '',
    SubAgentName: run.SubAgentName || '',
    DelegationId: run.DelegationId || '',
    ToolName: fields.ToolName || '',
    ModelActual: run.ModelActual,
    Status: fields.Status || run.OutcomeStatus,
    DurationMs: fields.DurationMs || 0,
    InputTokens: fields.InputTokens || 0,
    OutputTokens: fields.OutputTokens || 0,
    EstimatedCostUsd: fields.EstimatedCostUsd || 0,
    PrivacyMode: run.PrivacyMode,
    ContentCaptureSignal: Boolean(fields.ContentCaptureSignal)
  });
}

function generateDemoData(options = {}) {
  const runs = Number.isFinite(options.runs) && options.runs > 0 ? Math.floor(options.runs) : 50;
  const withContent = options.withContent === true;
  const scenarios = chooseScenarios({
    withFailures: options.withFailures !== false,
    withPrivacyDrops: options.withPrivacyDrops !== false,
    withGithubOutcomes: options.withGithubOutcomes !== false
  });
  if (scenarios.length === 0) throw new Error('demo scenario selection is empty');

  const tables = Object.fromEntries(tableNames.map(name => [name, []]));
  const validationErrors = [];

  for (let index = 0; index < runs; index += 1) {
    const scenario = scenarios[index % scenarios.length];
    const time = isoMinutesAgo((runs - index) * 11);
    const runId = `run_demo_${String(index + 1).padStart(4, '0')}`;
    const sessionId = `session_demo_${String(Math.floor(index / 3) + 1).padStart(4, '0')}`;
    const traceId = stableHash(`${runId}:trace`, 'trace');
    const repoHash = stableHash(`repo:${index % 5}`, 'repo');
    const branchHash = stableHash(`branch:${scenario.name}:${index % 7}`, 'branch');
    const prHash = scenario.github.opened ? stableHash(`pr:${runId}`, 'pr') : '';
    const privacyDrops = scenario.privacyDrops || 0;
    const context = contextProfile(scenario, index);

    const run = {
      TimeGenerated: time,
      RunId: runId,
      ScenarioName: scenario.name,
      SessionId: sessionId,
      TraceId: traceId,
      Surface: index % 5 === 0 ? 'vscode_mcp' : index % 7 === 0 ? 'sdk' : 'cli',
      RepoHash: repoHash,
      BranchHash: branchHash,
      TaskType: scenario.taskType,
      AgentName: index % 4 === 0 ? 'panel/editAgent' : 'copilotLanguageModel',
      SkillName: index % 6 === 0 ? 'agentops-live-triage' : '',
      ParentAgentName: index % 8 === 0 ? 'agentops-orchestrator' : '',
      SubAgentName: index % 8 === 0 ? 'agentops-dashboard-specialist' : '',
      DelegationId: index % 8 === 0 ? stableHash(`${runId}:delegation`, 'delegation') : '',
      ModelRequested: scenario.model,
      ModelActual: scenario.model,
      PrivacyMode: 'strict',
      ContentCaptureMode: privacyDrops ? 'signal_only' : 'off',
      ContentCaptureSignal: privacyDrops > 0,
      OutcomeStatus: scenario.status,
      OutcomeReason: scenario.reason,
      DurationMs: scenario.duration + (index % 5) * 7000,
      InputTokens: scenario.input + index * 211,
      OutputTokens: scenario.output + index * 37,
      ReasoningTokens: scenario.reasoning,
      EstimatedCostUsd: Number((scenario.cost + (index % 3) * 0.03).toFixed(2)),
      ContextWindowPct: context.ContextWindowPct,
      CacheReadTokens: context.CacheReadTokens,
      CacheCreationTokens: context.CacheCreationTokens,
      TokensRemoved: context.TokensRemoved,
      PermissionWaitMs: context.PermissionWaitMs,
      ToolCount: scenario.tools,
      ToolFailureCount: scenario.failures,
      ToolDeniedCount: scenario.denied,
      TestsRan: scenario.testsRan,
      TestsPassed: scenario.testsPassed,
      FilesReadCount: scenario.filesRead,
      FilesEditedCount: scenario.filesEdited,
      PrOpened: scenario.github.opened,
      PrNumberHash: prHash,
      CiStatus: scenario.github.ci,
      EvalOverall: scenario.eval,
      RiskScore: scenario.risk
    };

    tables.AgentOpsRunSummary_CL.push(run);
    const validation = validateAgentRun({ attributes: runAttributes(run) });
    if (!validation.ok) validationErrors.push({ runId, errors: validation.errors });

    addEvent(tables, time, run, 'run.started', { Status: 'success' });
    addEvent(tables, isoMinutesAgo((runs - index) * 11 - 1), run, 'gen_ai.chat', {
      DurationMs: Math.round(run.DurationMs * 0.44),
      InputTokens: run.InputTokens,
      OutputTokens: run.OutputTokens,
      EstimatedCostUsd: run.EstimatedCostUsd
    });
    if (run.ContextWindowPct >= 80 || run.TokensRemoved > 0) {
      addEvent(tables, isoMinutesAgo((runs - index) * 11 - 1), run, 'context.pressure', {
        Status: run.ContextWindowPct >= 90 ? 'warning' : 'success'
      });
    }

    if (withContent && index < Math.min(runs, 10)) {
      run.ContentCaptureMode = 'redacted';
      run.ContentCaptureSignal = true;
      tables.AgentOpsContent_CL.push({
        TimeGenerated: isoMinutesAgo((runs - index) * 11 - 1),
        RunId: runId,
        SessionId: sessionId,
        TraceId: traceId,
        SpanId: stableHash(`${runId}:content`, 'span'),
        TurnIndex: 1,
        Role: 'user',
        ContentKind: 'prompt',
        CaptureMode: 'redacted',
        PromptText: `Demo prompt for ${scenario.taskType}: inspect the hashed repository and produce a safe metadata-only answer.`,
        ResponseText: '',
        ToolName: '',
        ModelActual: scenario.model,
        RedactionStatus: 'demo_safe',
        ContentHash: stableHash(`${runId}:prompt`, 'content'),
        ContentLength: 95
      });
      tables.AgentOpsContent_CL.push({
        TimeGenerated: isoMinutesAgo((runs - index) * 11),
        RunId: runId,
        SessionId: sessionId,
        TraceId: traceId,
        SpanId: stableHash(`${runId}:content-response`, 'span'),
        TurnIndex: 1,
        Role: 'assistant',
        ContentKind: 'response',
        CaptureMode: 'redacted',
        PromptText: '',
        ResponseText: `Demo response: ${scenario.status === 'success' ? 'completed the run and reported validation metadata.' : 'stopped with a clear failure reason for replay.'}`,
        ToolName: '',
        ModelActual: scenario.model,
        RedactionStatus: 'demo_safe',
        ContentHash: stableHash(`${runId}:response`, 'content'),
        ContentLength: 82
      });
    }

    const toolStatus = scenario.failures ? 'failed' : 'success';
    tables.AgentOpsToolCalls_CL.push({
      TimeGenerated: isoMinutesAgo((runs - index) * 11 - 2),
      RunId: runId,
      TraceId: traceId,
      SpanId: stableHash(`${runId}:tool`, 'span'),
      Surface: run.Surface,
      ToolName: scenario.denied ? 'filesystem.read' : scenario.testsRan ? 'shell.test' : 'read_file',
      ToolType: scenario.denied ? 'secret-access' : scenario.testsRan ? 'shell' : 'read-only',
      ToolRisk: scenario.denied ? 'secret-access' : scenario.testsRan ? 'shell' : 'read-only',
      Allowed: scenario.denied === 0,
      DeniedReason: scenario.denied ? 'policy_secret_access' : '',
      Status: toolStatus,
      DurationMs: Math.max(1000, Math.round(run.DurationMs * 0.21)),
      ErrorType: scenario.failures ? scenario.reason : '',
      OutputSizeBytes: scenario.denied ? 0 : 2048 + index * 17,
      AgentName: run.AgentName,
      ArgsSchemaHash: stableHash(`${scenario.name}:args-schema`, 'schema')
    });
    addEvent(tables, isoMinutesAgo((runs - index) * 11 - 2), run, 'tool.call', { ToolName: scenario.denied ? 'filesystem.read' : 'read_file', Status: toolStatus, DurationMs: Math.round(run.DurationMs * 0.21) });

    if (scenario.mcp || run.Surface === 'vscode_mcp') {
      const mcp = scenario.mcp || { server: 'filesystem', tool: 'read_file', risk: 'read-only', status: 'success' };
      tables.AgentOpsMcpCalls_CL.push({
        TimeGenerated: isoMinutesAgo((runs - index) * 11 - 3),
        RunId: runId,
        TraceId: traceId,
        SpanId: stableHash(`${runId}:mcp`, 'span'),
        McpSessionId: stableHash(sessionId, 'mcp_session'),
        McpServerName: mcp.server,
        McpServerHash: stableHash(mcp.server, 'mcp_server'),
        McpClientName: 'vscode',
        McpTransport: 'stdio',
        Surface: run.Surface,
        AgentName: run.AgentName,
        ToolName: mcp.tool,
        ToolRisk: mcp.risk,
        Allowed: true,
        Sandboxed: mcp.server !== 'playwright',
        Status: mcp.status,
        DurationMs: Math.max(1200, Math.round(run.DurationMs * 0.17)),
        ArgsSchemaHash: stableHash(`${mcp.server}:${mcp.tool}:schema`, 'schema'),
        ResultSizeBytes: mcp.status === 'failed' ? 0 : 4096
      });
      addEvent(tables, isoMinutesAgo((runs - index) * 11 - 3), run, 'mcp.tools.call', { ToolName: mcp.tool, Status: mcp.status });
    }

    if (scenario.filesEdited > 0) addEvent(tables, isoMinutesAgo((runs - index) * 11 - 4), run, 'file.edit', { Status: 'success' });
    if (scenario.testsRan) addEvent(tables, isoMinutesAgo((runs - index) * 11 - 5), run, 'test.run', { Status: scenario.testsPassed ? 'success' : 'failed' });

    if (privacyDrops) {
      tables.AgentOpsPrivacy_CL.push({
        TimeGenerated: isoMinutesAgo((runs - index) * 11 - 6),
        RunId: runId,
        TraceId: traceId,
        PrivacyMode: 'strict',
        ContentKind: scenario.privacyKind || 'prompt',
        Observed: true,
        Action: 'dropped',
        DroppedCount: privacyDrops,
        RedactedCount: 0,
        LeakDetected: false
      });
      addEvent(tables, isoMinutesAgo((runs - index) * 11 - 6), run, 'privacy.signal', { ContentCaptureSignal: true, Status: 'success' });
    }

    tables.AgentOpsEval_CL.push({
      TimeGenerated: isoMinutesAgo((runs - index) * 11 - 7),
      RunId: runId,
      TraceId: traceId,
      RepoHash: repoHash,
      ModelActual: scenario.model,
      TaskType: scenario.taskType,
      EvalOverall: scenario.eval,
      TestDiscipline: scenario.testsRan ? (scenario.testsPassed ? 95 : 45) : (scenario.filesEdited ? 35 : 70),
      Security: scenario.denied ? 42 : privacyDrops ? 75 : 90,
      ToolEfficiency: scenario.failures ? 48 : 86,
      ContextEfficiency: run.ContextWindowPct >= 90 || run.TokensRemoved > 0 ? 52 : 84,
      Reliability: scenario.status === 'success' ? 90 : 40,
      CodeOutcome: scenario.github.merged ? 98 : scenario.github.opened ? 68 : 60,
      EvalBucket: scenario.eval >= 80 ? 'good' : scenario.eval >= 60 ? 'review' : 'poor'
    });

    if (scenario.github.opened) {
      const runStartedAt = time;
      const prCreatedAt = isoMinutesAgo((runs - index) * 11 - 8);
      const prMergedAt = scenario.github.merged ? isoMinutesAgo((runs - index) * 11 - 10) : '';
      tables.AgentOpsGithubOutcomes_CL.push({
        TimeGenerated: prCreatedAt,
        RunId: runId,
        RepoHash: repoHash,
        BranchHash: branchHash,
        RunStartedAt: runStartedAt,
        PrCreatedAt: prCreatedAt,
        PrMergedAt: prMergedAt,
        TimeToPrMinutes: Math.max(0, Math.round((new Date(prCreatedAt) - new Date(runStartedAt)) / 60000)),
        TimeToMergeMinutes: prMergedAt ? Math.max(0, Math.round((new Date(prMergedAt) - new Date(runStartedAt)) / 60000)) : null,
        PrOpened: true,
        PrNumberHash: prHash,
        PrMerged: scenario.github.merged,
        PrClosed: scenario.github.closed,
        PrReverted: scenario.github.reverted,
        CiStatus: scenario.github.ci,
        ReviewCommentCount: scenario.github.merged ? 2 : 7,
        CommitCount: 1 + (index % 4),
        FilesChangedCount: scenario.filesEdited
      });
      addEvent(tables, isoMinutesAgo((runs - index) * 11 - 8), run, 'github.pr.outcome', { Status: scenario.github.ci === 'passed' ? 'success' : 'failed' });
    }

    if (scenario.insight || scenario.collectorError || scenario.denied) {
      tables.AgentOpsInsights_CL.push({
        TimeGenerated: isoMinutesAgo((runs - index) * 11 - 9),
        InsightId: stableHash(`${runId}:insight`, 'insight'),
        RunId: runId,
        TraceId: traceId,
        InsightType: scenario.insight || (scenario.collectorError ? 'collector-health' : 'policy-spike'),
        Severity: scenario.collectorError || scenario.denied ? 'high' : 'medium',
        Title: scenario.insight === 'cost-anomaly' ? 'Cost anomaly by model and task' : scenario.insight === 'instruction-regression' ? 'Eval regression after instruction change' : scenario.collectorError ? 'Collector export issue' : 'Policy deny spike',
        Summary: scenario.insight === 'cost-anomaly'
          ? 'Estimated cost is above the recent baseline for this task type.'
          : scenario.insight === 'instruction-regression'
            ? 'Eval score dropped after a configuration hash changed.'
            : scenario.collectorError
              ? 'Collector export health should be checked before relying on live data.'
              : 'A risky tool request was blocked by policy metadata.',
        SuggestedNextStep: scenario.collectorError ? 'Run agentops collector smoke --privacy strict --poison --json' : 'Open Run Replay and inspect the linked spans.'
      });
    }

    tables.AgentOpsCollectorHealth_CL.push({
      TimeGenerated: isoMinutesAgo((runs - index) * 11 - 10),
      Component: 'otel-collector',
      CheckName: 'exporter-health',
      Status: scenario.collectorError ? 'degraded' : 'healthy',
      Detail: scenario.collectorError ? 'Azure exporter reported retryable send failures.' : 'Exporter delivered telemetry successfully.',
      LastSpanReceived: time,
      LastExportSuccess: scenario.collectorError ? '' : time,
      ExportErrors: scenario.collectorError ? 3 : 0,
      ExportFailureReason: scenario.collectorError ? 'azure-monitor-exporter-errors' : '',
      ExportFailureAction: scenario.collectorError ? 'Check collector logs, Azure Monitor DCR/DCE connectivity, and retry after fixing exporter credentials or network access.' : '',
      PrivacyPoisonOk: !scenario.collectorError,
      DroppedContentCount: privacyDrops,
      CollectorMode: 'auto',
      PrivacyMode: 'strict',
      OtlpEndpoint: 'http://127.0.0.1:4318',
      AzureConfigured: true,
      GrafanaConfigured: true,
      DashboardVersion: 'v2',
      SchemaVersion: '2'
    });

    addEvent(tables, isoMinutesAgo((runs - index) * 11 - 10), run, 'run.completed', { Status: run.OutcomeStatus });
  }

  for (const rows of Object.values(tables)) {
    for (const row of rows) {
      if (row.SchemaVersion === undefined) row.SchemaVersion = AGENTOPS_SCHEMA_VERSION;
    }
  }

  return {
    ok: validationErrors.length === 0,
    generated_at: new Date().toISOString(),
    runs,
    scenarios: [...new Set(tables.AgentOpsRunSummary_CL.map(row => row.OutcomeReason))],
    scenario_names: [...new Set(tables.AgentOpsRunSummary_CL.map(row => row.ScenarioName))],
    tables,
    table_counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    validation_errors: validationErrors
  };
}

function writeDemoData(result, outDir) {
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
    scenarios: result.scenarios,
    scenario_names: result.scenario_names,
    files
  }, null, 2)}\n`);
  return { out_dir: outDir, manifest, files };
}

module.exports = {
  baseScenarios,
  generateDemoData,
  tableNames,
  writeDemoData
};
