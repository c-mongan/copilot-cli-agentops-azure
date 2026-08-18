const { writeJson, writeJsonOrRender } = require('./command-output');

function createBenchmarkCommand(dependencies = {}) {
  const {
    benchmarkApproval,
    benchmarkArtifactReview,
    benchmarkFixturePack,
    benchmarkJudgeProviderGuide,
    benchmarkReport,
    compareBenchmarkRuns,
    listBenchmarks,
    parseBenchmarkApproveArgs,
    parseBenchmarkArtifactsArgs,
    parseBenchmarkCompareArgs,
    parseBenchmarkFixturePackArgs,
    parseBenchmarkReportArgs,
    parseBenchmarkRunArgs,
    renderBenchmarkJudgeProviderGuide,
    runBenchmarkSuite,
    stdout = process.stdout
  } = dependencies;

  function benchmarkCommand(args) {
    const [subcommand, ...benchmarkArgs] = args;
    if (subcommand === 'list') {
      writeJson(listBenchmarks(), stdout);
      return;
    }

    if (subcommand === 'fixture-pack') {
      const options = parseBenchmarkFixturePackArgs(benchmarkArgs);
      writeJson(benchmarkFixturePack(options), stdout);
      return;
    }

    if (subcommand === 'judge-provider') {
      const guide = benchmarkJudgeProviderGuide();
      writeJsonOrRender(guide, benchmarkArgs.includes('--json'), renderBenchmarkJudgeProviderGuide, stdout);
      return;
    }

    if (subcommand === 'approve') {
      const options = parseBenchmarkApproveArgs(benchmarkArgs);
      writeJson(benchmarkApproval(options), stdout);
      return;
    }

    if (subcommand === 'artifacts') {
      const options = parseBenchmarkArtifactsArgs(benchmarkArgs);
      writeJson(benchmarkArtifactReview(options.runId, null, options), stdout);
      return;
    }

    if (subcommand === 'run') {
      const options = parseBenchmarkRunArgs(benchmarkArgs);
      writeJson(runBenchmarkSuite(options.suite, options), stdout);
      return;
    }

    if (subcommand === 'report') {
      const options = parseBenchmarkReportArgs(benchmarkArgs);
      writeJson(benchmarkReport(options.runId, null, options), stdout);
      return;
    }

    if (subcommand === 'compare') {
      const options = parseBenchmarkCompareArgs(benchmarkArgs);
      writeJson(compareBenchmarkRuns(options.beforeRunId, options.afterRunId, null, options), stdout);
      return;
    }

    throw new Error('benchmark requires list, fixture-pack, judge-provider, approve, artifacts, run, report, or compare');
  }

  return {
    benchmarkCommand
  };
}

module.exports = {
  createBenchmarkCommand
};
