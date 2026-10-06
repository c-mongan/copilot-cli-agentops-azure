const { validateKqlDuration } = require('./kql');

const dashboardKqlHelp = {
  ok: true,
  mode: 'help',
  evidenceTier: 'help',
  usage: 'agentops dashboard kql-check [--local-only | --live] [--last <duration>] [--workspace-id <uuid>] [--require-rows] [--json]',
  description: 'Default mode executes live Azure queries. --local-only renders bounded queries without Azure access. --last must be at most 30d. --require-rows is live-only.'
};

function parseKqlCheckArgs(args, options) {
  const parsed = { last: '24h', workspaceId: options.workspaceId, localOnly: false, live: false, requireRows: false };
  const switches = { '--local-only': 'localOnly', '--live': 'live', '--require-rows': 'requireRows', '--json': 'json' };
  const values = { '--last': 'last', '--workspace-id': 'workspaceId' };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (Object.hasOwn(switches, arg)) { parsed[switches[arg]] = true; continue; }
    const equals = arg.indexOf('=');
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (!Object.hasOwn(values, name)) throw new Error(`Unknown dashboard kql-check argument: ${arg}`);
    const value = equals < 0 ? args[++index] : arg.slice(equals + 1);
    if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`);
    parsed[values[name]] = value;
  }
  parsed.last = validateKqlDuration(parsed.last);
  const seconds = Number(parsed.last.slice(0, -1)) * { s: 1, m: 60, h: 3600, d: 86400 }[parsed.last.slice(-1)];
  if (!Number.isFinite(seconds) || seconds > 30 * 86400) throw new Error('--last must be at most 30d');
  if (parsed.workspaceId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.workspaceId)) throw new Error('--workspace-id must be a workspace UUID');
  if (parsed.localOnly && parsed.live) throw new Error('--local-only cannot be combined with --live');
  if (parsed.localOnly && parsed.requireRows) throw new Error('--require-rows requires live mode');
  return parsed;
}

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
  const safeLast = validateKqlDuration(last);
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
  if (args.includes('--help') || args.includes('-h')) return { ...dashboardKqlHelp };
  const { last, workspaceId, localOnly, requireRows } = parseKqlCheckArgs(args, options);
  const { queryFromPanel, v2DashboardBodies } = require('./dashboard-validation');
  const runQuery = localOnly ? null : (options.runQuery || ((query, queryOptions) => require('../legacy').runAzureLogAnalyticsQuery(query, queryOptions)));
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
    if (localOnly) {
      checks.push({ uid, panel: panelTitle, ok: true, query });
      continue;
    }
    const result = runQuery(query, {
      spawnSync: options.spawnSync,
      workspaceId
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
    mode: localOnly ? 'local-only' : 'live',
    evidenceTier: localOnly ? 'local-query-render' : 'live-azure-query',
    last,
    require_rows: requireRows,
    checks: localOnly ? checks : checks.map(({ query, ...check }) => check),
    errors
  };
}

module.exports = {
  dashboardKqlCheck,
  substituteGrafanaMacros,
  v2KqlSmokePanels
};
