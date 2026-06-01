function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function evalBucket(score) {
  if (score >= 80) return 'good';
  if (score >= 60) return 'review';
  return 'poor';
}

module.exports = {
  clampScore,
  evalBucket
};
