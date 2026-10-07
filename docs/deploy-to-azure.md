# Deploy to Azure

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fc-mongan%2Fcopilot-cli-agentops-azure%2Fmain%2Finfra%2Fazuredeploy.json)

The button opens the Azure portal's custom deployment page with
[`infra/azuredeploy.json`](../infra/azuredeploy.json). That file is ARM JSON
compiled from [`infra/bicep/azuredeploy.bicep`](../infra/bicep/azuredeploy.bicep).
Deploy it into a new or empty resource group. The narrowed table schema is not
a migration for existing legacy tables; use a fresh workspace for this path.

## What it deploys

```text
resource group
├── Log Analytics workspace   law-<baseName>-<env>   30-day retention, 1 GB/day cap
├── Data collection endpoint  dce-<baseName>-<env>
├── Data collection rule      dcr-<baseName>-<env>-v2
├── 11 metadata custom tables AgentOpsEvents_CL, AgentOpsSpans_CL, AgentOpsRunSummary_CL, ...
├── Role assignment           Monitoring Metrics Publisher on the DCR, optional, explicit opt-in
├── Azure Workbook            "Copilot CLI AgentOps (<env>)"            (deployWorkbook)
└── Consumption budget        budget-<baseName>-<env>, 5 per month     (deployBudget)
```

This entry point always enables **metadata only**. A reviewed positive column
allowlist controls both the table schemas and DCR projections. File diffs, all
dynamic containers (including nested evidence and benchmark artifacts), narrative
text, commands, reference paths and endpoint URLs are excluded. Unknown future
columns cannot be retained unless explicitly added to the policy. Agent, tool,
script and model identifiers remain metadata; do not place content or secrets
in those identifiers. The broader developer ingestion template retains its
legacy schema and is not covered by this button-specific guarantee. Prompt and response content tables
(`eval-content.bicep`) are not part of this template. Application Insights,
Managed Grafana, Key Vault, Function Apps and action groups are not deployed.
The `TELEMETRY_CONTENT` output is always `metadata-only`.

## Parameters

| Parameter | Default | Notes |
|---|---|---|
| `baseName` / `environmentName` | `copilot-agentops` / `dev` | Used in every resource name |
| `retentionInDays` | `30` | 30-730 |
| `dailyIngestionCapGb` | `1` | Log Analytics daily cap; cost safeguard; collection may stop after the threshold is exceeded and excess ingestion can still be billed |
| `deployWorkbook` | `true` | Workbook bound to the new workspace |
| `grantDeployerUpload` | `false` | Explicit opt-in to grant you Monitoring Metrics Publisher on the DCR. Needs Owner or User Access Administrator on the resource group |
| `allowPublicNetworkAccess` | `false` | Explicit opt-in for public DCE access and workspace ingestion/query access |
| `uploaderPrincipalId` / `uploaderPrincipalType` | `''` / `User` | Providing a nonblank ID explicitly opts into an RBAC grant for an extra uploader; also requires role-assignment permissions |
| `deployBudget` | `true` | Resource-group monthly budget |
| `monthlyBudgetAmount` | `5` | In your **billing currency** (5 = €5 only when you are billed in EUR) |
| `budgetAlertEmail` | `''` | Blank: alerts at 80% and 100% of actual spend go to effective **Owners at the resource-group budget scope**; no action group is created. Set an address to email it instead |
| `budgetStartDate` | first day of the current month | Azure does not allow changing a budget's start date. On redeploy, pass the original value or set `deployBudget=false` |

The budget only alerts. It does not stop spending. The daily ingestion cap is
not a precise spending limit; collection can stop after the threshold is exceeded.
Keep the CLI byte cap as an additional safeguard.

## After deployment

No upload role is granted and public access is disabled by default. Before using
the commands below, deliberately enable `grantDeployerUpload=true` (or supply
`uploaderPrincipalId`, or use a separately authorized sender). For public uploads
and queries, also enable `allowPublicNetworkAccess=true`. Otherwise configure
Azure Monitor Private Link and private connectivity separately; this template
does not create private endpoints.

The deployment outputs include the ingestion endpoint and DCR immutable ID.
Upload a run with the CLI, using an explicit target, an approved subscription and
a non-zero daily byte cap:

```bash
export AGENTOPS_AZURE_SUBSCRIPTION_ID="<subscription-id>"
export AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS="$AGENTOPS_AZURE_SUBSCRIPTION_ID"
export AGENTOPS_LOGS_INGESTION_ENDPOINT="<AGENTOPS_LOGS_INGESTION_ENDPOINT output>"
export AGENTOPS_DCR_IMMUTABLE_ID="<AGENTOPS_DCR_IMMUTABLE_ID output>"
export AGENTOPS_MAX_PUBLISH_BYTES_PER_DAY=5000000

agentops copilot-session launch --repo /path/to/repo --upload --yes --json -- -p "Run the tests"
```

