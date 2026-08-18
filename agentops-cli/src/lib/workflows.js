function agentopsWorkflows() {
  const cli = 'node agentops-cli/src/index.js';
  return [
    {
      name: 'setup',
      skill: 'agentops-setup',
      description: 'Install the local Collector binary, local shim, and safe defaults.',
      prompt: 'Use agentops-setup to check my AgentOps install and tell me the next command to run.',
      commands: [
        `${cli} setup`,
        `${cli} init --full`,
        `${cli} validate-enterprise`,
        'az login',
        'azd provision',
        `${cli} install`,
        './setup-agentops.sh',
        './setup-agentops.ps1',
        `${cli} configure show`,
        `${cli} configure import-azd`,
        `${cli} init --dry-run`,
        `${cli} validate-azure`,
        `${cli} collector smoke --privacy strict --poison`,
        `${cli} smoke --real-copilot --wait 2m --poll 10s --open-browser`,
        `${cli} plugin install`,
        `${cli} status`,
        `${cli} doctor --local-only`
      ]
    },
    {
      name: 'orchestrate',
      skill: 'agentops-orchestrator',
      description: 'Route setup, triage, attribution, dashboard, benchmark, and operations questions to the right AgentOps skill.',
      prompt: 'Use agentops-orchestrator to figure out which AgentOps workflow I need and run the first read-only check.',
      commands: [
        `${cli} workflows list`,
        `${cli} workflows show setup`,
        `${cli} workflows show latest-run`,
        `${cli} workflows show attribution`,
        `${cli} workflows show dashboard`,
        `${cli} workflows show science-mode`,
        `${cli} workflows show operations`
      ]
    },
    {
      name: 'latest-run',
      skill: 'agentops-latest-run',
      description: 'Find, open, and inspect the latest observed Copilot CLI run.',
      prompt: 'Use agentops-latest-run to find my latest AgentOps run, open the Run Story link, explain it, and recommend one next action.',
      commands: [
        'copilot -p "Reply with exactly: agentops smoke."',
        `${cli} ask-context latest --last 2h`,
        `${cli} open latest --last 2h`,
        `${cli} latest --last 7d`,
        `${cli} explain latest --last 7d`,
        `${cli} recommend latest --last 7d`,
        `${cli} live --last 2h`,
        `${cli} replay latest --last 7d`
      ]
    },
    {
      name: 'attribution',
      skill: 'agentops-attribution',
      description: 'Filter telemetry by custom agent, skill, MCP server/tool, script, or hook.',
      prompt: 'Use agentops-attribution to show usage, failures, cost, and tools for my custom agents, skills, MCP servers, and hooks.',
      commands: [
        `${cli} attribution --last 7d`,
        `${cli} primitives --last 7d`,
        `${cli} mcp --last 7d`,
        `${cli} lineage --last 24h`,
        `${cli} link session <conversation-id>`
      ]
    },
    {
      name: 'dashboard',
      skill: 'agentops-dashboard-ops',
      description: 'Open, rebuild, import, and deep-link Grafana dashboards.',
      prompt: 'Use agentops-dashboard-ops to open the AgentOps dashboard and create a link for this session.',
      commands: [
        `${cli} open`,
        `${cli} link session <conversation>`,
        `${cli} link trace <operationId>`,
        'node scripts/build-grafana-dashboard-pack.js',
        'AZURE_RESOURCE_GROUP=rg-agentops-dev GRAFANA_NAME=graf-agentops-dev ./scripts/grafana-import-dashboard.sh'
      ]
    },
    {
      name: 'science-mode',
      skill: 'agentops-benchmark-gate',
      description: 'Run repeatable benchmark checks before keeping agent changes.',
      prompt: 'Use agentops-benchmark-gate to compare my baseline and candidate benchmark runs.',
      commands: [
        `${cli} benchmark list`,
        `${cli} benchmark fixture-pack benchmarks/starter/fixtures/tiny-repo --id tiny-repo-sealed --fixture fixtures/tiny-repo --output benchmarks/starter/fixture-packs/tiny-repo.json`,
        `${cli} benchmark fixture-pack benchmarks/starter/fixtures/tiny-repo --id tiny-repo-sealed --fixture fixtures/tiny-repo --sign-key-id eval-fixtures-v1 --sign-private-key keys/eval-fixtures-v1.pem --output benchmarks/starter/fixture-packs/tiny-repo.json`,
        `${cli} benchmark judge-provider`,
        `${cli} benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy --dry-run`,
        `${cli} benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy`,
        `${cli} benchmark approve <run-id> --by alice@example.com --ticket CHG-123 --output approvals/<run-id>.json`,
        `${cli} benchmark artifacts <run-id> --task create-note --include-content`,
        `${cli} benchmark report <run-id>`,
        `${cli} benchmark compare <baseline-run-id> <variant-run-id> --azure --last 24h`
      ]
    },
    {
      name: 'judge-provider',
      skill: 'agentops-benchmark-gate',
      description: 'Wire a hosted LLM judge CLI into benchmark semantic checks without storing prompts or secrets.',
      prompt: 'Use agentops-benchmark-gate to configure a hosted llm-judge provider for my benchmark suite.',
      commands: [
        `${cli} benchmark judge-provider`,
        `${cli} benchmark judge-provider --json`,
        'AGENTOPS_JUDGE_ENDPOINT=https://judge.example.com AGENTOPS_JUDGE_TOKEN=... benchmark-judges/hosted-judge.sh notes/hello.txt note-quality'
      ]
    },
    {
      name: 'offline-test',
      skill: 'agentops-live-triage',
      description: 'Use local JSONL fixtures when Azure telemetry is not available.',
      prompt: 'Use agentops-live-triage with the sample JSONL fixture to explain a local tool failure.',
      commands: [
        `${cli} latest --file fixtures/sample-otel/tool-failure.ndjson.fixture`,
        `${cli} explain latest --file fixtures/sample-otel/tool-failure.ndjson.fixture`,
        `${cli} recommend latest --file fixtures/sample-otel/tool-failure.ndjson.fixture`,
        `${cli} live --file fixtures/sample-otel/tool-failure.ndjson.fixture`,
        `${cli} replay latest --file fixtures/sample-otel/tool-failure.ndjson.fixture`
      ]
    },
    {
      name: 'analyst-mode',
      skill: 'agentops-evidence-prompts',
      description: 'Generate read-only KQL, links, saved views, and investigation prompts.',
      prompt: 'Use agentops-evidence-prompts to investigate the last 24 hours and propose one safe improvement.',
      commands: [
        `${cli} fields --last 7d`,
        `${cli} context --last 7d`,
        `${cli} token-rollup-audit --last 14d`,
        `${cli} collector-health --last 24h`,
        `${cli} policy --last 7d`,
        `${cli} mcp --last 7d`,
        `${cli} lineage --last 24h`,
        `${cli} permission-friction --last 7d`,
        `${cli} alert recommend --last 14d`,
        `${cli} ask-context latest --last 24h`,
        `${cli} saved-view add latest-risk --session <conversation-id> --tag risk`,
        `${cli} saved-view list`
      ]
    },
    {
      name: 'primitive-inventory',
      skill: 'agentops-primitive-inventory',
      description: 'Show which agents, skills, hooks, MCP tools, and other primitives are configured or observed.',
      prompt: 'Use agentops-primitive-inventory to inventory this repo and explain any missing runtime signals.',
      commands: [
        `${cli} primitives --last 7d`,
        `${cli} primitives --root /path/to/awesome-copilot --last 7d`
      ]
    },
    {
      name: 'operations',
      skill: 'agentops-operations',
      description: 'Check health, stop collector, disable shadowing, or uninstall safely.',
      prompt: 'Use agentops-operations to check health and choose the safest cleanup command.',
      commands: [
        `${cli} status`,
        `${cli} validate-collector`,
        `${cli} collector-health --last 24h`,
        `${cli} disable-shadow`,
        `${cli} collector stop`,
        `${cli} plugin uninstall`,
        `${cli} uninstall`
      ]
    }
  ];
}

function parseWorkflowsArgs(args) {
  return {
    subcommand: args[0] || 'list',
    name: args[1],
    json: args.includes('--json')
  };
}

function renderWorkflow(workflow) {
  const lines = [
    `${workflow.name}: ${workflow.description}`,
    `Skill: ${workflow.skill}`,
    `Ask Copilot: ${workflow.prompt}`,
    '',
    'Commands:'
  ];
  for (const command of workflow.commands) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function renderWorkflowsList(workflows = agentopsWorkflows()) {
  const lines = ['AgentOps workflows', ''];
  for (const workflow of workflows) {
    lines.push(`- ${workflow.name}: ${workflow.description}`);
    lines.push(`  Skill: ${workflow.skill}`);
    lines.push(`  Ask: ${workflow.prompt}`);
  }
  lines.push('', 'Run `agentops workflows show <name>` to print the commands for one workflow.');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  agentopsWorkflows,
  parseWorkflowsArgs,
  renderWorkflow,
  renderWorkflowsList
};
