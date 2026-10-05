# Lean enterprise pilot deployment verification — 2 October 2026

The approved lean design is implemented and deployed into the existing North Europe development/test pilot. This report separates synthetic cloud qualification from production, team access and human benefit. Source head is `0b91a3671376f9bc655aa955094d995ac711254c` plus the preserved working-tree candidate; no commit, push or public release occurred.

```text
Owned local process -> private evidence ledger -> strict metadata projection
                                            -> bounded target-specific publishing
                                            -> existing DCE / 11-stream metadata DCR
                                            -> Log Analytics -> authenticated Workbook
```

## Deployment and costs

Target: subscription `<subscription-id>`, resource group `rg-copilot-agentops-synthetic-pilot-20260930`, North Europe. The separate Pay-As-You-Go subscription was not used. Fresh ARM readback confirmed spending protection On; the signed-in native portal confirmed positive current-period credit. Private financial amounts are not included here.

The additive Bicep references existing LAW, DCR, DCE and Application Insights. Reviewed what-if showed only two creates: saved Workbook `0c9ff309-52d7-5203-a194-ba64fae76a13` and resource-group budget `budget-agentops-diagnostic-pilot`. Deployment succeeded; resource readback confirmed the Workbook source workspace and the EUR 10 monthly budget. The budget has no notification recipients and is not a hard spending cap. Existing Application Insights remains bound to the original pilot LAW. No new runtime, model judge, action group, active health alert or principal grant was enabled.

The initial saved Workbook had an unsupported resource-picker default. The actual portal revealed it. A reviewed source repair now binds the exact LAW ID and resource defaults; a second what-if allowed only this Workbook modification. Redeployment succeeded, `canFetchContent=true` readback confirmed the selection and twelve panels, and a fresh portal load selected the intended LAW automatically. Further portal testing found unquoted single-run interpolation, unnamed union stream labels and invalid time-choice shapes. Reviewed repairs use documented base64 single-value formatting, explicit table labels and native duration objects. Each redeployment modified only this saved Workbook. Final ARM content matches the maintained source exactly after workspace binding.

The [approved cost plan](../plans/2026-10-02-lean-enterprise-deployment.md) contains current regional pricing, volume examples and production conditions. Its budget estimate is separate from measured usage. This qualification used one synthetic batch, capped by an explicit 1 MiB publishing allowance. The uploader reserved 86,987 conservative upper-bound bytes against that allowance. Default product publishing allowance remains zero.

## Cloud data qualification

Prepared batch `enterprise-synthetic-9e008465-d71f-4181-9baa-90a1ee07e9cb` uses the actual demo, native event, span and product evidence projection paths with synthetic inputs. Prepared SHA-256: `04dcb3fec79c2c0637ee8077e9734545ba3cd4e21a6c59254f95ab88c9d1bd83`.

| Stream | API accepted | Typed rows observed exactly |
| --- | --- | ---: |
| Run summary | Yes | 9 |
| Events | Yes | 53 |
| Spans | Yes | 1 |
| Tool calls | Yes | 8 |
| MCP calls | Yes | 3 |
| Privacy | Yes | 1 |
| Evaluation | Yes | 8 |
| GitHub outcomes | Yes | 2 |
| Architecture insights | Yes | 3 |
| Recommendations | Yes | 1 |
| Collector health | Yes | 8 |
| **Total** | **11 streams** | **97** |

The uploader accepted each stream once. No duplicate upload was used to address latency. First bounded readback retained missing/failed results. The query CLI flattened nulls, booleans and numbers into strings; the strict comparator rejected them. A reviewed repair uses the official typed Logs query API without weakening comparisons. Second bounded readback matched every maintained schema field, row multiplicity and original manifest/stream hash. Secret-like fixture canary absence passed in all eleven projected streams. Acceptance and observation remain separate receipts.

This proves synthetic producer/schema/ingestion contracts. It does not establish complete live capture, actual model provenance, real GitHub outcomes, independently graded model quality or human diagnostic benefit. The content stream was excluded.

## Verification and repairs

- Current full CLI suite: 1,028 tests, 1,027 passed, one Windows-only skip, zero failures; 90.51% line coverage against an 80% threshold.
- The real Collector test stopped after any receipt bytes appeared. It now waits for the exact terminal supervisor span with exit code 7 before shutdown; all outcome assertions remain. Isolated and three concurrent checks passed, followed by the full suite. No production instrumentation changed for this repair.
- Current installed-package smoke passed after copied source removal. Packed Bicep loads its Workbook JSON and preserves workspace binding; installed runtime/protected receipt replay and private-asset exclusion pass.
- Enterprise access and typed qualification regression tests: 12 passed. Warning-free compiled IaC, metadata Workbook source contracts and schema checks passed. Final source static analysis passed for 1,027 files. A separate whole-enterprise integration review found no outstanding material P1/P2 findings.
- Independent security reviews approved canonical Monitor endpoint validation, exact Node wire bytes/conservative CLI serialization bounds, spool ownership/link protections, retained retry expiry, shared target/policy/clock-bound publishing budget and complete typed readback. Two eligible queues each default to 128 MiB; retained original evidence is not a global disk cap.
- Existing SDK/evaluation suites (98 passed) and local desktop/mobile browser proof are reused for unchanged code. Deterministic fixture grading does not establish live held-out model or human outcomes.
- Ponytail simplification guidance, Graphify local code indexing (5,366 nodes / 13,023 edges) and scoped Open Code Review were used. The external review's original soft token budget was exceeded; no new hosted model review was run during deployment. New enterprise reviews were performed independently by delegated agents.

Final saved Workbook browser proof: all twelve panels rendered without resource/query errors with the intended workspace and default all-runs selection. Actual single-run filtering returned one summary, correct linked evidence and explicit unknown empty panels. Stream labels use exact table names. Native time choices displayed Last hour, Last 4 hours, Last 24 hours and Last 7 days; switching to Last hour refreshed the run list and results. Health remains correctly workspace-wide. The tab is left open for review. No captured browser console errors were observed. These are signed-in owner checks, not observer isolation or independent human usefulness.

Private parent receipts are retained at `<agent-workspace>/scratch/agentops-enterprise-20261002/`: original deployment, what-if, budget/Workbook readback, upload receipt, first/second readback and final check logs. No credentials are retained in these reports.

## Remaining production gates

A regular organization-owned production subscription, named operator, approved principal groups and effective access boundary are still required. Current resource-permissions access mode causes the deployment guard to reject team grants. No observer/editor/publisher isolation was claimed or assigned. Notification recipients were not invented. Linux/Windows exact-candidate execution and public release are not proved on this macOS host. Live held-out model execution and human diagnostic timing remain unqualified.

## Tabbed Workbook redeploy and end to end — 2026-10-05

- **Deploys.** Three Workbook-only redeploys succeeded: `agentops-workbook-tabs-20261004`, `-ux2-20261005` and `-ux3-20261005`. Each what-if showed only the Workbook as Modify. ARM readback matched every local item.
- **Publish and readback.** Three synthetic metadata spans were published and returned HTTP 204. Readback found 3 of 3. The publisher used a cached CLI token, so this does not prove VS Code provider sign-in.
- **Panel queries.** All 14 ran live over 7 days without errors.
- **Portal.** The Overview tiles and chart rendered in the signed-in owner portal.
- **Private receipts.** `<agent-workspace>/scratch/workbook-redesign-20261004/`.
