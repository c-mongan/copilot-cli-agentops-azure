#!/usr/bin/env node

const legacy = require('./legacy');
const { collectorCommand } = require('./commands/collector');
const { copilotCommand } = require('./commands/copilot');
const { doctorCommand } = require('./commands/doctor');
const { e2eCommand } = require('./commands/e2e');
const { statusCommand } = require('./commands/status');

const coreCommands = [
  'setup',
  'install',
  'uninstall',
  'status',
  'doctor',
  'configure',
  'collector',
  'copilot',
  'latest',
  'replay',
  'open',
  'validate-azure',
  'validate-enterprise',
  'plugin',
  'e2e'
];

const experimentalCommands = new Set([
  'agents',
  'alert',
  'ask-context',
  'attribution',
  'attribution-smoke',
  'benchmark',
  'codex',
  'collector-health',
  'compat-check',
  'context',
  'custom',
  'enable-shadow',
  'explain',
  'fields',
  'import-jsonl',
  'init',
  'lineage',
  'link',
  'live',
  'live-replay-smoke',
  'mcp',
  'otel-setup',
  'permission-friction',
  'policy',
  'primitives',
  'recommend',
  'saved-view',
  'scan',
  'skills',
  'smoke',
  'tail',
  'token-rollup-audit',
  'validate-collector',
  'workflows'
]);

function usage() {
  return `agentops <command>

Core commands:
  setup [--json]
  install [--no-shadow-copilot] [--no-collector] [--plugin]
  uninstall [--keep-plugin] [--keep-collector] [--keep-binary] [--purge]
  status [--json]
  doctor [--json]
  configure show|set|import-azd [--json]
  collector start|stop|status|validate|smoke|install-binary|uninstall-binary [--mode auto|docker|binary|none] [--privacy strict|compat] [--json]
  copilot [copilot-args...]
  latest [--file <jsonl>] [--last <duration>] [--json]
  replay <session|latest> [--file <jsonl>] [--last <duration>]
  open [--file <jsonl>] [--last <duration>] [--json]
  validate-azure [--last <duration>] [--json]
  validate-enterprise [--json]
  plugin install|uninstall [--copilot-home <path>] [--force] [--dry-run] [--json]
  e2e run|report|browser-check [--json]

Experimental:
  agentops experimental <old-command> [...]
`;
}

function legacyWithMigration(command, args) {
  process.stderr.write(`agentops ${command} is experimental now; use agentops experimental ${command} ${args.join(' ')}\n`);
  return legacy.main([command, ...args]);
}

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  if (command === 'experimental') {
    const [experimentalCommand, ...experimentalArgs] = args;
    if (!experimentalCommand) throw new Error('experimental requires a command');
    return legacy.main([experimentalCommand, ...experimentalArgs]);
  }

  if (command === 'status') return statusCommand(args);
  if (command === 'doctor') return doctorCommand(args);
  if (command === 'collector' || command === 'start' || command === 'stop') {
    const collectorArgs = command === 'start' || command === 'stop' ? [command, ...args] : args;
    return collectorCommand(collectorArgs);
  }
  if (command === 'copilot') return copilotCommand(args);
  if (command === 'e2e') return e2eCommand(args);
  if (command === 'latest' && args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(legacy.latestSummaryFromArgs(args), null, 2)}\n`);
    return;
  }
  if (command === 'open' && args.includes('--json')) {
    const summary = legacy.latestSummaryFromArgs(args);
    process.stdout.write(`${JSON.stringify(legacy.openLinksSummary(summary), null, 2)}\n`);
    return;
  }

  if (experimentalCommands.has(command)) return legacyWithMigration(command, args);

  if (coreCommands.includes(command)) return legacy.main([command, ...args]);

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  ...legacy,
  main,
  coreCommands,
  experimentalCommands,
  collectorCommand,
  copilotCommand,
  doctorCommand,
  e2eCommand,
  statusCommand,
  usage
};
