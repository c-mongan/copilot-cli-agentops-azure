const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const legacy = require('../legacy');
const { hasFlag, optionValue } = require('../lib/args');
const { latestByTime } = require('../lib/explain/v2-explain');

const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

function readJsonl(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function pickRun(runs, runId) {
  if (runId && runId !== 'latest') return runs.find(row => row.RunId === runId) || null;
  return latestByTime(runs);
}

function firstPositional(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && index + 1 < args.length && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    return arg;
  }
  return 'latest';
}

function dashboardBaseUrl(links = legacy.openLinksSummary()) {
  const home = links.v2_home_url || '/d/agentops-v2-home';
  return home.replace(/\/d\/agentops-v2-home.*$/, '');
}

function dashboardUrl(uid, vars = {}, links = legacy.openLinksSummary()) {
  const base = `${dashboardBaseUrl(links)}/d/${uid}`;
  const pairs = Object.entries(vars).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (pairs.length === 0) return base;
  return `${base}?${pairs.map(([key, value]) => `var-${key}=${encodeURIComponent(value)}`).join('&')}`;
}

function replayUrl(run, links) {
  if (!run) return dashboardUrl('agentops-v2-runs-explorer', {}, links);
  if (run.RunId) return dashboardUrl('agentops-v2-run-replay', { run_id: run.RunId }, links);
  if (run.SessionId) return dashboardUrl('agentops-v2-run-replay', { session_id: run.SessionId }, links);
  return dashboardUrl('agentops-v2-run-replay', {}, links);
}

function topInsightForRun(insights, runId) {
  return insights
    .filter(row => row.RunId === runId)
    .sort((left, right) => {
      const bySeverity = (severityRank[right.Severity] || 0) - (severityRank[left.Severity] || 0);
      if (bySeverity !== 0) return bySeverity;
      return String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || ''));
    })[0] || null;
}

function matchingPatternInsight(insights, run = {}) {
  const task = run.TaskType || '';
  const model = run.ModelActual || '';
  const repo = run.RepoHash || '';
  const agent = run.AgentName || 'agent';
  const privacy = run.PrivacyMode || 'strict';
  const outcome = run.OutcomeReason || (run.OutcomeStatus && run.OutcomeStatus !== 'success' ? 'failed' : '');
  const candidates = insights.filter(row => row.PatternKey || String(row.InsightType || '').startsWith('recurring-'));
  return candidates
    .filter(row => {
      const key = String(row.PatternKey || '');
      return (task && key.includes(`|${task}|`))
        || (model && key.includes(`|${model}|`))
        || (repo && key.includes(`|${repo}|`))
        || (agent && key.includes(`|${agent}`))
        || (privacy && key.endsWith(`|${privacy}`))
        || (outcome && key.endsWith(`|${outcome}`));
    })
    .sort((left, right) => {
      const byRuns = Number(right.PatternRuns || 0) - Number(left.PatternRuns || 0);
      if (byRuns !== 0) return byRuns;
      const bySeverity = (severityRank[right.Severity] || 0) - (severityRank[left.Severity] || 0);
      if (bySeverity !== 0) return bySeverity;
      return String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || ''));
    })[0] || null;
}

function linkedDashboardsForRecommendation(run, insight, links = legacy.openLinksSummary()) {
  const dashboards = [{ title: 'Run Replay', url: replayUrl(run, links) }];
  if (insight?.ToolName || Number(run?.ToolFailureCount || 0) > 0 || Number(run?.ToolDeniedCount || 0) > 0) {
    dashboards.push({ title: 'Tools & MCP Risk', url: dashboardUrl('agentops-v2-tools-mcp-risk', insight?.ToolName ? { tool_name: insight.ToolName } : {}, links) });
  }
  if (Number(run?.EstimatedCostUsd || 0) > 0 || run?.ModelActual) {
    dashboards.push({ title: 'Models, Cost & Tokens', url: dashboardUrl('agentops-v2-models-cost-tokens', run?.ModelActual ? { model: run.ModelActual } : {}, links) });
  }
  if (Number(run?.ToolDeniedCount || 0) > 0 || insight?.InsightType === 'privacy-drop') {
    dashboards.push({ title: 'Safety, Privacy & Policy', url: dashboardUrl('agentops-v2-safety-privacy-policy', {}, links) });
  }
  if (run?.PrOpened || run?.CiStatus) {
    dashboards.push({ title: 'Code Outcomes', url: dashboardUrl('agentops-v2-code-outcomes', run?.RepoHash ? { repo_hash: run.RepoHash } : {}, links) });
  }
  dashboards.push({
    title: insight?.PatternKey ? 'Insights Pattern' : 'Insights & Regressions',
    url: dashboardUrl('agentops-v2-insights-regressions', insight?.PatternKey ? { pattern_key: insight.PatternKey } : run?.RunId ? { run_id: run.RunId } : {}, links)
  });
  return dashboards;
}

