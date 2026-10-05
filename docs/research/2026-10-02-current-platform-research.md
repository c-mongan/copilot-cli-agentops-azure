# Current platform comparison — 2 October 2026

This is read-only platform research with a new report artifact. No dependencies were installed, models invoked, or Azure resources changed. Official documentation describes available contracts; it does not prove that this checkout or subscription exercises them. Existing live evidence is referenced separately.

## Decision

AgentOps is useful if it remains an evidence layer over native telemetry: declared architecture versus observed execution, explicit coverage gaps, privacy receipts, reliable delivery, deterministic evaluation, and human-reviewed proposals. A second general tracing platform, token dashboard, or generic agent waterfall has substantial overlap with Microsoft and GitHub capabilities already available. This is an assessment from the comparison below, not a demonstrated customer ROI result.

```text
Native CLI / SDK / VS Code signals + owned hooks / scripts
                         |
               local privacy boundary
                         |
          native telemetry + evidence ledger
                 /                   \
     Azure / Aspire standard views   AgentOps architecture + coverage
                                     + outcome / evaluation joins
```

## Versions and availability verified today

| Component | Current official evidence | Repo implication |
|---|---|---|
| Copilot CLI | Stable 1.0.91, released 1 October; 1.0.92-0 is prerelease. Stable notes include bounded telemetry flushing at shutdown. | Retain pinned runtime identity and test exit-time capture. A prerelease is not the acceptance baseline. |
| Copilot SDK | Latest release 1.0.16, 30 September; release notes associate its snapshot with CLI 1.0.90. | SDK package version and runtime version are different provenance fields. |
| Vally | npm latest tags are 0.17.0 for both CLI and library, published 24 September. Library dependencies pin Copilot 1.0.85 and SDK 1.0.14. | This pinned evaluation environment does not certify native CLI 1.0.91 behavior. |
| Azure Agents view | The portal path remains Agents (Preview). | Native product availability does not prove telemetry in this subscription. |
| Azure native OTLP ingestion | Preview; Microsoft documents no SLA and advises against production reliance. | Keep separately gated from the existing exporter/custom-table route. |
| Aspire | Current official site advertises 13.6.0 released 29 September; current persistence docs describe SQLite. | Re-evaluate overlap with the custom local viewer after testing the exact selected binary. |
| OTel GenAI conventions | Core documentation now redirects to the separate GenAI repository; agent spans remain Development. | Pin schema/source revision; tolerate producer drift through explicit versioned projections. |

