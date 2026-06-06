# Grafana Query Library

The reusable V2 KQL files live under `grafana/kql/`.

## Core Queries

- `run-summary.kql`: one row per Agent Run.
- `runs-explorer.kql`: Datadog-style run list.
- `run-replay.kql`: timeline events for one run.
- `tool-risk.kql`: tool/MCP risk and reliability.
- `privacy-signals.kql`: privacy drops/redactions.
- `code-outcomes.kql`: PR, CI, merge, close, revert outcomes.
- `evals.kql`: deterministic quality scores.
- `insights.kql`: anomalies, regressions, and recurring metadata-only patterns.
- `recommendations.kql`: persisted next actions from recommendations, with fallback rows projected from insights.
- `collector-health.kql`: collector/export health, including exporter failure fields.
- `content-viewer.kql`: optional prompt/response rows from `AgentOpsContent_CL`.

These queries target conceptual `AgentOps*_CL` tables. Current Application Insights tables can be adapted into the same shape with KQL views or rollup jobs.
