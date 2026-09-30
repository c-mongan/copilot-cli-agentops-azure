const { hasFlag, optionValue } = require('./args');
const {
  queryFromPanel,
  v2DashboardBodies
} = require('./dashboard-validation');
const legacy = require('../legacy');

const v2KqlSmokePanels = [
  { uid: 'agentops-v2-home', panel: 'Session Health', requireRows: true },
  { uid: 'agentops-v2-home', panel: 'Recommended next actions', requireRows: false },
  { uid: 'agentops-v2-home', panel: 'Saved investigations', requireRows: false },
  { uid: 'agentops-v2-runs-explorer', panel: 'Runs', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Run summary', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Agent, skill, and MCP lineage', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Context and cache posture', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Why this failed / next check', requireRows: false },
  { uid: 'agentops-v2-run-replay', panel: 'Ask AgentOps context', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Transcript availability', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Prompt and response viewer (explicit opt-in)', requireRows: false },
  { uid: 'agentops-v2-models-cost-tokens', panel: 'Model ROI', requireRows: true },
  { uid: 'agentops-v2-tools-mcp-risk', panel: 'Tool risk table', requireRows: true },
  { uid: 'agentops-v2-safety-privacy-policy', panel: 'Blocked or redacted items by kind', requireRows: false },
  { uid: 'agentops-v2-safety-privacy-policy', panel: 'Alert handoff review', requireRows: false },
  { uid: 'agentops-v2-code-outcomes', panel: 'Runs and PR outcomes', requireRows: true },
  { uid: 'agentops-v2-code-outcomes', panel: 'Delivery timing', requireRows: true },
  { uid: 'agentops-v2-evals-quality', panel: 'Low-score runs', requireRows: true },
  { uid: 'agentops-v2-evals-quality', panel: 'Eval scorecard by repo, model, and task', requireRows: true },
  { uid: 'agentops-v2-evals-quality', panel: 'Eval regression follow-up', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Before/after run comparison', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark artifact diff review', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark artifact files', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark hidden check packs', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark policy review', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark semantic checks', requireRows: false },
  { uid: 'agentops-v2-evals-quality', panel: 'Benchmark promotion approvals', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Latest insights', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Recurring patterns', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Eval regression queue', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Recommendation artifacts', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Config change annotations', requireRows: false },
  { uid: 'agentops-v2-collector-health', panel: 'Collector checks', requireRows: true },
  { uid: 'agentops-v2-collector-health', panel: 'Schema version coverage', requireRows: false },
  { uid: 'agentops-v2-collector-health', panel: 'Exporter failure review', requireRows: false }
];

function substituteGrafanaMacros(query, { last = '24h' } = {}) {
  const safeLast = legacy.validateKqlDuration(last);
  const variableNames = [
    'datasource',
    'workspace',
    'timeRange',
    'run_id',
    'session_id',
    'trace_id',
    'surface',
    'repo_hash',
    'branch_hash',
    'model',
    'agent_name',
    'skill_name',
    'mcp_server',
    'sub_agent',
    'task_type',
    'tool_name',
    'tool_risk',
    'pattern_key',
    'privacy_mode',
    'outcome_status',
    'eval_bucket'
  ];
  let rendered = String(query || '')
    .replaceAll('$__timeFrom()', `ago(${safeLast})`)
    .replaceAll('$__timeTo()', 'now()')
    .replaceAll('$__interval', '1h');
  for (const name of variableNames) {
    rendered = rendered
      .replaceAll(`$${name}`, '__all')
      .replaceAll(`\${${name}}`, '__all');
  }
  return `${rendered}\n| take 5`;
}

function dashboardKqlCheck(args = [], options = {}) {
  const last = optionValue(args, '--last', '24h');
  const requireRows = hasFlag(args, '--require-rows');
  const runQuery = options.runQuery || ((query, queryOptions) => legacy.runAzureLogAnalyticsQuery(query, queryOptions));
  const dashboards = (options.dashboardBodies || v2DashboardBodies)();
  const smokePanels = options.smokePanels || v2KqlSmokePanels;
  const byUid = new Map(dashboards.map(item => [item.body.uid, item]));
  const checks = [];

  for (const smokePanel of smokePanels) {
    const { uid, panel: panelTitle } = smokePanel;
    const dashboard = byUid.get(uid);
    if (!dashboard) {
      checks.push({ uid, panel: panelTitle, ok: false, rows: 0, error: 'dashboard not found' });
      continue;
    }
    const panel = (dashboard.body.panels || []).find(item => item.title === panelTitle && queryFromPanel(item));
    const rawQuery = queryFromPanel(panel);
    if (!rawQuery) {
      checks.push({ uid, panel: panelTitle, ok: false, rows: 0, error: 'panel query not found' });
      continue;
    }
    const query = substituteGrafanaMacros(rawQuery, { last });
    const result = runQuery(query, {
      spawnSync: options.spawnSync,
      workspaceId: optionValue(args, '--workspace-id', options.workspaceId)
    });
    const rows = Array.isArray(result.rows) ? result.rows.length : 0;
    const rowsRequired = requireRows && smokePanel.requireRows !== false;
    const ok = Boolean(result.ok) && (!rowsRequired || rows > 0);
    checks.push({
      uid,
      panel: panelTitle,
      ok,
      rows,
      require_rows: rowsRequired,
      error: ok ? '' : (result.error || (rowsRequired ? 'query returned no rows' : 'query failed')),
      query
    });
  }

  const errors = checks.filter(check => !check.ok).map(check => `${check.uid}/${check.panel}: ${check.error}`);
  return {
    ok: errors.length === 0,
    last: legacy.validateKqlDuration(last),
    require_rows: requireRows,
    checks: checks.map(({ query, ...check }) => check),
    errors
  };
}

module.exports = {
  dashboardKqlCheck,
  substituteGrafanaMacros,
  v2KqlSmokePanels
};
