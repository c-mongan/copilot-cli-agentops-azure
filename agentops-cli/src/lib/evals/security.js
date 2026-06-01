const { clampScore } = require('./scoring');

function scoreSecurity(run = {}, context = {}) {
  const deniedTools = Number(run.ToolDeniedCount || 0);
  const privacyDrops = (context.privacy || []).reduce((total, row) => total + Number(row.DroppedCount || 0), 0);

  return clampScore(deniedTools > 0 ? 70 - deniedTools * 15 : privacyDrops > 0 ? 72 : String(run.PrivacyMode || 'strict') === 'unsafe' ? 20 : 92);
}

module.exports = {
  scoreSecurity
};
