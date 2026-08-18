const legacy = require('../legacy');
const { changeAnnotationsForRun } = require('./change-annotations');
const { latestByTime } = require('./explain/v2-explain');
const { readJson, readJsonl } = require('./json');
const { buildRecommendation } = require('./recommendation-builder');
const {
  matchingPatternInsight,
  topInsightForRun
} = require('./recommendation-links');

function pickRun(runs, runId) {
  if (runId && runId !== 'latest') return runs.find(row => row.RunId === runId) || null;
  return latestByTime(runs);
}

function recommendFromFiles(options = {}) {
  const runs = readJsonl(options.runsFile);
  const evals = readJsonl(options.evalsFile);
  const insights = readJsonl(options.insightsFile);
  const events = readJsonl(options.eventsFile);
  const benchmarkReport = options.benchmarkReportFile
    ? readJson(options.benchmarkReportFile)
    : options.benchmarkRunId
      ? legacy.benchmarkReport(options.benchmarkRunId)
      : null;
  const run = pickRun(runs, options.runId);
  const insight = run ? topInsightForRun(insights, run.RunId) || matchingPatternInsight(insights, run) : null;
  const evaluation = run ? evals.find(row => row.RunId === run.RunId) || null : null;
  const changeAnnotations = run ? changeAnnotationsForRun(events, run) : [];
  return buildRecommendation({ run, insight, evaluation, links: options.links, benchmarkReport, changeAnnotations });
}

module.exports = {
  pickRun,
  recommendFromFiles
};
