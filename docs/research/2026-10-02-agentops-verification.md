# AgentOps verification — 2026-10-02

The local product and bounded live synthetic workflow are verified. This report follows the October 1 implementation and Azure proof; it does not claim exhaustive provider observation or production readiness.

## Delivered changes

- Added optional `copilot launch --expectations <manifest.json>` validation before execution. A bounded independent stimulus manifest supplies expected counts and support declarations. Only its scope, hash, and validated component fields enter metadata. Old records and global completeness remain unknown.
- Runs now displays attempted, observed, completed, failed, pending, expected, and missing component receipts. Counters deduplicate lifecycle IDs and valid script/model spans. Distinct skill activations are not execution outcomes.
- Added a reproducible twelve-task StockPilot specification and authoritative post-grading against actual bounded synthetic sink files. Output-only Vally grading is explicitly operational, not correctness proof.
- Fixed contradictory synthetic inputs: three distinct aggregate low-stock products for the batch task, a known 2× promotional analog for SKU-0116, and a fixed June 15 planning date. Existing acceptance requirements were retained; additional supplier, cycle-count, and escalation sink checks strengthen them.
- Added inline favicons after isolated browser inspection exposed a real favicon 404.

## Proof tiers

| Tier | Result | Limit |
| --- | --- | --- |
| Local | CLI 923 passed, one Windows-only skip; StockPilot 49 passed; schemas 14 passed; dashboard checks 10 passed; static checks passed for 916 files | Local contracts and synthetic fixtures |
| Live corpus | Fresh twelve-task execution: 12/12 passed actual output/sink grading | One worker, synthetic files, included Copilot models |
| Native capture | Declared stimulus receipts fulfilled; source-to-ledger-to-rendered Runs verified | Provider completeness stays unknown |
| Repeated experiment | Three trials per variant, all six actual sink grades passed; inconclusive | No accepted change or general efficiency claim |
| Azure | October 1 exact-ID, field-level synthetic readback remains recorded separately | No new Azure write or deployment in this follow-up |

The first full live corpus produced 10/12 actual grades. The two failures exposed missing/contradictory fixture inputs, not a reason to weaken grading. That original grade remains preserved. The repaired full corpus was run fresh, not relabelled.

## Native compatibility and capture

Installed Copilot CLI 1.0.91 passed three minimal skill-only probes. With the synthetic MCP server configured, one of three probes failed both registered skill lookups with `Skill not found`; the other two succeeded. This establishes an intermittent compatibility problem, not its internal root cause. The separately verified npm-loader CLI 1.0.85 passed all three equivalent MCP probes. The documented `COPILOT_CLI_BIN` override selects that bounded workaround without changing global settings. Vally 0.17.0 and SDK 1.0.14 were retained.

Fresh run `agentops_live_pinned_20261002`, native session `f7858868-9322-4a07-8fe1-f9b0ac610699`, captured all 66 native source events and exported 50 event rows plus 46 span rows. Completed reference order was `a.md → b.md → a.md → a.md`; the final read belonged to the delegated agent. Independent expectations were one agent, two skills, four reference reads, and two owned scripts: all had zero missing receipts. Eleven tool attempts ended in nine completions and two deliberate failures; none remained pending. Eleven distinct model spans were observed. The Python root span still reports unknown outcome while its owning shell reports exit 7; an unknown span is never converted to success.

Metadata export did not contain the synthetic privacy canary. Restricted native content stayed local. Global coverage and evidence completeness remain unknown even when the stimulus counts match.

## Experiment and browser evidence

`stockpilot-repeated-tool-thrash-20261002` executed three baseline and three candidate trials with one worker and no model judge. Each wrote three distinct alert actions and passed actual sink grading. Tool counts were baseline 11, 9, 9 and candidate 8, 10, 11. Medians were 9 versus 10, below the predeclared 20% effect threshold. Duration fields are per-trial medians; token and usage fields are totals. Unknown architecture/configuration compatibility also prevents an efficiency conclusion. The stored result is inconclusive; no refactor or experiment merge occurred.

Rendered desktop Runs, Architecture, and Compare were exercised in an owned incognito window with the DevTools Console visible and zero messages after the favicon fix. The final Compare showed 3/3 on each side and its evidence link reached the matching Runs anchor. Runs showed the independent counts and unknown global coverage. Mobile navigation, search, and expanded receipts were exercised at 390×844; Runs document width remained 390 pixels. Architecture correctly showed zero eligible runs and no absence verdict. The temporary viewport override was reset and the mobile verification tab was closed.

## Recoverable evidence

Local evidence root: `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-reliability-20261002`.

- `full-corpus-grade.json`: preserved original 10/12 result.
- `full-corpus-repaired-live/smoke/2026-10-01T23-23-53-306Z/results.jsonl` and `repaired-grade.json`: fresh 12/12 execution and actual grades.
- `repeated-experiment-live/experiment/2026-10-01T23-29-55-827Z/`, `repeat-criteria.json`, and `repeated-grade.json`: predeclared criteria and six trial results.
- `pinned-result.json`, `pinned-audit.json`, `expectations.json`, and `ledger/runs/agentops_live_pinned_20261002`: launch, source audit, independent expectations, and ledger evidence.
- `cli-final.log`, `final-focused.log`, `stockpilot-tests.log`, `schema.log`, and `package-final.log`: verification receipts. The final component span-ID guard was checked with 74 focused passing tests after the full CLI suite.

The GitHub Enterprise included allowance was verified before this execution. The old twenty-call ceiling was explicitly relaxed by the user; execution remained serial. No paid overage setting, global credential/profile change, publication, push, or production deployment occurred. Azure subscription/credit protection and previous readback evidence are in [the prior live follow-up](2026-10-01-agentops-live-followup.md).

## Remaining limits

The native 1.0.91 intermittent skill/MCP issue remains upstream; 1.0.85 is a tested workaround. Matching declared stimulus counts does not prove exhaustive capture across arbitrary providers, sessions, or enterprise systems. Larger experiments with recorded compatible versions are needed before accepting architecture changes. Production deployment and real restricted-data capture remain outside this delivery.
