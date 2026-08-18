const { durationToMs, optionValue, parseLastArg } = require('./cli-options');

function parseSmokeArgs(args) {
  const parsed = {
    dryRun: args.includes('--dry-run'),
    endpoint: optionValue(args, ['--endpoint']),
    id: optionValue(args, ['--id']),
    last: parseLastArg(args, '2h'),
    realCopilot: args.includes('--real-copilot') || args.includes('--copilot'),
    openBrowser: args.includes('--open-browser'),
    copilotTimeoutMs: durationToMs(optionValue(args, ['--timeout']), 120000),
    verify: !args.includes('--local') && !args.includes('--no-verify'),
    // Azure Monitor native OTLP is eventually consistent. Give the default
    // verification window enough time for the first row to reach Log Analytics;
    // local receipt checks remain quick and explicit --no-verify by default.
    waitMs: durationToMs(optionValue(args, ['--wait']), args.includes('--local') || args.includes('--no-verify') ? 60000 : 300000),
    pollMs: durationToMs(optionValue(args, ['--poll']), 10000),
    json: args.includes('--json')
  };
  if (args.includes('--local')) parsed.local = true;
  return parsed;
}

function realCopilotSmokeArgs() {
  return [
    '--no-ask-user',
    '--no-remote',
    '--no-remote-export',
    '--add-dir',
    '.',
    "--allow-tool=shell(pwd)",
    "--allow-tool=shell(ls:*)",
    '-p',
    'Do not edit files. Run pwd and ls docs | head, then summarize.'
  ];
}

function commandShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function realCopilotSmokeCommand() {
  return `copilot ${realCopilotSmokeArgs().map(commandShellQuote).join(' ')}`;
}

module.exports = {
  commandShellQuote,
  durationToMs,
  optionValue,
  parseLastArg,
  parseSmokeArgs,
  realCopilotSmokeArgs,
  realCopilotSmokeCommand
};
