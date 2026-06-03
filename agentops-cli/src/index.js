#!/usr/bin/env node

const legacy = require('./legacy');
const { collectorCommand } = require('./commands/collector');
const { azureIngestCommand } = require('./commands/azure-ingest');
const { askContextCommand } = require('./commands/ask-context');
const { contentCommand } = require('./commands/content');
const { copilotCommand } = require('./commands/copilot');
const { copilotSessionCommand } = require('./commands/copilot-session');
const { dashboardCommand } = require('./commands/dashboard');
const { demoCommand } = require('./commands/demo');
const { doctorCommand } = require('./commands/doctor');
const { e2eCommand } = require('./commands/e2e');
const { explainCommand } = require('./commands/explain');
const { githubEnrichCommand } = require('./commands/github-enrich');
const { healthCommand } = require('./commands/health');
const { insightsCommand } = require('./commands/insights');
const { mcpProxyCommand } = require('./commands/mcp-proxy');
const { openCommand } = require('./commands/open');
const { productCommand } = require('./commands/product');
const { recommendCommand } = require('./commands/recommend');
const { runSummaryCommand } = require('./commands/run-summary');
const { schemaCommand } = require('./commands/schema');
const { securityCommand } = require('./commands/security');
const { statusCommand } = require('./commands/status');
const { triageCommand } = require('./commands/triage');

const coreCommands = [
  'setup',
  'install',
  'uninstall',
  'status',
  'doctor',
  'configure',
  'collector',
  'azure-ingest',
  'ask-context',
  'content',
  'copilot',
  'copilot-session',
  'dashboard',
  'demo',
  'explain',
  'github-enrich',
  'health',
  'insights',
  'init',
  'latest',
  'mcp-proxy',
  'recommend',
  'replay',
  'open',
  'product',
  'validate-azure',
  'validate-enterprise',
  'plugin',
  'run-summary',
  'schema',
  'security',
  'smoke',
  'triage',
  'e2e'
];

const experimentalCommands = new Set([
  'agents',
  'alert',
  'attribution',
  'attribution-smoke',
  'benchmark',
  'codex',
  'collector-health',
  'compat-check',
  'context',
  'custom',
  'enable-shadow',
  'fields',
  'import-jsonl',
  'lineage',
  'link',
  'live',
  'live-replay-smoke',
  'mcp',
  'otel-setup',
  'permission-friction',
  'policy',
  'primitives',
  'saved-view',
  'scan',
  'skills',
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
  azure-ingest plan [--dir <AgentOps table dir>] [--allow-content] [--json]
  ask-context latest|<run-id> [--runs <jsonl>] [--events <jsonl>] [--tools <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--json]
  content status|opt-in [--dir <AgentOps table dir>] [--runs <jsonl>] [--allow-content] [--json]
  copilot [copilot-args...]
  copilot-session enrich <session-id> [--file <events.jsonl>] [--dry-run] [--json]
  schema validate|print [--file <json>]
  security audit|posture [--json] [--fail-on-warning]
  dashboard validate|links-check|filters-check|ux-check|content-check|kql-check|verify|import [--last <duration>] [--live] [--yes] [--all] [--folder <name>] [--resource-group <rg>] [--grafana-name <name>]
  demo generate|verify [--runs <n>] [--out <dir>] [--with-content] [--json]
  github-enrich [--limit <n>] [--runs <AgentOpsRunSummary_CL.jsonl>] [--out <dir>] [--json]
  health [--runs <AgentOpsRunSummary_CL.jsonl>] [--json]
  explain latest|<run-id> [--runs <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--json]
  insights [generate|patterns] [--runs <jsonl>] [--insights <jsonl>] [--tools <jsonl>] [--privacy <jsonl>] [--github <jsonl>] [--out <dir>] [--json]
  init [--dry-run] [--provision-cloud] [--force-skills] [--no-skills] [--json]
  recommend latest|<run-id> [--runs <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--benchmark-run <id>] [--benchmark-report <json>] [--out <dir>] [--json]
  triage latest|<run-id> [--runs <jsonl>] [--events <jsonl>] [--tools <jsonl>] [--privacy <jsonl>] [--github <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--benchmark-run <id>] [--out <dir>] [--json]
  mcp-proxy --server-name <name> [--out <jsonl>] -- <server command> [args...]
  latest [--file <jsonl>] [--last <duration>] [--json]
  replay <session|latest> [--file <jsonl>] [--last <duration>]
  open [latest|<run-id>] [--runs <jsonl>] [--file <jsonl>] [--last <duration>] [--json]
  product audit [--live] [--last <duration>] [--require-rows] [--require-visual] [--report <html>] [--json]
  validate-azure [--last <duration>] [--import-dashboards] [--production] [--remediation-plan] [--json]
  validate-enterprise [--json]
  plugin install|uninstall [--copilot-home <path>] [--force] [--dry-run] [--json]
  run-summary generate --file <jsonl> [--out <dir>] [--json]
  smoke [--real-copilot] [--dry-run] [--wait <duration>] [--poll <duration>] [--json]
  e2e run|report|browser-check|auth-profile [--json]

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
  if (command === 'copilot-session') return copilotSessionCommand(args);
  if (command === 'azure-ingest') return azureIngestCommand(args);
  if (command === 'ask-context') return askContextCommand(args);
  if (command === 'content') return contentCommand(args);
  if (command === 'schema') return schemaCommand(args);
  if (command === 'security') return securityCommand(args);
  if (command === 'dashboard') return dashboardCommand(args);
  if (command === 'demo') return demoCommand(args);
  if (command === 'e2e') return e2eCommand(args);
  if (command === 'explain') return explainCommand(args);
  if (command === 'github-enrich') return githubEnrichCommand(args);
  if (command === 'health') return healthCommand(args);
  if (command === 'insights') return insightsCommand(args);
  if (command === 'mcp-proxy') return mcpProxyCommand(args);
  if (command === 'recommend') {
    if (args.includes('--runs')) return recommendCommand(args);
    return legacy.main([command, ...args]);
  }
  if (command === 'run-summary') return runSummaryCommand(args);
  if (command === 'triage') return triageCommand(args);
  if (command === 'latest' && args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(legacy.latestSummaryFromArgs(args), null, 2)}\n`);
    return;
  }
  if (command === 'open') return openCommand(args);
  if (command === 'product') return productCommand(args);
  if (command === 'smoke') return legacy.main([command, ...args]);

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
  azureIngestCommand,
  askContextCommand,
  contentCommand,
  copilotCommand,
  copilotSessionCommand,
  dashboardCommand,
  demoCommand,
  doctorCommand,
  e2eCommand,
  explainCommand,
  githubEnrichCommand,
  healthCommand,
  insightsCommand,
  mcpProxyCommand,
  openCommand,
  productCommand,
  recommendCommand,
  runSummaryCommand,
  schemaCommand,
  securityCommand,
  statusCommand,
  usage
};
