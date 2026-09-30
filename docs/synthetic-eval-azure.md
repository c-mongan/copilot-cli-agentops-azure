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
  --run-id <observed-run-id> --allow-content --synthetic

agentops azure-ingest plan --dir <private-dir> --content-only --allow-content --json
```

The export includes user prompts, tool arguments, tool results and assistant answers. It carries `CaptureMode=full`, `RedactionStatus=synthetic_unredacted`, session ID, the explicit observed run ID, model, timestamps and content hash. Without `--run-id`, `RunId` defaults to the session ID for older workflows. Missing trace IDs are left empty instead of invented. It omits system messages. Output creation refuses to overwrite an existing file.

The content-only upload plan allows only `AgentOpsContent_CL`, requires an Azure Monitor ingestion endpoint and valid DCR ID, scans for obvious secrets, and limits one batch to 1 MiB. Upload remains dry-run until `--yes`. The Azure CLI write guard requires `AGENTOPS_AZURE_SUBSCRIPTION_ID` and `AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS`; content-only mode passes the chosen subscription explicitly without changing the machine's default Pay-As-You-Go subscription. The dedicated content DCR uses `transformKql: 'source'` as an explicit pass-through; keep it aligned with the incoming stream and table columns when changing the schema.

## Production boundary

The EVAL workspace uses Entra authentication, but its ingestion and query endpoints are public network endpoints. The signed-in user has a DCR-scoped Monitoring Metrics Publisher assignment. After role propagation, Azure accepted synthetic detail and Kusto readback verified it. A 30 September same-run check returned nine rows, including six tool argument/result rows with IDs that exactly join to three native tool calls' start/completion events; the Node script root and named step also link to its successful Bash call as an explicitly inferred logical edge. The content-only plan found zero secret-pattern leaks. Table retention and DCR provisioning were read back; production reader restrictions, cost usage and deletion/recovery rules still need live verification. Rich content should enter this workspace only from approved synthetic or consented incident fixtures. Changing later redaction settings does not remove already ingested rows.

Azure returns HTTP acceptance before Kusto readback is available. After each schema change, wait for propagation, ingest a new unique synthetic run once, and verify both the rows and DCR `ColumnsDroppedCount` metric. In the 30 September test, two batches uploaded before the mapping was refreshed had one dropped column each. Updating the content DCR with the explicit pass-through preserved the immutable ID; the subsequent batch showed nine rows received, no dropped rows, and no dropped columns. Never resend a batch already accepted because Logs Ingestion can create duplicates.

To verify detail-to-tool correlation without displaying prompt or response text, query by one explicit run ID:

```kusto
let run = 'native_run_1790769821264_9d54f2254c';
let content = AgentOpsContent_CL
| where RunId == run and isnotempty(ToolCallId)
| summarize ContentKinds = make_set(ContentKind), ToolName = take_any(ToolName) by RunId, ToolCallId;
let events = AgentOpsEvents_CL
| where RunId == run and isnotempty(ToolCallId)
| summarize EventNames = make_set(EventName), Statuses = make_set(Status), ExitCodes = make_set(ExitCode) by RunId, ToolCallId;
content | join kind=leftouter events on RunId, ToolCallId
```

The existing rich transcript Grafana panel assumes the content table is in its datasource's workspace. With an isolated EVAL workspace, configure a separate datasource or cross-workspace query; that connection is not yet implemented.

On 29 September 2026, a synthetic Copilot CLI run with an instrumented Python skill script exported ten content rows. The content-only plan passed schema and secret-pattern checks, Azure accepted the 6,693-byte upload, and a workspace query read back ten rows covering prompt, tool arguments, tool result, and response. That upload predates the explicit `--run-id` option and has `RunId` equal to the session ID, so it does not join the script's separate run ID in Azure.

A separate metadata-only export from that run produced 46 rows for `AgentOpsSpans_CL`. Azure accepted the batch and DCR metrics showed 46 rows received, zero dropped, and output to the table. A Log Analytics query later read back all 46 rows for `synthetic-run-20260929-3`: 8 native-session links, 3 script logical links, and 35 native span events. A corrected 10-row content export using that explicit run ID was also uploaded. A KQL join on `RunId` and `SessionId` returned both tables' expected counts and link types. This verifies one Azure-backed synthetic skill/reference/Python-script path; MCP, spawned subagents, and a complete cloud waterfall remain unverified.

Sources: [GitHub Copilot CLI MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [Azure Logs Ingestion API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview), [Azure daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap), [Log Analytics access](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-access).
