const fs = require('node:fs');

function readJsonl(filePath) {
  if (!filePath) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function latestByTime(rows) {
  return [...rows].sort((left, right) => String(right.TimeGenerated || '').localeCompare(String(left.TimeGenerated || '')))[0] || null;
}

function explainRun(run, evalRows = [], insightRows = []) {
  if (!run) {
    return {
      ok: false,
      headline: 'Not enough data yet',
      detail: 'No V2 AgentOps run rows were available.',
      run: null,
      evaluation: null,
      insights: []
    };
  }
  const evaluation = evalRows.find(row => row.RunId === run.RunId) || null;
  const insights = insightRows.filter(row => row.RunId === run.RunId);
  const topInsight = insights.find(row => row.Severity === 'high') || insights[0] || null;
  const failed = run.OutcomeStatus && run.OutcomeStatus !== 'success';
  const score = evaluation?.EvalOverall;

  let headline = 'This run looks healthy';
  let detail = 'No high-severity eval or insight rows were found.';
  if (topInsight) {
    headline = topInsight.Summary;
    detail = topInsight.SuggestedNextStep || 'Open the linked dashboard and inspect the run timeline.';
  } else if (failed) {
    headline = `Run ended as ${run.OutcomeStatus}`;
    detail = run.OutcomeReason || 'Inspect Run Replay for the failed span or tool call.';
  } else if (score !== undefined && score < 60) {
    headline = `Eval score is low (${score})`;
    detail = evaluation.EvalReason || 'Review eval component scores before repeating this task.';
  }

  return {
    ok: true,
    headline,
    detail,
    run,
    evaluation,
    insights
  };
}

function renderV2Explanation(explanation) {
  const lines = ['AgentOps explanation', ''];
  if (!explanation.ok) {
    lines.push(explanation.headline);
    lines.push(explanation.detail);
    return `${lines.join('\n')}\n`;
  }
  const run = explanation.run;
  lines.push(`Run: ${run.RunId}`);
  lines.push(`Status: ${run.OutcomeStatus || 'unknown'}${run.OutcomeReason ? ` (${run.OutcomeReason})` : ''}`);
  lines.push(`Headline: ${explanation.headline}`);
  lines.push(`Next: ${explanation.detail}`);
  if (explanation.evaluation) {
    lines.push(`Eval: ${explanation.evaluation.EvalOverall} (${explanation.evaluation.EvalBucket || 'unknown'})`);
    lines.push(`Scores: tests=${explanation.evaluation.TestDiscipline} tools=${explanation.evaluation.ToolEfficiency} security=${explanation.evaluation.Security} reliability=${explanation.evaluation.Reliability} code=${explanation.evaluation.CodeOutcome}`);
  }
  if (explanation.insights.length > 0) {
    lines.push('Insights:');
    for (const insight of explanation.insights.slice(0, 5)) {
      lines.push(`- ${insight.Severity}: ${insight.InsightType} - ${insight.Summary}`);
    }
  }
  lines.push('Privacy: explanation is based on metadata-only rows.');
  return `${lines.join('\n')}\n`;
}

function explainFromFiles(options = {}) {
  const runs = readJsonl(options.runsFile);
  const evals = readJsonl(options.evalsFile);
  const insights = readJsonl(options.insightsFile);
  const run = options.runId && options.runId !== 'latest'
    ? runs.find(row => row.RunId === options.runId)
    : latestByTime(runs);
  return explainRun(run, evals, insights);
}

module.exports = {
  explainFromFiles,
  explainRun,
  latestByTime,
  renderV2Explanation
};
