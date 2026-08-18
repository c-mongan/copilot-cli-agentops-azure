const { firstPositional, hasFlag, optionValue } = require('./args');
const {
  changeAnnotationsForRun,
  normalizeConfigChangeAnnotation: normalizeChangeAnnotation
} = require('./change-annotations');
const { writeJson } = require('./command-output');
const { benchmarkEvidenceFromReport } = require('./recommendation-benchmark-evidence');
const {
  actionFromInsight,
  buildRecommendation
} = require('./recommendation-builder');
const { recommendFromFiles } = require('./recommendation-files');
const {
  dashboardUrl,
  fileRefsForRecommendation,
  linkedDashboardsForRecommendation,
  matchingPatternInsight,
  topInsightForRun
} = require('./recommendation-links');
const { renderRecommendationV2 } = require('./recommendation-render');
const {
  compareRecommendationAfterRun,
  defaultRecommendationStorePath,
  exportRecommendationStore,
  recommendationActionPlan,
  recommendationActionPlanForRow,
  recommendationRow,
  recommendationStoreCommand,
  saveRecommendation,
  writeRecommendation
} = require('./recommendation-store');

function recommendCommand(args = []) {
  if (args[0] === 'list' || args[0] === 'export' || args[0] === 'compare' || args[0] === 'action-plan') {
    writeJson(recommendationStoreCommand(args));
    return;
  }

  const runId = firstPositional(args);
  const runsFile = optionValue(args, '--runs');
  if (!runsFile) throw new Error('recommend requires --runs <AgentOpsRunSummary_CL.jsonl> for V2 recommendations');

  const recommendation = recommendFromFiles({
    runId,
    runsFile,
    evalsFile: optionValue(args, '--evals'),
    eventsFile: optionValue(args, '--events'),
    insightsFile: optionValue(args, '--insights'),
    benchmarkReportFile: optionValue(args, '--benchmark-report'),
    benchmarkRunId: optionValue(args, '--benchmark-run')
  });
  const outDir = optionValue(args, '--out');
  const written = outDir ? writeRecommendation(recommendation, outDir) : null;
  const saved = hasFlag(args, '--save')
    ? saveRecommendation(recommendation, optionValue(args, '--store') || defaultRecommendationStorePath())
    : null;
  if (written) recommendation.artifact = {
    table: 'AgentOpsRecommendations_CL',
    file: written.file,
    manifest: written.manifest,
    privacy: 'metadata-only'
  };
  if (saved) recommendation.saved = {
    store: saved.path,
    recommendation_id: saved.saved.RecommendationId,
    count: saved.count,
    privacy: 'metadata-only'
  };

  if (hasFlag(args, '--json')) {
    writeJson(recommendation);
  } else {
    process.stdout.write(renderRecommendationV2(recommendation));
    if (written) process.stdout.write(`Artifact: ${written.file}\n`);
    if (saved) process.stdout.write(`Saved: ${saved.path}\n`);
  }
}

module.exports = {
  actionFromInsight,
  buildRecommendation,
  changeAnnotationsForRun,
  normalizeChangeAnnotation,
  dashboardUrl,
  benchmarkEvidenceFromReport,
  compareRecommendationAfterRun,
  exportRecommendationStore,
  firstPositional,
  fileRefsForRecommendation,
  recommendCommand,
  recommendFromFiles,
  recommendationActionPlan,
  recommendationActionPlanForRow,
  recommendationStoreCommand,
  recommendationRow,
  renderRecommendationV2,
  saveRecommendation,
  matchingPatternInsight,
  writeRecommendation,
  topInsightForRun
};
