# AgentOps deep audit and completion map — 2 October 2026

## Verdict

**AgentOps is useful today as a local Copilot execution debugger and a synthetic Azure evidence pipeline. It is not yet a proven architecture optimizer, a deployed cloud application, or a demonstrated productivity improvement.** The core engineering is substantial and the local checks are green. The important unfinished work is trustworthy eligibility for architecture analysis, a valid change-comparison contract, producer-to-view qualification beyond event/span transport, and measured user benefit.

Audited local head: `0b91a3671376f9bc655aa955094d995ac711254c`, branch `feat/enterprise-flight-recorder`. Existing dirty master plan, overnight plan and older research were preserved. No product code was modified, no models were newly trialled through Copilot/Vally, and no Azure writes, releases or pushes occurred. Ponytail installation was separately requested and completed. OCR invoked its configured review provider; its successes and failures are reported below.

Five independent agents reviewed platform sources, plans/code, tests/evaluations, Azure/GitHub state, and complexity. Detailed reports:

1. [Plans, architecture and data flow](2026-10-02-plans-architecture-audit.md).
2. [Current Microsoft/GitHub/OTel/Aspire/Vally capabilities](2026-10-02-current-platform-research.md).
3. [Fresh tests and retained evaluation regrades](2026-10-02-tests-evals-audit.md).
4. [Fresh deployed Azure and GitHub state](2026-10-02-deployment-audit.md).
5. [Ponytail complexity review](2026-10-02-ponytail-audit.md).

## What works, with the right proof tier

| Capability | Evidence from this audit | Limit |
| --- | --- | --- |
| Core CLI | 951 passing tests, zero failures, one Windows-only skip | Local macOS proof; current head has no remote CI qualification |
| Fixtures, graders, SDK adapter | 88 passing tests | Synthetic/local contracts |
| Product/assets | 29/29 product checks; 10 V2 dashboard drift checks; schema/JSON/static checks pass | Packaged dashboards are not deployed dashboards |
| Native semantic receipts | Patterns 12/12 checks; StockPilot MCP/delegation 9/9 | Replays retained live executions, not new model runs or global completeness |
| Task correctness | Retained repaired full corpus regraded 12/12; actual sink outcomes | Known synthetic tasks/data, one execution each, no reviewed blind holdout |
| Repeated comparison | Three baseline and three candidate sink grades pass | Tool-call medians 9 versus 10, below declared 20% effect; inconclusive |
| Azure delivery | Fresh typed exact-run readback: 390 rows, 14,639 field comparisons, all matched | Nine selected synthetic runs; continuous ingestion and other table producers unqualified |
| Browser | Current-source regenerated Runs/reviewer replay/Architecture/Compare exercised | Retained inputs; no new execution or cloud frontend screenshot |
| Human value | Study protocol and evidence schema exist | No consenting participant results or measured diagnosis benefit established |

`dashboard kql-check` unexpectedly ignores `--help` and `--local-only`. The test auditor's attempted local check executed read-only Azure queries: 35 succeeded, 14 returned rows and 21 were empty. This is query smoke proof, not offline compilation or a guarantee every dashboard has data. No cloud mutation occurred.

## Architecture and data flow

```text
Repository definitions                         Explicit observed launch
agents / skills / references / owned scripts    agentops copilot
          |                                               |
          v                                      scoped supervisor
hash-bound attachment inventory                  + owned Collector
          |                                               |
          |                      +------------------------+----------------+
          |                      |                        |                |
          |               Copilot events             native OTel     owned script
          |               + tool-call IDs             spans           OTLP receipts
          |                      |                        |                |
          |                      +------- strict metadata projection ------+
          |                                               |
          |                         local run ledger + target-bound outbox
          |                         run-context / Events / Spans / receipts
          |                                  |                       |
          +------ architecture join ---------+                       |
                     |                                               |
          coverage + version + task gates                    reviewed ingestion
                     |                                               |
          metrics / hypothesis cards                         Azure DCE + DCR
                     |                                               |
          Runs / replay / Architecture                       Log Analytics tables
                     |                                               |
          single-change Vally trials                 exact-ID typed readback
          + actual task/sink graders                         + Azure Logs
                     |
          Compare + human decision
          (no automatic refactor)
```

These are multiple carriers rather than one universal trace. Native session identity and tool-call IDs can establish exact joins. Owned script run identity establishes logical linkage; timing/path joins remain inferred where there is no physical parent. Unknown tokens, capture completeness, native script outcomes and provider coverage must remain unknown. A hash of observed configuration is provenance, not independent verification of every effective setting.

