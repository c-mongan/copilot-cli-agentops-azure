# Branch integration and upstream reuse audit

Date: 2026-10-07. Repository: c-mongan/copilot-cli-agentops-azure.
Baseline: `4e1d3fbccd96a96e96aa027c89c02adcfd9f70c6`.
Scope: full fetched Git history and source inspection; no branch merges,
upstream code imports, cloud deployment or live Azure qualification.

## Integration decision

Build forward from current main plus the local privacy-preserving agent-label
patch. The branch inventory does not represent five missing feature sets.
Several branches were incorporated by squash or equivalent import. Full-history
and blob comparisons are recorded in
[the machine-readable evidence](2026-10-07-branch-integration-evidence.json).

| Branch | Verified relationship to main | Integration decision |
| --- | --- | --- |
| `cmongan/agentops-v2-control-room` | No common ancestor even after unshallowing. All ten V2 dashboard files and the generator exist in main and have evolved. 131 identical blobs, 155 changed common paths, 20 branch-only paths. | Use main's implementation. Review the old sample/poison fixtures only for uncovered cases; do not merge unrelated histories. Old screenshots are historical evidence. |
| `feat/native-azure-publish-proof` | Entire final tree equals merged #168 commit `ee7029b`. Main has subsequent changes. | Already incorporated; no merge required. |
| `fix/pin-azure-mcp-2.0.5` | Patch-equivalent commit exists in main; merged #169. | Already incorporated; reconcile the remaining `@latest` sample separately. |
| `qualification/native-windows-20261003` | 774 identical blobs, 102 changed common paths, no branch-only files. Five core launcher/qualification files match main exactly. | Keep main's newer capture/readback work. Code equivalence does not establish live Windows qualification. |
| `docs/pr170-walkthrough-wording` | One commit directly atop current main, two files, three additions and three deletions. | Independent wording follow-up; no platform dependency. |

Main's V2 work includes filter-preserving navigation, shared saved-view and
recommendation links, alert handoffs, comparison evidence, schema/export health
and generator checks. Its value should be retained in the new product views.
Commit counts alone are misleading: the Windows branch's 68 divergent commits
are not 68 missing features, and the control-room branch's 33 commits are not
an outstanding merge queue.

## Existing code worth carrying forward

| Code | Existing value | Boundary still to implement or qualify |
| --- | --- | --- |
| `grafana/dashboards/v2/`, `workbooks/` | Queries, navigation, overview and native-span diagnostics | Reconcile actual exporter schema; native portal dashboard deployment and live drilldown proof |
| `agentops-cli/src/lib/observability-queries.js` | Named query definitions and aggregation | Bounded Azure execution with result receipts; existing command output is KQL text |
| `agentops-cli/src/saved-views.js` | Saved investigation state | Shared authorization, stable links and versioned updates |
| `agentops-cli/src/lib/recommendation-store.js` | Recommendation review, export and action plans | Shared decision persistence and authenticated attribution |
| `actioner/index.js` and `actioner/README.md` | Ask AgentOps context, shared-store write/editor handlers and alert packets | Extract reusable builders; current handlers are not a completed team authorization or concurrency system |
| `agentops-cli/src/lib/architecture/experiment-contract.js` | Frozen identity, single-file treatment, repeat trials and quality gates | Runtime identity remains caller-asserted; independent evidence and holdouts need qualification |
| `agentops-cli/src/lib/architecture/metrics.js` | Conservative coverage handling | Modern producer qualification deliberately returns false; no full-run unused-skill or coactivation claims |

The shared-store HTTP trigger uses `authLevel: function`. The Blob output
binding does not establish conditional ETag updates or atomic review history.
Do not expose it as an Entra-authorized team approval service merely because
it can write JSON. Preserve the validators and record structures; add the
identity, authorization, conflict and idempotency semantics in the workflow API.
The existing Ask AgentOps handler can render a draft from supplied context;
that is not proof it has queried current Azure telemetry.

The experiment contract fixes requested/actual model, provider, runtime, tools,
MCP settings, task, dataset and grader across both sides. It requires exactly
one changed file and reports descriptive, conditional results. Therefore
"does a cheaper model retain quality?" requires a new explicit model-treatment
contract, not loosening the existing v1 checks. V1 should first validate a
single instruction/skill-file change. Failure-regression experiments with a
failing baseline also need a distinct contract: v1's efficiency gate requires
the baseline to pass, so it cannot certify a failing-to-passing repair.

