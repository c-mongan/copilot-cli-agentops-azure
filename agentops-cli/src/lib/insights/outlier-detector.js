function numericValues(rows, field) {
  return rows
    .map(row => Number(row[field] || 0))
    .filter(value => Number.isFinite(value) && value > 0);
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function detectCostOutlier(run = {}, baselineRuns = [], options = {}) {
  const current = Number(run.EstimatedCostUsd || 0);
  const minCurrent = options.minCurrent ?? 1;
  const minMultiplier = options.minMultiplier ?? 2;
  const peers = baselineRuns.filter(row => row.RunId !== run.RunId
    && (!run.ModelActual || row.ModelActual === run.ModelActual)
    && (!run.TaskType || row.TaskType === run.TaskType));
  const baseline = average(numericValues(peers, 'EstimatedCostUsd'));

  if (current < minCurrent) return null;
  if (baseline > 0 && current < baseline * minMultiplier) return null;

  return {
    type: 'cost-anomaly',
    severity: current >= 3 ? 'high' : 'medium',
    summary: baseline > 0
      ? `Estimated cost is ${current.toFixed(2)} USD, above the ${baseline.toFixed(2)} USD baseline for this model/task.`
      : 'Estimated run cost is high for this model/task.',
    suggestedNextStep: 'Compare model/task cost in Models, Cost & Tokens before repeating this task.',
    baselineValue: baseline || null,
    currentValue: current
  };
}

function detectLatencyOutlier(run = {}, baselineRuns = [], options = {}) {
  const current = Number(run.DurationMs || 0);
  const minCurrent = options.minCurrentMs ?? 120000;
  const minMultiplier = options.minMultiplier ?? 2;
  const peers = baselineRuns.filter(row => row.RunId !== run.RunId
    && (!run.TaskType || row.TaskType === run.TaskType));
  const baseline = average(numericValues(peers, 'DurationMs'));

  if (current < minCurrent) return null;
  if (baseline > 0 && current < baseline * minMultiplier) return null;

  return {
    type: 'latency-anomaly',
    severity: current >= 300000 ? 'high' : 'medium',
    summary: baseline > 0
      ? `Run duration is ${Math.round(current / 1000)}s, above the ${Math.round(baseline / 1000)}s baseline for this task.`
      : 'Run duration is high for this task.',
    suggestedNextStep: 'Open Run Replay and inspect the slow model/tool spans.',
    baselineValue: baseline || null,
    currentValue: current
  };
}

function detectOutliers(run = {}, baselineRuns = [], options = {}) {
  return [
    detectCostOutlier(run, baselineRuns, options),
    detectLatencyOutlier(run, baselineRuns, options)
  ].filter(Boolean);
}

module.exports = {
  detectCostOutlier,
  detectLatencyOutlier,
  detectOutliers
};
