# Testing and Next Steps

## Current Validation Status

Completed locally:

```bash
npm --prefix agentops-cli test
node agentops-cli/src/index.js doctor --local-only
node agentops-cli/src/index.js doctor --json
az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-arm.json
node agentops-cli/src/index.js collector validate --mode auto --privacy strict --json
```

All of the above pass.

For a compact machine-readable setup/UI contract, run:

```bash
node agentops-cli/src/index.js health --json
```

Azure deployment checklist:

- Core telemetry stack can be deployed with the Bicep/AZD files in this repo.
- Managed Grafana user access and data-source RBAC must be configured for your subscription.
- Application Insights synthetic ingestion should pass before real Copilot telemetry testing.
- Collector-backed real Copilot CLI telemetry should pass through `copilot-observe`.
- Grafana dashboard imports should show run, token, AIU, latency, model, failure, content-capture, compaction/truncation, policy-block, and session-lifecycle panels.
- Proposal-only Azure Monitor scheduled query rules should stay disabled until thresholds are tuned.

## Local Collector Smoke Test

The collector smoke test uses the local Collector binary by default. Docker/OrbStack is optional.

### Option A: Local Collector Binary

Install and validate the tested OpenTelemetry Collector Contrib binary:

```bash
node agentops-cli/src/index.js collector install-binary
node agentops-cli/src/index.js collector validate --mode binary --privacy strict
node agentops-cli/src/index.js collector smoke --privacy strict --poison
```

### Option B: Docker/OrbStack

Start Docker Desktop or OrbStack, then run:

```bash
node agentops-cli/src/index.js collector start --mode docker --privacy strict
node agentops-cli/src/index.js smoke --dry-run
node agentops-cli/src/index.js experimental collector-health --last 24h
```

Stop the collector with:

```bash
node agentops-cli/src/index.js collector stop --mode docker
```

## Azure Monitor Collector Smoke Test

Binary mode is the default tested path for collector-backed Azure export. Start the Azure Monitor collector with the deployed Application Insights connection string retrieved at runtime:

```bash
node agentops-cli/src/index.js collector start --mode auto --privacy strict
```

Send a privacy-safe OTLP trace through the local collector:

```bash
node agentops-cli/src/index.js experimental smoke --wait 2m --poll 10s
./scripts/otlp-smoke-trace.sh
```

The CLI smoke command sends a synthetic client span and polls Log Analytics for the same `smokeId`. The shell script is still available for low-level collector testing. The Azure Monitor exporter maps the synthetic span into `AppDependencies`:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has '<smokeId>' or Name has '<smokeId>' | project TimeGenerated, Name, Properties | order by TimeGenerated desc | take 20"
```

Stop the Azure Monitor collector after testing:

```bash
node agentops-cli/src/index.js collector stop --mode auto
```

The collector helper retrieves the Application Insights connection string at runtime and does not write it to the repository.

## Copilot CLI Wrapper Smoke Test

After the collector is running:

```bash
source copilot/env.sample.sh
copilot-observe --help
```

For a real telemetry run, execute a small Copilot CLI task through `copilot-observe`. Keep content capture disabled.

```bash
node agentops-cli/src/index.js collector start --mode auto --privacy strict
node agentops-cli/src/index.js copilot -p "Reply with exactly: agentops real telemetry smoke."
node agentops-cli/src/index.js collector stop --mode auto
```

## Always-On Copilot Collection

For daily use, install the AgentOps shim and use `copilot-agentops` instead of starting the collector manually:

```bash
node agentops-cli/src/index.js install --shadow-copilot
export PATH="$HOME/.local/bin:$PATH"
copilot --help
```

PowerShell:

```powershell
./scripts/install-copilot-agentops-shim.ps1
$env:PATH = "$HOME/.local/bin;$env:PATH"
copilot-agentops --help
```

The shim checks whether the Azure Monitor collector is already running. If it is not, it retrieves the Application Insights connection string at runtime, starts the collector, and then launches Copilot CLI through `copilot-observe` with content capture disabled.

If the Azure Monitor collector cannot start because the configured Azure resources are missing or unavailable, the shim fails closed unless `AGENTOPS_ALLOW_UNOBSERVED_FALLBACK=1` is set. The CLI wrapper writes metadata-only lifecycle rows to `.agentops/wrapper-events.jsonl`, including `agentops.run.start`, `agentops.run.end`, `agentops.collector.start_failed`, and `agentops.wrapper.fallback_unobserved`.

After a successful wrapped run, `agentops copilot` prints an `AgentOps Run Replay` link scoped to the wrapper run and session IDs. Set `AGENTOPS_PRINT_RUN_LINK=false` to suppress the link.

The wrapper preserves user-supplied OpenTelemetry settings where possible. It sets safe defaults for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `COPILOT_OTEL_SOURCE_NAME`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`, then prepends AgentOps metadata to existing `OTEL_RESOURCE_ATTRIBUTES` instead of replacing them.

