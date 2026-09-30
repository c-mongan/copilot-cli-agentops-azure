const path = require('node:path');

const { baseScenarios, chooseScenarios, contextProfile } = require('./agentops-demo-scenarios');
const { writeJsonFile, writeJsonlFile } = require('../command-output');
const { prefixedHash: stableHash } = require('../hash');
const { validateAgentRun } = require('../schema/agent-run-schema');
const { AGENTOPS_SCHEMA_VERSION } = require('../schema/agentops-attributes');

const tableNames = [
  'AgentOpsRunSummary_CL',
  'AgentOpsEvents_CL',
  'AgentOpsSpans_CL',
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

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
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
  const previous = tables.AgentOpsEvents_CL.filter(event => event.RunId === run.RunId).at(-1);
  const sequence = (previous?.Sequence || 0) + 1;
  const eventId = stableHash(`${run.RunId}:${sequence}:${eventName}`, 'event');
  tables.AgentOpsEvents_CL.push({
    TimeGenerated: time,
    Sequence: sequence,
    EventId: eventId,
    ParentEventId: previous?.EventId || '',
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
        SuggestedNextStep: scenario.collectorError ? 'Run agentops collector smoke --privacy strict --poison --json' : 'Open Run Story and inspect the linked spans.'
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
    scenarios: result.scenarios,
    scenario_names: result.scenario_names,
    files
  });
  return { out_dir: outDir, manifest, files };
}

module.exports = {
  baseScenarios,
  generateDemoData,
  tableNames,
  writeDemoData
};
