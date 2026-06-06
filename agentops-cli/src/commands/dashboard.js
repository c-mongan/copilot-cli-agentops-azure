const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { hasFlag, optionValue } = require('../lib/args');
const { validateDashboardContentGuardrails } = require('../lib/dashboard-content-guardrails');
const { repoRoot } = require('../lib/paths');
const legacy = require('../legacy');

function dashboardJsonFiles() {
  const roots = [
    path.join(repoRoot, 'grafana'),
    path.join(repoRoot, 'grafana', 'dashboards', 'v2')
  ];
  return roots.flatMap(root => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(root, file));
  }).sort();
}

function validateDashboards() {
  const files = dashboardJsonFiles();
  const errors = [];
  const requiredV2Variables = new Set([
    'datasource',
    'workspace',
    'timeRange',
    'actioner_url',
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
  ]);

  for (const file of files) {
    let dashboard;
    try {
      dashboard = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      errors.push(`${file}: invalid JSON: ${error.message}`);
      continue;
    }
    if (!dashboard.uid) errors.push(`${file}: missing uid`);
    if (!dashboard.title) errors.push(`${file}: missing title`);
    if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) errors.push(`${file}: missing panels`);
    if (file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`)) {
      const variables = new Set((dashboard.templating?.list || []).map(item => item.name));
      for (const variable of requiredV2Variables) {
        if (!variables.has(variable)) errors.push(`${file}: missing V2 variable ${variable}`);
      }
      if (!Array.isArray(dashboard.links) || dashboard.links.length < 5) errors.push(`${file}: missing V2 nav links`);
    }
  }

  return {
    ok: errors.length === 0,
    dashboards: files.length,
    errors
  };
}

function collectPanelLinks(panel, links = []) {
  for (const link of panel.fieldConfig?.defaults?.links || []) links.push({ panel: panel.title, link });
  for (const override of panel.fieldConfig?.overrides || []) {
    const field = override.matcher?.options || 'unknown-field';
    for (const property of override.properties || []) {
      if (property.id !== 'links') continue;
      for (const link of property.value || []) links.push({ panel: panel.title, field, link });
    }
  }
  for (const child of panel.panels || []) collectPanelLinks(child, links);
  return links;
}

function validateDashboardLinks() {
  const files = dashboardJsonFiles().filter(file => file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`));
  const dashboards = files.map(file => ({ file, body: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  const uidSet = new Set(dashboards.map(item => item.body.uid));
  const errors = [];
  const expectedNav = [
    'agentops-v2-home',
    'agentops-v2-runs-explorer',
    'agentops-v2-run-replay',
    'agentops-v2-models-cost-tokens',
    'agentops-v2-tools-mcp-risk',
    'agentops-v2-safety-privacy-policy',
    'agentops-v2-code-outcomes',
    'agentops-v2-evals-quality',
    'agentops-v2-insights-regressions',
    'agentops-v2-collector-health'
  ];
  const requiredDataLinks = [
    { field: 'RunId', uid: 'agentops-v2-run-replay', variable: 'var-run_id', time: true },
    { field: 'SessionId', uid: 'agentops-v2-run-replay', variable: 'var-session_id', time: true },
    { field: 'TraceId', uid: 'agentops-v2-run-replay', variable: 'var-trace_id', time: true },
    { field: 'ToolName', uid: 'agentops-v2-tools-mcp-risk', variable: 'var-tool_name', time: true },
    { field: 'McpServer', uid: 'agentops-v2-tools-mcp-risk', variable: 'var-mcp_server', time: true },
    { field: 'ModelActual', uid: 'agentops-v2-models-cost-tokens', variable: 'var-model', time: true },
    { field: 'AgentName', uid: 'agentops-v2-runs-explorer', variable: 'var-agent_name', time: true },
    { field: 'SkillName', uid: 'agentops-v2-runs-explorer', variable: 'var-skill_name', time: true },
    { field: 'SubAgentName', uid: 'agentops-v2-run-replay', variable: 'var-sub_agent', time: true },
    { field: 'RepoHash', uid: 'agentops-v2-runs-explorer', variable: 'var-repo_hash', time: true },
    { field: 'PrNumberHash', uid: 'agentops-v2-code-outcomes', variable: 'var-repo_hash', time: true },
    { field: 'CiStatus', uid: 'agentops-v2-code-outcomes', variable: 'var-outcome_status', time: true },
    { field: 'EvalOverall', uid: 'agentops-v2-evals-quality', variable: 'var-run_id', time: true },
    { field: 'PatternKey', uid: 'agentops-v2-insights-regressions', variable: 'var-pattern_key', time: true },
    { field: 'OpenTranscript', uid: 'agentops-v2-run-replay', variable: 'viewPanel=26', time: true },
    { field: 'OpenReplay', uid: 'agentops-v2-run-replay', variable: 'var-run_id', time: true },
    { field: 'OpenTrace', uid: 'agentops-v2-run-replay', variable: 'var-trace_id', time: true },
    { field: 'OpenGithub', uid: 'agentops-v2-code-outcomes', variable: 'var-run_id', time: true },
    { field: 'OpenPattern', uid: 'agentops-v2-insights-regressions', variable: 'var-pattern_key', time: true }
  ];

  for (const { file, body } of dashboards) {
    const navUids = new Set((body.links || []).map(link => link.uid).filter(Boolean));
    for (const uid of expectedNav) {
      if (!navUids.has(uid)) errors.push(`${file}: missing nav link to ${uid}`);
    }
    for (const link of body.links || []) {
      if (link.uid && !uidSet.has(link.uid)) errors.push(`${file}: nav target ${link.uid} does not exist`);
      if (link.uid && link.url !== `/d/${link.uid}`) errors.push(`${file}: nav link ${link.uid} should use /d/${link.uid}`);
      if (link.uid && link.keepTime !== true) errors.push(`${file}: nav link ${link.uid} must preserve the active time range`);
      if (link.uid && link.includeVars !== true) errors.push(`${file}: nav link ${link.uid} must preserve active dashboard filters`);
    }

    const panelLinks = (body.panels || []).flatMap(panel => collectPanelLinks(panel));
    for (const item of panelLinks) {
      const match = String(item.link?.url || '').match(/\/d\/([^?]+)/);
      if (match && !uidSet.has(match[1])) errors.push(`${file}: panel ${item.panel} links to missing dashboard ${match[1]}`);
    }
    for (const required of requiredDataLinks) {
      const matching = panelLinks.filter(item => item.field === required.field);
      if (matching.length === 0) {
        errors.push(`${file}: missing data link for ${required.field}`);
        continue;
      }
      if (!matching.some(item => String(item.link.url || '').includes(`/d/${required.uid}`))) {
        errors.push(`${file}: ${required.field} data link does not target ${required.uid}`);
      }
      if (!matching.some(item => String(item.link.url || '').includes(required.variable))) {
        errors.push(`${file}: ${required.field} data link does not set ${required.variable}`);
      }
      if (required.time && !matching.some(item => String(item.link.url || '').includes('__url_time_range'))) {
        errors.push(`${file}: ${required.field} data link does not preserve time range`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    dashboards: dashboards.length,
    checked_links: dashboards.reduce((total, item) => total + (item.body.links || []).length + (item.body.panels || []).flatMap(panel => collectPanelLinks(panel)).length, 0),
    errors
  };
}

function validateDashboardFilters() {
  const dashboards = v2DashboardBodies();
  const errors = [];
  const requiredChoices = {
    surface: ['__all', 'cli', 'sdk', 'vscode_mcp', 'github_action', 'cloud_agent', 'custom'],
    task_type: ['__all', 'explain', 'review', 'test', 'fix', 'refactor', 'docs', 'debug_ci', 'unknown'],
    tool_risk: ['__all', 'read-only', 'write-file', 'shell', 'network', 'secret-access', 'browser-control', 'destructive', 'privileged'],
    privacy_mode: ['__all', 'strict', 'compat', 'unsafe'],
    outcome_status: ['__all', 'success', 'failed', 'cancelled', 'blocked', 'unknown'],
    eval_bucket: ['__all', 'ok', 'review', 'poor']
  };
  const queryFilterContracts = {
    'agentops-v2-home': ['run_id', 'session_id', 'trace_id', 'surface', 'repo_hash', 'branch_hash', 'model', 'agent_name', 'skill_name', 'sub_agent', 'task_type', 'privacy_mode', 'outcome_status', 'eval_bucket'],
    'agentops-v2-runs-explorer': ['run_id', 'session_id', 'trace_id', 'surface', 'repo_hash', 'branch_hash', 'model', 'agent_name', 'skill_name', 'sub_agent', 'task_type', 'privacy_mode', 'outcome_status', 'eval_bucket'],
    'agentops-v2-run-replay': ['run_id', 'session_id', 'trace_id', 'surface', 'repo_hash', 'branch_hash', 'model', 'agent_name', 'skill_name', 'sub_agent', 'task_type', 'privacy_mode', 'outcome_status', 'eval_bucket'],
    'agentops-v2-models-cost-tokens': ['run_id', 'session_id', 'trace_id', 'surface', 'repo_hash', 'branch_hash', 'model', 'agent_name', 'skill_name', 'sub_agent', 'task_type', 'privacy_mode', 'outcome_status', 'eval_bucket'],
    'agentops-v2-tools-mcp-risk': ['run_id', 'trace_id', 'surface', 'agent_name', 'mcp_server', 'tool_name', 'tool_risk'],
    'agentops-v2-safety-privacy-policy': ['run_id', 'session_id', 'trace_id', 'surface', 'repo_hash', 'branch_hash', 'model', 'agent_name', 'skill_name', 'sub_agent', 'task_type', 'privacy_mode', 'outcome_status', 'eval_bucket'],
    'agentops-v2-code-outcomes': ['run_id', 'repo_hash', 'branch_hash', 'outcome_status'],
    'agentops-v2-evals-quality': ['run_id', 'repo_hash', 'model', 'task_type', 'eval_bucket'],
    'agentops-v2-insights-regressions': ['run_id', 'repo_hash', 'model', 'task_type', 'tool_name', 'pattern_key', 'eval_bucket'],
    'agentops-v2-collector-health': ['privacy_mode']
  };

  for (const { file, body } of dashboards) {
    const variables = new Set((body.templating?.list || []).map(item => item.name));
    const queryText = (body.panels || [])
      .flatMap(panel => [panel, ...(panel.panels || [])])
      .flatMap(panel => panel.targets || [])
      .map(target => target.azureLogAnalytics?.query || target.query || '')
      .join('\n');
    const expected = queryFilterContracts[body.uid] || [];

    for (const variable of expected) {
      if (!variables.has(variable)) errors.push(`${file}: missing filter variable ${variable}`);
      if (!queryText.includes(`$${variable}`) && !queryText.includes(`\${${variable}}`)) {
        errors.push(`${file}: filter ${variable} is not wired into any panel query`);
      }
    }
    for (const [name, values] of Object.entries(requiredChoices)) {
      const variable = (body.templating?.list || []).find(item => item.name === name);
      if (!variable) continue;
      const choices = String(variable.query || '').split(',').map(value => value.trim()).filter(Boolean);
      for (const value of values) {
        if (!choices.includes(value)) errors.push(`${file}: filter ${name} missing dropdown value ${value}`);
      }
    }
    if (expected.includes('eval_bucket') && !queryText.includes("iff('$eval_bucket' == 'ok', 'good', '$eval_bucket')")) {
      errors.push(`${file}: eval_bucket filter must accept ok as the user-facing alias for good`);
    }
    for (const link of body.links || []) {
      if (link.uid && link.includeVars !== true) errors.push(`${file}: nav link ${link.uid} does not carry filters`);
      if (link.uid && link.keepTime !== true) errors.push(`${file}: nav link ${link.uid} does not carry time range`);
    }
  }

  return {
    ok: errors.length === 0,
    dashboards: dashboards.length,
    errors
  };
}

const v2KqlSmokePanels = [
  { uid: 'agentops-v2-home', panel: 'Session Health', requireRows: true },
  { uid: 'agentops-v2-home', panel: 'Recommended next actions', requireRows: true },
  { uid: 'agentops-v2-home', panel: 'Saved investigations', requireRows: false },
  { uid: 'agentops-v2-runs-explorer', panel: 'Runs', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Run summary', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Agent, skill, and MCP lineage', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Context and cache posture', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Why this failed / next check', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Ask AgentOps context', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Transcript availability', requireRows: true },
  { uid: 'agentops-v2-run-replay', panel: 'Prompt and response viewer (explicit opt-in)', requireRows: false },
  { uid: 'agentops-v2-models-cost-tokens', panel: 'Model ROI', requireRows: true },
  { uid: 'agentops-v2-tools-mcp-risk', panel: 'Tool risk table', requireRows: true },
  { uid: 'agentops-v2-safety-privacy-policy', panel: 'Privacy drops by kind', requireRows: true },
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
  { uid: 'agentops-v2-insights-regressions', panel: 'Latest insights', requireRows: true },
  { uid: 'agentops-v2-insights-regressions', panel: 'Recurring patterns', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Eval regression queue', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Recommendation artifacts', requireRows: false },
  { uid: 'agentops-v2-insights-regressions', panel: 'Config change annotations', requireRows: false },
  { uid: 'agentops-v2-collector-health', panel: 'Collector checks', requireRows: true },
  { uid: 'agentops-v2-collector-health', panel: 'Schema version coverage', requireRows: false }
];

function queryFromPanel(panel) {
  return panel?.targets?.[0]?.azureLogAnalytics?.query || panel?.targets?.[0]?.query || '';
}

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

function v2DashboardBodies() {
  return dashboardJsonFiles()
    .filter(file => file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`))
    .map(file => ({ file, body: JSON.parse(fs.readFileSync(file, 'utf8')) }));
}

function panelByTitle(dashboard, title) {
  return (dashboard.body.panels || []).find(panel => panel.title === title);
}

function orderedInText(text, terms) {
  let cursor = -1;
  for (const term of terms) {
    const index = String(text || '').indexOf(term);
    if (index <= cursor) return false;
    cursor = index;
  }
  return true;
}

function orderedAfter(text, marker, terms) {
  const index = String(text || '').lastIndexOf(marker);
  if (index === -1) return false;
  return orderedInText(String(text).slice(index), terms);
}

function validateDashboardUx() {
  const dashboards = v2DashboardBodies();
  const byUid = new Map(dashboards.map(item => [item.body.uid, item]));
  const errors = [];
  const required = [
    'agentops-v2-home',
    'agentops-v2-runs-explorer',
    'agentops-v2-run-replay',
    'agentops-v2-models-cost-tokens',
    'agentops-v2-tools-mcp-risk',
    'agentops-v2-safety-privacy-policy',
    'agentops-v2-code-outcomes',
    'agentops-v2-evals-quality',
    'agentops-v2-insights-regressions',
    'agentops-v2-collector-health'
  ];
  for (const uid of required) {
    if (!byUid.has(uid)) errors.push(`missing V2 dashboard ${uid}`);
  }
  let emptyStateDashboards = 0;
  for (const dashboard of dashboards) {
    const text = (dashboard.body.panels || [])
      .filter(panel => panel.type === 'text')
      .map(panel => panel.options?.content || '')
      .join('\n');
    if (text.includes('agentops collector smoke --privacy strict --poison --json') && text.includes('agentops demo generate')) {
      emptyStateDashboards += 1;
    } else {
      errors.push(`${dashboard.file}: missing dashboard-level empty-state commands`);
    }
  }

  const home = byUid.get('agentops-v2-home');
  const homeTitles = new Set((home?.body.panels || []).map(panel => panel.title));
  for (const title of ['Runs', 'Success rate', 'Failed runs', 'Policy blocks', 'Privacy drops', 'Estimated cost', 'Input tokens', 'Output tokens', 'p95 duration', 'Tests ran %', 'PRs opened', 'Collector health', 'Session Health', 'Saved investigations']) {
    if (!homeTitles.has(title)) errors.push(`home missing top-strip panel ${title}`);
  }
  const homeText = (home?.body.panels || [])
    .filter(panel => panel.type === 'text')
    .map(panel => `${panel.title}\n${panel.options?.content || ''}`)
    .join('\n');
  for (const snippet of ['Open latest run', 'agentops open latest --last 2h --json', 'Get recommendation', 'agentops recommend latest --last 2h', 'Ask AgentOps', 'agentops ask-context latest --last 2h --json', '--recommendations <AgentOpsRecommendations_CL.jsonl>', 'docs/copilot-mcp-agentops-prompts.md']) {
    if (!homeText.includes(snippet)) errors.push(`home action strip missing ${snippet}`);
  }
  const savedViewsQuery = queryFromPanel(panelByTitle(home, 'Saved investigations'));
  for (const field of ['AgentOpsSavedViews_CL', 'SavedViewId', 'Name', 'QueryHash', 'ChangeAnnotationCount', 'ChangeTargetRefs', 'AskSharedContext', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/saved-view/', 'OpenSavedView', 'OpenReplay']) {
    if (!savedViewsQuery.includes(field)) errors.push(`saved investigations panel missing ${field}`);
  }
  const recommendedNextActionsQuery = queryFromPanel(panelByTitle(home, 'Recommended next actions'));
  for (const field of ['AskSharedContext', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/recommendation/']) {
    if (!recommendedNextActionsQuery.includes(field)) errors.push(`recommended next actions panel missing ${field}`);
  }
  const sessionHealthQuery = queryFromPanel(panelByTitle(home, 'Session Health'));
  for (const field of ['LatestRecommendations', 'HealthStatus', 'RootAgent', 'RecommendedNextAction', 'ToolFailureCount', 'ToolDeniedCount', 'ContentCaptureSignal', 'ContextWindowPct', 'EvalOverall', 'OpenReplay']) {
    if (!sessionHealthQuery.includes(field)) errors.push(`session health panel missing ${field}`);
  }

  const runs = byUid.get('agentops-v2-runs-explorer');
  const runsQuery = queryFromPanel(panelByTitle(runs, 'Runs'));
  for (const action of ['OpenReplay', 'OpenTrace', 'OpenGithub']) {
    if (!runsQuery.includes(action)) errors.push(`runs explorer missing ${action} action cell`);
  }

  const replay = byUid.get('agentops-v2-run-replay');
  const replayTitles = new Set((replay?.body.panels || []).map(panel => panel.title));
  for (const title of ['Run summary', 'Replay timeline', 'Agent, skill, and MCP lineage', 'Context and cache posture', 'Why this failed / next check', 'Latest recommendation', 'Ask AgentOps context', 'Transcript availability', 'Prompt and response viewer (explicit opt-in)', 'Policy, privacy, tests, and GitHub outcome']) {
    if (!replayTitles.has(title)) errors.push(`run replay missing panel ${title}`);
  }
  const latestRecommendationQuery = queryFromPanel(panelByTitle(replay, 'Latest recommendation'));
  for (const field of ['RecommendationId', 'Action', 'ObservedPattern', 'NextAction', 'RecommendationCommand', 'AskContextCommand', 'AskSharedContext', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/recommendation/', 'OpenReplay', 'OpenPattern']) {
    if (!latestRecommendationQuery.includes(field)) errors.push(`latest recommendation panel missing ${field}`);
  }
  const askQuery = queryFromPanel(panelByTitle(replay, 'Ask AgentOps context'));
  for (const field of ['RunReplayUrl', 'InvestigationKql', 'AskContextCommand', 'BundleCommand', 'AskPrompt', 'TriageCommand', 'AskAgentOpsLaunch', '/ask-agentops', 'OpenReplay', 'Do not request or enable prompt']) {
    if (!askQuery.includes(field)) errors.push(`ask agentops context panel missing ${field}`);
  }
  const transcriptQuery = queryFromPanel(panelByTitle(replay, 'Transcript availability'));
  if (!orderedAfter(transcriptQuery, '| project Status', ['Status', 'SafetyNote', 'OpenTranscript', 'ContentRows', 'FullContentRows', 'RedactedContentRows'])) {
    errors.push('transcript availability must put status, safety note, open action, and content counts first');
  }
  const contentQuery = queryFromPanel(panelByTitle(replay, 'Prompt and response viewer (explicit opt-in)'));
  if (!orderedAfter(contentQuery, '| project TimeGenerated', ['TimeGenerated', 'TurnIndex', 'Role', 'ContentKind', 'MessageText', 'CaptureMode', 'RedactionStatus', 'ViewerNote'])) {
    errors.push('prompt/response viewer must read like a transcript before showing hashes and IDs');
  }
  if (!contentQuery.includes('AgentOpsContent_CL')) errors.push('prompt/response viewer must use AgentOpsContent_CL only');

  const tools = byUid.get('agentops-v2-tools-mcp-risk');
  const toolQuery = queryFromPanel(panelByTitle(tools, 'Tool risk table'));
  for (const field of ['BadOutcomeCorrelation', 'McpServer', 'ToolRisk', 'DeniedRate']) {
    if (!toolQuery.includes(field)) errors.push(`tool risk table missing ${field}`);
  }

  const safety = byUid.get('agentops-v2-safety-privacy-policy');
  const safetyTitles = new Set((safety?.body.panels || []).map(panel => panel.title));
  if (!safetyTitles.has('Alert handoff review')) errors.push('safety dashboard missing Alert handoff review panel');
  const alertHandoffQuery = queryFromPanel(panelByTitle(safety, 'Alert handoff review'));
  for (const field of ['AgentOpsAlertHandoffs_CL', 'HandoffId', 'AlertRule', 'SessionId', 'ConfigChangeCount', 'ChangeTargetRefs', 'AskSharedContext', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/alert-handoff/', 'OpenReplay']) {
    if (!alertHandoffQuery.includes(field)) errors.push(`alert handoff review missing ${field}`);
  }

  const code = byUid.get('agentops-v2-code-outcomes');
  const codeTitles = new Set((code?.body.panels || []).map(panel => panel.title));
  for (const title of ['Runs and PR outcomes', 'PR and CI outcomes', 'Delivery timing', 'Edited files but no tests']) {
    if (!codeTitles.has(title)) errors.push(`code outcomes missing panel ${title}`);
  }
  const timingQuery = queryFromPanel(panelByTitle(code, 'Delivery timing'));
  for (const field of ['TimeToPrMinutes', 'TimeToMergeMinutes', 'P95TimeToPrMinutes', 'P95TimeToMergeMinutes']) {
    if (!timingQuery.includes(field)) errors.push(`delivery timing missing ${field}`);
  }

  const evals = byUid.get('agentops-v2-evals-quality');
  const evalsTitles = new Set((evals?.body.panels || []).map(panel => panel.title));
  if (!evalsTitles.has('Eval scorecard by repo, model, and task')) errors.push('evals dashboard missing Eval scorecard by repo, model, and task panel');
  if (!evalsTitles.has('Eval regression follow-up')) errors.push('evals dashboard missing Eval regression follow-up panel');
  if (!evalsTitles.has('Before/after run comparison')) errors.push('evals dashboard missing Before/after run comparison panel');
  if (!evalsTitles.has('Benchmark artifact diff review')) errors.push('evals dashboard missing Benchmark artifact diff review panel');
  if (!evalsTitles.has('Benchmark artifact files')) errors.push('evals dashboard missing Benchmark artifact files panel');
  if (!evalsTitles.has('Benchmark artifact content diffs')) errors.push('evals dashboard missing Benchmark artifact content diffs panel');
  if (!evalsTitles.has('Benchmark hidden check packs')) errors.push('evals dashboard missing Benchmark hidden check packs panel');
  if (!evalsTitles.has('Benchmark policy review')) errors.push('evals dashboard missing Benchmark policy review panel');
  if (!evalsTitles.has('Benchmark semantic checks')) errors.push('evals dashboard missing Benchmark semantic checks panel');
  if (!evalsTitles.has('Benchmark promotion approvals')) errors.push('evals dashboard missing Benchmark promotion approvals panel');
  const evalScorecardQuery = queryFromPanel(panelByTitle(evals, 'Eval scorecard by repo, model, and task'));
  for (const field of ['ScorecardStatus', 'PoorRuns', 'ReviewRuns', 'AvgTestDiscipline', 'AvgToolEfficiency', 'AvgSecurity', 'AvgReliability', 'AvgCodeOutcome']) {
    if (!evalScorecardQuery.includes(field)) errors.push(`eval scorecard missing ${field}`);
  }
  const evalFollowUpQuery = queryFromPanel(panelByTitle(evals, 'Eval regression follow-up'));
  for (const field of ['EvalBucket', 'ObservedPattern', 'NextAction', 'ChangeAnnotationCount', 'ChangeTargetRefs', 'OpenReplay', 'OpenPattern']) {
    if (!evalFollowUpQuery.includes(field)) errors.push(`eval regression follow-up missing ${field}`);
  }
  const runComparisonQuery = queryFromPanel(panelByTitle(evals, 'Before/after run comparison'));
  for (const field of ['BeforeRunId', 'AfterRunId', 'ComparisonStatus', 'EvalDelta', 'CostDelta', 'TokenDelta', 'ToolFailureDelta', 'RiskDelta', 'OpenReplay']) {
    if (!runComparisonQuery.includes(field)) errors.push(`before/after run comparison missing ${field}`);
  }
  const artifactDiffQuery = queryFromPanel(panelByTitle(evals, 'Benchmark artifact diff review'));
  for (const field of ['BenchmarkRunId', 'BenchmarkArtifactAdded', 'BenchmarkArtifactModified', 'BenchmarkArtifactDeleted', 'BenchmarkArtifactTotalChanged', 'ReviewAction', 'ChangeTargetRefs']) {
    if (!artifactDiffQuery.includes(field)) errors.push(`benchmark artifact diff review missing ${field}`);
  }
  const artifactFilesQuery = queryFromPanel(panelByTitle(evals, 'Benchmark artifact files'));
  for (const field of ['BenchmarkArtifactFiles', 'mv-expand', 'ArtifactTaskId', 'ArtifactChange', 'ArtifactPath']) {
    if (!artifactFilesQuery.includes(field)) errors.push(`benchmark artifact files missing ${field}`);
  }
  const artifactContentDiffQuery = queryFromPanel(panelByTitle(evals, 'Benchmark artifact content diffs'));
  for (const field of ['BenchmarkArtifactContentDiffs', 'mv-expand', 'ArtifactTaskId', 'ArtifactChange', 'ArtifactPath', 'DiffPreview']) {
    if (!artifactContentDiffQuery.includes(field)) errors.push(`benchmark artifact content diffs missing ${field}`);
  }
  const hiddenCheckQuery = queryFromPanel(panelByTitle(evals, 'Benchmark hidden check packs'));
  for (const field of ['BenchmarkHiddenCheckPacks', 'mv-expand', 'BenchmarkHiddenChecksPassed', 'BenchmarkHiddenChecksFailed', 'HiddenTaskId', 'HiddenPackId', 'HiddenCommandCount']) {
    if (!hiddenCheckQuery.includes(field)) errors.push(`benchmark hidden check packs missing ${field}`);
  }
  const policyQuery = queryFromPanel(panelByTitle(evals, 'Benchmark policy review'));
  for (const field of ['BenchmarkPolicyTasks', 'mv-expand', 'BenchmarkPolicyBlocks', 'BenchmarkPermissionProfiles', 'PolicyTaskId', 'PermissionProfile', 'OsSandboxMode', 'OsSandboxActive', 'BlockedRisks', 'ViolationRisks']) {
    if (!policyQuery.includes(field)) errors.push(`benchmark policy review missing ${field}`);
  }
  const semanticQuery = queryFromPanel(panelByTitle(evals, 'Benchmark semantic checks'));
  for (const field of ['BenchmarkSemanticChecks', 'mv-expand', 'BenchmarkSemanticCheckCount', 'BenchmarkSemanticAverageScore', 'SemanticTaskId', 'SemanticCheckId', 'SemanticAdapter', 'SemanticScore']) {
    if (!semanticQuery.includes(field)) errors.push(`benchmark semantic checks missing ${field}`);
  }
  const approvalQuery = queryFromPanel(panelByTitle(evals, 'Benchmark promotion approvals'));
  for (const field of ['BenchmarkRunId', 'BenchmarkApprovalStatus', 'BenchmarkApprovalCount', 'BenchmarkRequiredApprovals', 'BenchmarkApprovalTicket', 'ApprovalAction']) {
    if (!approvalQuery.includes(field)) errors.push(`benchmark promotion approvals missing ${field}`);
  }

  const insights = byUid.get('agentops-v2-insights-regressions');
  const insightsTitles = new Set((insights?.body.panels || []).map(panel => panel.title));
  if (!insightsTitles.has('Recurring patterns')) errors.push('insights dashboard missing Recurring patterns panel');
  if (!insightsTitles.has('Eval regression queue')) errors.push('insights dashboard missing Eval regression queue panel');
  if (!insightsTitles.has('Recommendation artifacts')) errors.push('insights dashboard missing Recommendation artifacts panel');
  if (!insightsTitles.has('Config change annotations')) errors.push('insights dashboard missing Config change annotations panel');
  const patternsQuery = queryFromPanel(panelByTitle(insights, 'Recurring patterns'));
  for (const field of ['PatternId', 'PatternRuns', 'PatternDimension', 'PatternKey', 'OpenPattern', 'OpenReplay']) {
    if (!patternsQuery.includes(field)) errors.push(`recurring patterns panel missing ${field}`);
  }
  const recommendationsQuery = queryFromPanel(panelByTitle(insights, 'Recommendation artifacts'));
  for (const field of ['RecommendationId', 'Action', 'ObservedPattern', 'NextAction', 'BenchmarkRunId', 'BenchmarkDecision', 'BenchmarkArtifactTotalChanged', 'BenchmarkArtifactFiles', 'BenchmarkHiddenCheckPacks', 'BenchmarkPolicyTasks', 'BenchmarkSemanticChecks', 'BenchmarkApprovalStatus', 'ChangeAnnotationCount', 'ChangeAnnotations', 'ChangeTargetRefs', 'AskSharedContext', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/recommendation/', 'OpenReplay', 'OpenPattern']) {
    if (!recommendationsQuery.includes(field)) errors.push(`recommendation artifacts panel missing ${field}`);
  }
  const evalRegressionQueueQuery = queryFromPanel(panelByTitle(insights, 'Eval regression queue'));
  for (const field of ['Source', 'EvalBucket', 'BaselineValue', 'CurrentValue', 'Summary', 'NextAction', 'OpenReplay', 'OpenPattern']) {
    if (!evalRegressionQueueQuery.includes(field)) errors.push(`eval regression queue missing ${field}`);
  }
  const configAnnotationsQuery = queryFromPanel(panelByTitle(insights, 'Config change annotations'));
  for (const field of ['agentops.config.changed', 'agentops.custom.annotation_type', 'ChangeComponent', 'ChangeTarget', 'ChangeType', 'ChangeId', 'Version']) {
    if (!configAnnotationsQuery.includes(field)) errors.push(`config change annotations missing ${field}`);
  }

  const collector = byUid.get('agentops-v2-collector-health');
  const collectorTitles = new Set((collector?.body.panels || []).map(panel => panel.title));
  if (!collectorTitles.has('Schema version coverage')) errors.push('collector health missing Schema version coverage panel');
  const schemaCoverageQuery = queryFromPanel(panelByTitle(collector, 'Schema version coverage'));
  for (const field of ['SchemaStatus', 'ExpectedSchemaVersion', 'MissingSchemaVersion', 'SchemaVersion', 'AgentOpsRunSummary_CL']) {
    if (!schemaCoverageQuery.includes(field)) errors.push(`schema version coverage missing ${field}`);
  }

  return {
    ok: errors.length === 0,
    dashboards: dashboards.length,
    contracts: {
      home_top_strip: 12,
      home_action_strip: true,
      run_replay_panels: 9,
      ask_agentops_context: true,
      runs_actions: 3,
      transcript_first_columns: ['Status', 'SafetyNote', 'OpenTranscript', 'ContentRows'],
      code_outcome_timing: true,
      recurring_patterns: true,
      recommendation_artifacts: true,
      artifact_diff_review: true,
      artifact_file_review: true,
      artifact_content_diff_review: true,
      hidden_check_review: true,
      policy_review: true,
      semantic_review: true,
      promotion_approvals: true,
      alert_handoff_review: true,
      schema_version_coverage: true,
      pattern_drilldowns: true,
      empty_state_dashboards: emptyStateDashboards
    },
    errors
  };
}

function dashboardKqlCheck(args = [], options = {}) {
  const last = optionValue(args, '--last', '24h');
  const requireRows = hasFlag(args, '--require-rows');
  const runQuery = options.runQuery || ((query, queryOptions) => legacy.runAzureLogAnalyticsQuery(query, queryOptions));
  const dashboards = v2DashboardBodies();
  const byUid = new Map(dashboards.map(item => [item.body.uid, item]));
  const checks = [];

  for (const smokePanel of v2KqlSmokePanels) {
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

function dashboardVerify(args = [], options = {}) {
  const includeLive = hasFlag(args, '--live') || hasFlag(args, '--kql');
  const checks = {
    validate: validateDashboards(),
    links: validateDashboardLinks(),
    filters: validateDashboardFilters(),
    ux: validateDashboardUx(),
    content: validateDashboardContentGuardrails()
  };
  if (includeLive) checks.kql = dashboardKqlCheck(args, options);

  const errors = Object.entries(checks)
    .flatMap(([name, result]) => (result.errors || []).map(error => `${name}: ${error}`));
  return {
    ok: errors.length === 0,
    live: includeLive,
    checks,
    summary: {
      dashboards: checks.validate.dashboards,
      v2_dashboards: checks.links.dashboards,
      checked_links: checks.links.checked_links,
      filter_dashboards: checks.filters.dashboards,
      ux_contracts: checks.ux.contracts,
      kql_checks: checks.kql?.checks?.length || 0
    },
    errors,
    next: errors.length === 0
      ? [
        includeLive ? 'agentops open' : 'agentops dashboard verify --live --last 24h',
        'agentops validate-azure --last 24h'
      ]
      : [
        'agentops dashboard validate',
        'agentops dashboard links-check',
        'agentops dashboard filters-check',
        'agentops dashboard ux-check',
        'agentops dashboard kql-check --last 24h'
      ]
  };
}

function dashboardImportPlan(args = [], options = {}) {
  const env = options.env || process.env;
  const v2Only = !hasFlag(args, '--all');
  const folder = optionValue(args, '--folder', v2Only ? 'AgentOps for Azure' : 'AgentOps');
  const resourceGroup = optionValue(args, '--resource-group', env.AZURE_RESOURCE_GROUP || '');
  const grafanaName = optionValue(args, '--grafana-name', env.GRAFANA_NAME || env.AGENTOPS_GRAFANA_NAME || '');
  const script = path.join(repoRoot, 'scripts', 'grafana-import-dashboard.sh');
  const files = dashboardJsonFiles()
    .filter(file => !v2Only || file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`));
  const command = [
    `GRAFANA_FOLDER=${JSON.stringify(folder)}`,
    v2Only ? 'AGENTOPS_V2_ONLY=true' : 'AGENTOPS_V2_ONLY=false AGENTOPS_INCLUDE_V2=true AGENTOPS_INCLUDE_LEGACY=true',
    resourceGroup ? `AZURE_RESOURCE_GROUP=${JSON.stringify(resourceGroup)}` : 'AZURE_RESOURCE_GROUP=<resource-group>',
    grafanaName ? `GRAFANA_NAME=${JSON.stringify(grafanaName)}` : 'GRAFANA_NAME=<managed-grafana-name>',
    script
  ].join(' ');

  return {
    ok: files.length > 0,
    dry_run: !hasFlag(args, '--yes'),
    v2_only: v2Only,
    folder,
    script,
    dashboards: files.length,
    files,
    requires: [
      'az login',
      'Azure CLI amg extension',
      'Grafana Editor/Admin access',
      'Azure Monitor datasource UID configured'
    ],
    command,
    errors: files.length > 0 ? [] : ['no dashboards found to import']
  };
}

function runDashboardImport(args = [], options = {}) {
  const plan = dashboardImportPlan(args, options);
  if (!plan.ok || plan.dry_run) return plan;

  const env = {
    ...(options.env || process.env),
    GRAFANA_FOLDER: plan.folder,
    AGENTOPS_V2_ONLY: plan.v2_only ? 'true' : 'false',
    AGENTOPS_INCLUDE_V2: 'true',
    AGENTOPS_INCLUDE_LEGACY: plan.v2_only ? 'false' : 'true'
  };
  const resourceGroup = optionValue(args, '--resource-group', env.AZURE_RESOURCE_GROUP || '');
  const grafanaName = optionValue(args, '--grafana-name', env.GRAFANA_NAME || env.AGENTOPS_GRAFANA_NAME || '');
  if (resourceGroup) env.AZURE_RESOURCE_GROUP = resourceGroup;
  if (grafanaName) env.GRAFANA_NAME = grafanaName;

  const spawn = options.spawnSync || spawnSync;
  const result = spawn(plan.script, [], {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });

  return {
    ...plan,
    dry_run: false,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    errors: result.status === 0 ? [] : [result.stderr || result.stdout || `dashboard import exited ${result.status}`]
  };
}

function dashboardCommand(args = []) {
  const [subcommand = 'validate'] = args;
  if (!['validate', 'links-check', 'filters-check', 'ux-check', 'content-check', 'kql-check', 'verify', 'import'].includes(subcommand)) throw new Error('dashboard supports: validate|links-check|filters-check|ux-check|content-check|kql-check|verify|import');
  const result = subcommand === 'links-check'
    ? validateDashboardLinks()
    : subcommand === 'filters-check'
      ? validateDashboardFilters()
    : subcommand === 'content-check'
      ? validateDashboardContentGuardrails()
    : subcommand === 'ux-check'
      ? validateDashboardUx()
    : subcommand === 'verify'
      ? dashboardVerify(args.slice(1))
    : subcommand === 'kql-check'
      ? dashboardKqlCheck(args.slice(1))
    : subcommand === 'import'
      ? runDashboardImport(args.slice(1))
      : validateDashboards();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  dashboardImportPlan,
  dashboardCommand,
  dashboardKqlCheck,
  dashboardVerify,
  runDashboardImport,
  substituteGrafanaMacros,
  validateDashboardContentGuardrails,
  validateDashboardLinks,
  validateDashboardFilters,
  validateDashboardUx,
  validateDashboards
};
