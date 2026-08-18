const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const {
  healthSummary,
  renderHealth,
  runHealthFromRows,
  summarizeChecks
} = require('./health-summary');

async function healthCommand(args = []) {
  const summary = await healthSummary({
    runsFile: optionValue(args, '--runs'),
    mode: process.env.AGENTOPS_COLLECTOR_MODE || 'auto'
  });
  writeJsonOrRender(summary, hasFlag(args, '--json'), renderHealth);
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  healthCommand,
  healthSummary,
  renderHealth,
  runHealthFromRows,
  summarizeChecks
};
