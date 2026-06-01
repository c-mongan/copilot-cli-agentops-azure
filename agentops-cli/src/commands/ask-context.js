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

function v2RunReplayUrl(run) {
  const links = legacy.openLinksSummary({ session: { id: run.SessionId || run.RunId, grafana_url: null } });
  const base = links.v2_replay_url || '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}var-run_id=${encodeURIComponent(run.RunId)}&var-session_id=${encodeURIComponent(run.SessionId || '__all')}&var-trace_id=${encodeURIComponent(run.TraceId || '__all')}`;
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
  const replayUrl = v2RunReplayUrl(run);

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
    `Session: ${run.SessionId || 'unknown'}`,
    `Trace: ${run.TraceId || 'unknown'}`,
    `Status: ${run.OutcomeStatus || 'unknown'}${run.OutcomeReason ? ` (${run.OutcomeReason})` : ''}`,
    '',
    'Use only the metadata in this bundle and read-only Azure/Grafana MCP if available.',
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
      insights: topRows(insights, 10)
    },
    counts: {
      events: events.length,
      tools: tools.length,
      failed_tools: failedTools.length,
      privacy_signals: privacy.length,
      github_outcomes: github.length,
      evals: evals.length,
      insights: insights.length
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
    `Replay: ${result.replay_url}`,
    `Evidence: ${result.counts.events} events, ${result.counts.failed_tools} failed/denied tools, ${result.counts.insights} insights`,
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
    insightsFile: optionValue(args, '--insights') ? path.resolve(optionValue(args, '--insights')) : null
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
