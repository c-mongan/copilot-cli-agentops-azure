# Enterprise Pilot Guide

This guide is for a small opt-in internal pilot. It is not a claim that the project is approved for broad enterprise rollout.

## Pilot Boundary

Use a dedicated Azure subscription or resource group:

```text
Pilot users
    |
    v
Local AgentOps wrapper
    |
    v
127.0.0.1 OpenTelemetry Collector
    |
    v
Dedicated Azure resource group
    |
    +--> Log Analytics Workspace
    +--> Application Insights
    +--> Azure Managed Grafana
    +--> Key Vault
```

Keep the pilot opt-in. Do not auto-install the wrapper across a fleet until privacy, security, and operations owners have signed off.

## Data Classification

Default telemetry is intended to be metadata-only operational telemetry.

```text
Allowed by default:
  session ids, operation names, tool names, model names, durations,
  success/failure, token counts, estimated cost/AIU, agent/skill/MCP labels,
  hashed repo or file identifiers where configured

Blocked by default:
  prompts, completions, system instructions, code contents, file contents,
  tool arguments, tool results, request bodies, response bodies, full URLs

Do not use without extra review:
  regulated data, customer data, incident data, credentials, source code,
  raw prompts, raw completions, tool payload bodies
```

The control that matters most is the local collector scrub path. The daily Log Analytics cap is only a spike guardrail.

## Required Pilot Settings

Run these before deploying or publishing a pilot package:

```bash
node agentops-cli/src/index.js validate-enterprise
AGENTOPS_DEPLOYMENT_PROFILE=team ./scripts/azure-what-if.sh
```

Recommended defaults:

```text
deploymentProfile          team
logRetentionDays           0, profile default 30
dailyIngestionCapGb        0, profile default 2 GB
deployActioner             false
deployAlerts               false
enableAlerts               false
alertActionGroupResourceIds []
grafanaPublicNetworkAccess Enabled until private access is tested
grafanaZoneRedundancy      Disabled until region/SKU support is confirmed
deployRbacAssignments      false until Entra group IDs are approved
deployBudget               false until a budget contact list is approved
```

## Acceptance Checks

Before inviting pilot users, run one real read-only Copilot command, one custom-agent/MCP/skill pass, and one attribution smoke:

```bash
AGENTOPS_EXPERIMENT=pilot-readiness \
copilot --name agentops-pilot-readiness --allow-all-tools --allow-all-paths \
  -p "Do not edit files. Run agentops status and summarize the setup in 5 bullets."

AGENTOPS_EXPERIMENT=pilot-readiness-custom-agent \
copilot --name agentops-pilot-kitchen-sink --plugin-dir plugin \
  --agent agentops-kitchen-sink-smoke --allow-all-tools --allow-all-paths \
  -p "Do not edit files. Use agentops-live-triage, agentops-attribution, Azure Monitor MCP, and the local post-tool-failure hint script. Summarize only counts."

agentops attribution-smoke --wait 5m --poll 15s
agentops validate-azure --last 2h
```

Then verify these dashboards:

```text
Overview          real runs, tool calls, token/cost counters
Sessions          latest run rows with session ids
Traces / Spans    raw span rows for invoke_agent, chat, execute_tool
Tools & MCP       tool usage and MCP rows when MCP is configured
Attribution       real custom-agent rows, loaded skill context, inferred MCP rows, and attribution-smoke direct dimensions
Runtime Events    context, hook, skill, and policy events when emitted
Safety & Policy   no content capture signals in the default secure posture
Data Quality      token rollup, schema fields, collector health, and smoke ingestion checks
```

Empty Safety/Policy, Runtime, Alert Tuning, or Experiments panels are acceptable when no matching policy, hook, alert, or benchmark signal occurred. Empty Overview, Sessions, Traces, Tools, Attribution, or Data Quality panels after a real run should be treated as a setup issue.

## Access Model

Use Microsoft Entra security groups, not individual users.

```text
agentops-observers
  Log Analytics Data Reader on the workspace
  Grafana Viewer on the Managed Grafana resource

agentops-operators
  Monitoring Reader on the resource group
  Grafana Editor on the Managed Grafana resource

agentops-admins
  Grafana Admin on the Managed Grafana resource
  Keep empty unless a named break-glass group is required
```

