const fs = require('node:fs');
const path = require('node:path');

const { evaluateRunQuality } = require('../evals');
const { detectOutliers } = require('./outlier-detector');
const { detectEvalRegression, detectToolRegression } = require('./regression-detector');

function readJsonl(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function byRun(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.RunId)) map.set(row.RunId, []);
    map.get(row.RunId).push(row);
  }
  return map;
}

function addInsight(insights, run, type, severity, summary, suggestedNextStep, extra = {}) {
  insights.push({
    TimeGenerated: run.TimeGenerated || new Date().toISOString(),
    InsightId: `${type}_${run.RunId}`,
    InsightType: type,
    Severity: severity,
    Summary: summary,
    RunId: run.RunId,
    RepoHash: run.RepoHash || '',
    ModelActual: run.ModelActual || '',
    ToolName: extra.ToolName || '',
    BaselineValue: extra.BaselineValue ?? null,
    CurrentValue: extra.CurrentValue ?? null,
    ConfigHash: extra.ConfigHash || '',
    PatternId: extra.PatternId || '',
    PatternKey: extra.PatternKey || '',
    PatternRuns: extra.PatternRuns ?? null,
    PatternDimension: extra.PatternDimension || '',
    SuggestedNextStep: suggestedNextStep
  });
}

function patternKey(parts = []) {
  return parts.map(part => String(part || 'unknown').replace(/\s+/g, '_')).join('|');
}

