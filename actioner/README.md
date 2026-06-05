# Actioner

The actioner is an opt-in Azure Functions package for metadata-only AgentOps workflow APIs. It includes:

- `AlertActioner`: turns an Azure Monitor alert payload into a metadata-only review packet with run links, alert history KQL, action-plan evidence, and an optional preview-only GitHub route plan.
- `AskAgentOps`: renders a metadata-only assistant launch packet/page for a run, session, or trace, including a first-party response draft with evidence, root-cause candidates, validation, and rollback metadata.
- `SharedStoreWrite`: accepts one metadata-only recommendation or saved-view row and writes it to the shared Blob artifact store.
- `SharedStoreEditor`: renders a small browser form for creating metadata-only recommendation or saved-investigation rows through `SharedStoreWrite`.

Local handler contract:

```bash
node -e 'const { buildActionerReview } = require("./actioner"); console.log(JSON.stringify(buildActionerReview({ data: { essentials: { alertRule: "failed-spans" }, customProperties: { "agentops.session": "session-123", "agentops.owner": "agentops-oncall" } } } ), null, 2))'
```

The actioner expects Azure Monitor common alert schema payloads with:

- `data.essentials.alertRule`: one of `high-aiu`, `cost-spike`, `runaway-tool-loop`, `failed-spans`, or `content-capture`
- `data.customProperties["agentops.session"]`: Copilot/AgentOps conversation id
- optional `data.customProperties["agentops.owner"]`
- optional `data.customProperties["agentops.service"]`
- optional `data.customProperties["agentops.last"]`

If required metadata is missing, it returns `needs-review` and does not create a route plan.

## Ask AgentOps Launcher

Use the hosted launcher to open an assistant with run-scoped metadata already assembled. It does not call an LLM by itself; it returns a safe prompt, a first-party metadata-only response draft, and, when `AGENTOPS_ASSISTANT_URL` is configured, an assistant launch URL with the prompt encoded. POST bodies can include schema-valid metadata-only `recommendation`, `saved_view`, and `alert_handoff` packets. The page links recommendation `ChangeTargetRefs`, benchmark run id, artifact file paths, `ExpectedMetricMovement`, `BeforeTelemetry`, `AfterTelemetry`, `ObservedMetricMovement`, validation steps, rollback condition, saved-view query/tag/annotation context, and alert handoff owner/query/config-change context without rendering raw diff content. When recommendation evidence is present, the page also shows a guided review section with approve/reject controls that write an `OperatorReview` metadata object back through the shared-store API when configured, plus an `agentops recommend action-plan --recommendation-id <id>` handoff for the guarded patch/benchmark workflow.

HTTP route:

```text
GET  /api/ask-agentops?run_id=<run>&session_id=<session>&trace_id=<trace>&last=24h
POST /api/ask-agentops
```

Supported metadata fields are `run_id`, `session_id`, `trace_id`, `dashboard_url`, `selected_event`, `benchmark_run_id`, `recommendation`, `saved_view`, `alert_handoff`, and `last`. Add `format=json` or send `Accept: application/json` to receive the packet instead of the browser page.

## Shared Store Write API

Deploy with both `deployActioner=true` and `deploySharedStore=true` to let the Function App write metadata-only rows to the shared Blob container through managed identity. The deployment grants the Function App `Storage Blob Data Contributor` on the shared storage account and configures the blob output binding with `AgentOpsSharedStorage__blobServiceUri`.

HTTP route:

```text
GET  /api/shared-store/editor
POST /api/shared-store/{table}/{id}
```

Open `/api/shared-store/editor` in a browser to create a recommendation or saved investigation without leaving the hosted AgentOps workflow. The editor submits JSON to the same write API and receives the same privacy validation response.

Allowed `table` values:

- `AgentOpsRecommendations_CL`
- `AgentOpsSavedViews_CL`

Body shape:

```json
{
  "owner": "agentops-oncall",
  "row": {
    "TimeGenerated": "2026-06-03T12:00:00.000Z",
    "SavedViewId": "view-123",
    "Name": "latest-risk",
    "Url": "https://grafana.example/d/agentops-session-detail",
    "QueryHash": "query_123"
  }
}
```

