# Copilot CLI AgentOps for Azure

> Independent personal open-source project. Not an official Microsoft, GitHub, OpenAI, Azure, or Grafana product, and not endorsed by those organizations. See [DISCLAIMER.md](DISCLAIMER.md) and [SECURITY.md](SECURITY.md) before using with real telemetry.

## 1. What this does in 5 lines

AgentOps shows what happened during a GitHub Copilot CLI run.
It sends privacy-safe run metadata to Azure Monitor and Managed Grafana.
It helps you spot expensive runs, tool failures, context pressure, and policy blocks.
It keeps prompts, code, tool arguments, and file contents out of telemetry by default.
It gives analysts deeper Azure and dashboard workflows when they need them.

## 2. Who it is for

Use this if you run GitHub Copilot CLI and want a simple answer to:

- Did my latest run work?
- Which tool failed?
- Did Copilot run out of useful context?
- Did a safety policy stop something risky?
- Did a change make Copilot better or worse?

You do not need to know OpenTelemetry, KQL, MCP, or Grafana to start. Those are just the plumbing underneath the simple install path described below.

## 3. Use Copilot OTel without installing the wrapper

You can use the observability stack without installing the `agentops` command or the `copilot-agentops` shim. AgentOps is an OTLP receiver plus Azure/Grafana/KQL content on top. If your Copilot surface emits OpenTelemetry to the local collector, the stack can observe it.

This is the most native path for VS Code Copilot Chat:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

For Copilot CLI terminal sessions, set:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT='http://127.0.0.1:4318'
export OTEL_EXPORTER_OTLP_PROTOCOL='http/protobuf'
export COPILOT_OTEL_ENABLED='true'
export COPILOT_OTEL_EXPORTER_TYPE='otlp-http'
export OTEL_SERVICE_NAME='github-copilot'
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT='false'
```

For a Copilot SDK app:

```ts
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: "http://127.0.0.1:4318",
    exporterType: "otlp-http",
    sourceName: "github.copilot",
    captureContent: false
  }
});
```

The optional helper command prints all three snippets with your endpoint:

```bash
node agentops-cli/src/index.js otel-setup
agentops otel-setup
agentops otel-setup --shell powershell
agentops otel-setup --endpoint "http://localhost:4318" --service-name copilot-chat
```

It also prints the equivalent JSONL file-export settings for offline review, which is useful when a user wants to share telemetry without running a collector.

Then start the collector and check whether the incoming telemetry has the fields AgentOps dashboards and evals need:

```bash
./scripts/collector-azuremonitor-up.sh
node agentops-cli/src/index.js compat-check --last 2h
agentops collector start
agentops compat-check --last 2h
```

If you do not want to run the CLI at all, use `kql/22-otel-compatibility.kql` directly in Log Analytics after starting the collector. The wrapper is still useful because it starts the collector, adds safe AgentOps labels, installs skills, and runs smoke validation. It is not required for telemetry ingestion.

Current Copilot OTel coverage:

- VS Code Copilot Chat: traces, metrics, and events are accepted through OTLP HTTP or gRPC. AgentOps recognizes `copilot-chat`, `github-copilot`, and CLI wrapper spans, including foreground agents, background CLI sessions, subagents, tool calls, edit acceptance, user feedback, cloud sessions, and PR-ready metrics.
- Copilot CLI: traces, metrics, and span events are accepted through OTLP HTTP or JSONL file export. AgentOps recognizes `invoke_agent`, `chat`, `execute_tool`, token/cost/AIU fields, hook events, truncation/compaction events, skill events, shutdown/abort events, and tool-call metrics.
- Copilot SDK: OTLP HTTP and file export are supported through the SDK telemetry config. Trace context propagation is preserved when the SDK/CLI emit W3C trace context.
- Privacy: the collector receives all three signal pipelines, but strips prompt messages, responses, system instructions, tool definitions, tool arguments, tool results, URL bodies, and file paths before Azure export.

Docs used for this support matrix:

- [VS Code: Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents)
- [VS Code: GitHub Copilot settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings#_observability-settings)
- [GitHub Docs: Copilot CLI OpenTelemetry monitoring](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring)
- [GitHub Docs: Copilot SDK OpenTelemetry](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry)

## 4. Quickstart

The low-friction path is:

```bash
az login
./install-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
agentops configure set \
  --resource-group rg-copilot-agentops-dev \
  --workspace-id "<workspace-id>" \
  --workspace-name "<workspace-name>" \
  --grafana-url "https://<your-grafana>.grafana.azure.com" \
  --grafana-name "<grafana-resource-name>" \
  --app-insights-name "<app-insights-name>"
