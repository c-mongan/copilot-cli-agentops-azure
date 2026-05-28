# Threat Model

Scope: metadata-only GitHub Copilot CLI observability for Azure Monitor and Grafana.

## Assets

High value:

- Azure tenant/subscription access
- App Insights connection string
- Log Analytics telemetry
- Grafana dashboards
- Copilot auth state

Sensitive if misconfigured:

- prompts and responses
- code or file contents
- tool arguments and results
- system instructions
- full URLs and request/response bodies

## Trust Boundaries

```text
Copilot runtime -> AgentOps wrapper
AgentOps wrapper -> local Collector on 127.0.0.1
local Collector -> Azure Monitor exporter
Azure Monitor -> Grafana / human operators
```

## Threats And Mitigations

| Threat | Mitigation |
| --- | --- |
| Prompt/content leaves the machine | Copilot content capture forced off; strict Collector mode allowlists safe metadata. |
| Collector exposed on the network | Binary mode listens on `127.0.0.1`; Docker Compose publishes OTLP/health ports on `127.0.0.1` only. |
| Connection string stored on disk | Runtime lookup only; local config stores names/IDs, not secrets. |
| Direct-to-backend mode bypasses scrubber | `none` mode requires explicit unsafe opt-in. |
| Policy hook overclaim | Docs call hooks demo guardrails, not a security boundary. |
| Cost spike | Log Analytics caps/retention and optional budget module. |
| Automation mutates resources unexpectedly | Alerts/actioner/RBAC automation disabled by default. |

## Residual Risks

- Strict Collector config relies on current Collector transform support; keep poison tests in CI/offline validation.
- Azure ingestion is eventually consistent, so live validation may need retries.
- Authenticated Azure Managed Grafana cannot be fully validated by Codex in-app browser.
- Private networking and pinned image digests are not enabled by default.

Review this file whenever collector scrub rules, wrapper env behavior, Bicep outputs, RBAC, alerts, or actioner behavior changes.