The optional `infra/bicep/rbac.bicep` module assigns these roles when `deployRbacAssignments=true`. The deploying identity needs `Microsoft.Authorization/roleAssignments/write`, usually through User Access Administrator or Owner at the resource group scope.

Example what-if with approved group object IDs:

```bash
AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS=true \
AGENTOPS_OBSERVER_PRINCIPAL_IDS='["00000000-0000-0000-0000-000000000001"]' \
AGENTOPS_OPERATOR_PRINCIPAL_IDS='["00000000-0000-0000-0000-000000000002"]' \
./scripts/azure-what-if.sh
```

After the what-if is approved, deploy the same parameter set intentionally:

```bash
AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS=true \
AGENTOPS_OBSERVER_PRINCIPAL_IDS='["00000000-0000-0000-0000-000000000001"]' \
AGENTOPS_OPERATOR_PRINCIPAL_IDS='["00000000-0000-0000-0000-000000000002"]' \
./scripts/azure-deploy-enterprise-pilot.sh
```

Role references:

- Azure Monitor built-in roles: https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/monitor
- Azure Managed Grafana access: https://learn.microsoft.com/azure/managed-grafana/how-to-manage-access-permissions-users-identities
- Azure production hardening checklist: `docs/azure-production-hardening.md`

## Grafana Network And Availability

For early pilots, public Managed Grafana access with Entra/RBAC can be acceptable. For production or regulated environments, make the network posture an explicit review item:

```bash
AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS=Disabled \
AGENTOPS_GRAFANA_ZONE_REDUNDANCY=Enabled \
./scripts/azure-what-if.sh
```

Only disable public access after private connectivity, DNS, and operator access have been tested.

## Alert Routing

AgentOps scheduled query rules are disabled by default and should stay that way until thresholds are tuned from real traffic.

When alerts are ready, route them through approved Azure Monitor action groups:

```bash
AGENTOPS_DEPLOY_ALERTS=true \
AGENTOPS_ENABLE_ALERTS=true \
AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS='["/subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/<name>"]' \
./scripts/azure-what-if.sh
```

## Cost Guardrails

Cost controls are layered:

```text
Collector scrub/filtering
    |
    v
Log Analytics daily cap
    |
    v
Short retention
    |
    v
Optional Azure Consumption budget
```

For a pilot, use a team distribution list for budget notifications:

```bash
AGENTOPS_DEPLOY_BUDGET=true \
AGENTOPS_MONTHLY_BUDGET_AMOUNT=100 \
AGENTOPS_BUDGET_CONTACT_EMAILS='["agentops-pilot-owners@example.com"]' \
./scripts/azure-what-if.sh
```

Then deploy with the same environment variables:

```bash
AGENTOPS_DEPLOY_BUDGET=true \
AGENTOPS_MONTHLY_BUDGET_AMOUNT=100 \
AGENTOPS_BUDGET_CONTACT_EMAILS='["agentops-pilot-owners@example.com"]' \
./scripts/azure-deploy-enterprise-pilot.sh
```

Budget references:

- Azure budget resource: https://learn.microsoft.com/azure/templates/microsoft.consumption/budgets
- Log Analytics daily cap: https://learn.microsoft.com/azure/azure-monitor/logs/daily-cap

## Rollback

Disable collection locally:

```bash
agentops experimental disable-shadow
agentops collector stop
```

Remove the local shim:

```bash
agentops uninstall
```

Stop Azure ingestion without deleting historical data:

```bash
agentops collector stop --mode auto
```

Delete the pilot resource group only after the owner confirms that retention/export requirements are satisfied:

```bash
az group delete --name <pilot-resource-group>
```

## Review Checklist

- Pilot owner named.
- Dedicated subscription or resource group selected.
- Data classification accepted.
- `agentops validate-enterprise` passes.
- What-if reviewed.
- Entra group owners approved.
- Budget owner and contact list approved.
- Retention approved.
- Rollback owner named.
- Broad deployment explicitly out of scope.
