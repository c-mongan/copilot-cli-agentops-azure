# Azure Production Hardening

Use this checklist before treating AgentOps for Azure as a production observability surface.

This project is privacy-first, but production readiness also depends on Azure access control, retention, alert routing, and network posture.

## Production Shape

```text
Developers / agents
    |
    v
127.0.0.1 OTLP collector
    |
    v
Azure resource group
    |
    +-- Log Analytics workspace
    |     - short retention
    |     - daily ingestion cap
    |     - resource-permission access model
    |
    +-- Application Insights
    |     - workspace-based
    |
    +-- Azure Managed Grafana
    |     - system-assigned managed identity
    |     - API keys disabled
    |     - explicit public/private access decision
    |
    +-- Optional alert rules
          - disabled until tuned
          - action groups required before enabling
```

## Validate Locally

```bash
node agentops-cli/src/index.js validate-enterprise --json
node agentops-cli/src/index.js security audit --json
node agentops-cli/src/index.js dashboard verify
```

## Managed Grafana Access

Use Microsoft Entra groups, not individual users.

```text
agentops-observers
  Grafana Viewer
  Log Analytics Data Reader

agentops-operators
  Grafana Editor
  Monitoring Reader

agentops-admins
  Grafana Admin
  break-glass only
```

The Azure Monitor datasource is provisioned with managed identity auth:

```yaml
azureAuthType: msi
```

Do not use committed Grafana tokens. If a Grafana MCP token is needed for a local investigation, set it outside the repo and keep it short-lived or least-privilege.

Reference:

- Azure Managed Grafana access: https://learn.microsoft.com/azure/managed-grafana/how-to-manage-access-permissions-users-identities
- Grafana datasource auth: https://learn.microsoft.com/azure/managed-grafana/how-to-authentication-permissions

## Log Analytics Posture

Keep default telemetry metadata-only.

Required posture:

- workspace-based Application Insights;
- resource-permission access model;
- explicit retention;
- daily ingestion cap;
- no raw prompt, response, source, file, tool argument, or tool result content in default tables.

Default profile values:

```text
dev/team retention: 30 days
enterprise retention: 90 days
dev daily cap: 1 GB
team daily cap: 2 GB
enterprise daily cap: 5 GB
```

Optional content capture must use a separate restricted workspace or table, short retention, and approved viewers.

## Private Access

`grafanaPublicNetworkAccess` is explicit in Bicep.

```bash
AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS=Disabled \
AGENTOPS_GRAFANA_ZONE_REDUNDANCY=Enabled \
./scripts/azure-what-if.sh
```

Only disable public network access after private connectivity, DNS, and operator access have been tested. For pilots, keeping public access enabled behind Entra/RBAC can be acceptable. For regulated production, document the private access path before enabling content capture.

## Alert Routing

AgentOps alert rules are proposal-only and disabled by default.

Before enabling alerts:

1. Run real traffic long enough to tune thresholds.
2. Create or select Azure Monitor action groups.
3. Review action-group destinations and rate limits.
4. Pass action group resource IDs explicitly.

```bash
AGENTOPS_DEPLOY_ALERTS=true \
AGENTOPS_ENABLE_ALERTS=true \
AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS='["/subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/<name>"]' \
./scripts/azure-what-if.sh
```

References:

- Azure Monitor action groups: https://learn.microsoft.com/azure/azure-monitor/alerts/action-groups
- Azure Monitor alert best practices: https://learn.microsoft.com/azure/azure-monitor/alerts/best-practices-alerts

## What-If Before Deploy

Run what-if and review the exact posture before provisioning:

```bash
AGENTOPS_DEPLOYMENT_PROFILE=enterprise \
AGENTOPS_LOG_RETENTION_DAYS=90 \
AGENTOPS_DAILY_INGESTION_CAP_GB=5 \
AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS=Disabled \
AGENTOPS_GRAFANA_ZONE_REDUNDANCY=Enabled \
AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS=true \
AGENTOPS_OBSERVER_PRINCIPAL_IDS='["<observer-group-object-id>"]' \
AGENTOPS_OPERATOR_PRINCIPAL_IDS='["<operator-group-object-id>"]' \
AGENTOPS_DEPLOY_BUDGET=true \
AGENTOPS_BUDGET_CONTACT_EMAILS='["agentops-owners@example.com"]' \
./scripts/azure-what-if.sh
```

Deploy only after the what-if output is approved:

```bash
./scripts/azure-deploy-enterprise-pilot.sh
```

## Final Gate

```bash
node agentops-cli/src/index.js validate-azure --last 24h --json
node agentops-cli/src/index.js product audit --live --last 24h --require-rows --json
node agentops-cli/src/index.js product audit --live --last 24h --require-rows --require-visual --json
```

The visual gate requires authenticated Azure Managed Grafana pages to render. A Microsoft sign-in page does not count as dashboard proof.
