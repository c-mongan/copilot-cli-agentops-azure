# Threat Model

Scope: AgentOps for Azure internal pilot mode.

## System Boundary

```text
Developer machine
  copilot / codex command
  AgentOps wrapper
  OpenTelemetry Collector on 127.0.0.1

Azure resource group
  Log Analytics Workspace
  Application Insights
  Azure Managed Grafana
  Azure Monitor Workspace
  Key Vault
  Optional actioner Function
  Optional alert rules
  Optional RBAC assignments
  Optional budget
```

Out of scope for the pilot:

- Fleet-wide endpoint management.
- Private endpoint networking.
- Raw prompt or response capture.
- Customer or regulated data.
- Automated remediation without human review.

## Assets

```text
High value:
  Azure tenant and subscription access
  Log Analytics telemetry
  Grafana dashboards
  App Insights connection string
  Entra security group membership

Sensitive if misconfigured:
  prompt text
  code snippets
  file contents
  tool arguments and results
  full URLs and request bodies
```

## Trust Boundaries

```text
Boundary 1: CLI process -> local wrapper
  Risk: wrapper captures more than expected.
  Control: content capture defaults false; tests validate env defaults.

Boundary 2: local wrapper -> local collector
  Risk: OTLP endpoint exposed to network.
  Control: docker compose binds OTLP ports to 127.0.0.1.

Boundary 3: local collector -> Azure Monitor
  Risk: sensitive payload fields leave the machine.
  Control: collector deletes prompt, completion, tool payload, URL, and body fields before export.

Boundary 4: Azure Monitor -> human/agent analyst
  Risk: too many people can read telemetry.
  Control: optional Entra group RBAC and read-only default analyst mode.

Boundary 5: alerts/actioner -> automation
  Risk: telemetry triggers unsafe changes.
  Control: alert and actioner modules are disabled by default; actioner is proposal-only.
```

## Threats And Mitigations

| Threat | Impact | Mitigation | Status |
|---|---:|---|---|
| Prompt or response content is exported | High | Content capture disabled and collector scrub list deletes known GenAI payload keys | Implemented |
| Collector listens on non-local interfaces | High | Azure Monitor compose file binds OTLP HTTP/gRPC to `127.0.0.1` | Implemented |
| App Insights connection string is persisted in repo or azd outputs | High | Runtime lookup only; enterprise validation blocks top-level connection-string output | Implemented |
| Excessive telemetry ingestion causes spend spike | Medium | Daily Log Analytics cap, short retention, optional budget | Implemented |
| Broad dashboard access exposes sensitive metadata | Medium | Optional Entra group RBAC for observers/operators/admins | Implemented |
| Operator enables content capture for debugging | High | Enterprise validation fails when content capture env vars are true | Implemented |
| Optional actioner performs unsafe changes | High | Actioner disabled by default and scoped as proposal-only | Implemented |
| Private networking required by policy | Medium | Not default; add private endpoint mode before regulated rollout | Open |
| Role assignments are granted to individual users | Medium | Pilot guide requires Entra security groups | Documented |
| Collector image supply chain changes unexpectedly | Medium | Image can be pinned by `AGENTOPS_OTELCOL_IMAGE`; broad rollout should pin digest | Open |

## Abuse Cases

```text
Misconfigured developer shell:
  User sets COPILOT_OTEL_CAPTURE_CONTENT=true.
  Expected result: agentops validate-enterprise fails before pilot approval.

Unexpected network exposure:
  Docker publishes 4318 on 0.0.0.0.
  Expected result: agentops validate-enterprise fails collector-localhost-published.

Overbroad azd output:
  Template emits APPLICATIONINSIGHTS_CONNECTION_STRING.
  Expected result: agentops validate-enterprise fails azd-no-connection-string-output.

Cost runaway:
  A noisy source floods OTLP.
  Expected result: collector scrub/filtering reduces payload size, Log Analytics daily cap limits ingestion spike, optional budget emails owners.
```

## Residual Risk

For a small internal pilot, the remaining risk is acceptable if the pilot excludes sensitive workloads and uses a dedicated resource group. For broad internal rollout, close these gaps first:

- Private endpoint and network isolation option.
- Pinned collector image digest and update process.
- Formal data handling review.
- Automated Entra group creation/ownership documentation.
- Azure Policy or internal policy alignment.
- Centralized budget and incident owner.

## Review Cadence

Review this file when any of these change:

- Collector scrub rules.
- Bicep outputs.
- RBAC roles.
- Actioner behavior.
- Alert enablement.
- Supported Copilot/Codex telemetry sources.
