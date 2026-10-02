# AgentOps live and synthetic Azure completion — 2 October 2026

The planned local product, bounded live capability test, and synthetic Azure
readback are verified. This record closes the two held operations in
[the completion review](2026-10-02-agentops-completion-review.md), without
claiming enterprise readiness or complete provider observation.

The user explicitly authorized continuation without current credit and enforced
Copilot paid-stop confirmations. Existing Azure spending protection remained On;
no billing or credential settings changed. All model launches were serial,
with one worker, one stimulus, and zero automatic retries or model judges.

## Live execution and repairs

Pinned Vally 0.17.0 and Copilot 1.0.85 executed the owned StockPilot MCP and
named read-only specialist using `gpt-5.4-mini`. Three launches are preserved:

| Launch | Presentation | Native ledger contract | Vally requests | Reported AIU |
| --- | --- | --- | ---: | ---: |
| v1 | Failed | Failed | 7 | 2.943375 |
| v2 | Failed | Passed | 10 | 2.894325 |
| v3 | Passed, 3/3 | Passed, 9/9 | 6 | 2.009805 |

The fixture rejected valid MCP request `_meta`. A direct pinned SDK request
reproduced that protocol incompatibility. The repair accepts the metadata
envelope outside arguments, validates progress tokens, retains strict tool
argument validation, and never includes metadata in tool results. The original
native wire metadata was not retained; its precise contents are not claimed.

The second launch completed the intended tool sequence but omitted the snapshot
fields from the delegated task. The specialist correctly returned unknown.
The stimulus now forwards SKU, warehouse, observed date, and on-hand value.

Final run `stockpilot_mcp_20261002_v3`, session
`7734c219-07d4-44a1-8f50-0cd708c84ec9`, proves one snapshot success, one deliberate
unavailable-snapshot failure, then named `stock-risk-auditor` completion with
`AUDIT_MATCH` for SKU-0042 / WH-EAST / 2026-06-15 / 312. The specialist viewed the
CSV once and performed no command, network, skill, or MCP action.

Actual SDK history and OTel evidence yielded 42 native events, 24 exported events,
and 30 span rows, with zero invalid records. No equivalent separate native run
was substituted. Vally reports six requests, 52,985 input tokens and 781 output
tokens. Native replay shows seven distinct chat spans, five with measured usage;
its token totals match. These different count bases remain explicit. Across
these three launches only, Vally reports 23 requests and 7.847505 AIU.

## Azure delivery and readback

The exact existing Visual Studio Enterprise subscription, staging resource
group, workspace, DCE, and DCR were verified. No infrastructure deployment was
needed; `main.bicep` was not applied.

- Subscription: `0222a208-955a-45fd-b6d8-ca4704421bf0`.
- Workspace: `law-copilot-agentops-eval-eval930`, customer ID
  `f556e73c-530a-4e5d-abe1-4de1407a8a11`.
- DCR immutable ID: `dcr-1b45ce3240c3473893972da44a2c2383`.
- One attempt per table uploaded 153 events and 137 spans, 268,075 wire bytes
  including two trailing newlines, below the 1 MiB bound.
- Exact four-run-ID queries returned all 290 rows. All 10,889 source-field
  comparisons matched; no missing or extra rows or privacy canaries.
- 929 unknown-token null checks and four measured-zero checks passed. Repeated
  span lifecycle identities were compared as full typed field multisets.

The original pre-upload review remains preserved. `delivery-proof.json` and
`field-readback-audit.json` record actual writes and field-level readback.
These uploads contain the four earlier captured agent-pattern runs; the new
StockPilot run is separately proven locally and is not described as uploaded.

## Final UI and checks

The new actual SDK receipts were rendered with existing Runs/replay/Architecture/
Compare functions. The static inventory was discovered after execution and is
explicitly not proof of pre-run attachment or coverage. Original run contexts
were copied without modification. Configuration identity and global coverage
stay unknown, with zero eligible architecture runs and no absence verdict.

Desktop 1440×1000 and mobile 390×844 checks exercised run search, session replay,
exact failure links, failure/native filters, and navigation. Mobile document
width remained 390. Model/token provenance and metadata redaction were visible;
no canary, console error, or page error was found. The fresh Azure REST viewer
is local evidence rendering, separate from the earlier real Azure portal photos.

The final StockPilot suite passed 56 tests, including actual pinned SDK metadata/
success/failure roundtrip. Static checks passed 961 files; diff checks passed.
The unchanged CLI retains its verified 951 passing tests and one macOS platform
skip, 94.10 percent coverage, and passing package/schema/dashboard/KQL/product
gates. The unchanged additive Bicep compilation remains valid. A separate
read-only completion audit found no further scoped local implementation gap.

Artifacts are under
`/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-patterns-20261002/`:
`stockpilot-live-final/LIVE-PROOF.md`, `native-proof-all.json`,
`azure-patterns-bundle/field-readback-audit.json`, `live-final-browser-proof.json`,
and `screenshots.html`. The gallery adds seven fresh screenshots to the prior
13 local and four earlier portal captures. Owned live processes are terminal.

No push, publication, production deployment, experiment merge, automatic
refactoring, or global agent installation occurred. Historical experiments stay
inconclusive. Unrelated dirty master plans and prior evidence files remain
preserved. Enterprise/Grafana deployment and universal runtime coverage remain
separate scope, as specified in the original plan.