The write API rejects unsupported tables, missing required columns, invalid recommendation rows, and content-like or secret-like payloads. It writes one JSON blob per accepted row under:

```text
<container>/<prefix>/<table>/<id>.json
```

The related CLI review workflow is:

```bash
node agentops-cli/src/index.js alert history --rule <name> --last 24h
node agentops-cli/src/index.js alert detail --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert tune-plan --last 14d --rule <name> --owner <team-or-person>
node agentops-cli/src/index.js alert threshold-simulate --rule <name> --threshold <number> --owner <team-or-person> --last 14d
node agentops-cli/src/index.js alert threshold-patch --rule <name> --threshold <number> --owner <team-or-person> --last 14d
node agentops-cli/src/index.js alert policy --owner <team-or-person> --service <service-name> --timezone UTC
node agentops-cli/src/index.js alert action-plan --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert open --rule <name> --session <conversation-id> --last 24h
node agentops-cli/src/index.js alert review --rule <name> --session <conversation-id> --owner <team-or-person> --last 24h
node agentops-cli/src/index.js alert export --rule <name> --session <conversation-id> --output .agentops/alerts/<rule>.json --last 24h
node agentops-cli/src/index.js alert handoff --rule <name> --session <conversation-id> --owner <team-or-person> --output .agentops/alerts/<rule>-handoff.json --last 24h
node agentops-cli/src/index.js alert route-plan --rule <name> --session <conversation-id> --owner <team-or-person> --target github-issue --output .agentops/alerts/<rule>-route.json --last 24h
node agentops-cli/src/index.js alert route-github --repo <owner/repo> --rule <name> --session <conversation-id> --owner <github-login> --last 24h
node agentops-cli/src/index.js alert route-azure-devops --org <url> --project <name> --rule <name> --session <conversation-id> --owner <user> --last 24h
node agentops-cli/src/index.js alert action-group-plan --resource-group <rg> --name <action-group-name> --short-name <short> --owner <team-or-person> --email <address>
node agentops-cli/src/index.js alert route-action-group --resource-group <rg> --scheduled-query <name> --action-group <id> --rule <name> --session <conversation-id> --owner <team-or-person> --last 24h
node agentops-cli/src/index.js incident timeline --artifact .agentops/alerts/<rule>.json --output .agentops/incidents/<incident>.json
```

The history and detail commands provide metadata-only KQL and session links for alert review. The open command turns a rule/session pair into Run Replay, Runs Explorer, session detail, content-viewer, and Azure Logs links. The review command bundles open, detail, action-plan, and export evidence into one metadata-only packet. The tune-plan command creates a proposal-only threshold-change artifact with Bicep patch targets and validation queries. The threshold-simulate command compares current and proposed alert-window counts with metadata-only KQL. The threshold-patch command previews a concrete `infra/bicep/alerts.bicep` diff for direct alert thresholds without editing files. The policy command creates ownership, dedupe, and manual-escalation metadata. The action-plan command creates a deterministic JSON plan for a GitHub issue or Azure DevOps work item. The export command writes a durable metadata-only alert artifact. The handoff command bundles the alert detail, tune-plan, policy, resource-state placeholder, and incident timeline into one operator review packet with:

- alert rule and threshold metadata
- session Grafana link
- session KQL
- threshold evidence KQL
- ownership and escalation guardrails
- review guardrails

The Function handlers use the same safe alert/recommendation/saved-view primitives as the CLI. The route-plan command turns safe handoff context into preview-only GitHub Issue or Azure DevOps Work Item payloads. The action-group-plan command previews receiver setup for an Azure Monitor action group without creating it. The route-github, route-azure-devops, and route-action-group commands are dry-run by default and only create issues/work items or attach action groups when `--yes` is passed with destination config and an owner. The tune-plan, threshold-simulate, threshold-patch, review, policy, handoff, route-plan, action-group-plan, incident timeline, and HTTP actioner keep remediation as review placeholders; they do not edit alert thresholds or page anyone.

It must not call broad LLM tools, read unrelated secrets, mutate Azure resources broadly, or change repository files automatically.
