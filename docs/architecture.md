# Architecture

Copilot CLI AgentOps for Azure is a local-first telemetry loop.

```text
Copilot CLI -> copilot-observe -> localhost OTel Collector -> Azure Monitor/App Insights/Log Analytics/Grafana -> Azure MCP/Grafana MCP -> telemetry-investigator -> patch proposal
```

The v0.1 implementation focuses on metadata-only telemetry and patch proposals. It does not capture prompts, responses, tool arguments, or file contents by default.

## Runtime Data Flow

```text
developer shell
    |
    | copilot -p ...             or              agentops codex ...
    v
AgentOps wrapper
    |
    +--> starts collector if needed
    +--> sets OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
    +--> sets content capture off
    +--> adds safe labels: experiment, profile, agent name, hashed repo
    |
    v
real CLI process
    |
    | OTLP spans/metrics/events
    v
127.0.0.1 OpenTelemetry Collector
    |
    +--> drops prompt/content/tool payload fields
    +--> keeps operation metadata, cost/tokens, timing, success/failure
    |
    v
Azure Monitor exporter
    |
    +--> Application Insights tables
    +--> Log Analytics KQL
    +--> Azure Managed Grafana dashboards
```

## Dashboard Topology

```text
Copilot CLI AgentOps overview
    |
    +--> Sessions
    |       |
    |       +--> Session Detail
    |       +--> Traces / Spans
    |       +--> Runtime Events
    |
    +--> Tools & MCP
    +--> Attribution
    +--> Safety & Policy
    +--> Permission Friction
    +--> Quality / Experiments / Data Quality
    +--> Alert Tuning
```

The overview is the user entry point. The other dashboards are drilldowns for operators, not separate products.

## Alert Posture

```text
raw telemetry
    |
    v
alert tuning dashboard
    |
    +--> review history and false positives
    +--> pick thresholds
    +--> wire action groups intentionally
    |
    v
disabled-by-default scheduled-query rules
```

Do not enable paging alerts on the first install. Start with dashboard evidence and opt-in action groups.
