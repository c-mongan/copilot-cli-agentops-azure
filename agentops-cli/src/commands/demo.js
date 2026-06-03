const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { validateDashboardLinks, validateDashboards } = require('./dashboard');
const { buildAzureIngestPlan } = require('../lib/azure/v2-ingest-plan');
const { generateDemoData, writeDemoData } = require('../lib/demo/agentops-demo-data');
const { explainRun, latestByTime, renderV2Explanation } = require('../lib/explain/v2-explain');
const { generateInsights, writeInsights } = require('../lib/insights/deterministic-insights');
const { v2OpenLinksForRun } = require('./open');
const { buildRecommendation, topInsightForRun, writeRecommendation } = require('./recommend');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parseRuns(value) {
  const runs = Number(value || 50);
  if (!Number.isInteger(runs) || runs <= 0 || runs > 1000) {
    throw new Error('--runs must be an integer between 1 and 1000');
  }
  return runs;
}

function flagPair(args, withFlag, withoutFlag, defaultValue = true) {
  const withValue = hasFlag(args, withFlag);
  const withoutValue = hasFlag(args, withoutFlag);
  if (withValue && withoutValue) throw new Error(`Use either ${withFlag} or ${withoutFlag}, not both`);
  if (withValue) return true;
  if (withoutValue) return false;
  return defaultValue;
}

function demoOptionsFromArgs(args = []) {
  return {
    withFailures: flagPair(args, '--with-failures', '--without-failures', true),
    withPrivacyDrops: flagPair(args, '--with-privacy-drops', '--without-privacy-drops', true),
    withGithubOutcomes: flagPair(args, '--with-github-outcomes', '--without-github-outcomes', true),
    withContent: hasFlag(args, '--with-content')
  };
}

function demoCommand(args = []) {
  const [subcommand = 'generate'] = args;
  if (!['generate', 'verify'].includes(subcommand)) throw new Error('demo supports: generate|verify');
  if (subcommand === 'verify') return demoVerifyCommand(args.slice(1));

  const runs = parseRuns(optionValue(args, '--runs', '50'));
  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'demo', 'latest')));
  const demoOptions = demoOptionsFromArgs(args);
  const result = generateDemoData({
    runs,
    ...demoOptions
  });
  const written = writeDemoData(result, outDir);

  const payload = {
    ok: result.ok,
    runs: result.runs,
    out_dir: written.out_dir,
    manifest: written.manifest,
    table_counts: result.table_counts,
    scenarios: result.scenarios,
    scenario_names: result.scenario_names,
    validation_errors: result.validation_errors,
    content_capture: demoOptions.withContent ? 'redacted_demo_content' : 'off',
    next: [
      'agentops dashboard validate',
      `ls ${written.out_dir}`
    ]
  };

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`Generated ${payload.runs} AgentOps demo runs.\n`);
    if (demoOptions.withContent) process.stdout.write('Included redacted demo prompt/response rows in AgentOpsContent_CL.\n');
    process.stdout.write(`Output: ${payload.out_dir}\n`);
    process.stdout.write(`Manifest: ${payload.manifest}\n`);
    process.stdout.write('Next: agentops dashboard validate\n');
  }

  if (!result.ok) process.exitCode = 1;
}

function demoVerifyCommand(args = []) {
  const runs = parseRuns(optionValue(args, '--runs', '50'));
  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'demo', 'latest')));
  const insightsOutDir = path.resolve(optionValue(args, '--insights-out', path.join(repoRoot, '.agentops', 'insights', 'latest')));
  const demo = generateDemoData({
    runs,
    withFailures: true,
    withPrivacyDrops: true,
    withGithubOutcomes: true
  });
  const writtenDemo = writeDemoData(demo, outDir);
  const insights = generateInsights({
    runs: demo.tables.AgentOpsRunSummary_CL,
    tools: demo.tables.AgentOpsToolCalls_CL,
    privacy: demo.tables.AgentOpsPrivacy_CL,
    github: demo.tables.AgentOpsGithubOutcomes_CL
  });
  const writtenInsights = writeInsights(insights, insightsOutDir);
  const latestRun = latestByTime(demo.tables.AgentOpsRunSummary_CL);
  const explanation = explainRun(latestRun, insights.evals, insights.insights);
  const openLinks = v2OpenLinksForRun(latestRun);
  const recommendation = buildRecommendation({
    run: latestRun,
    insight: topInsightForRun(insights.insights, latestRun?.RunId),
    evaluation: insights.evals.find(row => row.RunId === latestRun?.RunId) || null
  });
  const writtenRecommendation = writeRecommendation(recommendation, writtenDemo.out_dir);
  demo.table_counts.AgentOpsRecommendations_CL = 1;
  recommendation.artifact = {
    table: 'AgentOpsRecommendations_CL',
    file: writtenRecommendation.file,
    manifest: writtenRecommendation.manifest,
    privacy: 'metadata-only'
  };
  const dashboard = validateDashboards();
  const links = validateDashboardLinks();
  const azureIngest = buildAzureIngestPlan({ dir: writtenDemo.out_dir });
  const payload = {
    ok: demo.ok && insights.ok && explanation.ok && dashboard.ok && links.ok && azureIngest.ok,
    demo: {
      runs: demo.runs,
      out_dir: writtenDemo.out_dir,
      table_counts: demo.table_counts
    },
    insights: {
      out_dir: insightsOutDir,
      eval_file: writtenInsights.evalFile,
      insights_file: writtenInsights.insightsFile,
      table_counts: insights.table_counts
    },
    azure_ingest: azureIngest,
    explanation: {
      run_id: explanation.run?.RunId || null,
      headline: explanation.headline,
      detail: explanation.detail,
      eval_overall: explanation.evaluation?.EvalOverall ?? null,
      insight_count: explanation.insights.length
    },
    open_links: openLinks,
    recommendation,
    dashboard,
    links,
    next: [
      `agentops replay latest --file ${writtenDemo.files.AgentOpsEvents_CL}`,
      `agentops open latest --runs ${writtenDemo.files.AgentOpsRunSummary_CL}`,
      `agentops recommend latest --runs ${writtenDemo.files.AgentOpsRunSummary_CL} --events ${writtenDemo.files.AgentOpsEvents_CL} --evals ${writtenInsights.evalFile} --insights ${writtenInsights.insightsFile}`,
      `agentops azure-ingest plan --dir ${writtenDemo.out_dir}`,
      `agentops explain latest --runs ${writtenDemo.files.AgentOpsRunSummary_CL} --evals ${writtenInsights.evalFile} --insights ${writtenInsights.insightsFile}`
    ]
  };

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write('AgentOps V2 demo verification\n\n');
    process.stdout.write(`Demo runs: ${payload.demo.runs}\n`);
    process.stdout.write(`Eval rows: ${payload.insights.table_counts.AgentOpsEval_CL}\n`);
    process.stdout.write(`Insight rows: ${payload.insights.table_counts.AgentOpsInsights_CL}\n`);
    process.stdout.write(`Dashboard links: ${payload.links.checked_links}\n\n`);
    process.stdout.write(renderV2Explanation(explanation));
    process.stdout.write(`Open Run Replay: ${openLinks.links?.replay || 'unavailable'}\n`);
    process.stdout.write(`Recommended next action: ${recommendation.next_action}\n`);
  }
  if (!payload.ok) process.exitCode = 1;
}

module.exports = {
  demoOptionsFromArgs,
  demoCommand,
  demoVerifyCommand,
  parseRuns
};