## Native Copilot OTel Without The Wrapper

The installed `agentops` command and shim are optional for telemetry ingestion. VS Code Copilot Chat, Copilot CLI, and Copilot SDK apps can send OTLP directly to the AgentOps collector.

Generate copyable setup snippets:

```bash
node agentops-cli/src/index.js otel-setup
node agentops-cli/src/index.js otel-setup --shell powershell
```

Minimum VS Code settings:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

Minimum Copilot CLI environment:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT='http://127.0.0.1:4318'
export COPILOT_OTEL_ENABLED='true'
export COPILOT_OTEL_EXPORTER_TYPE='otlp-http'
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT='false'
```

After running a Copilot interaction, check whether the incoming data has the fields used by dashboards and evals:

```bash
node agentops-cli/src/index.js compat-check --last 2h
```

Use `./scripts/collector-azuremonitor-up.sh` to start the collector without installing the CLI. Use `kql/22-otel-compatibility.kql` for the compatibility check directly in Log Analytics when you do not want to run any CLI helper. A `ready` result means the stack found operation, session, model, and token fields. The query also reports matching Copilot/GenAI metrics and events from `AppMetrics`, `AppTraces`, and `AppEvents`. A `partial` result means ingestion works, but some dashboards or anti-cheat/eval rollups may be limited.

To bind this to the normal `copilot` command, install the shadow shim:

```bash
./scripts/install-copilot-agentops-shim.sh --shadow-copilot
export PATH="$HOME/.local/bin:$PATH"
copilot --help
```

PowerShell:

```powershell
./scripts/install-copilot-agentops-shim.ps1 -ShadowCopilot
$env:PATH = "$HOME/.local/bin;$env:PATH"
copilot --help
```

The shadow shim stores the real Copilot CLI path in `COPILOT_CLI_BIN` before routing through AgentOps, which avoids recursive calls. Stop the collector when you want collection off:

```bash
node agentops-cli/src/index.js collector stop --mode auto
```

Query recent real Copilot CLI spans:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where (Properties has 'github.copilot' or Properties has 'gen_ai.operation.name' or AppRoleName in ('github-copilot', 'copilot-chat', 'github-copilot-cli') or tostring(Properties['service.name']) in ('github-copilot', 'copilot-chat', 'github-copilot-cli')) | project TimeGenerated, Name, AppRoleName, Properties | order by TimeGenerated desc | take 20"
```