agentops start
agentops smoke --wait 5m --poll 15s
agentops copilot -p "Reply with exactly: agentops smoke."
agentops latest --last 2h
agentops open
```

For Codex:

```bash
codex mcp add azure-mcp -- npx -y @azure/mcp@latest server start --read-only --namespace monitor
agentops codex
```

For attribution across custom agents, skills, MCP, and scripts/hooks:

```bash
agentops plugin install
agentops attribution-smoke --wait 5m --poll 15s
agentops attribution --last 2h
agentops mcp --last 2h
agentops lineage --last 2h
```

Stop and remove cleanly:

```bash
agentops stop
agentops plugin uninstall
agentops uninstall
```

`agentops copilot` and `agentops codex` start the local collector first, then run the real local binary. Plain `copilot` is also observed when installed with shadowing and `~/.local/bin` is first on `PATH`.

## 5. Install in the shortest safe path

Install the local shim, then save the Azure workspace and Grafana endpoint once with `agentops configure`. The shim starts the Azure Monitor collector when needed, keeps content capture off, adds safe AgentOps labels, and then calls the real Copilot CLI.

macOS/Linux:

```bash
az login
./setup-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
agentops configure set \
  --resource-group rg-agentops-dev \
  --workspace-id "<workspace-id>" \
  --grafana-url "https://<your-grafana>.grafana.azure.com" \
  --grafana-name "<grafana-resource-name>" \
  --app-insights-name "<app-insights-name>"
agentops status
agentops init --dry-run
agentops validate-azure
agentops smoke --dry-run
agentops smoke --wait 2m --poll 10s
copilot --help
```

The setup script is just the shortest local wrapper. The product-style CLI installer is:

```bash
node agentops-cli/src/index.js install --shadow-copilot
```

After the package is installed or published, that becomes:

```bash
agentops install --shadow-copilot
```

If you deployed with `azd` and the environment contains the expected outputs, use this instead of manually entering values:

```bash
agentops configure import-azd
```

The installer adds `agentops`, `copilot-agentops`, and optional plain-`copilot` shadowing. `agentops init` also installs the bundled AgentOps agents and skills into your default Copilot home, so you can ask Copilot for the common workflows instead of remembering every CLI command:

```text
Use agentops-orchestrator to figure out which AgentOps workflow I need and run the first read-only check.
Use agentops-live-triage to explain my latest Copilot run and recommend one next action.
Use agentops-attribution to show usage and failures by custom agent, skill, MCP server, and hook.
Use agentops-benchmark-gate to compare my baseline and candidate benchmark runs.
Use agentops-primitive-inventory to show which agents, skills, hooks, and MCP tools are configured.
```

If you only want to install or refresh the Copilot plugin files later:

```bash
node agentops-cli/src/index.js plugin install
agentops plugin install
node agentops-cli/src/index.js agents install
agentops agents install
node agentops-cli/src/index.js skills install
agentops skills install
```

To remove only the AgentOps Copilot agents and skills while keeping the CLI/shim installed:

```bash
node agentops-cli/src/index.js plugin uninstall
agentops plugin uninstall
```

Plugin layout note:

- `plugin/agents/` contains the user-invocable and helper `.agent.md` files.
- `plugin/skills/` contains bundled `SKILL.md` workflows.
- `plugin/plugin.json` declares those runtime locations.
- `.github/plugin/marketplace.json` is only marketplace metadata pointing at `./plugin`; it should not duplicate the agents or skills.

If you are unsure which command maps to a README workflow:

```bash
node agentops-cli/src/index.js workflows list
node agentops-cli/src/index.js workflows show orchestrate
node agentops-cli/src/index.js workflows show setup
agentops workflows show setup
```

PowerShell:

```powershell
az login
./setup-agentops.ps1
$env:PATH = "$HOME/.local/bin;$env:PATH"
agentops configure set `
  --resource-group rg-agentops-dev `
  --workspace-id "<workspace-id>" `
  --grafana-url "https://<your-grafana>.grafana.azure.com" `
  --grafana-name "<grafana-resource-name>" `
  --app-insights-name "<app-insights-name>"
agentops status
agentops init --dry-run
agentops validate-azure
agentops smoke --dry-run
agentops smoke --wait 2m --poll 10s
copilot --help
```

Secure defaults to keep:

- Content capture is off by default: prompts, code, tool arguments, and file contents are not recorded.
- The collector listens on `127.0.0.1`, not the public network.
- The repository URL is hashed before export.
- Azure and Grafana MCP examples are read-only.
- Alerts are deployed disabled until thresholds are tuned.
- Agents propose changes; they do not auto-apply them.

