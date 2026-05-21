# Copilot CLI AgentOps for Azure

Secure Azure-native observability and self-improvement loop for GitHub Copilot CLI.

Status: v0.2 deployed and verified in Azure.

## What It Gives You

- Copilot CLI OpenTelemetry ingestion through a localhost collector.
- Azure Monitor, Application Insights, Log Analytics, and Azure Managed Grafana infrastructure.
- Managed Grafana dashboard import after `azd provision` through the `azure.yaml` post-provision hook.
- KQL query pack aligned to the verified `AppDependencies` / `Properties` workspace schema.
- Proposal-only Azure Monitor scheduled query alerts, deployed disabled until thresholds are tuned.
- Read-only Azure MCP and Grafana MCP investigation patterns.
- Custom Copilot CLI agents for telemetry retrospectives and safe optimization proposals.
- Skills for KQL, telemetry diagnosis, skill tuning, and subagent analysis.
- Hooks for deterministic guardrails and recovery hints.

## Secure Defaults

- Content capture is off.
- Collector binds to `127.0.0.1`.
- Repo URL is hashed before export.
- MCP samples are read-only.
- Agents propose patches; they do not auto-apply changes.

## Quickstart

Install the local wrapper and run the local debug collector:

```bash
az login
./installer/install.sh
./collector/start.sh
source ./copilot/env.sample.sh
copilot-observe --help
```

For the deployed Azure path, start the Azure Monitor collector, run Copilot CLI through the wrapper, then stop the collector to flush telemetry:

```bash
./scripts/collector-azuremonitor-up.sh
./copilot/copilot-observe
docker compose -f collector/docker-compose.azuremonitor.yaml down
```

To keep collection on for normal use, install the AgentOps Copilot shim:

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

The `copilot-agentops` command starts the Azure Monitor collector if needed, keeps it running, and routes Copilot CLI through the privacy-safe `copilot-observe` wrapper. To make plain `copilot` use the same observed path, install the optional shadow shim:

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

Stop always-on collection when needed with:

```bash
docker compose -f collector/docker-compose.azuremonitor.yaml down
```

PowerShell uses the same Docker Compose stop command.

Open the deployed dashboard:

```text
https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/copilot-agentops/copilot-cli-agentops
```

Inside Copilot CLI:

```text
Use the telemetry-investigator agent to analyze the last 24 hours of Copilot CLI telemetry and propose one safe improvement. Do not edit files yet.
```

## Azure Deployment

The core telemetry stack has been deployed to `rg-copilot-agentops-dev` in `northeurope`.

Deployed resources include:

- Log Analytics Workspace: `law-copilot-agentops-dev`
- Application Insights: `appi-copilot-agentops-dev`
- Azure Monitor Workspace: `amw-copilot-agentops-dev`
- Azure Managed Grafana: `graf-copilotagentops-de`
- Key Vault: `kv-copilotagentops-dev-u`
- Disabled proposal-only scheduled query rules for high AIU, failed spans, and content-capture detection

The `azure.yaml` file includes a post-provision hook:

```yaml
hooks:
  postprovision:
    shell: sh
    run: ./scripts/grafana-import-dashboard.sh
```

The hook uses the Bicep `GRAFANA_NAME` output and imports `grafana/agentops-dashboard.json` into Managed Grafana after provisioning. If you run deployments outside `azd`, import the dashboard manually:

```bash
AZURE_RESOURCE_GROUP=rg-copilot-agentops-dev \
GRAFANA_NAME=graf-copilotagentops-de \
./scripts/grafana-import-dashboard.sh
```

## Alert Rules

Alert rules are deployed disabled by default. Keep `enableAlerts=false` until there are enough real sessions to tune thresholds.

Verify the live alert state:

```bash
for name in \
  sqr-copilot-agentops-dev-high-aiu \
  sqr-copilot-agentops-dev-content-capture \
  sqr-copilot-agentops-dev-failures; do
  az resource show \
    --resource-group rg-copilot-agentops-dev \
    --resource-type Microsoft.Insights/scheduledQueryRules \
    --name "$name" \
    --query "{name:name,enabled:properties.enabled,severity:properties.severity}" \
    -o table
done
```

## Current Scope

This slice proves the secure telemetry loop end to end and provides operational dashboards, KQL, and disabled proposal-only alerts. It does not deploy the optional actioner Function by default, and it does not auto-apply remediation.

See [.azure/deployment-plan.md](.azure/deployment-plan.md) for the implementation and deployment plan.

## Testing And Next Steps

See [docs/testing-and-next-steps.md](docs/testing-and-next-steps.md) for local smoke tests, Azure validation findings, and the safe details needed before provisioning.
