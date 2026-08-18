function createBenchmarkContext(dependencies = {}) {
  const {
    benchmarkArtifactReviewBase,
    benchmarkAzureTelemetryBase,
    benchmarkReportBase,
    benchmarkRunBaseDir,
    benchmarkRunPlanBase,
    benchmarksDir,
    compareBenchmarkRunsBase,
    defaultBenchmarkSummaryDirBase,
    enrichBenchmarkSummariesWithAzureBase,
    listBenchmarksBase,
    loadBenchmarkSummariesBase,
    loadBenchmarkSuitesBase,
    parseBenchmarkCompareArgsBase,
    parseBenchmarkReportArgsBase,
    runAzureLogAnalyticsQuery,
    runBenchmarkSuiteBase,
    validateBenchmarkTaskBase,
    validateKqlDuration,
    root
  } = dependencies;

  function validateBenchmarkTask(task, suiteDir, source = 'task', options = {}) {
    return validateBenchmarkTaskBase(task, suiteDir, source, { root, ...options });
  }

  function loadBenchmarkSuites(baseDir = benchmarksDir) {
    return loadBenchmarkSuitesBase(baseDir, { root });
  }

  function listBenchmarks(baseDir = benchmarksDir) {
    return listBenchmarksBase(baseDir, { root });
  }

  function parseBenchmarkReportArgs(args) {
    return parseBenchmarkReportArgsBase(args, { validateDuration: validateKqlDuration });
  }

  function parseBenchmarkCompareArgs(args) {
    return parseBenchmarkCompareArgsBase(args, { validateDuration: validateKqlDuration });
  }

  function benchmarkRunPlan(suiteId, options = {}) {
    return benchmarkRunPlanBase(suiteId, {
      benchmarkRunBaseDir,
      loadBenchmarkSuites,
      ...options
    });
  }

  function runBenchmarkSuite(suiteId, options = {}) {
    return runBenchmarkSuiteBase(suiteId, {
      benchmarkReport,
      benchmarkRunBaseDir,
      defaultBenchmarkSummaryDir,
      loadBenchmarkSuites,
      ...options
    });
  }

  function benchmarkAzureTelemetry(runId, options = {}) {
    return benchmarkAzureTelemetryBase(runId, {
      runAzureLogAnalyticsQuery,
      ...options
    });
  }

  function enrichBenchmarkSummariesWithAzure(runId, summaries, options = {}) {
    return enrichBenchmarkSummariesWithAzureBase(runId, summaries, {
      runAzureLogAnalyticsQuery,
      ...options
    });
  }

  function defaultBenchmarkSummaryDir() {
    return defaultBenchmarkSummaryDirBase({ benchmarksDir });
  }

  function benchmarkArtifactReview(runId, summaries = null, options = {}) {
    return benchmarkArtifactReviewBase(runId, summaries, {
      benchmarksDir,
      loadBenchmarkSuites,
      ...options
    });
  }

  function loadBenchmarkSummaries(runId, options = {}) {
    return loadBenchmarkSummariesBase(runId, {
      benchmarksDir,
      ...options
    });
  }

  function benchmarkReport(runId, summaries = null, options = {}) {
    return benchmarkReportBase(runId, summaries, {
      benchmarksDir,
      loadBenchmarkSuites,
      runAzureLogAnalyticsQuery,
      ...options
    });
  }

  function compareBenchmarkRuns(beforeRunId, afterRunId, summaries = null, options = {}) {
    return compareBenchmarkRunsBase(beforeRunId, afterRunId, summaries, {
      benchmarksDir,
      loadBenchmarkSuites,
      runAzureLogAnalyticsQuery,
      ...options
    });
  }

  return {
    benchmarkArtifactReview,
    benchmarkAzureTelemetry,
    benchmarkReport,
    benchmarkRunPlan,
    compareBenchmarkRuns,
    defaultBenchmarkSummaryDir,
    enrichBenchmarkSummariesWithAzure,
    listBenchmarks,
    loadBenchmarkSummaries,
    loadBenchmarkSuites,
    parseBenchmarkCompareArgs,
    parseBenchmarkReportArgs,
    runBenchmarkSuite,
    validateBenchmarkTask
  };
}

module.exports = { createBenchmarkContext };
