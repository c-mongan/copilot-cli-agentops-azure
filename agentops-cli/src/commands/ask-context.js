const fs = require('node:fs');
const path = require('node:path');

const legacy = require('../legacy');
const { hasFlag, optionValue } = require('../lib/args');
const { latestByTime } = require('../lib/explain/v2-explain');

function readJsonl(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function hasV2AskArgs(args = []) {
  return Boolean(optionValue(args, '--runs'));
}

function filterByRun(rows = [], runId) {
  return rows.filter(row => row.RunId === runId);
}

function topRows(rows = [], count = 8) {
  return rows.slice(0, count);
}

function escapeKqlString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function v2RunReplayUrl(run) {
  const links = legacy.openLinksSummary({ session: { id: run.SessionId || run.RunId, grafana_url: null } });
  const base = links.v2_replay_url || '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}var-run_id=${encodeURIComponent(run.RunId)}&var-session_id=${encodeURIComponent(run.SessionId || '__all')}&var-trace_id=${encodeURIComponent(run.TraceId || '__all')}`;
}

function investigationKql(run, last = '2h') {
  const runId = escapeKqlString(run.RunId);
  const sessionId = escapeKqlString(run.SessionId || run.RunId);
  return [
    'union isfuzzy=true AppDependencies, AppTraces, AppEvents',
    `| where TimeGenerated > ago(${last})`,
    `| where tostring(Properties) has_any ("${runId}", "${sessionId}")`,
    '| extend Event=coalesce(tostring(Properties["agentops.event.name"]), tostring(Properties["github.copilot.event.name"]), Name)',
    '| extend Tool=coalesce(tostring(Properties["gen_ai.tool.name"]), tostring(Properties["agentops.tool.name"]))',
    '| extend Agent=coalesce(tostring(Properties["agentops.agent.name"]), tostring(Properties["gen_ai.agent.name"]))',
    '| project TimeGenerated, Event, Name, OperationId, Id, ParentId, Agent, Tool, Success, DurationMs, Properties',
    '| order by TimeGenerated asc',
    '| take 200'
  ].join('\n');
}

function latestRecommendation(rows = [], run = {}) {
  const matches = rows.filter(row => {
    return row.RunId === run.RunId ||
      (run.SessionId && row.SessionId === run.SessionId) ||
      (run.TraceId && row.TraceId === run.TraceId);
  });
  matches.sort((left, right) => String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || '')));
  const row = matches[0] || null;
  if (!row) return null;
  return {
    time: row.TimeGenerated || '',
    action: row.Action || '',
    severity: row.Severity || '',
    observed_pattern: row.ObservedPattern || '',
    next_action: row.NextAction || '',
    validation: Array.isArray(row.Validation) ? row.Validation : [],
    rollback_condition: row.RollbackCondition || '',
    benchmark_run_id: row.BenchmarkRunId || '',
    benchmark_decision: row.BenchmarkDecision || '',
    dashboard_titles: Array.isArray(row.DashboardTitles) ? row.DashboardTitles : []
  };
}

