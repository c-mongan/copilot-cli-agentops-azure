# Testing and Next Steps

## Current Validation Status

Completed locally:

```bash
npm --prefix agentops-cli test
node agentops-cli/src/index.js doctor --local-only
az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-arm.json
docker compose -f collector/docker-compose.yaml config >/tmp/agentops-compose.yaml
```

All of the above pass.

Azure deployment checklist:

- Core telemetry stack can be deployed with the Bicep/AZD files in this repo.
- Managed Grafana user access and data-source RBAC must be configured for your subscription.
- Application Insights synthetic ingestion should pass before real Copilot telemetry testing.
- Collector-backed real Copilot CLI telemetry should pass through `copilot-observe`.
- Grafana dashboard imports should show run, token, AIU, latency, model, failure, content-capture, compaction/truncation, policy-block, and session-lifecycle panels.
- Proposal-only Azure Monitor scheduled query rules should stay disabled until thresholds are tuned.

## Local Collector Smoke Test

The collector smoke test requires Docker/OrbStack or a local `otelcol-contrib` binary.

### Option A: Docker/OrbStack

Start Docker Desktop or OrbStack, then run:

```bash
docker compose -f collector/docker-compose.yaml up -d
node agentops-cli/src/index.js validate-collector
node agentops-cli/src/index.js smoke --dry-run
node agentops-cli/src/index.js collector-health --last 24h
docker compose -f collector/docker-compose.yaml logs --tail=50
```

Stop the collector with:

```bash
docker compose -f collector/docker-compose.yaml down
```

### Option B: Local Collector Binary

Install OpenTelemetry Collector Contrib and run:

```bash
otelcol-contrib --config collector/otelcol.local.yaml
```

In another terminal:

```bash
node agentops-cli/src/index.js validate-collector
```

## Azure Monitor Collector Smoke Test

Docker is the current tested path for collector-backed Azure export. Start the Azure Monitor collector with the deployed Application Insights connection string retrieved at runtime:

```bash
./scripts/collector-azuremonitor-up.sh
```

Send a privacy-safe OTLP trace through the local collector:

```bash
node agentops-cli/src/index.js smoke --wait 2m --poll 10s
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
docker compose -f collector/docker-compose.azuremonitor.yaml down
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
./scripts/collector-azuremonitor-up.sh
./copilot/copilot-observe -p "Reply with exactly: agentops real telemetry smoke."
docker compose -f collector/docker-compose.azuremonitor.yaml down
```

## Always-On Copilot Collection

For daily use, install the AgentOps shim and use `copilot-agentops` instead of starting the collector manually:

```bash
node agentops-cli/src/index.js install --shadow-copilot
./scripts/install-copilot-agentops-shim.sh
export PATH="$HOME/.local/bin:$PATH"
copilot-agentops --help
```

PowerShell:

```powershell
./scripts/install-copilot-agentops-shim.ps1
$env:PATH = "$HOME/.local/bin;$env:PATH"
copilot-agentops --help
```

The shim checks whether the Azure Monitor collector is already running. If it is not, it retrieves the Application Insights connection string at runtime, starts the collector, and then launches Copilot CLI through `copilot-observe` with content capture disabled.

If the Azure Monitor collector cannot start because the configured Azure resources are missing or unavailable, the shim warns and launches the real Copilot CLI without AgentOps telemetry.

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
docker compose -f collector/docker-compose.azuremonitor.yaml down
```

Query recent real Copilot CLI spans:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has 'github.copilot' and Properties has 'github-copilot-cli' | project TimeGenerated, Name, AppRoleName, Properties | order by TimeGenerated desc | take 20"
```

Summarize recent operational posture:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has 'github.copilot' and Properties has 'github-copilot-cli' | summarize Spans=count(), Runs=countif(tostring(Properties['gen_ai.operation.name']) == 'invoke_agent'), InputTokens=sum(todouble(Properties['gen_ai.usage.input_tokens'])), OutputTokens=sum(todouble(Properties['gen_ai.usage.output_tokens'])), AIU=sum(todouble(Properties['github.copilot.aiu'])), Cost=sum(todouble(Properties['github.copilot.cost'])), P95DurationMs=percentile(DurationMs, 95)"
```

## Local Live And Replay Checks

Use the live and replay commands when you want immediate local session visibility without prompt, response, tool argument, or file-content capture:

```bash
node agentops-cli/src/index.js configure show
node agentops-cli/src/index.js init --dry-run
node agentops-cli/src/index.js validate-azure
node agentops-cli/src/index.js smoke --wait 2m --poll 10s
node agentops-cli/src/index.js live --last 2h
node agentops-cli/src/index.js replay latest --last 2h
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js recommend latest --last 2h
node agentops-cli/src/index.js ask-context latest --last 2h
```

Use the fixture path when Azure telemetry is unavailable:

```bash
node agentops-cli/src/index.js live --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js replay latest --file tests/sample-otel/tool-failure.jsonl
node agentops-cli/src/index.js recommend latest --file tests/sample-otel/tool-failure.jsonl
```

Save repeat investigations locally:

```bash
node agentops-cli/src/index.js saved-view add latest-risk --session <conversation-id> --tag risk
node agentops-cli/src/index.js saved-view list
node agentops-cli/src/index.js saved-view open latest-risk
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
```

## Read-Only MCP Investigation Smoke Test

Validate the MCP sample JSON before using it:

```bash
node -e "JSON.parse(require('fs').readFileSync('plugin/.mcp.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.azure-monitor.sample.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.grafana.sample.json', 'utf8'))"
```

Use Azure MCP in read-only Azure Monitor scope:

```bash
az login
copilot --additional-mcp-config @copilot/mcp.azure-monitor.sample.json --allow-tool='azure-mcp'
```

Use Azure Managed Grafana MCP only after setting a token outside the repo:

```bash
sed -n '1,80p' copilot/mcp.grafana.sample.json
export AZURE_GRAFANA_MCP_TOKEN="<set-outside-repo>"
copilot --additional-mcp-config @copilot/mcp.grafana.sample.json --allow-tool='agent-grafana'
```

Before running that command, replace `<grafana-endpoint>` in the sample with your Azure Managed Grafana host.

Prompt templates for session investigation, tool failures, benchmark variant comparison, agent improvement, hook policy tuning, and MCP/tool regression checks are in `docs/copilot-mcp-agentops-prompts.md`.

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