The Azure route currently qualified is custom-table Logs Ingestion. Native Azure OTLP preview, the Application Insights Agents view, existing Azure Monitor exporter, local SDK adapter and optional content path are separate contracts. Passing one does not qualify the others.

## What is actually deployed

The selected pilot is `rg-copilot-agentops-synthetic-pilot-20260930`, in Visual Studio Enterprise subscription `<subscription-id>`. It has a Log Analytics workspace, Application Insights, two DCEs, two DCRs, and twelve custom Analytics tables. Fresh source-to-cloud comparisons cover 200 Events and 190 Spans rows.

**There is no deployed AgentOps Grafana, Workbook, portal dashboard, hosted product frontend, actioner, hosted judge, shared storage or active scheduled-query alert in the inspected subscription.** These optional implementations exist in the repository. They are not requirements to finish a narrow local pilot. Azure Logs is the verified cloud query surface; Runs, Architecture and Compare are local HTML.

The pilot workspace has a 1 GB/day cap and 30-day default retention; its twelve custom tables have seven-day retention. The separate original managed workspace remains uncapped (`dailyQuotaGb=-1`). No AgentOps budget was found. Subscription spending limit is On; remaining credit was not freshly measured. These controls have different scopes and must not be collapsed into one claim of enforced zero paid usage.

Public remote main is `090d337...`; its latest successful CI is from 18 August. The remote feature branch is also behind the local candidate. The October local implementation is not the published/CI-qualified head. Publication remains separate from this read-only audit.

## Finish priorities and acceptance checks

| Priority | Required work | Observable completion |
| --- | --- | --- |
| P0 | Define supported component coverage per runtime; freeze pre-run manifest, task contract, versions, and source denominators | Real supported runs qualify for appropriate metrics without stamping unsupported surfaces complete; incomplete/late/changed-manifest runs are excluded |
| P0 | Separate intended treatment identity from nuisance configuration in comparisons | A one-change architecture variant can be compared to its baseline; unrelated model/tool/MCP/runtime drift is rejected; partial configuration stays unknown |
| P0 | Reconcile requested model with source-reported actual model | Reviewer launch requested mini but native/cloud receipts report 5.5; tests detect mismatch and reports display both instead of certifying an override |
| P0 | Make flag/help behavior safe and explicit | `dashboard kql-check --help` performs zero network queries; unsupported flags are rejected; local rendering and live queries are distinct |
| P1 | Qualify useful summary/eval/insight/recommendation/health producers | Each chosen contract has valid synthetic production, privacy projection, delivery, typed readback and a rendered query/view; a table alone does not count |
| P1 | Test supported lifecycle/runtime matrix | Windows on Windows; exit-time flush on selected CLI; cancellation during setup, collector death and owned child cleanup; unsupported Python forms remain explicit |
| P1 | Prove usefulness against native tooling | Blinded incident diagnosis comparison measures time and correct attribution; held-out tasks and repeated trials show task quality before efficiency |
| P1 | Simplify supported product surface | One default flight-recorder path, one supported dashboard generation, optional legacy/hosted surfaces clearly separated; privacy and evidence boundaries retained |
| P1 | Fix replay landmarks and test human navigation | Nested main landmark and unlandmarked summary resolved; keyboard/screen-reader checks cover the actual flow |
| P2 | Prepare the selected distribution/deployment | Reviewed exact-head Linux/Windows CI and install checks, chosen operator UI, explicit retention/access/spend policy; fresh target-state readback after an authorized release |

The recorder deliberately sets all six global coverage kinds to unknown and `evidenceComplete=false` ([session-run-delivery.js](../../agentops-cli/src/lib/copilot/session-run-delivery.js)). The architecture loader and metrics require affirmative completeness. Consequently, live architecture findings remain unavailable. Do not repair this by changing false to true: build supported evidence denominators and component-specific eligibility. Observed failure/latency analysis need not pretend that absence is proven.

Compare currently requires equal architecture identities and equal authoritative configuration identities ([views.js](../../agentops-cli/src/lib/architecture/views.js)). A real architecture change intentionally differs. This is a comparison-contract limitation, not proof that experiment execution is impossible: stored decisions still render, and the view itself never approves or merges. Define the treatment separately and hold other effective settings fixed.

The reviewer launch scripts passed `--model gpt-5.4-mini`; current native events, retained model-bearing spans and fresh Azure rows report `gpt-5.5`. The previous completion document's runtime override claim is contradicted. This audit establishes the discrepancy, not its upstream precedence/root cause. Original evidence was preserved.

