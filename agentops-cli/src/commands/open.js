const fs = require('node:fs');
const path = require('node:path');

const legacy = require('../legacy');
const { hasFlag, optionValue } = require('../lib/args');
const { latestByTime } = require('../lib/explain/v2-explain');

function readJsonl(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
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
  lines.push(`Home: ${result.links.home}`);
  lines.push(`Runs Explorer: ${result.links.runs}`);
  lines.push(`Run Replay: ${result.links.replay}`);
  lines.push(`Prompt/response viewer (explicit opt-in): ${result.links.content_viewer}`);
  lines.push(`Models: ${result.links.models}`);
  lines.push(`Tools & MCP: ${result.links.tools}`);
  lines.push(`Safety & Privacy: ${result.links.privacy}`);
  lines.push(`Code Outcomes: ${result.links.outcomes}`);
  lines.push(`Evals: ${result.links.evals}`);
  lines.push(`Insights: ${result.links.insights}`);
  return `${lines.join('\n')}\n`;
}

function openCommand(args = []) {
  if (!optionValue(args, '--runs')) {
    const summary = legacy.latestSummaryFromArgs(args);
    const links = legacy.openLinksSummary(summary);
    process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(links, null, 2)}\n` : legacy.renderOpenLinks(links));
    return;
  }

  const result = openV2FromFiles({
    runId: firstPositional(args),
    runsFile: path.resolve(optionValue(args, '--runs'))
  });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(result, null, 2)}\n` : renderOpenV2(result));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  firstPositional,
  openCommand,
  openV2FromFiles,
  renderOpenV2,
  v2OpenLinksForRun
};