Summarize recent operational posture:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where (Properties has 'github.copilot' or Properties has 'gen_ai.operation.name' or AppRoleName in ('github-copilot', 'copilot-chat', 'github-copilot-cli') or tostring(Properties['service.name']) in ('github-copilot', 'copilot-chat', 'github-copilot-cli')) | summarize Spans=count(), Runs=countif(tostring(Properties['gen_ai.operation.name']) == 'invoke_agent'), InputTokens=sum(todouble(Properties['gen_ai.usage.input_tokens'])), OutputTokens=sum(todouble(Properties['gen_ai.usage.output_tokens'])), AIU=sum(todouble(Properties['github.copilot.aiu'])), Cost=sum(todouble(Properties['github.copilot.cost'])), P95DurationMs=percentile(DurationMs, 95)"
```

## Local Live And Replay Checks

Use the live and replay commands when you want immediate local session visibility without prompt, response, tool argument, or file-content capture:

```bash
node agentops-cli/src/index.js configure show
node agentops-cli/src/index.js init --dry-run
node agentops-cli/src/index.js init --full
node agentops-cli/src/index.js init --import-dashboards
node agentops-cli/src/index.js init --run-smoke
node agentops-cli/src/index.js init --triage-latest
node agentops-cli/src/index.js validate-azure
node agentops-cli/src/index.js smoke --wait 2m --poll 10s
node agentops-cli/src/index.js live --last 2h
node agentops-cli/src/index.js replay latest --last 2h
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js attribution --last 7d
node agentops-cli/src/index.js recommend latest --last 2h
node agentops-cli/src/index.js ask-context latest --last 2h
```

Use the fixture path when Azure telemetry is unavailable:

```bash
node agentops-cli/src/index.js live --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js replay latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js recommend latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js run-summary generate --file tests/sample-otel/copilot-cli-wrapper-snapshot.jsonl --json
```

Save repeat investigations locally:

```bash
node agentops-cli/src/index.js saved-view add latest-risk --session <conversation-id> --tag risk
node agentops-cli/src/index.js saved-view list
node agentops-cli/src/index.js saved-view open latest-risk
node agentops-cli/src/index.js saved-view export --out .agentops/saved-views/latest
```

Saved views are stored outside the repo in `~/.agentops/views.json` unless `AGENTOPS_VIEWS_PATH` is set.

## Permission Friction Checks

Permission friction covers broad allow modes, policy blocks, denied or excluded tools, disabled MCP servers, tool failures, and recovery hints.

```bash
node agentops-cli/src/index.js permission-friction --last 7d
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js primitives --last 7d
```

The same signal is available in the Permission Friction Grafana dashboard after rebuilding and importing the dashboard pack:

```bash
node scripts/build-grafana-dashboard-pack.js
```

## Alert Recommendation Check

Keep deployed scheduled query rules disabled until thresholds are tuned. Use the recommendation command to inspect historical p95/p99 AIU, failure, tool-failure, and content-capture evidence before changing alert thresholds:

```bash
node agentops-cli/src/index.js alert recommend --last 14d
node agentops-cli/src/index.js alert tune-plan --last 14d --owner agentops-oncall
node agentops-cli/src/index.js alert threshold-simulate --rule failed-spans --threshold 1 --owner agentops-oncall --last 14d
node agentops-cli/src/index.js alert threshold-patch --rule failed-spans --threshold 1 --owner agentops-oncall --last 14d
node agentops-cli/src/index.js alert resources --resource-group "${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
```

`alert tune-plan` is proposal-only and summarizes reviewable threshold changes with Bicep patch targets. `alert threshold-simulate` is preview-only and prints metadata-only KQL that compares current and proposed alert windows. `alert threshold-patch` is also preview-only and prints a concrete `infra/bicep/alerts.bicep` diff for owner-approved direct threshold changes. `alert resources` is read-only and summarizes current scheduled-query rule enabled/disabled state plus attached action groups.

## Read-Only MCP Investigation Smoke Test

Validate the MCP sample JSON before using it:

```bash
node -e "JSON.parse(require('fs').readFileSync('plugin/.mcp.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.azure-monitor.sample.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.grafana.sample.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.microsoft-learn.sample.json', 'utf8'))"
```

Use Azure MCP in read-only Azure Monitor scope:

```bash
az login
copilot --additional-mcp-config @copilot/mcp.azure-monitor.sample.json --allow-tool='azure-mcp'
```

Use Microsoft Learn MCP for official Microsoft documentation lookup:

```bash
copilot --additional-mcp-config @copilot/mcp.microsoft-learn.sample.json --allow-tool='microsoft-learn'
```

Use Codex with the same read-only Azure Monitor MCP server:

```bash
az login
codex mcp add azure-mcp -- npx -y @azure/mcp@latest server start --read-only --namespace monitor
codex mcp list
```

Use Azure Managed Grafana MCP only after setting a token outside the repo:

```bash
sed -n '1,80p' copilot/mcp.grafana.sample.json
export AZURE_GRAFANA_MCP_TOKEN="<set-outside-repo>"
copilot --additional-mcp-config @copilot/mcp.grafana.sample.json --allow-tool='agent-grafana'
```

Before running that command, replace `<grafana-endpoint>` in the sample with your Azure Managed Grafana host.

Prompt templates for session investigation, tool failures, benchmark variant comparison, agent improvement, hook policy tuning, and MCP/tool regression checks are in `docs/copilot-mcp-agentops-prompts.md`.

## Real Agent, Skill, MCP, And Script Attribution Check

After the collector and Azure checks pass, prefer a real observed Copilot run plus real custom lifecycle metadata:

```bash
copilot plugin install c-mongan/copilot-cli-agentops-azure:plugin
agentops copilot --agent agentops-orchestrator --allow-tool=bash --add-dir . --no-ask-user --no-remote \
  -p "Do not edit files. Use read-only shell commands: pwd and ls docs | head. Summarize what you saw."
agentops custom emit --event agent.delegation.started --agent investigator --parent-agent agentops-orchestrator --delegation-id e2e-delegation --workflow investigation --step delegate --outcome started
agentops attribution --last 2h
agentops mcp --last 2h
agentops lineage --last 2h
```

The older `agentops attribution-smoke` command remains useful as a low-level collector/filter diagnostic, but do not use it as screenshot or product-demo data when real Copilot/custom telemetry is available.

## Real Copilot CLI E2E Dashboard Check

The May 27, 2026 E2E pass used GitHub Copilot CLI `1.0.55-3` with the AgentOps shadow shim installed. Official Copilot CLI docs confirm that `-p`, custom agents, MCP config, permissions, and native OTel export are supported surfaces, and VS Code docs confirm the related custom agent, MCP, and `AGENTS.md` customization paths.

Commands used:

```bash
copilot --agent agentops-kitchen-sink-smoke \
  --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user \
  --name agentops-e2e-kitchen-sink \
  -p "AgentOps E2E smoke. Do not edit files. Inspect this repo using read-only commands only..."

