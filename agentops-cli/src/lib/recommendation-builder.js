const { changeRef } = require('./change-annotations');
const { benchmarkEvidenceFromReport } = require('./recommendation-benchmark-evidence');
const {
  dashboardUrl,
  fileRefsForRecommendation,
  linkedDashboardsForRecommendation
} = require('./recommendation-links');
const { telemetrySnapshot } = require('./recommendation-store');

function metricMovementForRecommendation(run = {}, insight = {}, evaluation = {}, benchmark = null) {
  const before = telemetrySnapshot(run, evaluation);
  const expected = [];
  if (insight?.BaselineValue !== undefined || insight?.CurrentValue !== undefined) {
    expected.push({
      metric: insight.InsightType || 'insight-value',
      baseline_value: insight.BaselineValue ?? null,
      current_value: insight.CurrentValue ?? null,
      expected_direction: insight.InsightType === 'eval-regression' ? 'increase' : 'decrease',
      source: 'insight'
    });
  }
  if (before.eval_overall !== null) {
    expected.push({
      metric: 'EvalOverall',
      baseline_value: before.eval_overall,
      current_value: before.eval_overall,
      expected_direction: 'increase',
      source: 'eval'
    });
  }
  if (benchmark?.average_score !== undefined && benchmark?.average_score !== null) {
    expected.push({
      metric: 'BenchmarkAverageScore',
      baseline_value: benchmark.average_score,
      current_value: benchmark.average_score,
      expected_direction: 'increase',
      source: 'benchmark'
    });
  }

  return {
    expected: {
      status: expected.length ? 'ready' : 'needs-baseline',
      metrics: expected
    },
    before,
    after: {},
    observed: {
      status: 'awaiting-after-run',
      compare_command: 'agentops recommend compare --recommendation-id <id> --after-runs <after-AgentOpsRunSummary_CL.jsonl> --after-evals <after-AgentOpsEval_CL.jsonl>'
    }
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

function buildRecommendation({ run, insight, evaluation, links, benchmarkReport, changeAnnotations = [] }) {
  if (!run) {
    return {
      ok: false,
      action: 'collect_data',
      severity: 'medium',
      observed_pattern: 'No AgentOps V2 run rows were available.',
      next_action: 'Run `agentops demo generate --runs 50 --with-failures --with-privacy-drops --with-github-outcomes --json` or collect a new Copilot run through the local collector.',
      evidence: { dashboards: [{ title: 'Today', url: dashboardUrl('agentops-v2-home', {}, links) }] },
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
      : 'Open Run Story and inspect the failed span, blocked tool, eval score, and GitHub outcome.');

  const benchmark = benchmarkEvidenceFromReport(benchmarkReport);
  const metricMovement = metricMovementForRecommendation(run, insight, evaluation, benchmark);
  const annotationRefs = changeAnnotations.map(changeRef).filter(Boolean);
  const validation = [
    `agentops explain ${run.RunId} --runs <AgentOpsRunSummary_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>`,
    'agentops dashboard kql-check --last 24h --json'
  ];
  if (changeAnnotations.length) validation.push(`agentops annotation config-change --component <component> --target <target> --run-id ${run.RunId}`);
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
      metric_movement: metricMovement,
      change_annotations: changeAnnotations,
      file_refs: [...new Set([...fileRefsForRecommendation(action, insight, run), ...annotationRefs])]
    },
    validation,
    rollback_condition: 'Rollback the agent, skill, MCP, model, or instruction change if eval score drops, failures rise, privacy drops appear unexpectedly, or CI worsens.'
  };
}

module.exports = {
  actionFromInsight,
  buildRecommendation,
  metricMovementForRecommendation
};
