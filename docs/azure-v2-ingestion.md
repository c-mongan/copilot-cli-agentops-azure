# Azure V2 Ingestion

The V2 dashboards expect Log Analytics custom tables named `AgentOps*_CL`.

Local generation and rollup commands write the same shape as JSONL first. That gives you a privacy check before anything leaves the machine.

## Validate Local Tables

```bash
agentops demo verify --runs 50 --json
agentops azure-ingest plan --dir .agentops/demo/latest --json
```

The plan checks:

- every expected `AgentOps*_CL.jsonl` file
- required columns for each table
- inferred Azure column types for DCR stream declarations
- `SchemaVersion` coverage, missing-row warnings, and mismatches from expected schema version `2`
- schema migration policy actions for missing, legacy, or unsupported newer versions
- stream names such as `Custom-AgentOpsRunSummary_CL`
- row counts for run summary and event tables
- content-like and secret-like leak patterns
- `AgentOpsContent_CL` rows are absent unless you pass `--allow-content`
- optional `AgentOpsRecommendations_CL` rows contain only metadata, actions, pattern ids, eval buckets, benchmark summaries, change-target refs, validation steps, and dashboard counts
- optional `AgentOpsAlertHandoffs` shared artifacts contain only metadata-only alert owner, rule, session, evidence-query, config-change count, operator-step, and guardrail context

It does not create Azure resources or upload data. For metadata-only saved-view, recommendation, and alert-handoff exports, `agentops azure-ingest upload-plan --dir <export-dir> --account <storage-account>` prints reviewed Azure Blob upload commands for the optional shared store.

## Azure Path

Use Azure Monitor Logs Ingestion API with a Data Collection Rule:

1. Create one custom Log Analytics table per `AgentOps*_CL` table.
2. Create one DCR stream per table using the columns reported by `agentops azure-ingest plan`.
3. Send each JSONL row to the matching DCR stream.
4. Import the V2 dashboard pack from `grafana/dashboards/v2/`.

## Shared Review Artifacts

Set `deploySharedStore=true` to create an optional Azure Blob container for metadata-only `AgentOpsRecommendations_CL.jsonl`, `AgentOpsSavedViews_CL.jsonl`, and `AgentOpsAlertHandoffs.jsonl` exports. The storage account disables public blob access and shared-key access; upload plans use Entra-backed `az storage blob upload --auth-mode login`.

Set `deployActioner=true` with `deploySharedStore=true` to enable the hosted write API. The Function App uses managed identity and writes one metadata-only row per blob at `/api/shared-store/{table}/{id}`. It accepts only `AgentOpsRecommendations_CL`, `AgentOpsSavedViews_CL`, and `AgentOpsAlertHandoffs` rows and rejects content-like payloads. Open `/api/shared-store/editor` for the browser-native metadata editor that submits to the same validated API.

Set `AGENTOPS_ASSISTANT_URL` on the Function App to enable `/api/ask-agentops` launch links. Without it, the route still renders a browser page with a metadata-only prompt for the selected run, session, or trace.

Preview the upload commands before sharing artifacts:

```bash
agentops azure-ingest upload-plan \
  --dir .agentops/shared/latest \
  --account <storage-account> \
  --container agentops-shared \
  --prefix team-a/latest
```
5. Run `agentops validate-azure --last 24h`.

The dashboards never require raw prompts, responses, file contents, tool arguments, or tool results. If you intentionally enable content capture, keep it in `AgentOpsContent_CL`, use `agentops azure-ingest plan --allow-content`, and expose it only through a separate, access-controlled workspace/dashboard.

## Useful Commands

```bash
agentops dashboard validate
agentops dashboard links-check
agentops validate-azure --last 24h
agentops open
```

If the plan reports a privacy failure, fix the local producer or collector before configuring cloud ingestion.

If the plan reports schema-version warnings, keep the export local until the producing collector stamps each `AgentOps*_CL` row with `SchemaVersion: "2"`. Legacy version `1` rows and missing versions are treated as migration-required warnings with concrete regeneration guidance. Newer unsupported versions fail the plan; upgrade the AgentOps CLI and Grafana dashboard pack before ingesting them. The Collector Health dashboard also shows schema coverage by table so mixed or legacy exports are visible after ingestion.
