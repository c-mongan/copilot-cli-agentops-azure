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
- stream names such as `Custom-AgentOpsRunSummary_CL`
- row counts for run summary and event tables
- content-like and secret-like leak patterns
- `AgentOpsContent_CL` rows are absent unless you pass `--allow-content`
- optional `AgentOpsRecommendations_CL` rows contain only metadata, actions, pattern ids, eval buckets, benchmark summaries, change-target refs, validation steps, and dashboard counts

It does not create Azure resources or upload data.

## Azure Path

Use Azure Monitor Logs Ingestion API with a Data Collection Rule:

1. Create one custom Log Analytics table per `AgentOps*_CL` table.
2. Create one DCR stream per table using the columns reported by `agentops azure-ingest plan`.
3. Send each JSONL row to the matching DCR stream.
4. Import the V2 dashboard pack from `grafana/dashboards/v2/`.
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
