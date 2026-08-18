const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { doctorSummary, renderDoctor } = require('./doctor-summary');

async function doctorCommand(args = []) {
  const json = hasFlag(args, '--json');
  const summary = await doctorSummary({
    mode: process.env.AGENTOPS_COLLECTOR_MODE || 'auto',
    localOnly: hasFlag(args, '--local-only'),
    last: optionValue(args, '--last', undefined)
  });
  writeJsonOrRender(summary, json, renderDoctor);
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  doctorCommand,
  doctorSummary,
  renderDoctor
};
