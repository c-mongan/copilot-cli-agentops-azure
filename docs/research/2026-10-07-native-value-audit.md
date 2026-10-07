# Native monitoring and practical value audit

Audit date: 2026-10-07. Baseline: main at
`4e1d3fbccd96a96e96aa027c89c02adcfd9f70c6` (PR #171).

## Verdict

The project has evidence of functioning capture, metadata delivery and cloud
readback. It does not yet have evidence that the **VS Code extension's current
publish path** populates Application Insights Agents (Preview), provides a
connected cloud trace tree, or improves task outcomes. More dashboard panels
will not resolve that distinction.

The next milestone is one useful investigation of one real, public-repository
task using native telemetry, with a separately verified outcome. Keep prompts,
responses, source code, tool arguments and results off.

## Evidence and gaps

| Area | What current main establishes | Practical consequence |
| --- | --- | --- |
| VS Code capture | The documented October 6 test received native spans after Agent Host restart/reopen | Capture is working in that test profile; installation elsewhere is not established |
| Extension Azure delivery | `nativeMetadataEvents()` produces `native.span.observed` rows in `AgentOpsEvents_CL`; documented readback matched 6/6 | This proves a custom-table receipt, not native Application Insights ingestion |
| Extension trace shape | Projection includes trace ID but omits span/parent IDs, model, tool name and agent label | Workbook rows cannot reconstruct a parent/child waterfall or identify the slow tool from those rows |
| Native cloud lane | Separate Azure Monitor exporter and native OTLP overlay exist | Reuse these for standard traces rather than inventing a new agent service |
| Standard agent label | All four strict trace allowlists dropped `gen_ai.agent.name` | Native grouping loses the agent label before export |
| Metric dimensions | Local strict metrics keep only operation, token type and success | Native metric dashboards cannot promise model/tool breakdowns from that stream; span queries may still have dimensions |
| Outcomes | Capture documentation explicitly leaves task outcome/coverage unknown | A completed span is not proof of correct code, passing tests or time saved |
| Documentation | Simplified design still describes an absent historical target; newer E2E records describe a deployed Workbook | Read dated records as historical evidence; inspect current resources before choosing a target |

This audit fixes the standard agent-label loss in the four strict trace paths.
The public built-in labels `copilot`, `copilotcli` and `claude` remain readable.
Other nonempty string labels become deterministic SHA-256 digests; non-string
and empty labels are removed. Hashes support grouping, not anonymous identity
or human-readable custom-agent names. No content attributes are added.
The extension's custom-table projection is deliberately unchanged: this fix
does **not** make that publisher feed Agents (Preview).

## Microsoft capabilities to use

1. **Application Insights Agents (Preview)** for agent runs, tool/model errors
   and end-to-end transaction details. Microsoft explicitly documents coding
   agents and third-party agents. Foundry hosting is not a prerequisite for
   this Application Insights experience.
2. **Native Copilot OTel** for model calls, tools and subagent parent/child
   traces. The extension already configures both Copilot Chat and registered
   Agent Host settings. Preserve native IDs through the selected Collector
   exporter; avoid a second instrumentation layer for the same operations.
3. **Prebuilt Copilot Grafana dashboard** as a reference/baseline after native
   data arrives. Azure portal Grafana experiences are available; a separate
   Managed Grafana resource need not be the first milestone. Validate query
   table assumptions against the chosen ingestion lane.
4. **Aspire Dashboard** for an optional local trace investigation before
   cloud onboarding. It still needs scrubbed telemetry and a configured
   exporter; the current extension's count report is not that trace viewer.
5. **Native edit acceptance/survival and PR metrics** as possible later signals
   of usefulness. They are documented by VS Code but are not yet qualified
   through this project's strict metric allowlist. Do not silently widen the
   privacy contract or equate accepted edits with correctness.

## Smallest route to first value

Use the existing Collector-to-Application-Insights path first when an approved
Application Insights resource/connection string already exists. Microsoft
documents this bridge for coding agents. Native Azure OTLP ingestion is an
alternative preview lane with separate onboarding and Entra/DCR requirements,
not a reason to create a Foundry service or redeploy the main Bicep template.

1. Inspect the actual target's workspace binding and access. Use the private
   operator configuration, not historical IDs or inferred targets. The
   deployment plan warns that the main template can repoint an existing
   Application Insights workspace: do not use it as a repair shortcut.
2. Qualify the changed strict config with the pinned real Collector. Run the
   poison smoke and check that labels survive as specified, content is absent,
   and trace ID/span ID/parent span ID remain connected. Then select one
   cloud exporter with a reviewed destination.
3. Use an ordinary native Copilot run on a public fixture: read a file, invoke
   a tool, call a subagent, and produce a bounded change. Start from a terminal
   carrying the reviewed OTel environment. Do not run both recorders/exporters
   over the same operations and accidentally double-count usage.
4. Query the standard span destination for that exact trace. The Azure Monitor
   exporter lane and native OTLP lane have different table contracts; inspect
   the actual schema. Verify agent operation/label, model, tool, parent IDs,
   durations and token counts. HTTP acceptance alone is insufficient.
5. Open **Agents (Preview)** and the transaction details for the same trace.
   Verify the tool and subagent tree visually. Keep custom-table readback as
   a separate receipt test.
6. Record the actual outcome separately: test result, accepted change/PR,
   correctness review and elapsed time. Answer a concrete question such as
   "Which tool consumed most of this run, and did its retry help?" before
   introducing additional dashboards or automated recommendations.

The definition of useful is a reproducible investigation with a supported
action and a measured outcome. Token counts alone establish activity.

## Verification boundary for this session

Read-only setup in this audit workspace reports local installation missing
and cloud not configured. Azure CLI, Copilot CLI and Docker are unavailable.
The pinned Collector installer could not download through the environment's
proxy. Consequently this session cannot establish current tenant state,
qualify OTTL execution, or prove Agents-view rendering. The config change is
reviewable and must pass the real-Collector gate before rollout.

## Current primary references

- [Application Insights Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view)
- [VS Code agent OpenTelemetry](https://code.visualstudio.com/docs/agents/guides/monitoring-agents)
- [Microsoft coding-agent Collector and Grafana guide](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights)
- [Azure Monitor native OTLP ingestion](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion)
- [Application Insights setup and experiences](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview?tabs=agents)
- [OTTL hash and type converters](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/ottlfuncs/README.md)
