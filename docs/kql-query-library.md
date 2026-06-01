# KQL Query Library

This is the operator-facing index for AgentOps KQL.

## V2 Dashboard Queries

Reusable V2 query files live under `grafana/kql/`:

- `run-summary.kql`: one row per Agent Run.
- `runs-explorer.kql`: run list for Datadog-style exploration.
- `run-replay.kql`: ordered run timeline.
- `tool-risk.kql`: tool and MCP risk analysis.
- `privacy-signals.kql`: dropped/redacted content signals.
- `code-outcomes.kql`: PR, CI, merge, close, and revert outcomes.
- `evals.kql`: deterministic quality scores.
- `insights.kql`: anomaly and regression rows.
- `recommendations.kql`: metadata-only recommendation artifacts and insight-derived next actions.
- `collector-health.kql`: collector/export health.
- `content-viewer.kql`: optional prompt/response rows from `AgentOpsContent_CL`.

## Legacy / Compatibility Queries

The `kql/` directory contains compatibility queries for current Application Insights tables and existing dashboards.

Use these when you need to investigate raw Copilot OTel rows, attribution, collector health, policy events, or token rollups before a V2 custom-table pipeline is available.

## Validation

Static dashboard checks:

```bash
agentops dashboard validate
agentops dashboard links-check
```

Live KQL checks against Azure Log Analytics:

```bash
agentops dashboard kql-check --last 24h --json
agentops dashboard kql-check --last 24h --require-rows --json
```

The prompt/response viewer query is syntax-checked even when strict mode has no `AgentOpsContent_CL` rows. It is not required to return rows unless content capture was explicitly enabled. When rows exist, it normalizes prompt/response columns into a transcript-style `MessageText` field and keeps `CaptureMode`, `RedactionStatus`, `ContentHash`, and `ContentLength` visible beside the text.

## Privacy

V2 queries are designed to work without raw prompts, responses, source code, file contents, tool arguments, or tool results.

If `AgentOpsContent_CL` exists, use a restricted workspace, restricted Grafana permissions, and short retention.
