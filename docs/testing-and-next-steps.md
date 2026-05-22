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

Azure deployment status:

- Core telemetry stack is deployed in `rg-copilot-agentops-dev`.
- Managed Grafana user access and data-source RBAC are configured.
- Application Insights synthetic ingestion smoke test passed.
- Collector-backed real Copilot CLI telemetry ingestion passed through `copilot-observe`.
- Grafana dashboard with real run, token, AIU, latency, model, failure, content-capture, compaction/truncation, policy-block, and session-lifecycle panels is imported at `https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/copilot-agentops/copilot-cli-agentops`.
- Proposal-only Azure Monitor scheduled query rules are deployed disabled.

## Local Collector Smoke Test

The collector smoke test requires Docker/OrbStack or a local `otelcol-contrib` binary.

### Option A: Docker/OrbStack

Start Docker Desktop or OrbStack, then run:

```bash
docker compose -f collector/docker-compose.yaml up -d
node agentops-cli/src/index.js validate-collector
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
./scripts/otlp-smoke-trace.sh
```

The script prints a `smokeId`. The Azure Monitor exporter maps this synthetic client span into `AppDependencies`:

```bash
az monitor log-analytics query \
  --workspace 81513958-e9aa-4a35-aeab-953e1d26e797 \
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

The wrapper preserves user-supplied OpenTelemetry settings where possible. It sets safe defaults for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `COPILOT_OTEL_SOURCE_NAME`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`, then prepends AgentOps metadata to existing `OTEL_RESOURCE_ATTRIBUTES` instead of replacing them.

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
  --workspace 81513958-e9aa-4a35-aeab-953e1d26e797 \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has 'github.copilot' and Properties has 'github-copilot-cli' | project TimeGenerated, Name, AppRoleName, Properties | order by TimeGenerated desc | take 20"
```

Summarize recent operational posture:

```bash
az monitor log-analytics query \
  --workspace 81513958-e9aa-4a35-aeab-953e1d26e797 \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has 'github.copilot' and Properties has 'github-copilot-cli' | summarize Spans=count(), Runs=countif(tostring(Properties['gen_ai.operation.name']) == 'invoke_agent'), InputTokens=sum(todouble(Properties['gen_ai.usage.input_tokens'])), OutputTokens=sum(todouble(Properties['gen_ai.usage.output_tokens'])), AIU=sum(todouble(Properties['github.copilot.aiu'])), Cost=sum(todouble(Properties['github.copilot.cost'])), P95DurationMs=percentile(DurationMs, 95)"
```

## Read-Only MCP Investigation Smoke Test

Validate the MCP sample JSON before using it:

```bash
node -e "JSON.parse(require('fs').readFileSync('plugin/.mcp.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.azure-monitor.sample.json', 'utf8')); JSON.parse(require('fs').readFileSync('copilot/mcp.grafana.sample.json', 'utf8'))"
```

Use Azure MCP in read-only Azure Monitor scope:

```bash
az login
copilot --additional-mcp-config @copilot/mcp.azure-monitor.sample.json
```

Use Azure Managed Grafana MCP only after setting a token outside the repo:

```bash
sed -n '1,80p' copilot/mcp.grafana.sample.json
export AZURE_GRAFANA_MCP_TOKEN="<set-outside-repo>"
copilot --additional-mcp-config @copilot/mcp.grafana.sample.json
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
    --resource-group rg-copilot-agentops-dev \
    --resource-type Microsoft.Insights/scheduledQueryRules \
    --name "$name" \
    --query "{name:name,enabled:properties.enabled,severity:properties.severity,description:properties.description}" \
    -o json
done
```

Keep `enableAlerts=false` until thresholds are tuned against more real sessions.

## Azure Validation Path

Current Azure CLI target:

- Subscription: `Visual Studio Enterprise Subscription`
- Subscription ID: `0222a208-955a-45fd-b6d8-ca4704421bf0`
- Tenant ID: `cf17fc39-219d-4d2b-9cd5-a49dc7ad0898`
- Default resource group target: `rg-copilot-agentops-dev`
- Recommended region: `northeurope`

Current deployed resources:

- `law-copilot-agentops-dev`
- `appi-copilot-agentops-dev`
- `amw-copilot-agentops-dev`
- `graf-copilotagentops-de`
- `kv-copilotagentops-dev-u`

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
  --resource-group rg-copilot-agentops-dev \
  --app appi-copilot-agentops-dev \
  --analytics-query "customEvents | where name == 'AgentOpsSmokeTest' | where customDimensions.smokeId == '<smokeId>' | project timestamp, name, customDimensions"
```

Or query the linked Log Analytics workspace:

```bash
az monitor log-analytics query \
  --workspace 81513958-e9aa-4a35-aeab-953e1d26e797 \
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
