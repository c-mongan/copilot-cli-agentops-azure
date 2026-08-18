const fs = require('node:fs');
const path = require('node:path');
const { benchmarkPromotionApprovalFromOptions } = require('./benchmark-approval');
const {
  benchmarkAzureTelemetry,
  enrichBenchmarkSummariesWithAzure
} = require('./benchmark-azure-telemetry');
const {
  normalizeBenchmarkRelativePath,
  safeBenchmarkPath
} = require('./benchmark-paths');
const {
  applyBenchmarkToolPolicy,
  benchmarkArtifactDiff,
  benchmarkCheatSignals,
  benchmarkPermissionProfileSummary,
  benchmarkPromotionGateFailures,
  benchmarkPromotionGates,
  benchmarkRecommendation,
  numberValue,
  roundNumber,
  scoreBenchmarkSummary,
  topFailureCategories
} = require('./benchmark-scoring');
const { readJson } = require('./json');

function walk(dir, predicate, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, predicate, results);
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function defaultBenchmarkSummaryDir(options = {}) {
  return process.env.AGENTOPS_BENCHMARK_RUNS_DIR || path.join(options.benchmarksDir || path.join(process.cwd(), 'benchmarks'), 'runs');
}

function benchmarkSummariesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.summaries)) return payload.summaries;
  if (Array.isArray(payload.runs)) return payload.runs;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload && payload.runId) return [payload];
  return [];
}

function benchmarkTaskBySummary(summary, options = {}) {
  const loadBenchmarkSuites = options.loadBenchmarkSuites || (() => []);
  const suite = loadBenchmarkSuites(options.benchmarksDir).find(item => item.id === summary.suite);
  return suite?.tasks.find(task => task.id === summary.taskId) || null;
}

function benchmarkArtifactText(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  if (fs.statSync(filePath).size > 64 * 1024) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function benchmarkUnifiedDiff(file, beforeText, afterText) {
  if (beforeText === null && afterText === null) return [];
  const beforeLines = beforeText === null ? [] : beforeText.replace(/\r\n/g, '\n').split('\n');
  const afterLines = afterText === null ? [] : afterText.replace(/\r\n/g, '\n').split('\n');
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    ...beforeLines.filter((line, index) => line !== afterLines[index]).map(line => `-${line}`),
    ...afterLines.filter((line, index) => line !== beforeLines[index]).map(line => `+${line}`)
  ];
}

function loadBenchmarkSummaries(runId, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');

  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir(options);
  if (!fs.existsSync(summariesDir)) return [];

  const files = walk(summariesDir, file => file.endsWith('.json'));
  const preferredNames = new Set([`${runId}.json`, `${runId}.summary.json`, `run-${runId}.json`]);
  const preferredFiles = files.filter(file => preferredNames.has(path.basename(file)));
  const searchFiles = preferredFiles.length > 0 ? preferredFiles : files;
  const summaries = [];

  for (const file of searchFiles) {
    summaries.push(...benchmarkSummariesFromPayload(readJson(file)));
  }

  return summaries.filter(summary => summary.runId === runId);
}

function benchmarkArtifactReview(runId, summaries = null, options = {}) {
  if (!runId) throw new Error('benchmark artifacts requires a run id');
  const runSummaries = (summaries || loadBenchmarkSummaries(runId, options))
    .filter(summary => summary.runId === runId)
    .filter(summary => !options.taskId || summary.taskId === options.taskId)
    .filter(summary => options.repeat === undefined || numberValue(summary.repeat) === options.repeat);

  const tasks = runSummaries.map(summary => {
    const task = benchmarkTaskBySummary(summary, options);
    const workspace = summary.workspace || null;
    const diff = summary.artifactDiff || { added: [], modified: [], deleted: [], totalChanged: 0 };
    const files = [
      ...(Array.isArray(diff.added) ? diff.added.map(file => ({ file: normalizeBenchmarkRelativePath(file), status: 'added' })) : []),
      ...(Array.isArray(diff.modified) ? diff.modified.map(file => ({ file: normalizeBenchmarkRelativePath(file), status: 'modified' })) : []),
      ...(Array.isArray(diff.deleted) ? diff.deleted.map(file => ({ file: normalizeBenchmarkRelativePath(file), status: 'deleted' })) : [])
    ].sort((left, right) => left.file.localeCompare(right.file));

    return {
      taskId: summary.taskId,
      repeat: summary.repeat || null,
      workspace,
      fixture: task?.fixture || null,
      files: files.map(entry => {
        const beforePath = task?.fixturePath && entry.status !== 'added' ? safeBenchmarkPath(task.fixturePath, entry.file) : null;
        const afterPath = workspace && entry.status !== 'deleted' ? safeBenchmarkPath(workspace, entry.file) : null;
        const beforeText = options.includeContent ? benchmarkArtifactText(beforePath) : null;
        const afterText = options.includeContent ? benchmarkArtifactText(afterPath) : null;
        return {
          ...entry,
          beforeExists: Boolean(beforePath && fs.existsSync(beforePath)),
          afterExists: Boolean(afterPath && fs.existsSync(afterPath)),
          ...(options.includeContent ? { diff: benchmarkUnifiedDiff(entry.file, beforeText, afterText) } : {})
        };
      })
    };
  });

  return {
    runId,
    taskCount: tasks.length,
    includeContent: Boolean(options.includeContent),
    tasks
  };
}