function buildAskContext(options = {}) {
  const runs = readJsonl(options.runsFile);
  const run = options.runId && options.runId !== 'latest'
    ? runs.find(row => row.RunId === options.runId)
    : latestByTime(runs);

  if (!run) {
    return {
      ok: false,
      run_id: options.runId || 'latest',
      error: 'No V2 AgentOps run rows were available.'
    };
  }

  const runId = run.RunId;
  const events = filterByRun(readJsonl(options.eventsFile), runId);
  const tools = filterByRun(readJsonl(options.toolsFile), runId);
  const privacy = filterByRun(readJsonl(options.privacyFile), runId);
  const github = filterByRun(readJsonl(options.githubFile), runId);
  const evals = filterByRun(readJsonl(options.evalsFile), runId);
  const insights = filterByRun(readJsonl(options.insightsFile), runId);
  const recommendation = latestRecommendation(readJsonl(options.recommendationsFile), run);
  const replayUrl = v2RunReplayUrl(run);
  const last = legacy.validateKqlDuration(options.last || '2h');
  const kql = investigationKql(run, last);

  const failedTools = tools.filter(row => row.Status !== 'success' || row.Allowed === false);
  const timeline = topRows(events, 20).map(row => ({
    time: row.TimeGenerated,
    event: row.EventName,
    status: row.Status,
    tool: row.ToolName || '',
    agent: row.AgentName || '',
    skill: row.SkillName || '',
    sub_agent: row.SubAgentName || ''
  }));

  const prompt = [
    'Use the telemetry-investigator or AgentOps triage skill.',
    '',
    `Investigate AgentOps run ${runId}.`,
    `Run Replay: ${replayUrl}`,
    `Time range: ${last}`,
    `Session: ${run.SessionId || 'unknown'}`,
    `Trace: ${run.TraceId || 'unknown'}`,
    `Status: ${run.OutcomeStatus || 'unknown'}${run.OutcomeReason ? ` (${run.OutcomeReason})` : ''}`,
    recommendation ? `Last recommendation: ${recommendation.action} (${recommendation.severity}) - ${recommendation.next_action}` : 'Last recommendation: none in this bundle',
    recommendation?.benchmark_run_id ? `Benchmark run: ${recommendation.benchmark_run_id} (${recommendation.benchmark_decision || 'unknown'})` : 'Benchmark run: none in this bundle',
    '',
    'Use only the metadata in this bundle and read-only Azure/Grafana MCP if available.',
    'Start with this KQL if Azure Monitor is available:',
    kql,
    '',
    'Return: what happened, why it matters, the most likely failure/cost/safety/context pattern, and one evidence-backed next action.',
    'Do not request or enable prompt, response, source code, file content, tool argument, tool result, URL, request body, response body, or secret capture.'
  ].join('\n');

  return {
    ok: true,
    run_id: runId,
    session_id: run.SessionId || '',
    trace_id: run.TraceId || '',
    status: run.OutcomeStatus || 'unknown',
    replay_url: replayUrl,
    time_range: last,
    kql_query: kql,
    grafana_url: replayUrl,
    last_recommendation: recommendation,
    benchmark_run_id: recommendation?.benchmark_run_id || '',
    run: {
      TimeGenerated: run.TimeGenerated,
      Surface: run.Surface,
      RepoHash: run.RepoHash,
      BranchHash: run.BranchHash,
      TaskType: run.TaskType,
      AgentName: run.AgentName,
      SkillName: run.SkillName || '',
      ParentAgentName: run.ParentAgentName || '',
      SubAgentName: run.SubAgentName || '',
      ModelActual: run.ModelActual,
      DurationMs: run.DurationMs,
      InputTokens: run.InputTokens,
      OutputTokens: run.OutputTokens,
      ReasoningTokens: run.ReasoningTokens,
      CacheReadTokens: run.CacheReadTokens || 0,
      ContextWindowPct: run.ContextWindowPct || 0,
      TokensRemoved: run.TokensRemoved || 0,
      PermissionWaitMs: run.PermissionWaitMs || 0,
      EstimatedCostUsd: run.EstimatedCostUsd,
      ToolCount: run.ToolCount,
      ToolFailureCount: run.ToolFailureCount,
      ToolDeniedCount: run.ToolDeniedCount,
      TestsRan: run.TestsRan,
      TestsPassed: run.TestsPassed,
      PrOpened: run.PrOpened,
      CiStatus: run.CiStatus,
      EvalOverall: run.EvalOverall,
      RiskScore: run.RiskScore,
      PrivacyMode: run.PrivacyMode,
      ContentCaptureMode: run.ContentCaptureMode
    },
    evidence: {
      timeline,
      failed_tools: topRows(failedTools, 10),
      privacy_signals: topRows(privacy, 10),
      github_outcomes: topRows(github, 5),
      evals: topRows(evals, 5),
      insights: topRows(insights, 10),
      recommendation: recommendation ? [recommendation] : []
    },
    counts: {
      events: events.length,
      tools: tools.length,
      failed_tools: failedTools.length,
      privacy_signals: privacy.length,
      github_outcomes: github.length,
      evals: evals.length,
      insights: insights.length,
      recommendations: recommendation ? 1 : 0
    },
    prompt
  };
}

function renderAskContext(result) {
  if (!result.ok) return `AgentOps ask context\n\n${result.error}\n`;
  const lines = [
    'AgentOps ask context',
    '',
    `Run: ${result.run_id}`,
    `Status: ${result.status}`,
    `Time range: ${result.time_range}`,
    `Replay: ${result.replay_url}`,
    `Evidence: ${result.counts.events} events, ${result.counts.failed_tools} failed/denied tools, ${result.counts.insights} insights, ${result.counts.recommendations} recommendation`,
    '',
    'Prompt:',
    result.prompt
  ];
  return `${lines.join('\n')}\n`;
}

function legacyAskContext(args = []) {
  const sessionId = args[0] || 'latest';
  const last = optionValue(args, '--last', '24h');
  const result = legacy.askAgentOpsContext({ sessionId, last, json: hasFlag(args, '--json'), args: args.slice(1) });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(result, null, 2)}\n` : legacy.renderAskContext(result));
  process.exitCode = result.ok ? 0 : 1;
}

function askContextCommand(args = []) {
  if (!hasV2AskArgs(args)) return legacyAskContext(args);
  const target = args[0] || 'latest';
  const result = buildAskContext({
    runId: target,
    runsFile: path.resolve(optionValue(args, '--runs')),
    eventsFile: optionValue(args, '--events') ? path.resolve(optionValue(args, '--events')) : null,
    toolsFile: optionValue(args, '--tools') ? path.resolve(optionValue(args, '--tools')) : null,
    privacyFile: optionValue(args, '--privacy') ? path.resolve(optionValue(args, '--privacy')) : null,
    githubFile: optionValue(args, '--github') ? path.resolve(optionValue(args, '--github')) : null,
    evalsFile: optionValue(args, '--evals') ? path.resolve(optionValue(args, '--evals')) : null,
    insightsFile: optionValue(args, '--insights') ? path.resolve(optionValue(args, '--insights')) : null,
    recommendationsFile: optionValue(args, '--recommendations') ? path.resolve(optionValue(args, '--recommendations')) : null,
    last: optionValue(args, '--last', '2h')
  });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(result, null, 2)}\n` : renderAskContext(result));
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  askContextCommand,
  buildAskContext,
  hasV2AskArgs,
  renderAskContext
};