To stop routing plain `copilot` through AgentOps while keeping the explicit `copilot-agentops` command:

```bash
node agentops-cli/src/index.js disable-shadow
agentops disable-shadow
```

If the Azure Monitor collector cannot start, plain `copilot` warns and continues without AgentOps telemetry instead of blocking Copilot.

To remove the installed shims:

```bash
node agentops-cli/src/index.js plugin uninstall
agentops plugin uninstall
node agentops-cli/src/index.js uninstall
agentops uninstall
```

To stop the local Azure Monitor collector:

```bash
node agentops-cli/src/index.js collector stop
agentops collector stop
```

## 6. See your latest Copilot run

Run Copilot normally after install:

```bash
copilot -p "Reply with exactly: agentops smoke."
```

The easiest follow-up is to ask Copilot to use the installed skill:

```text
Use agentops-live-triage to explain the latest run.
```

The CLI commands below are still useful for scripts, CI checks, and troubleshooting.

Open the dashboard links from the CLI:

```bash
node agentops-cli/src/index.js open
```

The command prints the overview dashboard and the run-first Sessions dashboard. Choose **Last 2 hours** in Grafana and open the newest row in **Sessions**. That row is your latest observed Copilot run.

Useful things to look for first:

- **Success** tells you whether the run completed cleanly.
- **Failures** point to failed spans or tools.
- **Input tokens** help reveal context pressure.
- **Policy** shows safety or permission friction.
- **Tools** shows what Copilot tried to call.

Ask for the latest live run from Azure Monitor:

```bash
node agentops-cli/src/index.js latest --last 7d
node agentops-cli/src/index.js explain latest --last 7d
node agentops-cli/src/index.js recommend latest --last 7d
```

Watch the current/latest run as a compact privacy-safe stream:

```bash
node agentops-cli/src/index.js live --last 2h
node agentops-cli/src/index.js live --last 2h --follow --interval 10
```

Print a replay-style timeline for the latest or a specific session:

```bash
node agentops-cli/src/index.js replay latest --last 7d
node agentops-cli/src/index.js replay <conversation-id> --last 24h
node agentops-cli/src/index.js lineage --last 24h
```

Generate a copyable investigation bundle for Copilot or another MCP-aware coding agent:

```bash
node agentops-cli/src/index.js ask-context latest --last 2h
node agentops-cli/src/index.js ask-context <conversation-id> --last 24h
```

Inventory Copilot primitives configured in this repo and covered by telemetry:

```bash
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js primitives --root /path/to/awesome-copilot --last 7d
```

You can still use an offline JSONL export or fixture when you are testing locally:

```bash
node agentops-cli/src/index.js latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js explain latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js recommend latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js live --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js replay latest --file tests/sample-otel/tool-failure.jsonl
```

## 7. Open the dashboard

Open your overview dashboard after setting `AGENTOPS_GRAFANA_BASE_URL`:

```text
https://<your-grafana>.grafana.azure.com/d/copilot-agentops/copilot-cli-agentops
```

The dashboard pack includes:

- Overview
- Sessions
- Session Detail
- Traces / Spans
- Tools & MCP
- Runtime Events
- Attribution
- Safety & Policy
- Permission Friction
- Alert Tuning
- Quality
- Experiments
- Data Quality

