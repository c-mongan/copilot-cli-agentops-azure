const path = require('node:path');

const legacy = require('../legacy');
const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const {
  buildV2AskContext,
  hasV2AskArgs,
  renderV2AskContext
} = require('./v2-ask-context');

function legacyAskContext(args = []) {
  const sessionId = args[0] || 'latest';
  const last = optionValue(args, '--last', '24h');
  const result = legacy.askAgentOpsContext({ sessionId, last, json: hasFlag(args, '--json'), args: args.slice(1) });
  writeJsonOrRender(result, hasFlag(args, '--json'), legacy.renderAskContext);
  process.exitCode = result.ok ? 0 : 1;
}

function askContextCommand(args = []) {
  if (!hasV2AskArgs(args)) return legacyAskContext(args);
  const target = args[0] || 'latest';
  const result = buildV2AskContext({
    runId: target,
    runsFile: path.resolve(optionValue(args, '--runs')),
    eventsFile: optionValue(args, '--events') ? path.resolve(optionValue(args, '--events')) : null,
    toolsFile: optionValue(args, '--tools') ? path.resolve(optionValue(args, '--tools')) : null,
    privacyFile: optionValue(args, '--privacy') ? path.resolve(optionValue(args, '--privacy')) : null,
    githubFile: optionValue(args, '--github') ? path.resolve(optionValue(args, '--github')) : null,
    evalsFile: optionValue(args, '--evals') ? path.resolve(optionValue(args, '--evals')) : null,
    insightsFile: optionValue(args, '--insights') ? path.resolve(optionValue(args, '--insights')) : null,
    recommendationsFile: optionValue(args, '--recommendations') ? path.resolve(optionValue(args, '--recommendations')) : null,
    last: optionValue(args, '--last', '2h')
  });
  writeJsonOrRender(result, hasFlag(args, '--json'), renderV2AskContext);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  askContextCommand,
  buildAskContext: buildV2AskContext,
  hasV2AskArgs,
  legacyAskContext,
  renderAskContext: renderV2AskContext
};
