# Synthetic EVAL content in Azure

This is an opt-in development path for invented/public fixtures. It is separate from the normal metadata-only Collector route and does not change the existing `appi-copilot-agentops-dev` resource.

```text
synthetic Copilot session events
  -> explicit local content export (0600 file)
  -> 1 MiB-reviewed batch + secret-pattern scan
  -> Entra-authenticated Logs Ingestion API
  -> isolated EVAL DCR -> AgentOpsContent_CL (7-day retention)
```

## Prepare and inspect

The [subscription Bicep template](../infra/bicep/eval-content-subscription.bicep) creates an EVAL resource group in North Europe, a Log Analytics workspace with a 1 GB/day safety cap, a 7-day `AgentOpsContent_CL` table, and one DCE/DCR. The workspace default retention is 30 days, the SKU minimum; the content table has its own seven-day setting. It does not repoint Application Insights. The isolated resources were deployed and read back on 29 September 2026. The template is not a production access policy; inherited subscription RBAC still applies.

```bash
az deployment sub what-if \
  --subscription 0222a208-955a-45fd-b6d8-ca4704421bf0 \
  --location northeurope \
  --template-file infra/bicep/eval-content-subscription.bicep \
  --parameters location=northeurope environmentName=dev
```

## Export and validate one run

```bash
agentops copilot-session export-content <synthetic-session-id> \
  --output <private-dir>/AgentOpsContent_CL.jsonl \
  --allow-content --synthetic

agentops azure-ingest plan --dir <private-dir> --content-only --allow-content --json
```

The export includes user prompts, tool arguments, tool results and assistant answers. It carries `CaptureMode=full`, `RedactionStatus=synthetic_unredacted`, session/run ID, model, timestamps and content hash. Missing trace IDs are left empty instead of invented. It omits system messages. Output creation refuses to overwrite an existing file.

The content-only upload plan allows only `AgentOpsContent_CL`, requires an Azure Monitor ingestion endpoint and valid DCR ID, scans for obvious secrets, and limits one batch to 1 MiB. Upload remains dry-run until `--yes`. The Azure CLI write guard requires `AGENTOPS_AZURE_SUBSCRIPTION_ID` and `AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS`; content-only mode passes the chosen subscription explicitly without changing the machine's default Pay-As-You-Go subscription.

## Production boundary

The EVAL workspace uses Entra authentication, but its ingestion and query endpoints are public network endpoints. The signed-in user has a DCR-scoped Monitoring Metrics Publisher assignment. After role propagation, Azure accepted one four-row synthetic upload; a later table query read back the prompt, tool arguments, tool result, and response, including nonempty rich text fields. Table retention and DCR provisioning were read back; cost usage and deletion/recovery rules still need live verification. Rich content should enter this workspace only from approved synthetic or consented incident fixtures. Changing later redaction settings does not remove already ingested rows.

The existing rich transcript Grafana panel assumes the content table is in its datasource's workspace. With an isolated EVAL workspace, configure a separate datasource or cross-workspace query; that connection is not yet implemented.

Sources: [GitHub Copilot CLI MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [Azure Logs Ingestion API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview), [Azure daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap), [Log Analytics access](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-access).