Or upload an existing run directory:

```bash
agentops azure-ingest logs-upload --dir ~/.agentops/runs/<run-id> --events-only \
  --endpoint "$AGENTOPS_LOGS_INGESTION_ENDPOINT" --dcr-immutable-id "$AGENTOPS_DCR_IMMUTABLE_ID" \
  --max-publish-bytes-per-day 5000000 --yes --json
agentops azure-ingest logs-upload --dir ~/.agentops/runs/<run-id> --spans-only \
  --endpoint "$AGENTOPS_LOGS_INGESTION_ENDPOINT" --dcr-immutable-id "$AGENTOPS_DCR_IMMUTABLE_ID" \
  --max-publish-bytes-per-day 5000000 --yes --json
```

The role assignment can take a few minutes to apply. The first rows in new
tables can take 5-20 minutes to appear. Then read them back:

```bash
az monitor log-analytics query -w "<LOG_ANALYTICS_WORKSPACE_ID output>" -t P1D --analytics-query \
  "union withsource=T AgentOpsEvents_CL, AgentOpsSpans_CL | where RunId == '<run-id>' | summarize rows=count() by T"
```

Open the Workbook from the resource group, or use the
[KQL query library](kql-query-library.md).

## Command-line equivalent

```bash
az group create -n <rg> -l <region>
az deployment group what-if -g <rg> --template-file infra/azuredeploy.json
az deployment group create  -g <rg> --template-file infra/azuredeploy.json \
  -p budgetAlertEmail=you@example.com
```

## Rebuilding the template

Use pinned Bicep **0.38.33**. Edit the Bicep or column policy, then recompile and
commit both source and generated files. CI checks normalized output for drift:

```bash
az bicep build --file infra/bicep/azuredeploy.bicep --outfile infra/azuredeploy.json
BICEP_CLI=~/.azure/bin/bicep node scripts/check-deploy-to-azure-template.js
node --test agentops-cli/test/deploy-to-azure-template.test.js
```

The button reads `infra/azuredeploy.json` from the `main` branch.

## azd

`azure.yaml` points `azd` at `infra/bicep/main.bicep`, the larger developer
template, not at this button template. Use `azd` only for a **new, empty**
resource group: `main.bicep` creates its own workspace and Application
Insights component and must not be pointed at an existing deployment (see
[enterprise deployment](enterprise-deployment.md)).

Verified on 2026-10-07 with azd 1.19.0 in a throwaway resource group in
Sweden Central, which was then deleted:

| Step | Result |
|---|---|
| `azd provision` (default parameters) | Succeeded in 1 min 13 s |
| Resources | Log Analytics workspace and Application Insights only |
| Workspace settings | 30-day retention, 2 GB daily cap, PerGB2018 |
| `postprovision` hook | Skipped cleanly: Managed Grafana is disabled by default |
| `azd down --force --purge` | Succeeded in 1 min 21 s; resource group gone |

`azd provision` deploys infrastructure only. There is no app to deploy, so
`azd deploy` has nothing to do. The default `azd` path does not create the
metadata-only custom tables or the DCR; use the button or the
`az deployment group` commands above for those.

## Historical pilot evidence (2026-10-07, before privacy/access hardening)

The previous revision was tested end to end in a throwaway resource group in North Europe, which was then deleted.

| Step | Result |
|---|---|
| `az bicep build` (Bicep 0.38.33) | Compiled with no errors |
| `az deployment group what-if` | 17 creates: workspace, 11 tables, DCE, DCR, role assignment, Workbook, budget |
| `az deployment group create` | Succeeded in 1 min 12 s; outputs `AGENTOPS_TABLE_COUNT=11`, `TELEMETRY_CONTENT=metadata-only` |
| Budget | 5.0 EUR monthly, notifications to the Owner role, no emails, no action group |
| Real Copilot CLI session | `copilot-session launch --upload --yes`: 14 events, 65 spans, exit 0. Upload correctly refused until a daily byte cap was set |
| `azure-ingest logs-upload` (events, spans) | Accepted: 14 + 65 rows |
| KQL readback (about 12 min after upload) | `AgentOpsEvents_CL` 14 rows, `AgentOpsSpans_CL` 65 rows for the run: exact match |
| Cleanup | `az group delete --yes --no-wait`; resource group went to `Deleting` |

Workspace, subscription and DCR identifiers are omitted. These pilot results do
not validate the narrowed schema or current disabled-access defaults. The
follow-up was validated offline with Bicep compilation, generated-template
comparison, focused regression tests and static checks; no Azure deployment
was performed for it.
