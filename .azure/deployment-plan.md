# Azure deployment plan

> Status: Isolated synthetic EVAL resources deployed and read back. The original main template remains blocked. Synthetic content ingestion is awaiting DCR role propagation and query readback.

Date: 2026-09-29

## Target and intent

- Subscription: Visual Studio Enterprise Subscription, `0222a208-955a-45fd-b6d8-ca4704421bf0`. Always pass this ID explicitly; the CLI's current default is Pay-As-You-Go.
- Region: North Europe, matching the existing resources.
- Existing resource group: `rg-copilot-agentops-dev`.
- Existing Application Insights: `appi-copilot-agentops-dev`, connected to managed workspace `managed-appi-copilot-agentops-dev-ws` in resource group `ai_appi-copilot-agentops-dev_dc946c51-1650-47cf-9b62-2877e54afac4_managed`.
- Classification: synthetic development/EVAL only. No work agents or work data in this subscription workflow.

## Desired first cloud slice

1. Preserve the existing Application Insights connection and Collector metadata path.
2. Add a separately controlled rich EVAL path for synthetic prompts, tool arguments, and results, with explicit run labels and short retention. `infra/bicep/eval-content-subscription.bicep` creates a separate resource group and 7-day content table; `copilot-session export-content` produces local rows.
3. Limit each reviewed content upload batch to 1 MiB and set a 1 GB/day workspace emergency cap. Inspect usage before considering any automated ingestion. Avoid Managed Grafana, Function App, Key Vault, and other advanced services until needed.
4. Keep a rollback path: stop the EVAL exporter, retain local synthetic fixtures, and remove only resources created by this plan after review.

## Current evidence and deployment hazard

- Read-only Azure CLI inspection on 2026-09-29 found Application Insights and its managed Log Analytics workspace. The workspace has 30-day retention, `PerGB2018`, public ingestion and query endpoints, and `dailyQuotaGb: -1` (unlimited). The Application Insights component reports 90-day retention. `Usage` returned no rows for the prior seven days; that does not prove zero billing or no older data.
- The current `infra/bicep/main.bicep` creates a *new* `law-copilot-agentops-dev` and points the existing Application Insights component at it. Applying it as-is could move telemetry to a different workspace. Do not deploy that template against this resource group before an explicit migration design and what-if review.
- An explicit-subscription Azure what-if on 2026-09-29 confirmed `Create` for `law-copilot-agentops-dev` and `Modify` for `appi-copilot-agentops-dev`. The template is therefore blocked from deployment against the existing resource group in its current form.
- The isolated EVAL what-if showed exactly five Create actions: resource group, workspace, content table, DCE and DCR. It showed no Modify/Delete actions. Both resource providers are Registered. The subscription currently has two Log Analytics workspaces; the Azure Quota API returned BadRequest for Microsoft.OperationalInsights, so a numeric workspace quota is not verified. This is a small new resource count, and deployment still needs live capacity confirmation.
- The subscription has two direct assignments at subscription scope, one Owner and one Contributor (both User). They will inherit access to the EVAL resource group. This development environment is therefore **not** a private enterprise tenant boundary; only invented/public fixtures may be uploaded here.
- Microsoft Retail Prices API for North Europe lists Analytics Logs ingestion at USD 2.76/GB (with a separate zero-price free-benefit meter). The 1 GB/day cap could still permit roughly USD 82.80 in 30 days before any applicable free allowance or credit. The actual initial synthetic batch is 3,021 bytes; no automatic exporter is configured. A daily cap is an emergency brake, not a cost budget.
- The existing `azure.yaml` has a postprovision Grafana dashboard import hook. Do not use `azd provision` until that hook and the selected resource topology are reviewed.

## Validation and execution gates

- Local completed: focused CLI tests; Bicep compile; static check; synthetic run waterfall and four-row content export; content-only plan and secret-pattern scan.
- Cloud read-only completed: explicit-subscription inventory, existing ingestion cap/retention, direct subscription RBAC, and isolated-template what-if. Existing managed workspace `Usage` returned no rows for the past seven days.
- Cloud validation completed: subscription-scope template validation succeeded. First deployment attempt rejected a 7-day **workspace** retention setting: PerGB2018 requires a 30-day workspace default. The template now sets the workspace default to 30 days while the `AgentOpsContent_CL` table remains at seven days. A second what-if showed three creates and two deploys after the partially created resource group and DCE; the corrected deployment succeeded.
- Cloud readback completed: the separate EVAL workspace reports 30-day default retention and 1 GB/day cap; the Analytics content table reports seven-day interactive and total retention; DCR provisioning succeeded. The signed-in user was assigned `Monitoring Metrics Publisher` on this DCR only. The first upload was forbidden before the role assignment; the immediate retry was still forbidden while Azure RBAC propagated. No content ingestion has yet been confirmed.
- Azure confirms the signed-in user's object ID matches the monitoring-audience token's `oid`, and the DCR-scoped role assignment is listed. [Microsoft's ingestion tutorial](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/tutorial-logs-ingestion-portal) says role propagation can take up to 30 minutes and returns HTTP 403 before it takes effect.
- Cloud next step: upload only the reviewed 3,021-byte synthetic batch after the new role is effective, then query `AgentOpsContent_CL` and read back four rows. Do not run `azd provision` or the original `main.bicep` against the existing resource group.

The original main template remains blocked because it would repoint the existing Application Insights component.
