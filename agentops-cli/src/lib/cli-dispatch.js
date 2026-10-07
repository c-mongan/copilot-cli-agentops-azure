const { writeJson } = require('./command-output');

function editDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function commandSuggestion(command, candidates) {
  const ranked = Array.from(new Set(candidates)).map(candidate => ({ candidate, distance: editDistance(command, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  return ranked[0] && ranked[0].distance <= Math.max(2, Math.floor(String(command).length / 3)) ? ranked[0].candidate : null;
}

// Direct commands that render their own --help text (or, for copilot, pass it
// through to the wrapped Copilot CLI).
const SELF_HELP_COMMANDS = new Set([
  'architecture', 'attach', 'copilot', 'coverage', 'dashboard', 'detach', 'digest', 'product', 'provision', 'ui'
]);

function wantsHelp(args) {
  const separator = args.indexOf('--');
  const optionArgs = separator >= 0 ? args.slice(0, separator) : args;
  return optionArgs.includes('--help') || optionArgs.includes('-h');
}

function directHelpTopic(command, args) {
  if (SELF_HELP_COMMANDS.has(command)) return null;
  if (command === 'copilot-session') {
    const [subcommand] = args;
    if (subcommand === 'launch') return null;
    return subcommand && !subcommand.startsWith('-') ? `copilot-session ${subcommand}` : command;
  }
  return command;
}

function createCliMain(dependencies = {}) {
  const {
    commands = {},
    coreCommands = [],
    experimentalCommands = new Set(),
    legacy,
    stderr = process.stderr,
    stdout = process.stdout,
    usage,
    version
  } = dependencies;

  const directCommands = {
    attach: commands.attachCommand,
    coverage: commands.coverageCommand,
    architecture: commands.architectureCommand,
    'ask-context': commands.askContextCommand,
    'azure-ingest': commands.azureIngestCommand,
    provision: commands.azureProvisionCommand,
    content: commands.contentCommand,
    copilot: commands.copilotCommand,
    'copilot-session': commands.copilotSessionCommand,
    dashboard: commands.dashboardCommand,
    demo: commands.demoCommand,
    detach: commands.detachCommand,
    delivery: commands.deliveryCommand,
    digest: commands.digestCommand,
    doctor: commands.doctorCommand,
    e2e: commands.e2eCommand,
    explain: commands.explainCommand,
    'github-enrich': commands.githubEnrichCommand,
    health: commands.healthCommand,
    insights: commands.insightsCommand,
    'mcp-proxy': commands.mcpProxyCommand,
    open: commands.openCommand,
    product: commands.productCommand,
    'run-summary': commands.runSummaryCommand,
    schema: commands.schemaCommand,
    security: commands.securityCommand,
    status: commands.statusCommand,
    triage: commands.triageCommand,
    ui: commands.uiCommand
  };

  function legacyWithMigration(command, args) {
    stderr.write(`agentops ${command} is experimental now; use agentops experimental ${command} ${args.join(' ')}\n`);
    return legacy.main([command, ...args]);
  }

  return async function main(argv) {
    const [command, ...args] = argv;

    if (!command || command === '--help' || command === '-h') {
      stdout.write(usage());
      return undefined;
    }

    if (version && (command === '--version' || command === '-v')) {
      stdout.write(`${version}\n`);
      return undefined;
    }

    if (command === 'help') {
      stdout.write(usage(args[0]));
      return undefined;
    }

    if (command === 'experimental') {
      const [experimentalCommand, ...experimentalArgs] = args;
      if (!experimentalCommand) throw new Error('experimental requires a command');
      return legacy.main([experimentalCommand, ...experimentalArgs]);
    }

    const specialHelpTopic = { collector: 'collector', recommend: 'recommend', start: 'collector', stop: 'collector' }[command];
    if (specialHelpTopic && wantsHelp(args)) {
      stdout.write(usage(specialHelpTopic));
      return undefined;
    }

    if (command === 'collector' || command === 'start' || command === 'stop') {
      const collectorArgs = command === 'start' || command === 'stop' ? [command, ...args] : args;
      return commands.collectorCommand(collectorArgs);
    }

    if (command === 'recommend') {
      if (args.includes('--runs') || args[0] === 'list' || args[0] === 'export') return commands.recommendCommand(args);
      return legacy.main([command, ...args]);
    }

    if (command === 'latest' && args.includes('--json')) {
      writeJson(legacy.latestSummaryFromArgs(args), stdout);
      return undefined;
    }

    const directCommand = directCommands[command];
    if (directCommand) {
      const helpTopic = wantsHelp(args) ? directHelpTopic(command, args) : null;
      if (helpTopic) {
        const topicHelp = usage(helpTopic);
        stdout.write(helpTopic !== command && topicHelp.startsWith('No help found') ? usage(command) : topicHelp);
        return undefined;
      }
      return directCommand(args);
    }

    if (experimentalCommands.has(command)) return legacyWithMigration(command, args);

    if (coreCommands.includes(command)) {
      if (args.includes('--help') || args.includes('-h')) {
        stdout.write(usage(command));
        return undefined;
      }
      return legacy.main([command, ...args]);
    }

    const suggestion = commandSuggestion(command, [
      ...Object.keys(directCommands),
      ...coreCommands,
      ...experimentalCommands,
      'collector',
      'experimental',
      'start',
      'stop'
    ]);
    const hint = suggestion ? ` Did you mean "agentops ${suggestion}"?` : '';
    throw new Error(`Unknown command: ${command}.${hint} Run "agentops --help" to see the core commands.`);
  };
}

module.exports = {
  SELF_HELP_COMMANDS,
  commandSuggestion,
  createCliMain
};