## Current platform reuse and usefulness

Microsoft already supplies [Application Insights agent observability](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view) and [prebuilt coding-agent dashboards](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights). GitHub supplies native CLI/SDK spans and model/tool signals. Current [Aspire persistence documentation](https://aspire.dev/dashboard/data-persistence/) describes SQLite, although older official descriptions conflict. Vally supplies execution and grading. These overlap with general timelines, token charts, runner plumbing and trace storage.

Retain the differentiated layer: declared-versus-observed architecture, safe reference reads, evidence strength, coverage denominators, privacy/delivery receipts, deterministic sink outcomes, and reviewable one-change proposals. Investigate delegation to native viewers before expanding custom dashboard surface. Do not delete the ledger or redaction boundary until native substitutes preserve those contracts.

Current stable Copilot CLI is 1.0.91, SDK 1.0.16; Vally 0.17.0 pins CLI 1.0.85/SDK 1.0.14. Qualify exact versions rather than applying rolling docs to an older runtime. GenAI conventions moved to a separate developing repository. Native Azure OTLP remains preview and needs separate HTTP/protobuf, auth and metric aggregation qualification. Vally `--compare` reports judge-based regressions without itself enforcing a failure gate. Details and primary citations are in the platform report.

The strongest next product experiment is a diagnosis trial, not another transport smoke run: can an engineer identify a missing reference, failed MCP call, wrong actual model and script failure faster and more accurately than with native telemetry alone? Use hidden incidents, randomized tool order, accuracy as the primary guardrail and recorded setup effort. The existing usability protocol supplies 5–10 participant pilot targets; no participant results were found in this audit. No customer ROI claim is justified yet.

## Browser, Graphify, Ponytail and OCR proof

Fresh current-source product views were generated from the retained reviewer ledger into `<agent-workspace>/scratch/agentops-deep-audit-20261002-product/`. A named isolated agent-browser session exercised run search (one matching card), reviewer replay, native OTel plus `chat` search (two matching spans), Architecture (zero eligible runs), and Compare outcomes (zero accepted, two inconclusive). At 390px the document width was 390px; desktop was 1440×1000. Browser error and console collections were empty for the tested flow. This completes a fresh rendered check of the skill-doctor reviewer view previously reported as browser-blocked; it does not prove every page/participant flow.

Axe 4.12.1 default scan found two moderate best-practice issues: `landmark-main-is-top-level` at `#timeline`, and `region` at `.summary-grid`. WCAG 2 A/AA-tagged scan found zero violations. Automated scans are not screen-reader proof. Screenshots are external scratch `agentops-reviewer-audit-current-desktop-20261002.png` and `agentops-reviewer-audit-mobile-20261002.png`; the latter captures the earlier retained rendering, while the fresh source was separately exercised at mobile width.

Graphify read-only `affected` queries successfully traced `sessionWaterfall` and `loadLedgerFromDirectory` consumers into views, local queries and tests. The existing graph's overall freshness was not assumed; source inspection verified the material paths. A `processSupervisor` name query had no unique match and fell back to source. No project graph was created or refreshed.

Ponytail 4.10.0 was installed through `codex plugin add ponytail@ponytail`, read back as installed/enabled in the CLI and config, and its audit skill applied by the complexity reviewer. Its rules were loaded directly for this session. Automatic lifecycle hook activation in a newly started desktop thread was not tested; the upstream install instructions require restart and hook review/trust. No personal-profile/browser security prompt was bypassed.

Open Code Review completed commit `0b91a36`: one selected file, zero findings, exit 0, approximately 2,602 reported tokens. Broader recent-core range review failed before meaningful review because its estimate exceeded the 35,000-token cap; narrowing to two files still exceeded 30,000. A single adapter review then failed during context compaction (one cancelled request), with roughly 35,293 reported tokens. Those attempts are incomplete and must not be presented as 26 clean files. Raw outputs are `agentops-audit-{ocr,core-ocr,views-ocr,adapter-ocr}-20261002.txt` under external scratch. Manual source review and regression proof remain separate.

## Recommended delivery boundary

Finish a **Copilot-focused internal diagnostic pilot** first: supported version/coverage matrix, trustworthy actual model reporting, valid comparisons, deterministic task outcomes, a usable local UI, and the existing Azure event/span store. Treat enterprise fleet services, automatic remediation, hosted judges, extra providers and VS Code parity as separate qualified extensions.

The repository does not need another generic tracing platform to finish this pilot. It needs enough evidence to make one reliable operational decision, and a measured demonstration that the decision is easier with AgentOps.
