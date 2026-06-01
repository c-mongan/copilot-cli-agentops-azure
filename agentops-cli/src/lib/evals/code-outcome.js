const { clampScore } = require('./scoring');

function scoreCodeOutcome(run = {}, context = {}) {
  const githubOutcome = (context.github || [])[0] || {};
  const edited = Number(run.FilesEditedCount || 0) > 0;
  const testsRan = Boolean(run.TestsRan);

  return clampScore(githubOutcome.PrReverted ? 20
    : githubOutcome.PrMerged ? 98
      : githubOutcome.PrOpened && githubOutcome.CiStatus === 'failed' ? 50
        : githubOutcome.PrOpened ? 72
          : edited && !testsRan ? 40
            : 65);
}

module.exports = {
  scoreCodeOutcome
};
