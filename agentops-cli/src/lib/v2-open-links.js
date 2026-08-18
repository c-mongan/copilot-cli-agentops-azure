const legacy = require('../legacy');
const { latestByTime } = require('./explain/v2-explain');
const { readJsonl } = require('./json');

function withVars(baseUrl, vars = {}) {
  const entries = Object.entries(vars).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${entries.map(([key, value]) => `var-${key}=${encodeURIComponent(value)}`).join('&')}`;
}

function v2OpenLinksForRun(run, legacyLinks = legacy.openLinksSummary()) {
  const runVars = run ? {
    run_id: run.RunId || '__all',
    session_id: run.SessionId || '__all',
    trace_id: run.TraceId || '__all'
  } : {};
  const modelVars = run?.ModelActual ? { model: run.ModelActual } : {};
  const repoVars = run?.RepoHash ? { repo_hash: run.RepoHash } : {};
  const agentVars = run?.AgentName ? { agent_name: run.AgentName } : {};

  return {
    ok: Boolean(run),
    run_id: run?.RunId || '',
    session_id: run?.SessionId || '',
    trace_id: run?.TraceId || '',
    status: run?.OutcomeStatus || '',
    missing_latest_reason: run ? null : 'no V2 run row was found',
    links: {
      primary: legacyLinks.primary_investigation_url || legacyLinks.v2_home_url,
      primary_label: legacyLinks.primary_investigation_label || 'Grafana Today',
      azure_agents_view: legacyLinks.azure_agents_view_url || null,
      application_insights: legacyLinks.application_insights_url || null,
      home: legacyLinks.v2_home_url,
      runs: withVars(legacyLinks.v2_runs_url, { ...repoVars, ...agentVars }),
      replay: withVars(legacyLinks.v2_replay_url, runVars),
      content_viewer: withVars(`${legacyLinks.v2_replay_url}?viewPanel=26`, runVars),
      models: withVars(`${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-models-cost-tokens`, modelVars),
      tools: `${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-tools-mcp-risk`,
      privacy: `${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-safety-privacy-policy`,
      outcomes: withVars(`${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-code-outcomes`, repoVars),
      evals: withVars(`${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-evals-quality`, runVars),
      insights: withVars(`${legacyLinks.v2_home_url.replace(/\/d\/agentops-v2-home$/, '')}/d/agentops-v2-insights-regressions`, runVars)
    }
  };
}

function openV2FromFiles(options = {}) {
  const runs = readJsonl(options.runsFile);
  const run = options.runId && options.runId !== 'latest'
    ? runs.find(row => row.RunId === options.runId || row.SessionId === options.runId || row.TraceId === options.runId)
    : latestByTime(runs);
  return v2OpenLinksForRun(run, options.legacyLinks || legacy.openLinksSummary());
}

function renderOpenV2(result) {
  const lines = ['AgentOps V2 links', ''];
  if (!result.ok) {
    lines.push(`Latest run: unknown. ${result.missing_latest_reason}.`);
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Run: ${result.run_id}`);
  lines.push(`Status: ${result.status || 'unknown'}`);
  lines.push(`${result.links.primary_label}: ${result.links.primary}`);
  if (result.links.azure_agents_view) lines.push(`Azure Monitor Agents view: ${result.links.azure_agents_view}`);
  if (result.links.application_insights) lines.push(`Application Insights (open Agents): ${result.links.application_insights}`);
  lines.push(`Home: ${result.links.home}`);
  lines.push(`Runs: ${result.links.runs}`);
  lines.push(`Run Story: ${result.links.replay}`);
  lines.push(`Prompt/response viewer (explicit opt-in): ${result.links.content_viewer}`);
  lines.push(`Models: ${result.links.models}`);
  lines.push(`Tools & MCP: ${result.links.tools}`);
  lines.push(`Safety & Privacy: ${result.links.privacy}`);
  lines.push(`Code Outcomes: ${result.links.outcomes}`);
  lines.push(`Evals: ${result.links.evals}`);
  lines.push(`Insights: ${result.links.insights}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  openV2FromFiles,
  renderOpenV2,
  v2OpenLinksForRun
};
