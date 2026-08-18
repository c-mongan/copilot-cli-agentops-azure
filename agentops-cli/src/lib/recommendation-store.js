const fs = require('node:fs');
const path = require('node:path');

const { optionValue } = require('./args');
const { appendJsonlFile, writeJsonFile, writeJsonlFile } = require('./command-output');
const { latestByTime } = require('./explain/v2-explain');
const { prefixedHash: stableId } = require('./hash');
const { readJson, readJsonl } = require('./json');
const { defaultUserAgentOpsPath } = require('./paths');
const { AGENTOPS_SCHEMA_VERSION } = require('./schema/agentops-attributes');
const { validateRecommendationRow } = require('./schema/recommendation-schema');

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function telemetrySnapshot(run = {}, evaluation = {}) {
  return {
    run_id: run.RunId || '',
    eval_overall: evaluation?.EvalOverall ?? run.EvalOverall ?? null,
    eval_bucket: evaluation?.EvalBucket || '',
    estimated_cost_usd: run.EstimatedCostUsd ?? null,
    input_tokens: run.InputTokens ?? null,
    output_tokens: run.OutputTokens ?? null,
    tool_failure_count: run.ToolFailureCount ?? null,
    tool_denied_count: run.ToolDeniedCount ?? null,
    risk_score: run.RiskScore ?? null,
    outcome_status: run.OutcomeStatus || ''
  };
}

function recommendationRow(recommendation, timeGenerated = new Date().toISOString()) {
  const dashboards = recommendation.evidence?.dashboards || [];
  const pattern = recommendation.evidence?.pattern || {};
  const evaluation = recommendation.evidence?.eval || {};
  const benchmark = recommendation.evidence?.benchmark || {};
  const metricMovement = recommendation.evidence?.metric_movement || {};
  const changeAnnotations = recommendation.evidence?.change_annotations || [];
  return {
    TimeGenerated: timeGenerated,
    SchemaVersion: AGENTOPS_SCHEMA_VERSION,
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
    BenchmarkArtifactFiles: benchmark.artifact_files || [],
    BenchmarkArtifactContentDiffs: benchmark.artifact_content_diffs || [],
    BenchmarkHiddenChecksPassed: benchmark.hidden_checks?.passed ?? null,
    BenchmarkHiddenChecksFailed: benchmark.hidden_checks?.failed ?? null,
    BenchmarkHiddenCheckPacks: benchmark.hidden_checks?.packs || [],
    BenchmarkPolicyBlocks: benchmark.policy?.blocks ?? null,
    BenchmarkPermissionProfiles: benchmark.policy?.permission_profiles || {},
    BenchmarkPolicyTasks: benchmark.policy?.tasks || [],
    BenchmarkSemanticCheckCount: benchmark.semantic_checks?.count ?? null,
    BenchmarkSemanticAverageScore: benchmark.semantic_checks?.average_score ?? null,
    BenchmarkSemanticChecks: benchmark.semantic_checks?.checks || [],
    BenchmarkApprovalStatus: benchmark.approval?.status || '',
    BenchmarkApprovalCount: benchmark.approval?.approved_count ?? null,
    BenchmarkRequiredApprovals: benchmark.approval?.required_count ?? null,
    BenchmarkApprovalApprovedAt: benchmark.approval?.approved_at || '',
    BenchmarkApprovalTicket: benchmark.approval?.ticket || '',
    BenchmarkApprovalSource: benchmark.approval?.source || '',
    ExpectedMetricMovement: metricMovement.expected || {},
    BeforeTelemetry: metricMovement.before || {},
    AfterTelemetry: metricMovement.after || {},
    ObservedMetricMovement: metricMovement.observed || {},
    ChangeAnnotations: changeAnnotations,
    ChangeTargetRefs: recommendation.evidence?.file_refs || [],
    DashboardTitles: dashboards.map(dashboard => dashboard.title),
    DashboardCount: dashboards.length,
    Validation: recommendation.validation || [],
    RollbackCondition: recommendation.rollback_condition || ''
  };
}

