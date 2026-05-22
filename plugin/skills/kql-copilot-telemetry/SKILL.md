---
name: kql-copilot-telemetry
description: "Use when: writing KQL queries for GitHub Copilot CLI OpenTelemetry data in Application Insights, Log Analytics, AppDependencies, AppTraces, Properties, traces, dependencies, metrics, or customDimensions."
license: MIT
user-invocable: true
allowed-tools:
  - azure-mcp/*
  - agent-grafana/*
---

When writing KQL for Copilot CLI telemetry:
1. Discover table names first.
2. Prefer workspace tables verified by this project: `AppDependencies`, `AppTraces`, `AppEvents`, and `AppMetrics`.
3. Do not assume exact column mapping until verified.
4. Use `Properties` for OTel attributes in workspace tables and `customDimensions` for classic App Insights tables.
5. Always include a time bound.
6. Include a small sample query before a broad aggregate query.
7. For the Azure Monitor exporter path, Copilot CLI GenAI spans have landed in `AppDependencies` with `Properties` keys such as `gen_ai.operation.name`, `github.copilot.aiu`, `github.copilot.cost`, `gen_ai.usage.input_tokens`, and `gen_ai.usage.output_tokens`.

When a query supports a recommendation, include the recommendation contract fields: evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark or query, and rollback condition. Do not require prompt/content capture or secrets.