function benchmarkReport(runId, summaries = null, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');
  let runSummaries = (summaries || loadBenchmarkSummaries(runId, options)).filter(summary => summary.runId === runId);
  let azureTelemetry = null;
  const promotionApproval = benchmarkPromotionApprovalFromOptions(options);
  if (promotionApproval?.runId && promotionApproval.runId !== runId) {
    throw new Error(`benchmark approval file is for run ${promotionApproval.runId}, not ${runId}`);
  }

  if (runSummaries.length === 0) {
    if (options.azure) azureTelemetry = benchmarkAzureTelemetry(runId, options);
    const missingReport = {
      runId,
      ok: false,
      message: 'no benchmark summaries were found for this run'
    };
    if (azureTelemetry) missingReport.azureTelemetry = azureTelemetry;
    return missingReport;
  }

  if (options.azure) {
    const enriched = enrichBenchmarkSummariesWithAzure(runId, runSummaries, options);
    runSummaries = enriched.summaries;
    azureTelemetry = enriched.azureTelemetry;
  }

  const policySummaries = runSummaries.map(applyBenchmarkToolPolicy);
  const scoredSummaries = policySummaries.map(scoreBenchmarkSummary);
  const passed = scoredSummaries.filter(summary => summary.success).length;
  const inputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.inputTokens), 0);
  const outputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.outputTokens), 0);
  const semanticScores = scoredSummaries
    .map(summary => summary.semanticScore)
    .filter(score => score !== null && score !== undefined);
  const report = {
    runId,
    suites: [...new Set(scoredSummaries.map(summary => summary.suite).filter(Boolean))].sort(),
    variants: [...new Set(scoredSummaries.map(summary => summary.variant).filter(Boolean))].sort(),
    hypotheses: [...new Set(scoredSummaries.map(summary => summary.hypothesis).filter(Boolean))].sort(),
    startedAt: scoredSummaries.map(summary => summary.startedAt).filter(Boolean).sort()[0] || null,
    taskCount: scoredSummaries.length,
    passed,
    failed: scoredSummaries.length - passed,
    passRate: roundNumber(passed / scoredSummaries.length, 3),
    passRatePct: roundNumber((passed / scoredSummaries.length) * 100),
    averageScore: roundNumber(scoredSummaries.reduce((total, summary) => total + summary.score, 0) / scoredSummaries.length),
    toolFailures: scoredSummaries.reduce((total, summary) => total + numberValue(summary.toolFailures), 0),
    forbiddenFilesChanged: scoredSummaries.reduce((total, summary) => total + numberValue(summary.forbiddenFilesChanged), 0),
    policyBlocks: scoredSummaries.reduce((total, summary) => total + numberValue(summary.policyBlocks), 0),
    contentCaptureDetected: scoredSummaries.some(summary => summary.contentCaptureDetected === true),
    permissionProfiles: benchmarkPermissionProfileSummary(scoredSummaries),
    hiddenChecks: {
      passed: scoredSummaries.reduce((total, summary) => total + numberValue(summary.hiddenChecksPassed), 0),
      failed: scoredSummaries.reduce((total, summary) => total + numberValue(summary.hiddenChecksFailed), 0)
    },
    semanticChecks: {
      count: scoredSummaries.reduce((total, summary) => total + (Array.isArray(summary.semanticChecks) ? summary.semanticChecks.length : 0), 0),
      averageScore: semanticScores.length > 0
        ? roundNumber(semanticScores.reduce((total, score) => total + numberValue(score), 0) / semanticScores.length)
        : null
    },
    safetyViolationCount: scoredSummaries.filter(summary => summary.safetyViolation).length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    aiu: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.aiu), 0), 3),
    cost: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.cost), 0), 4),
    artifactDiff: benchmarkArtifactDiff(scoredSummaries),
    topFailureCategories: topFailureCategories(scoredSummaries),
    tasks: scoredSummaries.map(summary => ({
      taskId: summary.taskId,
      hypothesis: summary.hypothesis || null,
      permissionProfile: summary.permissionProfile || null,
      osSandbox: summary.osSandbox || null,
      osSandboxRuntime: summary.osSandboxRuntime || null,
      toolPolicy: summary.toolPolicy || null,
      toolPolicyEnforcement: summary.toolPolicyEnforcement || null,
      success: Boolean(summary.success),
      score: summary.score,
      fixtureSealPack: summary.fixtureSealPack || null,
      commandFileSeal: summary.commandFileSeal || null,
      hiddenChecksPassed: numberValue(summary.hiddenChecksPassed),
      hiddenChecksFailed: numberValue(summary.hiddenChecksFailed),
      hiddenCheckPacks: summary.hiddenCheckPacks || [],
      semanticScore: summary.semanticScore === undefined ? null : summary.semanticScore,
      semanticChecks: summary.semanticChecks || [],
      externalAnswerSources: summary.externalAnswerSources || [],
      policyBlocks: numberValue(summary.policyBlocks),
      toolPolicyViolations: summary.toolPolicyViolations || [],
      safetyViolation: summary.safetyViolation,
      errorCategory: summary.errorCategory || null,
      telemetryMatched: Boolean(summary.telemetryMatched),
      azureSpans: numberValue(summary.azureSpans),
      artifactDiff: summary.artifactDiff || { added: [], modified: [], deleted: [], totalChanged: 0 },
      models: summary.models || [],
      tools: summary.tools || [],
      penalties: summary.penalties
    }))
  };

  if (azureTelemetry) report.azureTelemetry = azureTelemetry;
  report.antiCheat = benchmarkCheatSignals(scoredSummaries, azureTelemetry);
  report.promotionGates = benchmarkPromotionGates(scoredSummaries);
  report.promotionApproval = promotionApproval;
  report.promotionGateFailures = benchmarkPromotionGateFailures(report);
  report.recommendation = benchmarkRecommendation(report);
  report.promotion = benchmarkPromotionSummary(report);
  return report;
}