function writeRecommendation(recommendation, outDir) {
  const absoluteDir = path.resolve(outDir);
  const row = recommendationRow(recommendation);
  const validation = validateRecommendationRow(row);
  if (!validation.ok) throw new Error(`recommendation row failed schema validation: ${validation.errors.join('; ')}`);
  const file = path.join(absoluteDir, 'AgentOpsRecommendations_CL.jsonl');
  appendJsonlFile(file, row);
  const manifest = path.join(absoluteDir, 'recommendation-manifest.json');
  writeJsonFile(manifest, {
    generated_at: row.TimeGenerated,
    table: 'AgentOpsRecommendations_CL',
    file,
    rows_written: 1,
    privacy: 'metadata-only; no prompts, responses, tool arguments, tool results, source code, or file contents'
  });
  return { out_dir: absoluteDir, file, manifest, row };
}

function defaultRecommendationStorePath() {
  return process.env.AGENTOPS_RECOMMENDATIONS_PATH || defaultUserAgentOpsPath('recommendations.json');
}

function readRecommendationStore(filePath = defaultRecommendationStorePath()) {
  if (!fs.existsSync(filePath)) return { recommendations: [] };
  const payload = readJson(filePath);
  return {
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : []
  };
}

function writeRecommendationStore(payload, filePath = defaultRecommendationStorePath()) {
  writeJsonFile(filePath, payload);
}

function saveRecommendation(recommendation, filePath = defaultRecommendationStorePath(), timeGenerated = new Date().toISOString()) {
  const row = recommendationRow(recommendation, timeGenerated);
  const validation = validateRecommendationRow(row);
  if (!validation.ok) throw new Error(`recommendation row failed schema validation: ${validation.errors.join('; ')}`);
  const payload = readRecommendationStore(filePath);
  const next = payload.recommendations
    .filter(item => item.RecommendationId !== row.RecommendationId)
    .concat(row)
    .sort((left, right) => String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || '')));
  writeRecommendationStore({ recommendations: next }, filePath);
  return { path: filePath, saved: row, count: next.length };
}

function exportRecommendationStore({ storePath = defaultRecommendationStorePath(), outDir } = {}) {
  const payload = readRecommendationStore(storePath);
  const absoluteDir = path.resolve(outDir || path.join(path.dirname(storePath), 'recommendations-export'));
  const rows = payload.recommendations;
  const file = path.join(absoluteDir, 'AgentOpsRecommendations_CL.jsonl');
  writeJsonlFile(file, rows);
  const manifest = path.join(absoluteDir, 'recommendations-manifest.json');
  writeJsonFile(manifest, {
    generated_at: new Date().toISOString(),
    table: 'AgentOpsRecommendations_CL',
    file,
    rows_written: rows.length,
    privacy: 'metadata-only; no prompts, responses, tool arguments, tool results, source code, or file contents'
  });
  return { out_dir: absoluteDir, file, manifest, rows_written: rows.length, rows };
}

function metricValue(snapshot = {}, metric) {
  const key = {
    EvalOverall: 'eval_overall',
    EstimatedCostUsd: 'estimated_cost_usd',
    ToolFailureCount: 'tool_failure_count',
    ToolDeniedCount: 'tool_denied_count',
    RiskScore: 'risk_score'
  }[metric] || metric;
  return snapshot[key];
}

function movementResults(row = {}, after = {}) {
  const before = row.BeforeTelemetry || {};
  const expected = Array.isArray(row.ExpectedMetricMovement?.metrics) ? row.ExpectedMetricMovement.metrics : [];
  return expected
    .map(metric => {
      const name = metric.metric;
      const beforeValue = metricValue(before, name) ?? metric.current_value ?? metric.baseline_value ?? null;
      const afterValue = metricValue(after, name);
      if (typeof beforeValue !== 'number' || typeof afterValue !== 'number') return null;
      const direction = metric.expected_direction || 'decrease';
      const delta = Number((afterValue - beforeValue).toFixed(6));
      const passed = direction === 'increase' ? delta >= 0 : delta <= 0;
      return {
        metric: name,
        expected_direction: direction,
        before_value: beforeValue,
        after_value: afterValue,
        delta,
        passed
      };
    })
    .filter(Boolean);
}

function observedMovementStatus(results = []) {
  if (results.length === 0) return 'no-comparable-metrics';
  if (results.every(result => result.passed)) return 'improved';
  if (results.every(result => !result.passed)) return 'regressed';
  return 'mixed';
}

function reviewDecision(row = {}) {
  return stringValue(row.OperatorReview?.decision || row.OperatorReview?.status).toLowerCase();
}