function fileRefsForRecommendation(action, insight = {}, run = {}) {
  insight = insight || {};
  run = run || {};
  const refs = new Set();
  if (action === 'run_validation') {
    refs.add('tests_or_benchmark_suite');
    refs.add('agent_skill_validation_step');
  }
  if (action === 'investigate_tool') {
    refs.add('tool_policy_or_mcp_config');
  }
  if (action === 'check_collector') {
    refs.add('collector_config');
  }
  if (action === 'review_policy') {
    refs.add('agentops_policy_config');
    refs.add('mcp_server_config');
  }
  if (action === 'reduce_context_or_cost' || action === 'reduce_context') {
    refs.add('agent_instruction_or_skill_context_rules');
  }
  if (action === 'fix_ci') {
    refs.add('ci_workflow_or_test_command');
  }
  if (action === 'compare_regression' || insight.ConfigHash || run.ConfigHash) {
    refs.add('agent_instruction_config');
    refs.add('skill_definition');
  }
  if (action === 'triage_recurring_pattern') {
    refs.add('recurring_pattern_owner');
  }
  return [...refs];
}

function benchmarkEvidenceFromReport(report = null) {
  if (!report || typeof report !== 'object') return null;
  const artifactDiff = report.artifactDiff || {};
  const approval = report.promotion?.approval || report.promotionApproval || {};
  const approvalSource = approval.source
    ? String(approval.source).split(/[\\/]/).filter(Boolean).pop() || String(approval.source)
    : '';
  return {
    run_id: report.runId || '',
    decision: report.ok === false ? 'missing' : (report.promotion?.decision || report.recommendation?.action || ''),
    pass_rate_pct: report.passRatePct ?? null,
    average_score: report.averageScore ?? null,
    safety_violation_count: report.safetyViolationCount ?? null,
    tool_failures: report.toolFailures ?? null,
    total_tokens: report.totalTokens ?? null,
    cost: report.cost ?? null,
    artifact_diff: {
      added: artifactDiff.added ?? null,
      modified: artifactDiff.modified ?? null,
      deleted: artifactDiff.deleted ?? null,
      total_changed: artifactDiff.totalChanged ?? null
    },
    approval: {
      status: approval.status || '',
      approved_count: approval.status === 'approved' ? (approval.approvedBy || []).length : 0,
      required_count: report.promotion?.gates?.requiredApprovals ?? report.promotionGates?.requiredApprovals ?? null,
      approved_at: approval.approvedAt || '',
      ticket: approval.ticket || '',
      source: approvalSource
    },
    validation: report.promotion?.validation || report.message || '',
    rollback: report.promotion?.rollback || (report.ok === false ? 'run or attach benchmark evidence before promotion' : '')
  };
}

function actionFromInsight(insight, run = {}) {
  if (!insight) {
    if (run.OutcomeStatus && run.OutcomeStatus !== 'success') return 'investigate_failed_run';
    if (Number(run.FilesEditedCount || 0) > 0 && !run.TestsRan) return 'run_validation';
    if (Number(run.ContextWindowPct || 0) >= 90 || Number(run.TokensRemoved || 0) > 0) return 'reduce_context';
    return 'keep_observing';
  }

  const type = insight.InsightType || '';
  if (type.startsWith('recurring-')) return 'triage_recurring_pattern';
  if (type.includes('test')) return 'run_validation';
  if (type.includes('tool')) return 'investigate_tool';
  if (type.includes('collector')) return 'check_collector';
  if (type.includes('policy') || type.includes('privacy')) return 'review_policy';
  if (type.includes('cost') || type.includes('context')) return 'reduce_context_or_cost';
  if (type.includes('ci')) return 'fix_ci';
  if (type.includes('eval') || type.includes('instruction') || type.includes('config')) return 'compare_regression';
  return 'investigate';
}

