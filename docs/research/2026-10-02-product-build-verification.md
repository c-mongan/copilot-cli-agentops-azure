# Product build verification — 2 October 2026

The local diagnostic product is implemented and independently reviewed. The lean enterprise synthetic pilot resources are deployed and read back, including exact typed REST readback for the 97-row synthetic batch and native portal proof of the Workbook. Production onboarding, model spend, and team access grants remain out of scope. Current cloud evidence is tracked in [enterprise deployment verification](2026-10-02-enterprise-deployment-verification.md).

Source baseline remains `0b91a3671376f9bc655aa955094d995ac711254c` on `feat/enterprise-flight-recorder`. Changes are uncommitted. Existing master-plan, pilot-evidence, overnight-plan and research work was preserved. Generated packages are review artifacts, not a published release.

## Delivered behavior

```text
Inventory → immutable pre-run snapshot → owned recorder process
                                      → metadata ledger + source integrity
                                      → Runs / replay / Architecture / Compare
                                      → qualified outcome bundle and local receipts
                                      → approved Azure ingress → deployed Workbook (native portal proof complete)
```

| Capability | Result |
| --- | --- |
| Product entry point | `product build`, `evidence`, `compare`, and `runtime` connect local capture, views, comparison and evidence APIs; prior audit remains available |
| Pre-run evidence | Hash-bound bounded inventory/configuration snapshot before collector/model startup; task identity; source-file integrity and attachment drift checks |
| Coverage | Recorded global coverage stays unknown; caller completeness stamps and stimulus counts cannot qualify exhaustive metrics; positive observations remain lower bounds |
| Model provenance | Launcher request, producer request and response model/provider remain separate; mismatches/mixed/unknown shown; credentials rejected from metadata rendering |
| Lifecycle | Pre-abort spawns nothing; startup OS cancellation reaches collector readiness; retry timers, sockets and processes are cleaned up with bounded shutdown |
| Outcomes | Typed schema-safe metadata bundle with replayed sink grades, null unknown outcomes/cost/delivery, same-run evidence references and explicit capture limits |
| Comparison | One predeclared treatment; nuisance/task checks; quality-first repeated-trial criteria; conditional descriptive `criteria-met` never authorizes a change |
| Evaluations | Seeded held-out StockPilot sink grader and replay; counterbalanced diagnostic kit with protected external keys and accuracy-first grading |
| Packaging | Installed runtime and protected grader replay work after source removal; explicit dependency allowlist excludes protected keys, dependency folders and sinks |
| Cloud pilot | Lean enterprise [deployment/cost/security plan](../plans/2026-10-02-lean-enterprise-deployment.md); additive Workbook `0c9ff309-52d7-5203-a194-ba64fae76a13` and 10-unit monthly resource-group budget deployed in the existing North Europe VS development/test resource group; production target still required |

## Verification results

