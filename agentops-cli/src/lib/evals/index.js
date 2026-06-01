const { scoreCodeOutcome } = require('./code-outcome');
const { scoreReliability } = require('./reliability');
const { scoreSecurity } = require('./security');
const { clampScore, evalBucket } = require('./scoring');
const { scoreTestDiscipline } = require('./test-discipline');
const { scoreToolEfficiency } = require('./tool-efficiency');

function evaluateRunQuality(run = {}, context = {}) {
  const TestDiscipline = scoreTestDiscipline(run, context);
  const ToolEfficiency = scoreToolEfficiency(run, context);
  const Security = scoreSecurity(run, context);
  const Reliability = scoreReliability(run, context);
  const CodeOutcome = scoreCodeOutcome(run, context);
  const EvalOverall = clampScore((TestDiscipline + ToolEfficiency + Security + Reliability + CodeOutcome) / 5);

  return {
    EvalOverall,
    TestDiscipline,
    ToolEfficiency,
    Security,
    Reliability,
    CodeOutcome,
    EvalBucket: evalBucket(EvalOverall)
  };
}

module.exports = {
  clampScore,
  evalBucket,
  evaluateRunQuality,
  scoreCodeOutcome,
  scoreReliability,
  scoreSecurity,
  scoreTestDiscipline,
  scoreToolEfficiency
};
