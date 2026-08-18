const assert = require('node:assert/strict');
const test = require('node:test');

const {
  dashboardBaseUrl,
  dashboardUrl,
  fileRefsForRecommendation,
  linkedDashboardsForRecommendation,
  matchingPatternInsight,
  replayUrl,
  topInsightForRun
} = require('../src/lib/recommendation-links');

const links = { v2_home_url: 'https://graf.example/d/agentops-v2-home?orgId=1' };

test('recommendation links reuse Grafana base URL and encode variables', () => {
  assert.equal(dashboardBaseUrl(links), 'https://graf.example');
  assert.equal(
    dashboardUrl('agentops-v2-run-replay', { run_id: 'run 1', empty: '', nil: null }, links),
    'https://graf.example/d/agentops-v2-run-replay?var-run_id=run%201'
  );
  assert.equal(
    replayUrl({ SessionId: 'session/1' }, links),
    'https://graf.example/d/agentops-v2-run-replay?var-session_id=session%2F1'
  );
});

test('recommendation links include dashboards relevant to the run and insight', () => {
  const dashboards = linkedDashboardsForRecommendation({
    RunId: 'run-risk',
    ToolFailureCount: 1,
    ToolDeniedCount: 1,
    EstimatedCostUsd: 0.42,
    ModelActual: 'gpt-5.5',
    PrOpened: true,
    RepoHash: 'repo#1'
  }, {
    ToolName: 'shell tool',
    PatternKey: 'cost|gpt-5.5|review'
  }, links);

  assert.deepEqual(dashboards.map(dashboard => dashboard.title), [
    'Run Story',
    'Tools & MCP Risk',
    'Models, Cost & Tokens',
    'Privacy',
    'Code Outcomes',
    'Insights Pattern'
  ]);
  assert.ok(dashboards.some(dashboard => dashboard.url.includes('var-tool_name=shell%20tool')));
  assert.ok(dashboards.some(dashboard => dashboard.url.includes('var-model=gpt-5.5')));
  assert.ok(dashboards.some(dashboard => dashboard.url.includes('var-repo_hash=repo%231')));
  assert.ok(dashboards.some(dashboard => dashboard.url.includes('var-pattern_key=cost%7Cgpt-5.5%7Creview')));
});

test('recommendation insights rank by severity then recency for a run', () => {
  const insight = topInsightForRun([
    { RunId: 'run-1', Severity: 'medium', TimeGenerated: '2026-06-03T10:00:00Z', Summary: 'medium' },
    { RunId: 'run-1', Severity: 'high', TimeGenerated: '2026-06-03T10:00:00Z', Summary: 'old high' },
    { RunId: 'run-1', Severity: 'high', TimeGenerated: '2026-06-03T11:00:00Z', Summary: 'new high' },
    { RunId: 'run-2', Severity: 'critical', TimeGenerated: '2026-06-03T12:00:00Z', Summary: 'other run' }
  ], 'run-1');

  assert.equal(insight.Summary, 'new high');
});

test('recommendation pattern insights match run dimensions and rank by runs severity and recency', () => {
  const run = {
    TaskType: 'review',
    ModelActual: 'gpt-5.5',
    RepoHash: 'repo-A',
    AgentName: 'copilot',
    PrivacyMode: 'strict',
    OutcomeReason: 'ci_failed'
  };
  const insight = matchingPatternInsight([
    { PatternKey: 'noise|other|dimension', PatternRuns: 99, Severity: 'critical', TimeGenerated: '2026-06-03T12:00:00Z', Summary: 'noise' },
    { PatternKey: 'cost|gpt-5.5|review', PatternRuns: 4, Severity: 'high', TimeGenerated: '2026-06-03T09:00:00Z', Summary: 'model' },
    { PatternKey: 'outcome|repo-A|ci_failed', PatternRuns: 8, Severity: 'medium', TimeGenerated: '2026-06-03T10:00:00Z', Summary: 'outcome' },
    { PatternKey: 'privacy|copilot|strict', PatternRuns: 10, Severity: 'low', TimeGenerated: '2026-06-03T11:00:00Z', Summary: 'agent privacy' }
  ], run);

  assert.equal(insight.Summary, 'agent privacy');
});

test('recommendation file refs map actions and regression config hashes to change targets', () => {
  assert.deepEqual(fileRefsForRecommendation('run_validation'), [
    'tests_or_benchmark_suite',
    'agent_skill_validation_step'
  ]);
  assert.deepEqual(fileRefsForRecommendation('compare_regression', { ConfigHash: 'cfg-1' }), [
    'agent_instruction_config',
    'skill_definition'
  ]);
});
