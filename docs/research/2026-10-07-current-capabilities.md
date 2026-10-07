# AgentOps: current Microsoft capabilities and product direction

> Dated research snapshot (2026-10-07, before v0.2.0-preview). For what has shipped since, see [CHANGELOG.md](../../CHANGELOG.md).

Checked against first-party documentation on 2026-10-07 UTC. This is a
documentation and repository assessment, not evidence of deployment or feature
availability in Conor's subscription. Documentation update dates below are not
release dates. Repository baseline: `4e1d3fb`, with local audit/design commits.

## Recommendation

Build an Azure-native AgentOps experience around native Copilot traces, Azure's
existing visualization and investigation surfaces, and our own evidence-backed
outcomes and experiments. Add Foundry analysis as an optional integration after
a small compatibility trial. The differentiator is the connection between an
observed problem, an independently verified result, a proposed change and a
reproducible comparison. A beautiful dashboard alone cannot establish value.

The everyday product should answer: what ran, where time/usage went, what failed,
whether the task actually succeeded, what changed, and what improvement is worth
testing. Each answer needs a trace or result receipt. Unknown must remain visible.

## Capability decisions

| Capability | Current documentation status | Fit and decision |
| --- | --- | --- |
| Native OTLP through OTel Collector | GA; AMA/AKS ingestion paths separately preview [1] | Qualify existing native overlay alongside current exporter, select one destination lane |
| Application Insights Agents | Portal entry still Agents (Preview) [2] | Use native run/model/tool investigation after real parent-linked trace proof |
| Portal Grafana | Available documented portal feature; built-in coding-agent dashboards [3] | Start with Copilot template and add our outcome/experiment panels |
| Azure MCP Monitor | Workspace/resource queries, schemas and metrics documented [4] | Copilot CLI investigation plus shared named-query contract; qualify pinned release |
| Foundry Insights | Explicit preview; documentation updated Sep 22 [5] | High-priority external-agent pilot, then read generated findings in coding agent |
| Foundry deployed trace evaluation | Explicit preview; documentation updated Sep 28 [6] | Public/synthetic content-bearing eval lane; current strict production data insufficient |
| Traces to versioned datasets | Explicit preview; documentation updated Sep 28 [7] | Later case-curation adapter; reviewed expected answers remain necessary |
| Foundry recurring monitoring/evals | Several dashboard, recurrence and alert functions explicitly preview [8] | Qualify scheduled external-trace path, do not assume response-completion rules cover Copilot |
| Foundry Agent Optimizer | Oct 6 current overview lacks earlier preview label; cached sources still say preview [9] | Status requires confirmation; supported agent types aren't arbitrary local Copilot agents |
| Azure Copilot Observability Agent | On-demand chat documented; durable resource/autonomous operations explicitly preview [10–12] | Try portal investigation; defer always-on incident triage until useful alerts exist |
| VS Code Copilot harness | 1.140 stable, released Sep 30 [13] | Make agent-host telemetry readiness a first-class onboarding check |
| Remote delegation / HydraFusion | Experimental / Research Preview in 1.140 [13] | Observe when used; future experiment subjects, not platform prerequisites |

## What materially changes the previous design

### Use Microsoft's Copilot dashboard as the visual starting point

Application Insights now lists a GitHub Copilot dashboard in its portal Grafana
gallery. Saved/customized dashboards are Azure resources with RBAC and ARM/Bicep
automation. The portal experience supports Azure data sources; non-Azure sources
and additional enterprise features are reasons to choose Managed Grafana. [3]

Our design inference: customize the native dashboard before converting every
existing panel. Reuse `grafana/dashboards/v2/` for verified outcomes, capture
health, run evidence and experiment comparisons that the native template doesn't
establish. Existing `/d/...` links and datasource assumptions need adaptation.

Three practical homes: portal Grafana for fleet trends, Agents transaction
details for one execution, and Foundry for optional analysis/evaluation. Make
transitions explicit using matching identifiers. A custom hosted frontend becomes
worthwhile if everyday investigation demonstrably requires too much navigation,
or if Azure panels cannot express the experiment workflow. Decide from usability
tests after real data flows, not from speculative frontend investment.

### Foundry Insights is a promising part of the meta loop

Insights analyzes repeated trace behavior and returns evidence and recommended
actions. It requires a connected Application Insights resource, supported GPT-5+
analysis deployment, identities/permissions and representative traces. Generated
findings can be retrieved read-only through `agent_insights_get` via Foundry MCP
or the Foundry Skill. Scheduling and model usage add cost. [5]

Crucially, Microsoft's linked SDK helper creates an external agent using
`ExternalAgentDefinition(otel_agent_id=...)`, independently of the gateway-based
registration wizard. Its fixture emits synthetic defects and controls rather
than running an agent. [14] The separate Control Plane registration guide
requires a reachable HTTP/A2A endpoint and API Management routing. [15]

