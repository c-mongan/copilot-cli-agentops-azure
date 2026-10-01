const coreCommands = [
  'attach',
  'coverage',
  'detach',
  'architecture',
  'setup',
  'install',
  'uninstall',
  'status',
  'doctor',
  'configure',
  'collector',
  'azure-ingest',
  'provision',
  'annotation',
  'annotate',
  'ask-context',
  'content',
  'copilot',
  'copilot-session',
  'dashboard',
  'demo',
  'delivery',
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
  'co-activation',
  'codex',
  'collector-health',
  'compat-check',
  'context',
  'custom',
  'enable-shadow',
  'fields',
  'import-jsonl',
  'incident',
  'lineage',
  'link',
  'live',
  'live-replay-smoke',
  'mcp',
  'model-tokens',
  'otel-setup',
  'permission-friction',
  'policy',
  'primitives',
  'read-order',
  'repeated-tools',
  'saved-view',
  'scan',
  'skills',
  'slow-scripts',
  'tail',
  'token-rollup-audit',
  'validate-collector',
  'workflows'
]);

function usage(command) {
  const full = `agentops <command>

Next:
  agentops init --full                       # advanced compatibility path; zero-write preview
  agentops provision azure --subscription <id> --resource-group <new-agentops-rg> --profile pilot  # synthetic Azure pilot

Local native path:
  agentops setup                             # read-only discovery
  agentops attach --repo .                   # project-local discovery; preview only
  agentops attach --repo . --yes             # record an inventory; installs no hooks or telemetry
  agentops coverage --repo .                 # compare inventory with associated local run evidence
  agentops detach --repo . --yes             # remove unchanged AgentOps-owned files
  eval "$(agentops init --local-only --yes --shell zsh)"
  agentops smoke --local                     # local privacy/receipt check

Then:
  Everyday use: agentops copilot ...         # observed; plain copilot stays unchanged by default
  See results:  agentops open latest
  Troubleshoot: agentops status

Help:
  agentops help <command>                    # focused syntax for one command

Core commands:
  attach --repo <git-repo> [--yes] [--json]
  coverage --repo <git-repo> [--json]
  detach --repo <git-repo> [--yes] [--json]
  setup [--json]
  install [--shadow-copilot] [--no-collector] [--plugin]
  uninstall [--keep-plugin] [--keep-collector] [--keep-binary] [--purge]
  status [--json]
  doctor [--local-only] [--last <duration>] [--json]
  configure show|set|import-azd [--project|--user] [--python-runtime <label>] [--node-runtime <label>] [--typescript-loader <label|unknown>] [--json]
  collector start|stop|status|validate|smoke|install-binary|uninstall-binary [--mode auto|local|docker|binary|azure-native|none] [--privacy strict|compat] [--json]
  azure-ingest plan [--dir <AgentOps table dir>] [--allow-content] [--json]
  azure-ingest upload-plan --dir <export dir> --account <storage> [--container <name>] [--prefix <path>] [--json]
  annotation config-change --component <name> --target <name> [--change-type <type>] [--change-id <id>] [--version <value>] [--run-id <id>] [--session <id>] [--trace-id <id>] [--dry-run] [--json]
  ask-context latest|<run-id> [--last <duration>] [--runs <jsonl>] [--events <jsonl>] [--tools <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--recommendations <jsonl>] [--json]
  content status|opt-in [--dir <AgentOps table dir>] [--runs <jsonl>] [--allow-content] [--json]
  copilot [copilot-args...]
  copilot-session enrich <session-id> [--file <events.jsonl>] [--sidecar <sidecar-events.jsonl>] [--dry-run] [--json]
  copilot-session launch [--repo <git-repo>] [--copilot-home <path>] [--upload --yes] [--json] -- [copilot-args...]\n  Azure upload needs a complete project target or explicit subscription, endpoint, and DCR environment values.
  copilot-session view <session-id> --output <local.html> [--allow-content] [--file <events.jsonl>] [--otel-file <native-receipt.jsonl>] [--run-id <id>] [--json]\n  Default is metadata-only (raw prompts/tool arguments/results redacted). --allow-content renders full captured content and persists it in the local HTML file.
  copilot-session export-spans <session-id> --run-id <id> --output <dir>/AgentOpsSpans_CL.jsonl [--file <events.jsonl>] [--otel-file <receipt.jsonl>] [--json]
  copilot-session export-events <session-id> --run-id <id> --output <dir>/AgentOpsEvents_CL.jsonl [--file <events.jsonl>] [--json]
  copilot-session collect <session-id> --run-id <id> [--repo <git-repo>] [--copilot-home <path>] [--otel-file <receipt.jsonl>] [--upload --yes] [--json]
  copilot-session export-content <session-id> --output <dir>/AgentOpsContent_CL.jsonl --allow-content --synthetic [--file <events.jsonl>] [--run-id <id>] [--json]
  copilot-session delete-content <session-id> --file <dir>/AgentOpsContent_CL.jsonl [--run-id <id>] [--confirm] [--json]\n  Local-only retention: previews by default; --confirm deletes only the exact selected session/run file. Makes no claim about Azure-side deletion.
  schema validate|print [--file <json>]
  security audit|posture [--json] [--fail-on-warning]
  dashboard validate|links-check|filters-check|ux-check|content-check|kql-check|verify|import [--last <duration>] [--live] [--yes] [--all] [--folder <name>] [--resource-group <rg>] [--grafana-name <name>]
  demo generate|verify [--runs <n>] [--out <dir>] [--insights-out <dir>] [--write] [--with-content] [--json]
  delivery status|review|requeue|prune|drain [--event-id <id>] [--run-id <id>] [--older-than <30-365-days>] [--dir <spool>] [--endpoint <logs-ingestion-endpoint>] [--dcr-immutable-id <id>] [--max-attempts <1-10>] [--yes] [--json]
  github-enrich [--limit <n>] [--runs <AgentOpsRunSummary_CL.jsonl>] [--out <dir>] [--json]
  health [--runs <AgentOpsRunSummary_CL.jsonl>] [--json]
  explain latest|<run-id> [--runs <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--json]
  insights [generate|patterns] [--runs <jsonl>] [--insights <jsonl>] [--tools <jsonl>] [--privacy <jsonl>] [--github <jsonl>] [--out <dir>] [--json]
  init --local-only [--yes] [--shell bash|zsh|fish|powershell|json] [--force-skills] [--no-skills] [--json]
  init [--dry-run] --full [--yes] [--provision-cloud] [--import-dashboards] [--run-smoke] [--triage-latest] [--force-skills] [--no-skills] [--json]
  provision azure --subscription <id> --resource-group <name> [--profile pilot] [--environment <suffix>] [--location <region>] [--yes] [--json]
  recommend latest|<run-id> [--runs <jsonl>] [--events <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--benchmark-run <id>] [--benchmark-report <json>] [--out <dir>] [--save] [--store <json>] [--json]
  recommend list|export [--store <json>] [--out <dir>]
  triage latest|<run-id> [--runs <jsonl>] [--events <jsonl>] [--tools <jsonl>] [--privacy <jsonl>] [--github <jsonl>] [--evals <jsonl>] [--insights <jsonl>] [--benchmark-run <id>] [--out <dir>] [--json]
  alert handoff --rule <name> --session <conversation> [--owner <name>] [--events <jsonl>] [--output <json>] [--last <duration>]
  mcp-proxy --server-name <name> [--out <jsonl>] -- <server command> [args...]
  latest [--file <jsonl>] [--last <duration>] [--json]
  replay <session|latest> [--file <jsonl>] [--last <duration>]
  open [latest|<run-id>] [--runs <jsonl>] [--file <jsonl>] [--last <duration>] [--json]
  product audit [--live] [--last <duration>] [--require-rows] [--require-visual] [--report <html>] [--json]
  validate-azure [--last <duration>] [--profile personal|team|internal] [--import-dashboards] [--verify-dashboard-content] [--production] [--remediation-plan] [--json]
  validate-enterprise [--json]
  plugin install|uninstall [--copilot-home <path>] [--force] [--dry-run] [--json]
  run-summary generate --file <jsonl> [--out <dir>] [--json]
  smoke [--real-copilot] [--local] [--dry-run] [--wait <duration>] [--poll <duration>] [--json]
  e2e run|report|browser-check|auth-profile [--azure-cli-grafana-auth] [--json]

Experimental:
  agentops experimental <old-command> [...]
`;

  if (!command) return full;

  const name = String(command).trim();
  const coreSection = full.split('\nExperimental:')[0];
  const commandLine = coreSection
    .split('\n')
    .map(line => line.trim())
    .find(line => line === name || line.startsWith(`${name} `) || line.startsWith(`${name}[`));

  if (commandLine) {
    return `agentops ${commandLine}\n\nRun "agentops --help" for the complete command list.\n`;
  }
  if (experimentalCommands.has(name)) {
    return `agentops experimental ${name} [...]\n\nThis command is experimental. Run "agentops --help" for the core command list.\n`;
  }
  return `No help found for "${name}".\nRun "agentops --help" for the complete command list.\n`;
}

module.exports = {
  coreCommands,
  experimentalCommands,
  usage
};
