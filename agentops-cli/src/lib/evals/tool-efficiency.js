const { clampScore } = require('./scoring');

function scoreToolEfficiency(run = {}) {
  const failedTools = Number(run.ToolFailureCount || 0);
  const toolCount = Number(run.ToolCount || 0);
  const contextWindowPct = Number(run.ContextWindowPct || 0);
  const tokensRemoved = Number(run.TokensRemoved || 0);
  const permissionWaitMs = Number(run.PermissionWaitMs || 0);
  const cacheReadTokens = Number(run.CacheReadTokens || 0);
  const inputTokens = Number(run.InputTokens || 0);

  let score = failedTools > 0 ? 75 - failedTools * 12 : toolCount > 20 ? 62 : 88;
  if (contextWindowPct >= 90) score -= 14;
  if (tokensRemoved > 0) score -= 10;
  if (permissionWaitMs >= 10000) score -= 8;
  if (inputTokens > 0 && cacheReadTokens / inputTokens >= 0.2) score += 6;
  return clampScore(score);
}

module.exports = {
  scoreToolEfficiency
};