function buildRecommendation({ run, insight, evaluation, links, benchmarkReport }) {
  if (!run) {
    return {
      ok: false,
      action: 'collect_data',
      severity: 'medium',
      observed_pattern: 'No AgentOps V2 run rows were available.',
      next_action: 'Run `agentops demo generate --runs 50 --with-failures --with-privacy-drops --with-github-outcomes --json` or collect a new Copilot run through the local collector.',
      evidence: { dashboards: [{ title: 'AgentOps Home', url: dashboardUrl('agentops-v2-home', {}, links) }] },
      validation: ['Run `agentops dashboard kql-check --last 24h --json` after data is ingested.'],
      rollback_condition: 'No rollback needed; this recommendation made no changes.'
    };
  }

  const action = actionFromInsight(insight, run);
  const healthy = action === 'keep_observing';
  const observedPattern = insight?.Summary
    || (healthy ? 'No high-severity insight was found for this run.' : `Run status is ${run.OutcomeStatus || 'unknown'}.`);
  const nextAction = insight?.SuggestedNextStep
    || (healthy
      ? 'Keep strict privacy mode enabled and compare the next similar run for cost, latency, eval, and outcome drift.'
      : 'Open Run Replay and inspect the failed span, blocked tool, eval score, and GitHub outcome.');

  const benchmark = benchmarkEvidenceFromReport(benchmarkReport);
  const validation = [
    `agentops explain ${run.RunId} --runs <AgentOpsRunSummary_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>`,
    'agentops dashboard kql-check --last 24h --json'
  ];
  if (benchmark?.run_id) validation.push(`agentops experimental benchmark report ${benchmark.run_id}`);

  return {
    ok: true,
    action,
    severity: insight?.Severity || (healthy ? 'low' : 'medium'),
    run_id: run.RunId,
    session_id: run.SessionId || '',
    trace_id: run.TraceId || '',
    observed_pattern: observedPattern,
    next_action: nextAction,
    evidence: {
      dashboards: linkedDashboardsForRecommendation(run, insight, links),
      eval: evaluation ? {
        overall: evaluation.EvalOverall,
        bucket: evaluation.EvalBucket || '',
        reason: evaluation.EvalReason || ''
      } : null,
      pattern: insight?.PatternKey ? {
        id: insight.PatternId || '',
        key: insight.PatternKey,
        runs: insight.PatternRuns ?? null,
        dimension: insight.PatternDimension || ''
      } : null,
      benchmark,
      file_refs: fileRefsForRecommendation(action, insight, run)
    },
    validation,
    rollback_condition: 'Rollback the agent, skill, MCP, model, or instruction change if eval score drops, failures rise, privacy drops appear unexpectedly, or CI worsens.'
  };
}

function recommendFromFiles(options = {}) {
  const runs = readJsonl(options.runsFile);
  const evals = readJsonl(options.evalsFile);
  const insights = readJsonl(options.insightsFile);
  const benchmarkReport = options.benchmarkReportFile
    ? JSON.parse(fs.readFileSync(options.benchmarkReportFile, 'utf8'))
    : options.benchmarkRunId
      ? legacy.benchmarkReport(options.benchmarkRunId)
      : null;
  const run = pickRun(runs, options.runId);
  const insight = run ? topInsightForRun(insights, run.RunId) || matchingPatternInsight(insights, run) : null;
  const evaluation = run ? evals.find(row => row.RunId === run.RunId) || null : null;
  return buildRecommendation({ run, insight, evaluation, links: options.links, benchmarkReport });
}

function stableId(value, prefix = 'rec') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function recommendationRow(recommendation, timeGenerated = new Date().toISOString()) {
  const dashboards = recommendation.evidence?.dashboards || [];
  const pattern = recommendation.evidence?.pattern || {};
  const evaluation = recommendation.evidence?.eval || {};
  const benchmark = recommendation.evidence?.benchmark || {};
  return {
    TimeGenerated: timeGenerated,
    RecommendationId: stableId([
      recommendation.run_id || 'none',
      recommendation.action || 'none',
      recommendation.severity || 'none',
      recommendation.observed_pattern || '',
      recommendation.next_action || '',
      pattern.key || ''
    ].join('|')),
    RunId: recommendation.run_id || '',
    SessionId: recommendation.session_id || '',
    TraceId: recommendation.trace_id || '',
    Action: recommendation.action || '',
    Severity: recommendation.severity || '',
    ObservedPattern: recommendation.observed_pattern || '',
    NextAction: recommendation.next_action || '',
    PatternId: pattern.id || '',
    PatternKey: pattern.key || '',
    PatternRuns: pattern.runs ?? null,
    PatternDimension: pattern.dimension || '',
    EvalOverall: evaluation.overall ?? null,
    EvalBucket: evaluation.bucket || '',
    BenchmarkRunId: benchmark.run_id || '',
    BenchmarkDecision: benchmark.decision || '',
    BenchmarkPassRatePct: benchmark.pass_rate_pct ?? null,
    BenchmarkAverageScore: benchmark.average_score ?? null,
    BenchmarkSafetyViolationCount: benchmark.safety_violation_count ?? null,
    BenchmarkToolFailures: benchmark.tool_failures ?? null,
    BenchmarkArtifactAdded: benchmark.artifact_diff?.added ?? null,
    BenchmarkArtifactModified: benchmark.artifact_diff?.modified ?? null,
    BenchmarkArtifactDeleted: benchmark.artifact_diff?.deleted ?? null,
    BenchmarkArtifactTotalChanged: benchmark.artifact_diff?.total_changed ?? null,
    BenchmarkApprovalStatus: benchmark.approval?.status || '',
    BenchmarkApprovalCount: benchmark.approval?.approved_count ?? null,
    BenchmarkRequiredApprovals: benchmark.approval?.required_count ?? null,
    BenchmarkApprovalApprovedAt: benchmark.approval?.approved_at || '',
    BenchmarkApprovalTicket: benchmark.approval?.ticket || '',
    BenchmarkApprovalSource: benchmark.approval?.source || '',
    ChangeTargetRefs: recommendation.evidence?.file_refs || [],
    DashboardTitles: dashboards.map(dashboard => dashboard.title),
    DashboardCount: dashboards.length,
    Validation: recommendation.validation || [],
    RollbackCondition: recommendation.rollback_condition || ''
  };
}