Our inference: investigate telemetry-only external registration first. Do not
wrap or rehost Copilot, or provision API Management, just to obtain analysis.
SDK examples demonstrate a possible integration contract, not that our actual
Copilot data already meets it. Our strict span allowlist currently drops
`gen_ai.agent.id` and `gen_ai.agent.version`; the preceding label fix preserved
only `gen_ai.agent.name`. Stable privacy-safe identity/version matching remains
an integration task. Never equate a hashed name with proof of version identity.

The pilot should retrieve evidence-backed recurring tool failure or token/latency
findings. Missing content limits semantic diagnosis; an empty insight list cannot
establish health. Keep our deterministic operational checks as a fallback.

### Trace evaluation needs a deliberate evaluation data path

Foundry can evaluate captured external-agent interactions without replaying them.
It reads `invoke_agent` spans; agent filtering needs identity attributes. Quality
evaluators use `gen_ai.input.messages` and `gen_ai.output.messages`; absent content
produces missing quality scores. [6]

Our inference: ordinary metadata-only traffic can support cost, timing, failures
and verified test outcomes, but not answer-quality evaluation. Enabling producer
content capture alone would not help: our strict collector still drops messages.
Use a separate, bounded public/synthetic evaluation profile and target if we
choose cloud semantic evaluation. Qualify its content contract explicitly, while
preserving strict production collection. Tests and execution assertions should
remain the primary correctness evidence for coding tasks; LLM judges complement
them. Do not manufacture scores for absent evidence.

Trace-to-dataset generation supports third-party OTel sources, versioned output,
intelligent sampling, and a 15–1000 sample cap. Current guidance requires public
query access for connected Application Insights and, when applicable, customer
storage. Python or portal is documented for time-window generation; TypeScript
examples do not yet cover that submission flow. [7]

Our inference: generated conversations are candidate cases, not ground truth.
An observed wrong response must not become its own expected answer. Review
assertions and separate fixed comparison cases from untouched holdouts.

The monitoring documentation separates scheduled runs from live
response-completion evaluation rules; its example starts a Foundry prompt agent.
[8] For Copilot, qualify a bounded schedule querying existing traces first rather
than assuming Foundry response events fire for a local CLI session.

### Optimizer availability does not mean Copilot is automatically optimized

The current Agent Optimizer overview supports Foundry prompt/hosted agents;
hosted agents require runtime configuration integration and the Responses
protocol. Targets include instructions, skills, function-tool descriptions and
model selection. Evaluation invokes agents and can execute external tools. The
page was updated Oct 6 and no longer carries the preview marker seen in cached
search results; this alone is not a verified GA announcement. [9]

Our inference: retain the repository's optimizer/benchmark harness for Copilot
custom instructions and skills. Reuse Microsoft's baseline/candidate workflow
ideas. Consider native optimizer integration if we later build an actual Foundry
hosted analyst or evaluation agent. Do not promise it can directly tune the
Copilot CLI runtime or all MCP tool behavior.

### Portal chat and local Copilot are complementary

Azure Copilot Observability Agent can chat over resource-scoped telemetry from
Application Insights/Log Analytics Logs. Chat is temporary; an Azure Monitor
issue preserves investigation context. [10] A durable Observability Agent
resource adds managed identity, instructions and autonomous behavior; portal
scope is one Application Insights resource, API up to ten. [11]

Autonomous operations correlate alerts, create issues and investigate them;
they do not apply mitigations. [12] Chat/deep investigation usage is charged in
Azure Agent Credits, with billing effective July 1, 2026. [16]

Our inference: test portal chat against a known run as a useful native fallback.
For questions that need source code, local experiments or reviewed patches,
Copilot CLI should use our named-query interface plus optional Foundry findings.
Azure Monitor issues and GitHub issues are distinct records; any future handoff
needs an explicit adapter. Start with alerts for stale telemetry, sustained tool
failures or ingestion failure, before adding always-on AI incident triage.

## Recent coding-agent changes and the observation model

VS Code 1.140's Copilot SDK-powered harness runs in a dedicated Agent Host.
Remote task delegation is experimental and disabled by default; HydraFusion is
a research preview with adaptive model orchestration. [13]

Our inference: group by surface/harness/runtime version and preserve selected
versus actual model where available. Compare a whole completed task, not just
one model call. Parallel/critique workflows can trade more usage for better
results; lower tokens alone don't establish improvement. Remote worker spans
need actual context propagation proof, not logical session labels standing in
for parentage.

VS Code documents native subagent context propagation, canonical
`github.copilot.*` attributes and edit acceptance/survival metrics. [17] Our
allowlist needs a deliberate contract review for useful safe fields such as
agent type, MCP server hashes and hook decisions. Raw git URLs, paths, commands
and tool payloads cannot simply be retained wholesale. Edit acceptance or
survival is adoption evidence, not proof the code is correct.

## Open-source patterns worth reusing