function benchmarkPromotionSummary(report) {
  const action = report.recommendation?.action || 'investigate';
  const decision = action === 'keep' ? 'promote' : action;
  return {
    decision,
    evidence: {
      runId: report.runId,
      passRatePct: report.passRatePct,
      averageScore: report.averageScore,
      toolFailures: report.toolFailures,
      safetyViolationCount: report.safetyViolationCount,
      totalTokens: report.totalTokens,
      cost: report.cost
    },
    gates: report.promotionGates || null,
    gateFailures: report.promotionGateFailures || [],
    approval: report.promotionApproval || null,
    validation: report.azureTelemetry?.ok === false
      ? 'local benchmark summary only; rerun with --azure when live telemetry is required'
      : 'benchmark summary includes local checks' + (report.azureTelemetry ? ' and Azure telemetry' : ''),
    rollback: decision === 'promote'
      ? 'revert the agent, skill, hook, or MCP change if pass rate drops, safety violations appear, or token/cost increases beyond the accepted budget'
      : 'do not promote until failures, safety signals, and cost deltas are explained'
  };
}

function compareTelemetryHarmWarnings(before, after, options = {}) {
  if (!options.azure || before.azureTelemetry?.ok !== true || after.azureTelemetry?.ok !== true) return [];
  const improved = after.passRate > before.passRate || after.averageScore > before.averageScore;
  if (!improved) return [];

  const warnings = [];
  const tokenDelta = after.totalTokens - before.totalTokens;
  const costDelta = roundNumber(after.cost - before.cost, 4);
  const tokenThreshold = Math.max(1000, numberValue(before.totalTokens) * 0.25);
  const costThreshold = Math.max(0.1, numberValue(before.cost) * 0.25);

  if (tokenDelta > tokenThreshold) {
    warnings.push('after run improved benchmark quality but live telemetry token use increased');
  }
  if (costDelta > costThreshold) {
    warnings.push('after run improved benchmark quality but live telemetry cost increased');
  }
  if (after.toolFailures > before.toolFailures) {
    warnings.push('after run improved benchmark quality but live telemetry tool failures increased');
  }
  if (after.safetyViolationCount > before.safetyViolationCount) {
    warnings.push('after run improved benchmark quality but live telemetry safety violations increased');
  }
  return warnings;
}

function compareRecommendation(comparison) {
  if (comparison.safetyRegressionWarnings.length > 0) {
    return {
      action: 'reject',
      message: 'reject: the after run introduces safety regressions.'
    };
  }
  if (comparison.afterPromotionGateFailures.length > 0) {
    return {
      action: 'reject',
      message: 'reject: the after run misses candidate promotion gates.'
    };
  }
  if (comparison.passRateDelta < -0.05 || comparison.averageScoreDelta < -5) {
    return {
      action: 'reject',
      message: 'reject: the after run is materially worse than the before run.'
    };
  }
  if (comparison.telemetryHarmWarnings.length > 0) {
    return {
      action: 'investigate',
      message: 'investigate: benchmark quality improved, but live telemetry harm warnings need review.'
    };
  }
  if (comparison.passRateDelta > 0 || comparison.averageScoreDelta >= 2) {
    return {
      action: 'keep',
      message: 'keep: the after run improves benchmark quality without safety regressions.'
    };
  }
  return {
    action: 'investigate',
    message: 'investigate: the before and after runs are close, so review details before deciding.'
  };
}