function safeToken(value, fallback = 'recommendation') {
  return stringValue(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || fallback;
}

function recommendationActionPlanForRow(row = {}, options = {}) {
  const validation = validateRecommendationRow(row);
  if (!validation.ok) throw new Error(`recommendation row failed schema validation: ${validation.errors.join('; ')}`);

  const decision = reviewDecision(row);
  const movementStatus = stringValue(row.ObservedMetricMovement?.status);
  const benchmarkDecision = stringValue(row.BenchmarkDecision);
  const approved = decision === 'approve' || decision === 'approved';
  const blockedReasons = [
    approved ? '' : 'operator review approval is required',
    movementStatus === 'regressed' ? 'observed metric movement regressed' : '',
    benchmarkDecision === 'reject' ? 'benchmark decision rejected the recommendation' : '',
    Array.isArray(row.Validation) && row.Validation.length > 0 ? '' : 'validation steps are required',
    row.RollbackCondition ? '' : 'rollback condition is required'
  ].filter(Boolean);
  const hypothesis = safeToken(options.hypothesis || row.RecommendationId || row.RunId, 'recommendation');
  const benchmarkSuite = safeToken(options.benchmarkSuite || 'starter', 'starter');
  const branch = `agentops/${hypothesis}`;
  const targetRefs = Array.isArray(row.ChangeTargetRefs) ? row.ChangeTargetRefs : [];
  const patchPrompt = [
    `Implement approved AgentOps recommendation ${row.RecommendationId}.`,
    `Action: ${row.Action}.`,
    `Observed pattern: ${row.ObservedPattern}.`,
    `Next action: ${row.NextAction}.`,
    targetRefs.length ? `Change targets: ${targetRefs.join(', ')}.` : 'Infer the smallest safe target from the recommendation metadata.',
    row.BenchmarkRunId ? `Benchmark evidence: ${row.BenchmarkRunId} (${benchmarkDecision || 'unknown'}).` : '',
    movementStatus ? `Observed metric movement: ${movementStatus}.` : '',
    'Keep prompts, responses, tool arguments, tool results, source code, file contents, request bodies, response bodies, and secrets out of telemetry artifacts.',
    `Validation: ${(row.Validation || []).join(' | ') || 'run the benchmark/report commands in this plan'}.`,
    `Rollback: ${row.RollbackCondition}.`
  ].filter(Boolean).join('\n');

  return {
    schema_version: 'agentops.recommendation-action-plan.v1',
    mode: 'metadata-only-recommendation-action-plan',
    status: blockedReasons.length ? 'needs-review' : 'ready',
    recommendation_id: row.RecommendationId || null,
    run_id: row.RunId || null,
    operator_review: row.OperatorReview || {},
    blocked_reasons: blockedReasons,
    guardrails: [
      'Create a branch before editing files.',
      'Make only the minimal patch described by the approved recommendation metadata.',
      'Run benchmark and recommendation comparison before promoting the change.',
      'Reject or rollback if validation fails, metric movement regresses, cost rises unexpectedly, or privacy signals appear.'
    ],
    commands: {
      create_branch: `git checkout -b ${branch}`,
      patch_prompt: patchPrompt,
      benchmark_dry_run: `agentops benchmark run ${benchmarkSuite} --variant ${hypothesis} --repeat 1 --hypothesis ${hypothesis} --dry-run`,
      benchmark_run: `agentops benchmark run ${benchmarkSuite} --variant ${hypothesis} --repeat 1 --hypothesis ${hypothesis}`,
      benchmark_report: 'agentops benchmark report <candidate-run-id>',
      compare_after_run: `agentops recommend compare --recommendation-id ${row.RecommendationId || '<id>'} --after-runs <after-AgentOpsRunSummary_CL.jsonl> --after-evals <after-AgentOpsEval_CL.jsonl>`
    },
    evidence: {
      change_target_refs: targetRefs,
      validation: row.Validation || [],
      rollback_condition: row.RollbackCondition || '',
      expected_metric_movement: row.ExpectedMetricMovement || {},
      observed_metric_movement: row.ObservedMetricMovement || {},
      before_telemetry: row.BeforeTelemetry || {},
      after_telemetry: row.AfterTelemetry || {}
    },
    next: blockedReasons.length
      ? ['Resolve blocked reasons, then regenerate this action plan.']
      : [
          'Create the branch.',
          'Apply the minimal patch using the patch prompt.',
          'Run the benchmark dry-run, benchmark run, benchmark report, and recommendation compare commands.',
          'Promote only if benchmark and after-run movement pass.'
        ]
  };
}

function recommendationActionPlan({
  storePath = defaultRecommendationStorePath(),
  recommendationId,
  benchmarkSuite,
  hypothesis
} = {}) {
  if (!recommendationId) throw new Error('recommend action-plan requires --recommendation-id <id>');
  const payload = readRecommendationStore(storePath);
  const row = payload.recommendations.find(item => item.RecommendationId === recommendationId);
  if (!row) throw new Error(`recommendation not found: ${recommendationId}`);
  return {
    path: storePath,
    action_plan: recommendationActionPlanForRow(row, { benchmarkSuite, hypothesis })
  };
}

function compareRecommendationAfterRun({
  storePath = defaultRecommendationStorePath(),
  recommendationId,
  afterRunsFile,
  afterEvalsFile,
  afterRunId,
  comparedAt = new Date().toISOString()
} = {}) {
  if (!recommendationId) throw new Error('recommend compare requires --recommendation-id <id>');
  if (!afterRunsFile) throw new Error('recommend compare requires --after-runs <AgentOpsRunSummary_CL.jsonl>');

  const payload = readRecommendationStore(storePath);
  const row = payload.recommendations.find(item => item.RecommendationId === recommendationId);
  if (!row) throw new Error(`recommendation not found: ${recommendationId}`);

  const afterRuns = readJsonl(afterRunsFile);
  const afterRun = afterRunId
    ? afterRuns.find(item => item.RunId === afterRunId)
    : latestByTime(afterRuns);
  if (!afterRun) throw new Error('no after-run rows were available');

  const afterEval = readJsonl(afterEvalsFile).find(item => item.RunId === afterRun.RunId) || null;
  const after = telemetrySnapshot(afterRun, afterEval);
  const results = movementResults(row, after);
  const updated = {
    ...row,
    AfterTelemetry: after,
    ObservedMetricMovement: {
      status: observedMovementStatus(results),
      compared_at: comparedAt,
      after_run_id: after.RunId || after.run_id || afterRun.RunId || '',
      results
    }
  };
  const validation = validateRecommendationRow(updated);
  if (!validation.ok) throw new Error(`updated recommendation row failed schema validation: ${validation.errors.join('; ')}`);

  const next = payload.recommendations
    .map(item => item.RecommendationId === recommendationId ? updated : item)
    .sort((left, right) => String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || '')));
  writeRecommendationStore({ recommendations: next }, storePath);
  return { path: storePath, updated, after_run: afterRun.RunId || '', status: updated.ObservedMetricMovement.status };
}

