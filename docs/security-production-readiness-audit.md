# Security And Production Readiness Audit

Date: 2026-06-02

This audit maps AgentOps for Azure against the current product shape, OWASP guidance, and Microsoft Learn guidance for Azure Monitor/Grafana operations.

## Sources

- OWASP GenAI Security Project: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- OWASP ASVS 5.0: https://github.com/OWASP/ASVS
- Azure Monitor visualization best practices: https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/best-practices-visualize
- Azure Monitor with Grafana: https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/visualize-grafana-overview

## System Shape

```text
Copilot CLI / VS Code / SDK / MCP
  -> localhost OTLP only
  -> local OpenTelemetry Collector privacy boundary
  -> Azure Monitor / Log Analytics
  -> Azure Managed Grafana dashboards
```

Default posture:

```text
AGENTOPS_PRIVACY_MODE=strict
AGENTOPS_CAPTURE_CONTENT=false
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
COPILOT_OTEL_CAPTURE_CONTENT=false
```

## Current Strengths

- Strict privacy is the default.
- Local collector is the scrub-before-export boundary.
- Collector `none` mode requires explicit unsafe opt-in.
- Poison fixtures validate that prompt/tool/file/secret-like fields are dropped before export.
- Runtime dashboards are metadata-first and avoid raw prompt/code content by default.
- CI uses read-only GitHub permissions.
- `gitleaks detect --no-git --redact` found no secrets in the working tree.
- Runtime npm packages currently have no direct dependencies.
- The product tracks broad Copilot permission modes such as `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, and `--allow-all-urls`.

## OWASP LLM Risk Mapping

| OWASP risk area | Current coverage | Gap to close |
| --- | --- | --- |
| Prompt injection | Captures metadata and policy signals without exporting raw prompt text. | Add explicit red-team fixtures for injected tool instructions and MCP prompt-injection attempts. |
| Sensitive information disclosure | Strict collector allowlist, content-signal drops, poison smoke. | Add CI secret scanning and documented retention/RBAC requirements for optional content capture. |
| Supply chain | No direct npm deps; collector binary checksum tests exist. | Add lockfile/SBOM strategy and pin SDK peer dependency expectations. |
| Excessive agency | Tool allow/deny counts, broad-permission flags, MCP risk dashboards. | Add policy tests for dangerous combinations such as broad tools plus content capture. |
| Insecure output handling | Product does not execute model output directly. | Keep this explicit in docs and tests for SDK/MCP adapter examples. |
| Vector/embedding weakness | Not currently a vector-store product. | No action unless vector/eval memory features are added. |
| Misinformation / overreliance | Deterministic evals and code outcome checks exist. | Add docs that dashboards are evidence aids, not security/compliance guarantees. |
| Model denial of service | Token/cost/latency dashboards exist. | Add budget guardrails and alert recommendations for runaway token/tool loops. |
| Unbounded consumption | Cost, token, and p95 panels exist. | Add CI tests for cost anomaly query shape and budget threshold configuration. |
| Agent/tool misuse | MCP risk classifier and dashboard filters exist. | Add an MCP abuse fixture covering network, shell, destructive, and secret-access tool classes. |

## Production Readiness Gaps

### P1: CI must run the same local static gate

Status: fixed in this branch.

The new `static:check` command validates JavaScript syntax, JSON validity, Bash syntax, local Markdown links, and CRLF line endings. CI now runs it.

### P1: Dependency audit needs a lockfile or documented exception

Status: open.

`npm audit` currently fails with `ENOLOCK` because there is no lockfile. That is understandable for a mostly dependency-free repo, but production users expect a repeatable dependency and audit story.

Recommended path:

```bash
npm --prefix agentops-cli install --package-lock-only
npm --prefix packages/agentops-copilot-sdk install --package-lock-only
npm --prefix agentops-cli audit --omit=dev
```

If the project intentionally avoids lockfiles, document that choice and use a separate SBOM/dependency inventory check.

### P1: Content capture needs stricter operational guardrails

Status: partially covered.

Content capture is off by default and requires explicit opt-in. For production readiness, optional prompt/response viewing should also require:

- separate restricted workspace or table;
- short retention;
- explicit RBAC guidance;
- clear dashboard warning state;
- tests proving strict mode never writes content rows.

### P2: Add OWASP-specific abuse fixtures

Status: fixed in this branch.

Add fixture families:

- prompt injection asks agent to reveal secrets;
- MCP tool returns hidden instructions;
- tool result contains secret-like text;
- model output requests shell execution;
- broad permission mode plus sensitive tool attempt;
- excessive loop/token spike.

### P2: Add security scan command group

Status: fixed in this branch.

Command:

```bash
agentops security audit --json
```

It should wrap:

- static check;
- gitleaks when installed;
- schema validate;
- collector validate;
- strict poison smoke;
- dashboard content exposure check;
- dependency audit when lockfiles exist.

### P2: Azure/Grafana production posture checklist

Status: open.

Azure Managed Grafana is the right product choice when the deployment needs audit usage logs, private networking, managed identity/service principal auth, alerts, reports, or sharing access without exposing the underlying data store.

Add a deployment checklist for:

- managed identity or service principal data source auth;
- least-privilege RBAC for Log Analytics;
- private networking where required;
- dashboard folder permissions;
- retention policy;
- alert routing;
- no public snapshots containing tenant/run data.

## Recommended Next PRs

1. `security-audit-command`: add `agentops security audit --json`.
2. `dependency-audit-lockfiles`: add lockfiles or a documented no-lockfile SBOM alternative.
3. `owasp-abuse-fixtures`: add LLM/MCP abuse fixtures and tests.
4. `content-capture-guardrails`: enforce restricted opt-in UX and retention docs for prompt/response viewer.
5. `azure-prod-hardening`: add Managed Grafana/RBAC/private networking checklist and validation queries.

## Verification From Initial Audit

```text
gitleaks detect --no-git --source . --redact: no leaks found
npm --prefix agentops-cli audit --omit=dev --json: blocked, no lockfile
```
