const legacy = require('../legacy');

const severityRank = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

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
  const dashboards = [{ title: 'Run Story', url: replayUrl(run, links) }];
  if (insight?.ToolName || Number(run?.ToolFailureCount || 0) > 0 || Number(run?.ToolDeniedCount || 0) > 0) {
    dashboards.push({ title: 'Tools & MCP Risk', url: dashboardUrl('agentops-v2-tools-mcp-risk', insight?.ToolName ? { tool_name: insight.ToolName } : {}, links) });
  }
  if (Number(run?.EstimatedCostUsd || 0) > 0 || run?.ModelActual) {
    dashboards.push({ title: 'Models, Cost & Tokens', url: dashboardUrl('agentops-v2-models-cost-tokens', run?.ModelActual ? { model: run.ModelActual } : {}, links) });
  }
  if (Number(run?.ToolDeniedCount || 0) > 0 || insight?.InsightType === 'privacy-drop') {
    dashboards.push({ title: 'Privacy', url: dashboardUrl('agentops-v2-safety-privacy-policy', {}, links) });
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

module.exports = {
  dashboardBaseUrl,
  dashboardUrl,
  fileRefsForRecommendation,
  linkedDashboardsForRecommendation,
  matchingPatternInsight,
  replayUrl,
  topInsightForRun
};
