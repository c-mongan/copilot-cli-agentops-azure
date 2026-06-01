const { clampScore } = require('./scoring');

function scoreReliability(run = {}) {
  return clampScore(run.OutcomeStatus === 'success' ? 90 : run.OutcomeStatus === 'blocked' ? 55 : 42);
}

module.exports = {
  scoreReliability
};
