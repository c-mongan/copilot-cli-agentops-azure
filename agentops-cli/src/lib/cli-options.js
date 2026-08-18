const { optionValues, requiredOptionValue: optionValue } = require('./args');

function parseLastArg(args, fallback = '7d') {
  if (!args.includes('--last')) return fallback;
  try {
    return optionValue(args, ['--last']);
  } catch (error) {
    throw new Error('--last requires a duration, for example 7d or 24h');
  }
}

function durationToMs(value, fallbackMs) {
  if (value === undefined || value === null || value === '') return fallbackMs;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^([0-9]+)(ms|s|m|h)$/);
  if (!match) throw new Error('duration must look like 500ms, 10s, 2m, or 1h');
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  return amount * 60 * 60 * 1000;
}

function parseSkillsArgs(args) {
  const subcommand = args[0] || 'install';
  const rest = args.slice(1);
  return {
    subcommand,
    copilotHome: optionValue(rest, ['--copilot-home', '--home']),
    force: rest.includes('--force'),
    dryRun: rest.includes('--dry-run'),
    json: rest.includes('--json')
  };
}

module.exports = {
  durationToMs,
  optionValue,
  optionValues,
  parseLastArg,
  parseSkillsArgs
};