function recommendationStoreCommand(args = []) {
  const subcommand = args[0];
  const storePath = optionValue(args, '--store') || defaultRecommendationStorePath();
  if (subcommand === 'list') {
    const payload = readRecommendationStore(storePath);
    return {
      path: storePath,
      recommendations: payload.recommendations.map(row => ({
        RecommendationId: row.RecommendationId,
        TimeGenerated: row.TimeGenerated,
        Severity: row.Severity,
        Action: row.Action,
        RunId: row.RunId,
        NextAction: row.NextAction,
        ObservedMetricMovementStatus: row.ObservedMetricMovement?.status || '',
        ChangeTargetRefs: row.ChangeTargetRefs || []
      }))
    };
  }
  if (subcommand === 'export') {
    return {
      path: storePath,
      export: exportRecommendationStore({ storePath, outDir: optionValue(args, '--out') })
    };
  }
  if (subcommand === 'compare') {
    return compareRecommendationAfterRun({
      storePath,
      recommendationId: optionValue(args, '--recommendation-id'),
      afterRunsFile: optionValue(args, '--after-runs'),
      afterEvalsFile: optionValue(args, '--after-evals'),
      afterRunId: optionValue(args, '--after-run-id')
    });
  }
  if (subcommand === 'action-plan') {
    return recommendationActionPlan({
      storePath,
      recommendationId: optionValue(args, '--recommendation-id'),
      benchmarkSuite: optionValue(args, '--benchmark-suite'),
      hypothesis: optionValue(args, '--hypothesis')
    });
  }
  throw new Error('recommend requires latest|<run-id>, list, export, compare, or action-plan');
}

module.exports = {
  compareRecommendationAfterRun,
  defaultRecommendationStorePath,
  exportRecommendationStore,
  readRecommendationStore,
  recommendationActionPlan,
  recommendationActionPlanForRow,
  recommendationRow,
  recommendationStoreCommand,
  saveRecommendation,
  telemetrySnapshot,
  writeRecommendation,
  writeRecommendationStore
};
