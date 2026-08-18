const path = require('node:path');

const { firstPositional, hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { writeRecommendation } = require('./recommendation-store');
const { buildTriage, renderTriage, writeTriage } = require('./triage-packet');

function resolveOption(args, name) {
  const value = optionValue(args, name);
  return value ? path.resolve(value) : null;
}

function triageCommand(args = []) {
  const runId = firstPositional(args);
  const runsFile = resolveOption(args, '--runs');
  const result = buildTriage({
    runId,
    runsFile,
    eventsFile: resolveOption(args, '--events'),
    toolsFile: resolveOption(args, '--tools'),
    privacyFile: resolveOption(args, '--privacy'),
    githubFile: resolveOption(args, '--github'),
    evalsFile: resolveOption(args, '--evals'),
    insightsFile: resolveOption(args, '--insights'),
    benchmarkReportFile: resolveOption(args, '--benchmark-report'),
    benchmarkRunId: optionValue(args, '--benchmark-run')
  });
  const outDir = optionValue(args, '--out');
  if (result.ok && outDir) {
    const triageArtifact = writeTriage(result, outDir);
    const recommendationArtifact = writeRecommendation({
      ok: true,
      action: result.recommendation.action,
      severity: result.recommendation.severity,
      run_id: result.run_id,
      session_id: result.session_id,
      trace_id: result.trace_id,
      observed_pattern: result.recommendation.observed_pattern,
      next_action: result.recommendation.next_action,
      evidence: {
        dashboards: result.recommendation.dashboards,
        pattern: result.recommendation.pattern,
        benchmark: result.recommendation.benchmark,
        change_annotations: result.recommendation.change_annotations,
        file_refs: result.recommendation.change_targets
      },
      validation: [],
      rollback_condition: 'Rollback the agent, skill, MCP, model, or instruction change if eval score drops, failures rise, privacy drops appear unexpectedly, or CI worsens.'
    }, outDir);
    result.artifacts = {
      triage: triageArtifact.file,
      recommendation: recommendationArtifact.file
    };
  }

  writeJsonOrRender(result, hasFlag(args, '--json'), renderTriage);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  buildTriage,
  renderTriage,
  triageCommand,
  writeTriage
};
