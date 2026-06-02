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
- Runtime npm packages currently have no direct dependencies and have committed npm lockfiles.
- The product tracks broad Copilot permission modes such as `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, and `--allow-all-urls`.
- V2 dashboards now have a content guardrail check that blocks prompt/response text outside the explicit opt-in viewer.

## OWASP LLM Risk Mapping

| OWASP risk area | Current coverage | Gap to close |
| --- | --- | --- |
| Prompt injection | Captures metadata and policy signals without exporting raw prompt text. | Add explicit red-team fixtures for injected tool instructions and MCP prompt-injection attempts. |
| Sensitive information disclosure | Strict collector allowlist, content-signal drops, poison smoke, dashboard content guardrails, and documented retention/RBAC requirements for optional content capture workspaces. | Keep content-capture operational guardrails in `agentops security audit`. |
| Supply chain | No direct npm deps, committed npm lockfiles, dependency audit command, and collector binary checksum tests exist. | Pin SDK peer dependency expectations before publishing a stable SDK package. |
| Excessive agency | Tool allow/deny counts, broad-permission flags, MCP risk dashboards. | Add policy tests for dangerous combinations such as broad tools plus content capture. |
| Insecure output handling | Product does not execute model output directly. | Keep this explicit in docs and tests for SDK/MCP adapter examples. |
| Vector/embedding weakness | Not currently a vector-store product. | No action unless vector/eval memory features are added. |
| Misinformation / overreliance | Deterministic evals, code outcome checks, and explicit docs that dashboards are evidence aids, not security/compliance guarantees. | Keep evidence-disclaimer checks in `agentops security audit`. |
| Model denial of service | Token/cost/latency dashboards exist. | Add budget guardrails and alert recommendations for runaway token/tool loops. |
| Unbounded consumption | Cost, token, and p95 panels exist. | Add CI tests for cost anomaly query shape and budget threshold configuration. |
| Agent/tool misuse | MCP risk classifier and dashboard filters exist. | Add an MCP abuse fixture covering network, shell, destructive, and secret-access tool classes. |

## Production Readiness Gaps

### P1: CI must run the same local static gate

Status: fixed in this branch.

The new `static:check` command validates JavaScript syntax, JSON validity, Bash syntax, local Markdown links, and CRLF line endings. CI now runs it.

### P1: Dependency audit needs a lockfile or documented exception

Status: fixed.

`agentops-cli/package-lock.json` and `packages/agentops-copilot-sdk/package-lock.json` provide repeatable npm dependency graphs. The security audit runs `npm audit --omit=dev --json` for both package roots and blocks on high or critical runtime vulnerabilities.

Recommended path:

```bash
npm --prefix agentops-cli install --package-lock-only
npm --prefix packages/agentops-copilot-sdk install --package-lock-only
npm --prefix agentops-cli audit --omit=dev
npm --prefix packages/agentops-copilot-sdk audit --omit=dev
```

### P1: Content capture needs stricter operational guardrails

Status: fixed.

Content capture is off by default and requires explicit opt-in. The V2 dashboard pack now has an automated guardrail:

```bash
agentops dashboard content-check
agentops security audit --json
```

The guardrail permits `AgentOpsContent_CL` only in:

- `Transcript availability`, which shows status and counts;
- `Prompt and response viewer (explicit opt-in)`, which is the only panel allowed to project prompt/response text.

The production policy evidence is enforced by `agentops security audit`:

- separate restricted workspace or table;
- short retention;
- explicit RBAC guidance;
- tests proving strict mode never writes content rows;
- explicit `--allow-content` ingestion review.

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
agentops security posture --json
```

`security audit` wraps:

- static check;
- gitleaks when installed;
- dependency audit;
- CI gate presence;
- collector privacy artifact validation;
- strict poison sanitizer checks;
- OWASP abuse fixture validation.
- V2 dashboard content guardrail validation.

`security posture` maps the current repo evidence to OWASP LLM Top 10 2025 and ASVS-aligned controls. It is intentionally static and evidence-based: controls are reported as `covered`, `partial`, `gap`, or `not-applicable`, and missing evidence makes the command fail.

Current posture summary:

```text
OWASP LLM01 Prompt Injection                  covered
OWASP LLM02 Sensitive Information Disclosure  covered
OWASP LLM03 Supply Chain                      covered
OWASP LLM04 Data And Model Poisoning          partial
OWASP LLM05 Improper Output Handling          covered
OWASP LLM06 Excessive Agency                  covered
OWASP LLM07 System Prompt Leakage             covered
OWASP LLM08 Vector And Embedding Weaknesses   not-applicable
OWASP LLM09 Misinformation                    covered
OWASP LLM10 Unbounded Consumption             covered
ASVS-SEC General AppSec Controls              covered
```

The remaining partial control is not a blocker for this product shape:

- `LLM04`: AgentOps is not a model training or vector memory pipeline; the current evidence is configuration/instruction hash regression detection.

`LLM09` is covered for current scope because dashboards and deterministic evals are documented as evidence aids, not correctness, compliance, or security guarantees.

### P2: Azure/Grafana production posture checklist

Status: fixed in this branch.

Azure Managed Grafana is the right product choice when the deployment needs audit usage logs, private networking, managed identity/service principal auth, alerts, reports, or sharing access without exposing the underlying data store.

Added `docs/azure-production-hardening.md` and `validate-enterprise` checks for:

- managed identity or service principal data source auth;
- least-privilege RBAC for Log Analytics;
- private networking where required;
- dashboard folder permissions;
- retention policy;
- alert routing;
- no public snapshots containing tenant/run data.

## Recommended Next PRs

1. `sdk-publish-hardening`: pin SDK peer dependency expectations and add package-publish dry-run checks.
2. `content-retention-rbac-live`: add live checks for optional content-capture workspace retention/RBAC if content capture is deployed.
3. `live-azure-posture-query`: keep expanding read-only live checks for deployed Grafana public access, zone redundancy, action groups, retention, and daily cap.

## Verification From Initial Audit

```text
gitleaks detect --no-git --source . --redact: no leaks found
npm --prefix agentops-cli audit --omit=dev --json: no vulnerabilities
npm --prefix packages/agentops-copilot-sdk audit --omit=dev --json: no vulnerabilities
```