copilot --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user \
  --name agentops-e2e-tool-failure \
  -p "Do not edit files. Run a harmless command that succeeds, then a harmless command that fails..."

copilot --agent telemetry-investigator \
  --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user \
  --name agentops-e2e-telemetry-investigator \
  -p "Use read-only local commands and Azure MCP if available..."

node agentops-cli/src/index.js attribution-smoke
node agentops-cli/src/index.js smoke
node agentops-cli/src/index.js benchmark run starter --variant e2e-docs --repeat 1 --hypothesis copilot-docs-e2e
```

Observed in Log Analytics for the last 24 hours:

- 220 matching AgentOps/Copilot spans across 31 sessions.
- Operations: `invoke_agent`, `skill.invoke`, `execute_tool`, `hook.execute`, `plan`, `chat`, and `smoke_test`.
- Custom agents: `agentops-kitchen-sink-smoke` and `telemetry-investigator`.
- Tools: shell/read-only local tools plus Azure MCP monitor/subscription/resource-group tools.
- MCP server: `azure-mcp`.
- Hook/script: `pre-tool-policy`.
- Benchmark run: `bench-20260527071414-40ba63ac`.
- Hypothesis: `copilot-docs-e2e`.
- Intentional tool failures: 7, including KQL syntax failures generated during MCP query testing.
- Content capture signals: 0.

Grafana checks:

- Overview, Sessions, Session Detail, Traces / Spans, Tools & MCP, Attribution, Runtime Events, Data Quality, Safety & Policy, Permission Friction, Alert Tuning, and Quality all rendered from live Azure telemetry without query errors.
- Session Detail showed data when opened with a concrete conversation id.
- Experiments opened populated without query errors or `No data`, showing the benchmark row for Suite=`starter`, Task=`create-note`, Variant=`e2e-docs`, Run=`bench-20260527071414-40ba63ac`, Hypothesis=`copilot-docs-e2e`.
- Dropdown variables populated and concrete selections worked. Operational dashboards keep **All** for normal triage; benchmark variables avoid **All** so sparse experiment pages do not open blank.

## Alert Rule Validation

The v0.2 alert rules are deployed but disabled. Verify them with:

```bash
for name in \
  sqr-copilot-agentops-dev-high-aiu \
  sqr-copilot-agentops-dev-content-capture \
  sqr-copilot-agentops-dev-failures; do
  az resource show \
    --resource-group "${AZURE_RESOURCE_GROUP:-rg-agentops-dev}" \
    --resource-type Microsoft.Insights/scheduledQueryRules \
    --name "$name" \
    --query "{name:name,enabled:properties.enabled,severity:properties.severity,description:properties.description}" \
    -o json
done
```

Keep `enableAlerts=false` until thresholds are tuned against more real sessions.

## Azure Validation Path

Set these values for your subscription before running Azure scripts:

```bash
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
export AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID="<workspace-id>"
export AGENTOPS_GRAFANA_BASE_URL="https://<your-grafana>.grafana.azure.com"
```

The default Bicep resource names are generated from `environmentName` and `baseName`.

Read-only readiness check:

```bash
./scripts/azure-readiness.sh
```

Provisioning prerequisites are already complete. The guarded prerequisite script remains available for rebuilding from a fresh subscription/resource group:

```bash
AGENTOPS_APPROVE_AZURE_CHANGES=yes ./scripts/azure-prereqs.sh
```

Run a what-if before future infrastructure changes:

```bash
./scripts/azure-what-if.sh
```

Only after reviewing what-if should future provisioning run.

## Azure Ingestion Smoke Test

Send a privacy-safe synthetic event to the deployed Application Insights resource:

```bash
./scripts/azure-smoke-appinsights.sh
```

The script prints a `smokeId`. Query it in Application Insights:

```bash
az monitor app-insights query \
  --resource-group "${AZURE_RESOURCE_GROUP:-rg-agentops-dev}" \
  --app "${APPLICATIONINSIGHTS_NAME:-appi-agentops-dev}" \
  --analytics-query "customEvents | where name == 'AgentOpsSmokeTest' | where customDimensions.smokeId == '<smokeId>' | project timestamp, name, customDimensions"
```

Or query the linked Log Analytics workspace:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppEvents | where Name == 'AgentOpsSmokeTest' | where Properties has '<smokeId>' | project TimeGenerated, Name, Properties"
```

The script retrieves the Application Insights connection string at runtime and does not write it to the repository.

## What Azure Details Are Safe to Provide

Safe to provide here:

- Subscription name or ID
- Tenant ID if needed
- Target region
- Resource group name
- Environment name such as `dev`, `test`, or `prod`
- Whether provider registration and resource-group creation are approved

Do not provide secrets here:

- Passwords
- Client secrets
- Tokens
- Grafana service account tokens
- Key Vault secret values

If a command prompts for a secret, type it directly into the terminal yourself.
