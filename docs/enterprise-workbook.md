# Enterprise metadata Workbook

`workbooks/agentops-enterprise-workbook.json` is the lean authenticated team view for the custom-table pipeline. It is separate from the existing `agentops-workbook.json` placeholder. It reads the eleven metadata tables in the twelve-table maintained contract; it never queries `AgentOpsContent_CL`.

```text
Owned local recorder -> approved metadata projection -> Azure custom tables
                                                        |
                                    selected workspace + time + run
                                                        |
                                         enterprise Azure Workbook
```

## Parameters and deployment binding

- `Workspace`: single Log Analytics **ARM resource ID**, resource parameter type 5. The portable default `value::1` is the documented current-resource option. The picker uses an object resource-type filter, not an array. Deployment explicitly replaces its single selected value with the workspace ARM ID. A workspace customer UUID is not the resource picker value.
- `TimeRange`: time parameter type 4, default 24 hours. Every source filters `TimeGenerated {TimeRange}`; the query controls also bind `timeContextFromParameter`.
- `RunId`: single query dropdown, default `*` for all observed runs. Its values come from the newest 500 run IDs in summary, event and span rows within the time range. Single-selection values are encoded by `{RunId:base64}` and decoded inside a quoted KQL `base64_decode_tostring` expression. Single-select controls do not apply multi-select quote/delimiter settings. Older runs outside the bounded list need a narrower time window.

