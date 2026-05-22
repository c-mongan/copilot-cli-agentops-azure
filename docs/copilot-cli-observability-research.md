# Copilot CLI Observability Research

This project should stay Azure-native while borrowing product patterns from agent observability tools and mature OpenTelemetry backends.

## Findings

- Copilot CLI already has first-party OpenTelemetry support for traces and metrics. It can be enabled by setting `OTEL_EXPORTER_OTLP_ENDPOINT`, and it emits an agent span tree with `invoke_agent`, `chat`, and `execute_tool` operations.
- Content capture is off by default in Copilot CLI and should stay off in this stack. The useful operational fields are metadata: model, session, tool, token, cost, AIU, latency, hooks, skill events, compaction, truncation, and errors.
- Local agent observability tools often pair a collector bootstrap command with a wrapped CLI launch that sets OTLP environment variables. The same pattern already exists here as `copilot-observe` and `copilot-agentops`.
- The most important data-quality lesson from comparable tools is token rollup discipline: parent aggregate spans and child chat spans can both carry usage fields. Dashboards should count tokens once.
- Agent-focused products emphasize sessions, live decisions, replay/debug, cost, token usage, model breakdown, and success rate. Those concepts map well to Azure Monitor tables plus Grafana drilldowns.
- SigNoz reinforces the product shape: unified logs, traces, metrics, quick filtering, trace detail, dashboards, alerts, and OpenTelemetry portability. For this repo, that argues for better KQL/Grafana workflows before building a custom app.

## Azure-Native Stack Shape

The target stack is:

1. `copilot-observe` sets privacy-safe Copilot OTel environment variables.
2. A localhost OpenTelemetry Collector receives Copilot OTLP.
3. Azure Monitor / Application Insights / Log Analytics store traces and metrics.
4. Managed Grafana provides session-first dashboards.
5. KQL packs provide repeatable investigations, token rollup audits, workflow funnels, and alert tuning.
6. Copilot custom agents and skills read those queries and propose safe changes.

## Next Build Priority

The next dashboard update should use the token rollup audit results to change session-level token, cost, and AIU panels from naive all-span sums to:

```text
if chat spans exist:
  sum chat span usage
else:
  use invoke_agent aggregate usage
```

After that, add replay-like session detail panels that show the ordered `invoke_agent -> chat -> execute_tool` timeline with related hook, skill, compaction, truncation, policy, and error events.