function addPatternInsight(insights, runs, type, severity, dimension, summary, suggestedNextStep, extra = {}) {
  if (runs.length < 2) return;
  const latest = [...runs].sort((a, b) => String(b.TimeGenerated || '').localeCompare(String(a.TimeGenerated || '')))[0] || runs[0];
  const key = extra.PatternKey || patternKey([type, dimension]);
  addInsight(insights, latest, type, severity, summary, suggestedNextStep, {
    ...extra,
    PatternId: `pattern_${Buffer.from(key).toString('base64url').slice(0, 18)}`,
    PatternKey: key,
    PatternRuns: runs.length,
    PatternDimension: dimension
  });
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function addRecurringPatterns(insights, runs) {
  const failedRuns = runs.filter(run => run.OutcomeStatus && run.OutcomeStatus !== 'success');
  for (const [key, rows] of groupBy(failedRuns, run => patternKey([
    'failure',
    run.TaskType,
    run.ModelActual,
    run.OutcomeReason || 'failed'
  ]))) {
    addPatternInsight(
      insights,
      rows,
      'recurring-failure-pattern',
      rows.length >= 5 ? 'high' : 'medium',
      'task_model_outcome',
      `${rows.length} failed runs share the same task/model/outcome shape.`,
      'Open Runs Explorer filtered by task and model, then inspect the newest failed Run Replay.',
      { PatternKey: key, CurrentValue: rows.length }
    );
  }

  const noTestRows = runs.filter(run => Number(run.FilesEditedCount || 0) > 0 && !run.TestsRan);
  for (const [key, rows] of groupBy(noTestRows, run => patternKey([
    'edited-no-tests',
    run.RepoHash,
    run.TaskType,
    run.AgentName || 'agent'
  ]))) {
    addPatternInsight(
      insights,
      rows,
      'recurring-no-tests-pattern',
      rows.length >= 4 ? 'high' : 'medium',
      'repo_task_agent',
      `${rows.length} runs edited files without recorded tests for the same repo/task/agent shape.`,
      'Open Code Outcomes and add a validation step to the agent or skill for this task type.',
      { PatternKey: key, CurrentValue: rows.length }
    );
  }

  const deniedRows = runs.filter(run => Number(run.ToolDeniedCount || 0) > 0);
  for (const [key, rows] of groupBy(deniedRows, run => patternKey([
    'policy-deny',
    run.RepoHash,
    run.TaskType,
    run.PrivacyMode || 'strict'
  ]))) {
    addPatternInsight(
      insights,
      rows,
      'recurring-policy-pattern',
      rows.length >= 4 ? 'high' : 'medium',
      'repo_task_privacy',
      `${rows.length} runs hit policy-deny metadata for the same repo/task/privacy shape.`,
      'Open Safety, Privacy & Policy and compare denied tool risk before changing permissions.',
      { PatternKey: key, CurrentValue: rows.length }
    );
  }

  const costRows = runs.filter(run => Number(run.EstimatedCostUsd || 0) >= 1);
  for (const [key, rows] of groupBy(costRows, run => patternKey([
    'cost',
    run.ModelActual,
    run.TaskType
  ]))) {
    const totalCost = rows.reduce((total, run) => total + Number(run.EstimatedCostUsd || 0), 0);
    addPatternInsight(
      insights,
      rows,
      'recurring-cost-pattern',
      totalCost >= 10 ? 'high' : 'medium',
      'model_task',
      `${rows.length} high-cost runs share the same model/task shape.`,
      'Open Models, Cost & Tokens and compare cost per useful outcome before repeating this task.',
      { PatternKey: key, CurrentValue: Number(totalCost.toFixed(4)) }
    );
  }
}

function evaluateRun(run, context = {}) {
  const privacy = context.privacy || [];
  const github = context.github || [];
  const testsRan = Boolean(run.TestsRan);
  const edited = Number(run.FilesEditedCount || 0) > 0;
  const failedTools = Number(run.ToolFailureCount || 0);
  const deniedTools = Number(run.ToolDeniedCount || 0);
  const privacyDrops = privacy.reduce((total, row) => total + Number(row.DroppedCount || 0), 0);
  const githubOutcome = github[0] || {};
  const scores = evaluateRunQuality(run, context);
  const highContext = Number(run.ContextWindowPct || 0) >= 90 || Number(run.TokensRemoved || 0) > 0;

  return {
    TimeGenerated: run.TimeGenerated || new Date().toISOString(),
    RunId: run.RunId,
    TraceId: run.TraceId || '',
    RepoHash: run.RepoHash || '',
    ModelActual: run.ModelActual || '',
    TaskType: run.TaskType || 'unknown',
    ...scores,
    EvalReason: [
      edited && !testsRan ? 'edited_files_without_tests' : null,
      failedTools > 0 ? 'tool_failures' : null,
      deniedTools > 0 ? 'tool_denied' : null,
      highContext ? 'context_pressure' : null,
      privacyDrops > 0 ? 'privacy_drops' : null,
      githubOutcome.CiStatus === 'failed' ? 'ci_failed' : null,
      githubOutcome.PrMerged ? 'pr_merged' : null
    ].filter(Boolean).join(',')
  };
}

function generateInsights(tables = {}) {
  const runs = tables.runs || [];
  const toolsByRun = byRun(tables.tools || []);
  const privacyByRun = byRun(tables.privacy || []);
  const githubByRun = byRun(tables.github || []);
  const baselineEvals = tables.evals || [];
  const baselineTools = tables.baselineTools || tables.tools || [];
  const evals = [];
  const insights = [];

  for (const run of runs) {
    const context = {
      tools: toolsByRun.get(run.RunId) || [],
      privacy: privacyByRun.get(run.RunId) || [],
      github: githubByRun.get(run.RunId) || []
    };
    const evaluation = evaluateRun(run, context);
    evals.push(evaluation);

    if (Number(run.FilesEditedCount || 0) > 0 && !run.TestsRan) {
      addInsight(insights, run, 'test-discipline', 'high', 'Files were edited without a recorded test run.', 'Run targeted tests and attach the test span to this run.');
    }
    const toolRegression = detectToolRegression(run, context.tools, baselineTools);
    if (toolRegression) {
      addInsight(insights, run, toolRegression.type, toolRegression.severity, toolRegression.summary, toolRegression.suggestedNextStep, {
        ToolName: toolRegression.toolName,
        BaselineValue: toolRegression.baselineValue,
        CurrentValue: toolRegression.currentValue
      });
    }
    if (Number(run.ToolDeniedCount || 0) > 0 || context.tools.some(tool => tool.Allowed === false)) {
      addInsight(insights, run, 'policy-deny', 'high', 'A tool request was blocked by policy metadata.', 'Review the denied tool risk and tighten the task or permissions.');
    }
    if (Number(run.ContextWindowPct || 0) >= 90 || Number(run.TokensRemoved || 0) > 0) {
      addInsight(insights, run, 'context-pressure', 'medium', 'Context pressure or token removal was observed during the run.', 'Open Run Replay and inspect context/cache posture before retrying.');
    }
    if (context.privacy.length > 0) {
      addInsight(insights, run, 'privacy-drop', 'medium', 'Content-like fields were observed and dropped before export.', 'Keep strict mode enabled and inspect the source surface for unexpected content fields.');
    }
    if (context.github.some(row => row.CiStatus === 'failed')) {
      addInsight(insights, run, 'ci-failed', 'high', 'A PR outcome had failing CI after the agent run.', 'Open the Code Outcomes dashboard and rerun the failing check locally.');
    }
    for (const outlier of detectOutliers(run, runs)) {
      addInsight(insights, run, outlier.type, outlier.severity, outlier.summary, outlier.suggestedNextStep, {
        BaselineValue: outlier.baselineValue,
        CurrentValue: outlier.currentValue
      });
    }
    const evalRegression = detectEvalRegression(run, evaluation, baselineEvals);
    if (evalRegression) {
      addInsight(insights, run, evalRegression.type, evalRegression.severity, evalRegression.summary, evalRegression.suggestedNextStep, {
        BaselineValue: evalRegression.baselineValue,
        CurrentValue: evalRegression.currentValue,
        ConfigHash: evalRegression.configHash
      });
    }
  }

  addRecurringPatterns(insights, runs);

  return {
    ok: true,
    evals,
    insights,
    table_counts: {
      AgentOpsEval_CL: evals.length,
      AgentOpsInsights_CL: insights.length
    }
  };
}

function writeInsights(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const evalFile = path.join(outDir, 'AgentOpsEval_CL.jsonl');
  const insightsFile = path.join(outDir, 'AgentOpsInsights_CL.jsonl');
  fs.writeFileSync(evalFile, `${result.evals.map(row => JSON.stringify(row)).join('\n')}${result.evals.length ? '\n' : ''}`);
  fs.writeFileSync(insightsFile, `${result.insights.map(row => JSON.stringify(row)).join('\n')}${result.insights.length ? '\n' : ''}`);
  return { evalFile, insightsFile };
}

module.exports = {
  evaluateRun,
  generateInsights,
  readJsonl,
  writeInsights
};