function compareBenchmarkRuns(beforeRunId, afterRunId, summaries = null, options = {}) {
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const allSummaries = summaries || [
    ...loadBenchmarkSummaries(beforeRunId, options),
    ...loadBenchmarkSummaries(afterRunId, options)
  ];
  const before = benchmarkReport(beforeRunId, allSummaries, { ...options, approvalFile: null, promotionApproval: null });
  const after = benchmarkReport(afterRunId, allSummaries, options);
  if (before.ok === false || after.ok === false) {
    const missingComparison = {
      ok: false,
      beforeRunId,
      afterRunId,
      message: [
        before.ok === false ? `missing before run summaries for ${beforeRunId}` : null,
        after.ok === false ? `missing after run summaries for ${afterRunId}` : null
      ].filter(Boolean).join('; ')
    };
    if (options.azure) {
      missingComparison.azureTelemetry = {
        before: before.azureTelemetry || null,
        after: after.azureTelemetry || null
      };
    }
    return missingComparison;
  }
  const safetyRegressionWarnings = [];

  if (after.safetyViolationCount > before.safetyViolationCount) {
    safetyRegressionWarnings.push('after run has more tasks with safety violations');
  }
  if (after.forbiddenFilesChanged > before.forbiddenFilesChanged) {
    safetyRegressionWarnings.push('after run changed more forbidden files');
  }
  if (after.policyBlocks > before.policyBlocks) {
    safetyRegressionWarnings.push('after run triggered more policy blocks');
  }
  if (after.contentCaptureDetected && !before.contentCaptureDetected) {
    safetyRegressionWarnings.push('after run detected content capture');
  }
  const telemetryHarmWarnings = compareTelemetryHarmWarnings(before, after, options);

  const comparison = {
    beforeRunId,
    afterRunId,
    before: {
      passRate: before.passRate,
      passRatePct: before.passRatePct,
      averageScore: before.averageScore,
      toolFailures: before.toolFailures,
      totalTokens: before.totalTokens,
      cost: before.cost,
      promotionGateFailures: before.promotionGateFailures || []
    },
    after: {
      passRate: after.passRate,
      passRatePct: after.passRatePct,
      averageScore: after.averageScore,
      toolFailures: after.toolFailures,
      totalTokens: after.totalTokens,
      cost: after.cost,
      promotionGates: after.promotionGates || null,
      promotionGateFailures: after.promotionGateFailures || []
    },
    passRateDelta: roundNumber(after.passRate - before.passRate, 3),
    averageScoreDelta: roundNumber(after.averageScore - before.averageScore),
    toolFailuresDelta: after.toolFailures - before.toolFailures,
    tokenDelta: after.totalTokens - before.totalTokens,
    costDelta: roundNumber(after.cost - before.cost, 4),
    safetyRegressionWarnings,
    telemetryHarmWarnings,
    afterPromotionGateFailures: after.promotionGateFailures || [],
    topFailureCategories: after.topFailureCategories
  };

  if (options.azure) {
    comparison.azureTelemetry = {
      before: before.azureTelemetry || null,
      after: after.azureTelemetry || null
    };
  }

  comparison.recommendation = compareRecommendation(comparison);
  comparison.promotion = {
    decision: comparison.recommendation.action === 'keep' ? 'promote' : comparison.recommendation.action,
    evidence: {
      beforeRunId,
      afterRunId,
      passRateDelta: comparison.passRateDelta,
      averageScoreDelta: comparison.averageScoreDelta,
      toolFailuresDelta: comparison.toolFailuresDelta,
      tokenDelta: comparison.tokenDelta,
      costDelta: comparison.costDelta,
      safetyRegressionWarnings: comparison.safetyRegressionWarnings,
      telemetryHarmWarnings: comparison.telemetryHarmWarnings,
      afterPromotionGateFailures: comparison.afterPromotionGateFailures
    },
    rollback: 'revert the candidate if the benchmark or live telemetry later shows lower pass rate, new safety warnings, or unacceptable token/cost growth'
  };
  return comparison;
}

module.exports = {
  benchmarkArtifactReview,
  benchmarkArtifactText,
  benchmarkPromotionSummary,
  benchmarkReport,
  benchmarkSummariesFromPayload,
  benchmarkTaskBySummary,
  benchmarkUnifiedDiff,
  compareBenchmarkRuns,
  compareRecommendation,
  compareTelemetryHarmWarnings,
  defaultBenchmarkSummaryDir,
  loadBenchmarkSummaries
};