If you changed dashboard JSON and need to rebuild the local pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```

If you run deployments outside `azd`, import dashboards manually:

```bash
AZURE_RESOURCE_GROUP=rg-agentops-dev \
GRAFANA_NAME=graf-agentops-dev \
./scripts/grafana-import-dashboard.sh
```

## 8. Optional: science mode

Science mode means you compare one Copilot setup against another using repeatable tasks.

Use this when you want to answer: "Did my new prompt, agent, model, or tool setup actually help?"

1. Pick one benchmark: a small task you can run the same way more than once.
2. Run the baseline: the current setup.
3. Run the variant: the changed setup.
4. Compare success, failures, tokens, duration, and policy blocks in Grafana.

Start with a dry run. It plans the benchmark without changing the repo or executing Copilot:

```bash
node agentops-cli/src/index.js benchmark list
node agentops-cli/src/index.js benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy --dry-run
```

Run the benchmark for real when you are ready. It copies the fixture to a temp workspace, gives Copilot an isolated `COPILOT_HOME`, writes a summary, and scores the result:

```bash
node agentops-cli/src/index.js benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy
node agentops-cli/src/index.js benchmark report <run-id>
```

Add Azure enrichment when you want the report to use real telemetry from Log Analytics:

```bash
node agentops-cli/src/index.js benchmark report <run-id> --azure --last 24h
node agentops-cli/src/index.js benchmark compare <baseline-run-id> <variant-run-id> --azure --last 24h
```

The report includes a promote, investigate, or reject recommendation with evidence, validation status, and rollback condition. Treat that as the benchmark gate before keeping agent, skill, hook, or MCP changes.

For manual comparisons, label each run:

```bash
AGENTOPS_EXPERIMENT=baseline copilot -p "Run the benchmark task."
AGENTOPS_EXPERIMENT=variant-shorter-prompt copilot -p "Run the benchmark task."
```

Do not turn on content capture for science mode. The default metadata is enough for first-pass comparisons.

For deeper repeatable checks, see [docs/testing-and-next-steps.md](docs/testing-and-next-steps.md).

## 9. Optional: Azure MCP analyst mode

Analyst mode is for people who want Copilot or an MCP client to inspect telemetry for them.

The safe default is read-only investigation:

```text
Use the telemetry-investigator agent to analyze the last 24 hours of Copilot CLI telemetry and propose one safe improvement. Do not edit files yet.
```

Read-only Azure Monitor MCP, Azure Managed Grafana MCP, and copyable prompt templates are documented in [docs/copilot-mcp-agentops-prompts.md](docs/copilot-mcp-agentops-prompts.md). The templates cover latest-session investigation, tool failures, benchmark variant comparison, agent improvement, hook policy tuning, and MCP/tool regressions.

For Codex, add the same read-only Azure Monitor MCP server globally:

```bash
az login
codex mcp add azure-mcp -- npx -y @azure/mcp@latest server start --read-only --namespace monitor
codex mcp list
```

To verify custom agent, skill, MCP, and script attribution without relying on a live agent to exercise every primitive:

```bash
agentops plugin install
agentops attribution-smoke --wait 5m --poll 15s
agentops attribution --last 2h
agentops mcp --last 2h
agentops lineage --last 2h
```

Useful implemented CLI helpers for analysts:

```bash
node agentops-cli/src/index.js status
node agentops-cli/src/index.js init --dry-run
node agentops-cli/src/index.js validate-azure
node agentops-cli/src/index.js smoke --dry-run
node agentops-cli/src/index.js smoke --wait 2m --poll 10s
node agentops-cli/src/index.js attribution-smoke --wait 5m --poll 15s
node agentops-cli/src/index.js open
node agentops-cli/src/index.js link session <conversation>
node agentops-cli/src/index.js link trace <operationId>
node agentops-cli/src/index.js ask-context latest --last 24h
node agentops-cli/src/index.js fields --last 7d
node agentops-cli/src/index.js context --last 7d
node agentops-cli/src/index.js token-rollup-audit --last 14d
node agentops-cli/src/index.js collector-health --last 24h
node agentops-cli/src/index.js attribution --last 7d
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js policy --last 7d
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js permission-friction --last 7d
node agentops-cli/src/index.js alert recommend --last 14d
node agentops-cli/src/index.js saved-view add latest-risk --session <conversation-id> --tag risk
node agentops-cli/src/index.js saved-view list
```

These commands print Grafana links or Azure Log Analytics queries. You can use them without learning KQL first, and an analyst can inspect the generated query when needed.

## 10. Optional: internals

AgentOps is a local-first telemetry loop:

```text
Copilot CLI -> AgentOps shim -> localhost collector -> Azure Monitor -> Managed Grafana
```

The Azure deployment creates:

- Log Analytics Workspace
- Application Insights
- Azure Monitor Workspace
- Azure Managed Grafana
- Key Vault
- Disabled proposal-only scheduled query rules

More detail:

- [docs/secure-by-default.md](docs/secure-by-default.md)
- [docs/copilot-mcp-agentops-prompts.md](docs/copilot-mcp-agentops-prompts.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/telemetry-schema.md](docs/telemetry-schema.md)
- [docs/grafana-llm-observability-ui.md](docs/grafana-llm-observability-ui.md)
- [docs/copilot-cli-observability-research.md](docs/copilot-cli-observability-research.md)

## Plain English Glossary

- **context pressure** = Copilot had too much to remember
- **tool failure** = a tool Copilot tried did not work
- **primitive inventory** = the support matrix for agents, subagents, skills, hooks, MCP, tools, instructions, plugins, workflows/commands, LSP, benchmarks, and runtime flags
- **lineage** = the session flow across agents, subagents, LLM calls, tools, MCP tools, skills, hooks, context, and errors
- **policy block** = a safety rule stopped something risky
- **content capture** = recording prompts/code/tool arguments
- **benchmark** = a repeatable task
- **baseline** = before
- **variant** = after/version being tested
- **regression** = got worse
