# Deployment Plan: copilot-cli-agentops-azure

Status: Public scaffold ready for user-owned Azure deployment.

## Summary

This repo packages a secure, metadata-first AgentOps control plane for GitHub Copilot CLI telemetry on Azure.

The core loop is:

1. Run Copilot CLI through the local AgentOps wrapper.
2. Send OpenTelemetry data to a localhost OpenTelemetry Collector.
3. Export locally for debug or to Azure Monitor/Application Insights.
4. Query telemetry through KQL and the `agentops` CLI.
5. Use Copilot agents, skills, hooks, and MCP samples to investigate telemetry and propose safe improvements.

## Secure Defaults

- Content capture is disabled.
- The collector binds to `127.0.0.1` only.
- Repository URLs are hashed before export.
- Azure and Grafana MCP samples are read-only.
- Patch workflows are proposal-only by default.
- Secrets are environment variables or Key Vault references, never committed.

## Azure Inputs

Set these values before running Azure scripts:

```bash
export AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}"
export AZURE_LOCATION="${AZURE_LOCATION:-northeurope}"
export AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID="<workspace-id>"
export AGENTOPS_GRAFANA_BASE_URL="https://<your-grafana>.grafana.azure.com"
```

The Bicep deployment accepts:

- `environmentName`
- `location`
- `baseName`
- `deployActioner`
- `deployAlerts`
- `enableAlerts`

## Resources

The core stack creates:

- Log Analytics Workspace
- Application Insights
- Azure Monitor Workspace
- Azure Managed Grafana
- Key Vault
- Optional Function App placeholder for future alert actioner workflows
- Disabled proposal-only scheduled query rules when `deployAlerts=true`

## Validation Plan

Local validation:

```bash
npm --prefix agentops-cli test
node agentops-cli/src/index.js doctor --local-only
node scripts/build-grafana-dashboard-pack.js
docker compose -f collector/docker-compose.yaml config >/tmp/agentops-compose.yaml
az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-arm.json
```

Azure validation:

```bash
./scripts/azure-readiness.sh
./scripts/azure-what-if.sh
```

Only after reviewing what-if should provisioning run:

```bash
azd provision
```

## Post-Deployment Smoke Tests

Start the Azure Monitor collector:

```bash
./scripts/collector-azuremonitor-up.sh
```

Send a privacy-safe synthetic OTLP trace:

```bash
./scripts/otlp-smoke-trace.sh
```

Run a minimal Copilot CLI task through the wrapper:

```bash
./copilot/copilot-observe -p "Reply with exactly: agentops telemetry smoke."
```

Query recent Copilot spans:

```bash
az monitor log-analytics query \
  --workspace "$AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID" \
  --analytics-query "AppDependencies | where TimeGenerated > ago(2h) | where Properties has 'github.copilot' and Properties has 'github-copilot-cli' | project TimeGenerated, Name, AppRoleName, Properties | order by TimeGenerated desc | take 20"
```

Import dashboards after Grafana RBAC is configured:

```bash
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-agentops-dev}" \
GRAFANA_NAME="<grafana-resource-name>" \
./scripts/grafana-import-dashboard.sh
```

## Open Decisions

- Whether to keep the Azure Monitor collector running during daily Copilot CLI sessions or start it only for explicit smoke tests.
- When to enable the optional actioner Function.
- When tuned alert thresholds are stable enough to set `enableAlerts=true`.