| Check | Evidence |
| --- | --- |
| Full CLI coverage run after correctness repairs | 1,028 tests: 1,027 passed, one Windows-only skip, zero failures; line coverage 90.51%, threshold 80% |
| Final SDK, pattern, StockPilot and diagnostic suites | 98 passed, zero failures |
| Last Runs scroll accessibility source change | 15 affected view/comparison tests passed after the full run |
| Static analysis | 1,027 files passed after final source, transport, and browser repairs |
| JSON assets | 18 validated |
| Schema compatibility | Passed against retained `agentops-events-table-final.json`; a retained snapshot is not fresh cloud schema proof |
| Outcome qualification | Existing event producer → actual synthetic sink grade/replay → JSONL readback → twelve maintained schemas/projections → limited table/project KQL replay; no live model or human usefulness claim |
| Security audit | 13/13 passed, zero warnings/blockers |
| Product audit | 29/29 passed; 1,119 links checked; zero live KQL checks |
| Offline dashboard verification | Passed; 24 dashboards, ten V2; zero live queries |
| Package checks | CLI and SDK publish checks, distribution via install smoke, fresh temporary-prefix installation and Homebrew formula checks passed; current copied-package check passed 1/1 with `loadJsonContent` and exact workspace injection; private qualification assets were excluded; no publication |
| Enterprise infrastructure | Bicep compiled without warnings; ARM validation and what-if succeeded with only the new Workbook and budget to create, no modify/delete; deployment and resource readback succeeded while preserving the existing LAW/DCR/DCE/App Insights binding |
| Enterprise Workbook | Twelve panels plus single-run checks passed 23 actual bounded Azure queries with explicit subscription/customer scoping. The final ARM deployment read back the maintained JSON after workspace injection. Native portal proof showed default LAW/all-runs data across all twelve panels without query/resource errors; Last Hour refreshed the run list and single-run panels, with named AgentOps tables, linked panels, workspace-wide health, and five honest empty/unknown panels. Browser error logs were empty |
| Enterprise qualification and transport | Qualification prepared 97 synthetic rows across eleven metadata streams. Exact typed REST readback matched every maintained field and the privacy canary was absent; the first readback failure was retained and no re-upload occurred. Publishing defaults to zero without an explicit allowance, queues cap at 128 MiB each/256 MiB combined eligible, retries expire at 48 hours, and the daily budget is target/policy bound |
| Independent review | Model/query, coverage/lifecycle, comparison/evaluation, product/outcomes, enterprise IaC, transport, qualification, whole-enterprise integration and whole-change reviews approved after reproducible findings were repaired; final integration review had no P1/P2 findings |
| Open Code Review | Scoped KQL review returned two medium findings; alias regression and old invalid-ID fixtures repaired. Warning: total usage exceeded the requested soft token budget; this was a scoped review, not whole-repository coverage |
| Graphify | Code-only local refresh; 5,366 nodes and 13,023 edges after final enterprise source changes; no semantic/remote extraction |

All five local views passed desktop/mobile axe with zero violations, including best-practice rules. Search, filters, anchors, keyboard expansion/scrolling, model conflict and canary exclusion passed; no console/page errors. Clipped Runs columns needed manual contrast confirmation (13.06:1). Detailed browser interactions, screenshots, axe results and limits are in [rendered browser verification](2026-10-02-build-browser-verification.md). Synthetic request/actual-model fixtures are explicitly labelled; they establish UI behavior, not a new model execution.

Evaluation smoke proves 24 oracle fixture answers and three actual synthetic sink grades. It does not prove an independently executed held-out cohort or human usefulness. Human timing medians remain null. Current protected fixture artifacts are outside the repository at `/tmp/agentops-evaluation-review-repaired-20261002-1790949222`.

Parent check receipts and logs are retained under `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-build-20261002/`. Browser artifacts use the verifier's separately named scratch folder documented in its report. Full-run results are reused for unchanged paths; affected checks were rerun after later repairs.

## Remaining delivery boundaries

1. The synthetic pilot target, budget, additive IaC and Workbook resources are deployed. Select a regular organization-owned production subscription/tenant, effective access, permitted data classification and budget before any production onboarding. Current Visual Studio credit resources are for development/testing.
2. The pilot Workbook deployment and native portal proof are complete. Actual observer/editor/publisher access tests remain unexecuted because no team principals were approved; production access must be qualified separately.
3. Linux/Windows exact-candidate CI and published-release proof remain unexecuted. Current host verification is macOS; local package smoke is not a public release.
4. Independently qualified exhaustive capture, live held-out model execution and human diagnostic usefulness remain unproved. No automatic optimization, judge, refactor, merge, or unattended spending was enabled; the pilot data path remains bounded synthetic evidence.

Ponytail is installed and its direct simplification guidance informed the scoped product. Automatic lifecycle-hook activation remains unverified. Graphify and Open Code Review were used; their proof scopes are recorded above.