Langfuse explicitly supports Copilot's native OTel with agent/model/tool spans
and sessions. Its endpoint accepts Copilot HTTP protocols but ingests traces
only, so metrics/events need another destination. [18] Its authenticated MCP
exposes platform data, with writes that need exclusion for an investigator. [19]
SigNoz documents a telemetry MCP with schema/query resources and mutation tools.
[20]

Our inference: copy the investigation workflow, linked sessions and experiment
provenance, while implementing narrow Azure adapters. Neither platform removes
the need for correct outcome evidence. Keep standard OTel portability so a
future optional backend doesn't require replacing collection. Self-hosting
another platform becomes justified if we need its evaluation/review experience
enough to pay the hosting and identity maintenance cost.

## Product concepts to prioritize

| Concept | Concrete user value | Required evidence |
| --- | --- | --- |
| Value overview | See whether agents deliver working changes | Verified tests/task assertions, explicit coverage and unknown count |
| Run investigation | Explain a failure or expensive run | Native span tree, tool errors, model usage and exact trace link |
| Ask AgentOps | Ask Copilot the same question as the dashboard | Shared query/version/filter receipt, actual returned rows |
| Improvement inbox | Turn repeated failures into owned hypotheses | Linked trace cohort, healthy controls, finding source and review state |
| Experiment comparison | Decide if a candidate is better | Fixed cases/judges, repeated runs, untouched holdout, usage and outcome deltas |
| Pipeline health | Distinguish no activity from broken collection | Capture/export/readback freshness and completeness |

## First end-to-end trial and remaining unknowns

1. Run a fixed public coding task with a known passing assertion and a deliberate
   tool-failure case. Record harness/CLI versions and config versions.
2. Qualify the real pinned Collector poison fixture and one chosen Azure export
   route. Check delta/exponential-histogram requirements and actual table schemas.
   Native ingestion requires Entra/DCR access; current collector auth examples
   note version-sensitive syntax. [21]
3. Confirm one physical parent-linked trace and deduplicated model token totals
   in Agents and the Copilot dashboard. Join test evidence without replacing
   the native trace with custom receipt events.
4. Execute a bounded Azure query from local Copilot and obtain the same run and
   totals. Online Azure MCP docs cannot establish that our pinned 2.0.5 has every
   current tool; record the discovered supported tool set.
5. Try telemetry-only Foundry registration with matching safe identity/version.
   Run one on-demand analysis, retrieve findings read-only, and check whether
   it identifies the planted failure rather than inventing a semantic diagnosis.
6. For optional quality evaluation, use a separate public/synthetic fixture with
   supported message attributes, then test one baseline/candidate comparison.
7. Record which stages actually pass. Don't enable recurring model analysis
   until usefulness, cost, region and access have been established.

No Azure query, deployed UI, Copilot invocation, Foundry registration or model
analysis was performed in this research turn. No cloud success is claimed.
Current session lacks usable GitHub write credentials and live Azure tooling.

## Sources

All links checked on 2026-10-07; dates mentioned above are source-specific.

1. [OTel paths and GA/preview distinction](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-options)
2. [Application Insights Agents](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
3. [Portal Grafana and coding-agent dashboards](https://learn.microsoft.com/en-us/azure/azure-monitor/app/grafana-dashboards)
4. [Azure MCP Monitor tools](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/azure-monitor)
5. [Foundry Insights](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/agent-insights)
6. [Evaluate captured interactions and required attributes](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/cloud-evaluation-deployed-interactions)
7. [Trace-to-dataset generation](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/traces-to-dataset)
8. [Monitoring and recurring evaluations](https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard)
9. [Agent Optimizer, current overview](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-optimizer-overview)
10. [Observability Agent chat](https://learn.microsoft.com/en-us/azure/azure-monitor/aiops/observability-agent-chat)
11. [Durable Observability Agent resource](https://learn.microsoft.com/en-us/azure/azure-monitor/aiops/observability-agent-resource)
12. [Autonomous operations](https://learn.microsoft.com/en-us/azure/azure-monitor/aiops/observability-agent-autonomous-operations)
13. [VS Code 1.140 release notes](https://code.visualstudio.com/updates/v1_140)
14. [External-agent Insights helper at inspected commit](https://github.com/Azure/azure-sdk-for-python/blob/fedc3ab96021c2b0d42496cb4ddf0c476f77b63d/sdk/ai/azure-ai-projects/samples/agent_insights/agent_insights_util.py)
15. [Gateway-based custom-agent registration](https://learn.microsoft.com/en-us/azure/foundry/control-plane/register-custom-agent)
16. [Observability Agent billing](https://learn.microsoft.com/en-us/azure/azure-monitor/aiops/observability-agent-billing)
17. [VS Code native telemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
18. [Langfuse Copilot integration](https://langfuse.com/integrations/developer-tools/github-copilot)
19. [Langfuse MCP](https://langfuse.com/docs/api-and-data-platform/features/mcp-server)
20. [SigNoz MCP](https://signoz.io/docs/ai/signoz-mcp-server/)
21. [Native Collector ingestion setup](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion)