## Langfuse: inspect, select, adapt

Inspected upstream commit:
`1a21a4229c98dd0dbba2916631ca5fe3e05fd504`.
Repository: https://github.com/langfuse/langfuse

| Inspected path | Useful pattern | Reuse decision |
| --- | --- | --- |
| `web/src/features/trace-graph-view/README.md` | Aggregated versus expanded observations, worker-based layout, selected observation links | Product reference; optional later run graph, not a replacement for Azure waterfall proof |
| `web/src/features/trace-graph-view/graphNodeMatching.ts` | Cycle-safe nearest-visible-ancestor selection, exact and aggregated node matching | Small pure helper is a candidate for later extraction with attribution and tests |
| `web/src/features/trace-graph-view/buildGraphCanvasData.ts` | Domain-to-visual projection | Do not copy wholesale: domain dependencies and synthetic start/end nodes must not become canonical evidence |
| `web/src/features/mcp/core/define-tool.ts` | Runtime schema validation and per-tool authorization/read-only annotations | Adapt interface pattern to our Azure contracts; not a drop-in module |
| `web/src/features/mcp/core/run-mcp-tool.ts` | Instrument tool execution and distinguish request/server errors | Reimplement with metadata-safe attributes; do not copy identity logging blindly |
| `web/src/features/mcp/server/experiments/tools/listExperimentItems.ts` | Required time bounds, cursor pagination, optional heavy fields and observation links | Apply to compact evidence tools; Langfuse's auth, API and entitlements remain product-specific |

The graph uses timing-inferred sibling relationships as well as parentage;
our UI must label inference and preserve real parent/span IDs. Its README
lists node virtualization as future work, not an existing capability.
Langfuse's root license at this commit is MIT, excluding `ee/`, `web/src/ee/`,
`worker/src/ee/` and independently licensed components. Preserve notices for
any actual copy. These inspected paths are outside the excluded directories;
transitive dependencies still require review at extraction time.
Pinned license: https://github.com/langfuse/langfuse/blob/1a21a4229c98dd0dbba2916631ca5fe3e05fd504/LICENSE

## SigNoz: compact, dependable agent tools

"Signal" is interpreted as SigNoz, consistent with the previous research.
Inspected MCP server commit:
`a215f6adc8741066a3349a1db72cca74f2d48487`.
Repository: https://github.com/SigNoz/signoz-mcp-server

| Inspected path | Useful pattern | Reuse decision |
| --- | --- | --- |
| `internal/handler/tools/query_builder.go` | Dedicated trace/log/metric tools, advanced query fallback, explicit bounds and warnings | Use named Azure tools first; adapt guidance and validation, not SigNoz query syntax |
| `internal/mcp-server/contract_budget_test.go` | Limits on actual wire tool count, schemas and descriptions | Add equivalent contract tests to prevent the analyst's tool catalog becoming excessive |
| `internal/client/error_envelope.go` | Bounded recognized errors, redacted credentials and markup, schema-drift reporting | Reimplement Azure-specific error envelopes; do not expose raw upstream JSON |
| `internal/mcp-server/testdata/wire-catalog/` | Golden wire contracts for discovery, successful calls and failures | Test protocol output, not merely internal handler objects |

Do not adopt the query builder's raw user-request `searchContext` behavior
under metadata-only collection. Read-only tool annotations are useful model
hints, but actual credentials and server authorization enforce access.
The inspected MCP repository is Apache-2.0; preserve applicable notices and
mark modifications for copied material. The main SigNoz product has separate
licensing, including enterprise exclusions. Do not infer a collector or UI
component's license from the MCP server license.
Pinned license: https://github.com/SigNoz/signoz-mcp-server/blob/a215f6adc8741066a3349a1db72cca74f2d48487/LICENSE

## Resulting product boundary

A thin Azure-hosted workbench owns saved investigations, finding review and
experiment decisions. Azure owns telemetry storage, native traces and portal
Grafana diagnostics. The CLI and UI consume the same evidence contracts.
Foundry Insights is an optional source of reviewed hypotheses. It does not
replace independent evaluation or silently gain control over Copilot agents.
No Langfuse/SigNoz backend, ClickHouse cluster or parallel trace store is needed
for this design. No upstream code was copied during this audit.

See [the integrated platform design](../superpowers/specs/2026-10-07-azure-agentops-platform-design.md)
and [the current Microsoft capability assessment](2026-10-07-current-capabilities.md).
