const { buildAzureIngestPlan } = require('./azure/v2-ingest-plan');
const {
  validateDashboardLinks,
  validateDashboards
} = require('./dashboard-validation');
const { generateDemoData, writeDemoData } = require('./demo/agentops-demo-data');
const { explainRun, latestByTime } = require('./explain/v2-explain');
const { generateInsights, writeInsights } = require('./insights/deterministic-insights');
const { buildRecommendation } = require('./recommendation-builder');
const { topInsightForRun } = require('./recommendation-links');
const { writeRecommendation } = require('./recommendation-store');
const { v2OpenLinksForRun } = require('./v2-open-links');

function buildDemoVerifyResult(options = {}) {
  const demo = generateDemoData({
    runs: options.runs,
    withFailures: true,
    withPrivacyDrops: true,
    withGithubOutcomes: true
  });
  const writtenDemo = writeDemoData(demo, options.outDir);
  const insights = generateInsights({
    runs: demo.tables.AgentOpsRunSummary_CL,
    tools: demo.tables.AgentOpsToolCalls_CL,
    privacy: demo.tables.AgentOpsPrivacy_CL,
    github: demo.tables.AgentOpsGithubOutcomes_CL
  });
  const writtenInsights = writeInsights(insights, options.insightsOutDir);
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
    artifact_mode: options.artifactMode || 'persistent',
    write_intent: options.writeIntent === true,
    demo: {
      runs: demo.runs,
      out_dir: writtenDemo.out_dir,
      table_counts: demo.table_counts
    },
    insights: {
      out_dir: options.insightsOutDir,
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

  return {
    payload,
    explanation,
    openLinks,
    recommendation
  };
}

function buildDemoVerifyPayload(options = {}) {
  return buildDemoVerifyResult(options).payload;
}

module.exports = {
  buildDemoVerifyPayload,
  buildDemoVerifyResult
};
