function detectEvalRegression(run = {}, evaluation = {}, baselineEvals = [], options = {}) {
  const current = Number(evaluation.EvalOverall ?? run.EvalOverall ?? 0);
  const baselineRows = baselineEvals.filter(row => row.RunId !== run.RunId
    && (!run.RepoHash || row.RepoHash === run.RepoHash)
    && (!run.TaskType || row.TaskType === run.TaskType));
  const baseline = baselineRows.length
    ? baselineRows.reduce((total, row) => total + Number(row.EvalOverall || 0), 0) / baselineRows.length
    : 0;
  const minDrop = options.minDrop ?? 20;
  const configHash = run.ConfigHash || run.InstructionHash || run.PolicyHash || run.McpConfigHash || '';

  if (!configHash || baseline <= 0 || baseline - current < minDrop) return null;

  return {
    type: 'eval-regression',
    severity: baseline - current >= 35 ? 'high' : 'medium',
    summary: 'Eval score dropped after a configuration hash changed.',
    suggestedNextStep: 'Open Insights & Regressions, compare the changed instruction/config hash, then replay the low-score run.',
    baselineValue: baseline,
    currentValue: current,
    configHash
  };
}

function detectToolRegression(run = {}, tools = [], baselineTools = [], options = {}) {
  const failures = tools.filter(tool => tool.Status && tool.Status !== 'success');
  if (failures.length === 0) return null;
  const toolName = failures[0].ToolName || '';
  const sameTool = baselineTools.filter(tool => tool.RunId !== run.RunId && tool.ToolName === toolName);
  const baselineFailureRate = sameTool.length
    ? sameTool.filter(tool => tool.Status && tool.Status !== 'success').length / sameTool.length
    : 0;
  const minFailureRate = options.minFailureRate ?? 0.25;
  const currentFailureRate = failures.length / Math.max(1, tools.length);

  if (sameTool.length > 0 && currentFailureRate < Math.max(minFailureRate, baselineFailureRate * 2)) return null;

  return {
    type: 'tool-regression',
    severity: currentFailureRate >= 0.5 ? 'high' : 'medium',
    summary: 'One or more tool calls failed above the recent baseline.',
    suggestedNextStep: 'Open Run Replay and inspect the failed tool span.',
    baselineValue: baselineFailureRate,
    currentValue: currentFailureRate,
    toolName
  };
}

module.exports = {
  detectEvalRegression,
  detectToolRegression
};
