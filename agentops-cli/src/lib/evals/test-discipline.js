const { clampScore } = require('./scoring');

function scoreTestDiscipline(run = {}) {
  const testsRan = Boolean(run.TestsRan);
  const testsPassed = Boolean(run.TestsPassed);
  const edited = Number(run.FilesEditedCount || 0) > 0;

  return clampScore(edited && !testsRan ? 35 : testsRan && testsPassed ? 95 : testsRan ? 55 : 75);
}

module.exports = {
  scoreTestDiscipline
};
