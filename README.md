# Copilot CLI AgentOps for Azure

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

You do not need to know OpenTelemetry, KQL, MCP, or Grafana to start. Those are just the plumbing underneath the beginner path.

## 3. Install in the shortest safe path

This repo currently points at the deployed dev stack in `rg-copilot-agentops-dev` in `northeurope`. The installer creates a local `copilot` shim that starts the Azure Monitor collector when needed, keeps content capture off, adds safe AgentOps labels, and then calls the real Copilot CLI.

macOS/Linux:

```bash
az login
./install-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
copilot --help
node agentops-cli/src/index.js status
```

PowerShell:

```powershell
az login
./install-agentops.ps1
$env:PATH = "$HOME/.local/bin;$env:PATH"
copilot --help
node agentops-cli/src/index.js status
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
```

To remove the installed shims:

```bash
node agentops-cli/src/index.js uninstall
```

To stop the local Azure Monitor collector:

```bash
node agentops-cli/src/index.js collector stop
```

## 4. See your latest Copilot run

Run Copilot normally after install:

```bash
copilot -p "Reply with exactly: agentops smoke."
```

Open the dashboard links from the CLI:

```bash
node agentops-cli/src/index.js open
```

Then choose **Last 2 hours** in Grafana and open the newest row in **Sessions**. That row is your latest observed Copilot run.

Useful things to look for first:

- **Success** tells you whether the run completed cleanly.
- **Failures** points to failed spans or tools.
- **Input tokens** helps reveal context pressure.
- **Policy** shows safety or permission friction.
- **Tools** shows what Copilot tried to call.

Ask for the latest live run from Azure Monitor:

```bash
node agentops-cli/src/index.js latest --last 7d
node agentops-cli/src/index.js explain latest --last 7d
```

You can still use an offline JSONL export or fixture when you are testing locally:

```bash
node agentops-cli/src/index.js latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js explain latest --file tests/sample-otel/tool-failure.jsonl
```

## 5. Open the dashboard

Open the deployed overview dashboard:

```text
https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/copilot-agentops/copilot-cli-agentops
```

The dashboard pack includes:

- Overview
- Sessions
- Session Detail
- Traces / Spans
- Tools & MCP
- Runtime Events
- Safety & Policy
- Quality
- Data Quality

If you changed dashboard JSON and need to rebuild the local pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```

If you run deployments outside `azd`, import dashboards manually:

```bash
AZURE_RESOURCE_GROUP=rg-copilot-agentops-dev \
GRAFANA_NAME=graf-copilotagentops-de \
./scripts/grafana-import-dashboard.sh
```

## 6. Optional: science mode

Science mode means you compare one Copilot setup against another using repeatable tasks.

Use this when you want to answer: "Did my new prompt, agent, model, or tool setup actually help?"

1. Pick one benchmark: a small task you can run the same way more than once.
2. Run the baseline: the current setup.
3. Run the variant: the changed setup.
4. Compare success, failures, tokens, duration, and policy blocks in Grafana.

Start with a dry run. It plans the benchmark without changing the repo or executing Copilot:

```bash
node agentops-cli/src/index.js benchmark list
node agentops-cli/src/index.js benchmark run starter --variant baseline --repeat 1 --dry-run
```

Run the benchmark for real when you are ready. It copies the fixture to a temp workspace, gives Copilot an isolated `COPILOT_HOME`, writes a summary, and scores the result:

```bash
node agentops-cli/src/index.js benchmark run starter --variant baseline --repeat 1
node agentops-cli/src/index.js benchmark report <run-id>
```

Add Azure enrichment when you want the report to use real telemetry from Log Analytics:

```bash
node agentops-cli/src/index.js benchmark report <run-id> --azure --last 24h
node agentops-cli/src/index.js benchmark compare <baseline-run-id> <variant-run-id> --azure --last 24h
```

For manual comparisons, label each run:

```bash
AGENTOPS_EXPERIMENT=baseline copilot -p "Run the benchmark task."
AGENTOPS_EXPERIMENT=variant-shorter-prompt copilot -p "Run the benchmark task."
```

Do not turn on content capture for science mode. The default metadata is enough for first-pass comparisons.

For deeper repeatable checks, see [docs/testing-and-next-steps.md](docs/testing-and-next-steps.md).

## 7. Optional: Azure MCP analyst mode

Analyst mode is for people who want Copilot or an MCP client to inspect telemetry for them.

The safe default is read-only investigation:

```text
Use the telemetry-investigator agent to analyze the last 24 hours of Copilot CLI telemetry and propose one safe improvement. Do not edit files yet.
```

Read-only Azure Monitor MCP, Azure Managed Grafana MCP, and copyable prompt templates are documented in [docs/copilot-mcp-agentops-prompts.md](docs/copilot-mcp-agentops-prompts.md). The templates cover latest-session investigation, tool failures, benchmark variant comparison, agent improvement, hook policy tuning, and MCP/tool regressions.

Useful implemented CLI helpers for analysts:

```bash
node agentops-cli/src/index.js status
node agentops-cli/src/index.js open
node agentops-cli/src/index.js link session <conversation>
node agentops-cli/src/index.js link trace <operationId>
node agentops-cli/src/index.js fields --last 7d
node agentops-cli/src/index.js context --last 7d
node agentops-cli/src/index.js token-rollup-audit --last 14d
node agentops-cli/src/index.js policy --last 7d
node agentops-cli/src/index.js mcp --last 7d
```

These commands print Grafana links or Azure Log Analytics queries. You can use them without learning KQL first, and an analyst can inspect the generated query when needed.

## 8. Optional: internals

AgentOps is a local-first telemetry loop:

```text
Copilot CLI -> AgentOps shim -> localhost collector -> Azure Monitor -> Managed Grafana
```

The Azure deployment contains:

- Log Analytics Workspace: `law-copilot-agentops-dev`
- Application Insights: `appi-copilot-agentops-dev`
- Azure Monitor Workspace: `amw-copilot-agentops-dev`
- Azure Managed Grafana: `graf-copilotagentops-de`
- Key Vault: `kv-copilotagentops-dev-u`
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
- **policy block** = a safety rule stopped something risky
- **content capture** = recording prompts/code/tool arguments
- **benchmark** = a repeatable task
- **baseline** = before
- **variant** = after/version being tested
- **regression** = got worse