Set ARM Workbook `sourceId` to the exact workspace resource ID and `serializedData` to this asset. `fallbackResourceIds` belongs inside the serialized Workbook JSON, not ARM Workbook properties. Deployment binds both serialized `fallbackResourceIds` and `defaultResourceIds` to that same exact workspace ID and replaces the Workspace parameter value with that ID. `sourceId` alone does not populate this picker. Do not hardcode a subscription or workspace into this reusable asset. Each Logs query uses `queryType: 0`, `resourceType: microsoft.operationalinsights/workspaces`, and `crossComponentResources: ["{Workspace}"]`. [Microsoft Workbook schema](https://github.com/microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json), [Microsoft ARM Workbook properties](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/2022-04-01/workbooks)

## Views and evidence limits

| View | What it establishes | What remains unknown |
| --- | --- | --- |
| Run summaries | Recorded run dimensions, requested/actual model, nullable usage/cost/outcome | Actual model independent execution; cost billing; complete capture |
| Stream coverage and delivery | Query-visible row counts and latest timestamp by run/table | Expected rows, uploader acknowledgment, missing-stream cause, capture completeness |
| Model events | Event-level recorded request and actual model with opaque event IDs | Request is never an actual-model fallback; independent provenance is absent from schema |
| Tool/MCP/script execution | Recorded statuses, error types and nonzero exits | No failure signal does not assert successful execution |
| Span lineage | Recorded span/parent IDs, attribution and tool-call evidence | Missing spans and inferred links do not prove complete flow |
| Privacy | Recorded observation, leak verdict, dropped/redacted counts | Missing receipt/verdict remains unknown; no-leak row is not complete privacy proof |
| Collector health | Latest workspace-wide component/check row and recorded export timestamp | Not run-filtered: table has no RunId; export timestamp is not readback |
| Evaluations | Nullable deterministic scores | Execution/evidence tier is absent; a fixture grade is not a live business outcome |
| GitHub outcomes | Nullable PR, CI, review and timing metadata | Causal benefit, ROI and missing outcomes |
| Architecture insights | Controlled rules, quantities, status and selected evidence IDs/coverage limits | Arbitrary dynamic Evidence body is not displayed; an insight is not a refactor approval |
| Recommendations | IDs, controlled action/severity and nullable score | Proposal only; human review required |
| Evidence references | Opaque run/session/trace/event/parent/tool IDs for local lookup | No raw-content replay or private file/URL navigation |

All query panels return at most 500 rows. Counts represent stored rows; retries can duplicate them. Numeric/boolean nulls remain blanks, with explanatory evidence labels. The fractional `EstimatedCostUsdReal` field is used; the immutable legacy integer cost field is not a fallback. Usage is not summed across nested spans, avoiding invented zero totals and parent/child double counting.

The absence of a table or insufficient access should remain a query error. The workbook does not use fuzzy unions to hide those failures. An empty successful query displays an explicit not-observed message. Missing tables need schema/read-permission qualification, not a success label.

## Privacy and access

The view exposes approved metadata and opaque IDs, which can still be linkable or personal data. It deliberately excludes prompts/responses, source code, raw logs, tool arguments/results, private URLs, filenames, raw reference names, collector endpoints/detail text, arbitrary dynamic evidence objects, and recommendation narrative/artifact content. Publisher metadata projection and privacy canaries are still required; a view cannot sanitize arbitrary poisoned ingestion.

Readers need Workbook access and query access to every selected metadata table. A content-table deny should remain effective even if a user edits a query. Qualify observer/editor/publisher/unauthorized identities independently. A saved resource does not prove authentication or effective RBAC. [Microsoft Workbook access control](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-access-control)

## Local verification

```bash
node scripts/check-enterprise-workbook.js
```

The focused checker loads all twelve maintained schemas, confirms eleven metadata sources and twelve query panels, verifies every initial source projection against schema columns, verifies workspace/time/run binding and bounded results, rejects content lanes and schema drift, and replays typed summary fixture projections with unknown actual model/outcome/usage/cost. It separately checks measured `0`, `false`, fractional cost and failed outcomes. It does **not** interpret KQL filters, union, extends, summaries or ordering.

On 2 October 2026 the checker passed with 186 source-column references. Validation against the official Microsoft JSON schema also passed using Python `jsonschema.Draft7Validator`. These are local source/structure contracts, not Azure KQL or rendering evidence. The graph index was consulted for navigation, but freshness was uncertain; maintained source schemas supplied the contracts.

Live read-only KQL qualification on 2 October 2026 accepted all twelve panels and the RunId parameter query in subscription `<subscription-id>`, workspace customer ID `<workspace-customer-id>`. Each call explicitly passed subscription, workspace and `--timespan PT24H`; queries expanded the default time/run values and appended `take 5`. Only bounded result counts and errors were retained, with no row payloads. Six panels returned zero rows (runs, privacy, health, evaluations, GitHub outcomes and recommendations), five reached the five-row bound, and insights returned two rows. The RunId parameter returned five bounded rows. Zero rows establish syntax acceptance and empty readback, not completed coverage or outcomes. The receipt is `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/enterprise-workbook-20261002/live-kql-qualification.json`; it includes rendered query hashes and the asset hash. No cloud writes, uploads, models or notifications occurred.

Remaining acceptance: inspect saved Workbook context; render in Azure portal; exercise time/run selection, empty rows, errors, nulls and failures; verify all identity boundaries. No cloud write, telemetry upload, model call or portal qualification is performed by the local checker. Microsoft's documented time-filter expansion is the query convention used here. [Microsoft time parameters](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-time)

## Workspace picker rendering repair

Portal qualification exposed a blank workspace and twelve “No resources selected” panels. Live ARM content readback confirmed the original asset used unsupported `value::context::resourceId`, an array `resourceTypeFilter`, and empty fallback resources. The source now follows Microsoft’s single workspace-picker shape (`value::1`, object resource-type filter, and current-resource additional option); deployment binds the exact workspace ID explicitly. The focused checker rejects both original malformed shapes. This repair requires redeployment and a fresh portal interaction check; successful KQL CLI queries did not detect it. [Microsoft LA Workspace Insights Health sample](https://github.com/microsoft/Application-Insights-Workbooks/blob/master/Workbooks/LogAnalytics%20Workspace/Health/LA%20Workspace%20Insights%20Health.workbook)

## Single-run parameter rendering repair

After workspace binding was repaired, portal rendering exposed bare `*` interpolation in eleven run-filtered panels. The previous qualification had incorrectly added quotes itself and therefore missed the actual single-select behavior. All filters now use `base64_decode_tostring('{RunId:base64}')` for both the all-runs comparison and selected run equality. The single picker remains single; its misleading quote/delimiter properties were removed. Base64 formatting prevents quotes/backslashes in selected IDs from changing KQL syntax. The checker models this documented format and tests all-runs, single-run, quote/backslash and injection-shaped values. [Microsoft parameter formatting](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-parameters), [Microsoft single/multiple selection behavior](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-dropdowns)

Read-only requalification accepted all twelve panels with all-runs selection and all eleven run-filtered panels with a real single run selected from current event rows: 23 successful Azure calls. Every query used the maintained interpolation helper, explicit subscription/workspace, a 24-hour timespan and `take 5`. The single-run summary returned one row and evidence references returned two rows; missing selected-run model/failure/privacy/eval/GitHub rows remained empty. Receipt: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/enterprise-workbook-20261002/live-single-select-qualification.json`. Only counts, query hashes and rendered metadata queries were retained. Redeployment and fresh portal selection tests still establish actual browser formatting; local format modeling is not browser proof.

## Readable stream and time labels

Portal inspection found `union_arg0` style stream labels because KQL `withsource` was labeling subquery branches rather than physical tables. Each of the ten run-scoped coverage branches now adds its exact maintained table name as `SourceTable`; collector health remains a separate workspace-wide view. The checker requires exactly those ten explicit labels and rejects generated `union_arg` names.

The same inspection found “Last null” time choices: the asset supplied bare millisecond numbers where Workbook time options require `{ "durationMs": number }` objects. The four choices now use the documented object shape, preserving the 24-hour default and custom range support. The focused checker rejects numeric-only options. These labels require fresh portal readback after the parent redeploys the repaired asset. [Microsoft time parameter configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-time), [Microsoft time picker example](https://github.com/microsoft/Application-Insights-Workbooks/blob/master/Workbooks/Resource%20Groups/Virtual%20Machines/Virtual%20Machines.workbook)

## Tabbed layout and UX repairs — 2026-10-05

The Workbook now uses seven tabs: Overview, Runs & models, Tools & scripts, Trace lineage, Privacy & health, Quality & outcomes, and Insights & actions. A hidden `selectedTab` parameter drives link-style tabs, and each tab is a `NotebookGroup/1.0` group with `conditionalVisibility`. The checker collects query panels recursively from these groups. The checker now covers 14 panels; the 2 new ones are `kpi-tiles` and `activity-timechart`, both on Overview.

- **KPI tiles.** There are six tiles: runs, events, spans, tool/MCP failure signals, privacy leak signals and Collector heartbeat. An empty value reads "not observed", never success. Attention values carry a text "⚠ " prefix. Icon formatter 18 and `rightContent` were removed, because the portal truncated the tiles and rendered "[object Object]" in their accessibility labels.
- **Time chart.** It uses `make-series ... default=0 ... from {TimeRange:start} to {TimeRange:end} step {TimeRange:grain}`. Do not wrap the time tokens in `datetime()`; the Workbook already inserts KQL datetime expressions, and wrapping them caused a parse error at line 19. The checker models this by rendering start/end as `datetime(ISO)`.

Deployments `agentops-workbook-tabs-20261004`, `agentops-workbook-ux2-20261005` and `agentops-workbook-ux3-20261005` succeeded. Each what-if changed only the Workbook. ARM content readback matched the local items. In the signed-in portal, the tiles showed full text with clean accessibility labels, and the chart rendered without errors. A live read-only run of all 14 panel queries over 7 days returned rows and no errors. This is an owner view of synthetic metadata. It does not show observer isolation or independent usefulness.