function writeRecommendation(recommendation, outDir) {
  const absoluteDir = path.resolve(outDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const row = recommendationRow(recommendation);
  const file = path.join(absoluteDir, 'AgentOpsRecommendations_CL.jsonl');
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  const manifest = path.join(absoluteDir, 'recommendation-manifest.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    generated_at: row.TimeGenerated,
    table: 'AgentOpsRecommendations_CL',
    file,
    rows_written: 1,
    privacy: 'metadata-only; no prompts, responses, tool arguments, tool results, source code, or file contents'
  }, null, 2)}\n`);
  return { out_dir: absoluteDir, file, manifest, row };
}

function renderRecommendationV2(recommendation) {
  const lines = ['AgentOps recommendation', ''];
  lines.push(`Action: ${recommendation.action}`);
  lines.push(`Severity: ${recommendation.severity}`);
  if (recommendation.run_id) lines.push(`Run: ${recommendation.run_id}`);
  lines.push(`Observed pattern: ${recommendation.observed_pattern}`);
  lines.push(`Next action: ${recommendation.next_action}`);
  if (recommendation.evidence?.eval) {
    const evaluation = recommendation.evidence.eval;
    lines.push(`Eval: ${evaluation.overall} (${evaluation.bucket || 'unknown'})${evaluation.reason ? ` - ${evaluation.reason}` : ''}`);
  }
  if (recommendation.evidence?.pattern) {
    const pattern = recommendation.evidence.pattern;
    lines.push(`Pattern: ${pattern.key} (${pattern.runs ?? 'unknown'} run(s), ${pattern.dimension || 'unknown'})`);
  }
  if (recommendation.evidence?.benchmark) {
    const benchmark = recommendation.evidence.benchmark;
    lines.push(`Benchmark: ${benchmark.run_id || 'unknown'} (${benchmark.decision || 'unknown'}, score ${benchmark.average_score ?? 'unknown'}, pass ${benchmark.pass_rate_pct ?? 'unknown'}%)`);
  }
  if (recommendation.evidence?.file_refs?.length) lines.push(`Change targets: ${recommendation.evidence.file_refs.join(', ')}`);
  if (recommendation.evidence?.dashboards?.length) {
    lines.push('Dashboards:');
    for (const dashboard of recommendation.evidence.dashboards) lines.push(`- ${dashboard.title}: ${dashboard.url}`);
  }
  lines.push('Validation:');
  for (const item of recommendation.validation || []) lines.push(`- ${item}`);
  lines.push(`Rollback condition: ${recommendation.rollback_condition}`);
  return `${lines.join('\n')}\n`;
}

function recommendCommand(args = []) {
  const runId = firstPositional(args);
  const runsFile = optionValue(args, '--runs');
  if (!runsFile) throw new Error('recommend requires --runs <AgentOpsRunSummary_CL.jsonl> for V2 recommendations');

  const recommendation = recommendFromFiles({
    runId,
    runsFile,
    evalsFile: optionValue(args, '--evals'),
    insightsFile: optionValue(args, '--insights'),
    benchmarkReportFile: optionValue(args, '--benchmark-report'),
    benchmarkRunId: optionValue(args, '--benchmark-run')
  });
  const outDir = optionValue(args, '--out');
  const written = outDir ? writeRecommendation(recommendation, outDir) : null;
  if (written) recommendation.artifact = {
    table: 'AgentOpsRecommendations_CL',
    file: written.file,
    manifest: written.manifest,
    privacy: 'metadata-only'
  };

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(recommendation, null, 2)}\n`);
  } else {
    process.stdout.write(renderRecommendationV2(recommendation));
    if (written) process.stdout.write(`Artifact: ${written.file}\n`);
  }
}

module.exports = {
  actionFromInsight,
  buildRecommendation,
  dashboardUrl,
  benchmarkEvidenceFromReport,
  firstPositional,
  fileRefsForRecommendation,
  recommendCommand,
  recommendFromFiles,
  recommendationRow,
  renderRecommendationV2,
  matchingPatternInsight,
  writeRecommendation,
  topInsightForRun
};
