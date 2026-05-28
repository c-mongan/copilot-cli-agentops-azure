# Architecture

AgentOps for Azure is one local-first observability loop:

```text
GitHub Copilot CLI
  -> agentops copilot wrapper
  -> OTLP on 127.0.0.1
  -> local OpenTelemetry Collector
  -> Azure Monitor exporter
  -> Application Insights + Log Analytics
  -> Azure Managed Grafana dashboards
```

## Runtime Path

`agentops copilot` resolves the real GitHub Copilot CLI, ensures the local collector is available unless explicitly disabled, sets metadata-only OpenTelemetry environment variables, and executes Copilot.

The wrapper records safe metadata such as model name, tool name, duration, token usage, cost fields, success/failure, and hashed repository metadata. It forces GenAI message content capture off by default.

## Privacy Boundary

The local Collector is the scrub-before-export boundary. Docker is optional, but the Collector is required for the safe path.

Strict mode allowlists known safe attributes before export. Compat mode keeps the older denylist scrubber for compatibility.

## Azure Resources

The Bicep deployment provisions:

- Log Analytics Workspace
- Application Insights
- Azure Monitor Workspace
- Azure Managed Grafana
- Key Vault
- optional alerts, actioner, RBAC, and budget modules disabled by default

## Dashboards

The core Grafana path is Overview, Sessions, and Session Detail. Other dashboards are useful but experimental or data-dependent.

Policy panels show observed hook signals only. They are not a security boundary.
