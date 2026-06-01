const path = require('node:path');

const legacy = require('../legacy');
const { hasFlag, optionValue } = require('../lib/args');
const { explainFromFiles, renderV2Explanation } = require('../lib/explain/v2-explain');

function hasV2Args(args) {
  return Boolean(optionValue(args, '--runs') || optionValue(args, '--evals') || optionValue(args, '--insights'));
}

function explainCommand(args = []) {
  const target = args[0] || 'latest';
  if (target !== 'latest' && !target.startsWith('run_') && !target.startsWith('run-')) {
    throw new Error('explain supports: latest or <run-id>');
  }

  if (!hasV2Args(args)) {
    if (target !== 'latest') throw new Error('legacy explain supports only latest unless --runs is supplied');
    const summary = legacy.latestSummaryFromArgs(args.slice(1));
    const explanation = legacy.explainLatest(summary);
    process.stdout.write(hasFlag(args, '--json')
      ? `${JSON.stringify(explanation, null, 2)}\n`
      : legacy.renderExplanation(explanation));
    return;
  }

  const explanation = explainFromFiles({
    runId: target,
    runsFile: path.resolve(optionValue(args, '--runs')),
    evalsFile: optionValue(args, '--evals') ? path.resolve(optionValue(args, '--evals')) : null,
    insightsFile: optionValue(args, '--insights') ? path.resolve(optionValue(args, '--insights')) : null
  });
  process.stdout.write(hasFlag(args, '--json')
    ? `${JSON.stringify(explanation, null, 2)}\n`
    : renderV2Explanation(explanation));
  if (!explanation.ok) process.exitCode = 1;
}

module.exports = {
  explainCommand,
  hasV2Args
};