Sources: [CLI releases](https://github.com/github/copilot-cli/releases/tag/v1.0.91), [CLI prerelease](https://github.com/github/copilot-cli/releases/tag/v1.0.92-0), [SDK release](https://github.com/github/copilot-sdk/releases/tag/v1.0.16), [Vally CLI registry metadata](https://registry.npmjs.org/@microsoft%2fvally-cli), [Vally library metadata](https://registry.npmjs.org/@microsoft%2fvally), [Azure Agents](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view), [Azure OTel preview](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/collect-use-observability-data), [Aspire persistence](https://aspire.dev/dashboard/data-persistence/), [OTel moved page](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [current agent conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md).

The npm registry was fetched directly with Python's standard library, returning only versions, publication times, and Copilot/Vally dependency pins. No npm install or executor launch occurred. Publication timestamps: CLI `2026-09-24T03:28:31.749Z`; library `2026-09-24T03:31:22.697Z`; SDK `2026-09-30T21:58:46.890Z`.

## What is already native

### Copilot CLI and SDK

Current GitHub CLI documentation describes native `invoke_agent`, `chat`, and `execute_tool` span trees, including subagents, model identity, usage, errors, and sessions. OTLP HTTP defaults to JSON, supports protobuf, and content capture defaults to false. Its `github.copilot.cost` attribute is a multiplier, not currency. Therefore monetary cost claims require a separate validated billing mapping. The command reference is rolling documentation and includes features beyond the locally pinned runtime; validate individual features against the installed version. [CLI monitoring reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring)

SDK documentation already provides telemetry configuration and W3C context propagation across the SDK/CLI boundary. Node applications use `onGetTraceContext` for outbound parent context and explicitly restore `traceparent`/`tracestate` supplied to tool invocation handlers. A custom wrapper can supply privacy defaults and provenance, but should not recreate native inference spans. This contract does not prove that arbitrary child shell processes receive context automatically. [SDK OTel](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry)

### Microsoft views and dashboards

Application Insights already supplies an agent run view, error and model/tool filtering, token analysis, and a story-like transaction view. Prebuilt coding-agent Grafana dashboards overlap with AgentOps general usage, tool, latency, and model panels. Keep custom views where they expose evidence strength, declarations, coverage, delivery, or measured task outcomes. [Agent observability](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)

Microsoft's coding-agent tutorial uses a Collector and Azure Monitor exporter; it also documents native OTLP as an alternative. Its VS Code sample explicitly enables content capture. That sample is unsuitable as this project's strict privacy default; retain `captureContent=false` and independently sanitize every supported carrier. [Coding-agent setup](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights)

### Native OTLP is an alternative route, not a drop-in flag

The documented Collector route requires version 0.132.0 or later, the Azure Auth extension, Entra authentication, signal-specific endpoints, and appropriate resources/roles. Its manual setup places LAW, AMW, and optional Application Insights in the same region. Use provisioned endpoints rather than guessing their suffixes. [Collector ingestion](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion)

Azure supports HTTP/protobuf for this ingress. Application Insights experiences require delta temporality and exponential histogram aggregation for OTLP metrics. A local JSON receiver is still compatible when the Collector performs outbound protobuf serialization. `cumulativetodelta` changes temporality; it is not evidence that explicit histogram buckets become exponential histograms. [OTLP limits and metric requirements](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/collect-use-observability-data)

Repository inspection: `collector/otelcol.azuremonitor.native.strict.yaml` uses `azure_auth`, `encoding: proto`, separate endpoint variables, downstream persistent queue, and `cumulativetodelta`. No exponential histogram configuration was found in the Collector directory. This is a compatibility proof gap for metrics, not proof that every current source emits incompatible histograms. Keep traces, logs, and metrics acceptance separate.

### Aspire overlap has increased

Aspire works as a standalone local OTel viewer without adopting AppHost orchestration. It already displays logs, traces, metrics, errors, and timing. [Dashboard overview](https://aspire.dev/dashboard/overview/)

Current persistence docs describe SQLite with `None`, `Run`, and `Resume` modes, bounded retention, historical run selection, and restart persistence. They also state that it is for development/short-term diagnostics, with no production-backend durability guarantees. Other official pages and README snapshots still say in-memory storage. Treat this as documentation/version inconsistency: verify persistence, schema compatibility, retention, and privacy on the selected release before substituting Aspire for an AgentOps ledger. Retain architecture manifests, provenance, coverage, and delivery receipts even if generic trace rendering is delegated. [Current persistence contract](https://aspire.dev/dashboard/data-persistence/), [configuration](https://aspire.dev/dashboard/configuration/), [inconsistent older description](https://aspire.dev/de/dashboard/telemetry-after-deployment/)

### Vally supplies execution, trajectory capture, and grading

The built-in executor uses the Copilot SDK. Stimuli, environment setup, trajectory events, custom executors, and graders are native Vally responsibilities. Reuse these rather than creating another generic executor. [Execution model](https://microsoft.github.io/vally/concepts/how-it-works/)

`--otlp-endpoint` sends Vally trial/attempt spans and runtime spans to the same Collector; child span shape remains executor-dependent. In this mode local span files are absent, and session `events.jsonl` is best-effort. An independently retained receipt/ledger remains valuable. [Eval CLI](https://microsoft.github.io/vally/reference/cli/eval/)

Use `--require-pass` for deterministic verdict gates. `experiment run --compare` is opt-in LLM judging and does not fail for a regression; a separate `compare --fail-on-regression` is needed if an authorized judge-based regression gate is desired. Its rubric judgment is distinct from configured graders. Reporter warnings can leave exit status green, so artifact completeness needs explicit acceptance checks. [Experiment CLI](https://microsoft.github.io/vally/reference/cli/experiment/)

## Product boundaries and finish requirements

| Need | Reuse | AgentOps responsibility | Acceptance evidence |
|---|---|---|---|
| Timing/models/tools/tokens | Native Copilot OTel; Azure/Aspire rendering | Preserve producer/version and unknown usage | Exact source-to-ledger-to-view comparison |
| Agent/skill/reference/script architecture | Native events where available | Manifest inventory, safe reads, owned process spans, version joins | Frozen manifest plus success/failure/delegation fixture |
| Privacy | Native content-off plus Collector processors | Strict projection, redaction, receipt, safe queue | Poison canaries across attributes/events/logs/metrics/rendered views |
| Delivery | OTel queues and Azure ingress | Target-bound outbox and readback distinction | Crash/replay, transient rejection, duplicate/loss checks, exact-ID readback |
| Quality | Vally execution and protected graders | Task/sink checks, provenance, proposal eligibility | Full corpus and held-out cases; repeated baseline/candidate trials |
| Improvements | Existing eval/experiment infrastructure | One-change hypotheses and human approval | Compatible configurations, no automatic refactor, measured outcome |
| Daily usability | Azure native dashboard and optional Aspire | Minimal architecture/coverage/compare workflow | Blinded incident diagnosis against native-tool baseline |

1. Stabilize native skill discovery before promising repeatable activation/reference coverage. The repository's [1 October live follow-up](2026-10-01-agentops-live-followup.md) records successful and failing identically configured runs; documentation alone does not resolve this instability.
2. Extend correctness evaluation to held-out tasks and additional representative workflows. The [2 October verification](2026-10-02-agentops-verification.md) records a fresh repaired 12-task corpus with 12/12 actual output/sink grades, preserving the original 10/12 result. Current-source regrading also passed 12/12; regrading is not another live execution. Retain those original failures and versioned grading evidence, and continue distinguishing actual task/sink correctness from nonempty output.
3. Repeat fully attributed single-change experiments against held-out tasks with recorded compatible architecture/executor versions. The [2 October verification](2026-10-02-agentops-verification.md) records three baseline and three candidate trials: all six actual sink grades passed, but median tool calls were 9 versus 10 and did not meet the predeclared 20% effect threshold. Unknown architecture/configuration compatibility is a separate limitation. This result remains inconclusive and does not establish improvement, tool-thrash causality, or product ROI.
4. Prove each ingestion route separately. Existing event/span custom-table readback is useful proof, but cannot certify native Agents UI discovery or metric compatibility. Inspect actual Azure state through the deployment audit, not this platform research.
5. Pin the active GenAI source revision and maintain adapter contract fixtures. Existing `docs/otel-genai-mcp-schema.md` links the old core location. The schema is still developing; avoid silently remapping native parentage or assuming every provider implements every field.
6. Use a small operational pilot: can an engineer diagnose a missing skill/read, failed MCP call, and script failure faster and more accurately than with native OTel/Azure alone? Measure diagnosis time, attribution correctness, setup effort, false positives, telemetry volume, and task completion. This is the evidence needed to claim usefulness beyond architecture completeness.

The separate GenAI conventions repository includes MCP as well as inference/agent schemas. An optional future normalization reuse candidate is Collector Contrib's alpha GenAI normalizer for OpenInference/OpenLLMetry; it does not replace declaration inventory, privacy policy, or outcome analysis. No new component is required to finish the current Copilot-focused scope. [GenAI repository](https://github.com/open-telemetry/semantic-conventions-genai), [normalizer official generated package documentation](https://pkg.go.dev/github.com/open-telemetry/opentelemetry-collector-contrib/processor/genainormalizerprocessor)
