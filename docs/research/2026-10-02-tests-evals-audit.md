# Independent tests and evaluation audit — 2 October 2026

Baseline: `0b91a3671376f9bc655aa955094d995ac711254c`. This audit ran current local code, regraded retained live synthetic artifacts, and replayed retained native semantic contracts. No new model trial, dependency installation, Azure write, package preparation, or source change was performed. Existing dirty plans and research were preserved.

## Fresh verification

| Check | Observed result | What this proves |
| --- | --- | --- |
| Full CLI `node --test` | 952 tests; 951 passed; 0 failed; 1 skipped; 33.21 seconds | Local regression contracts; Windows PowerShell lifecycle is skipped because PowerShell is unavailable |
| StockPilot + agent-patterns + SDK tests | 88 passed; 0 failed; 0 skipped | Deterministic graders, bounded synthetic MCP roundtrip, fixture contracts, SDK normalization/export contracts |
| Static checker | Passed: 962 files, 450 JavaScript, 169 JSON, 170 Markdown, 30 shell | Syntax/assets/links/text/schema guardrails at audit time |
| JSON assets | Passed | Selected plugin/MCP/dashboard JSON parses |
| V2 dashboard generator `--check` | Passed: 10 dashboards | Checked-in dashboard files match generator |
| Dashboard validation | Passed | Local structural dashboard contracts |
| Product audit | 29/29 checks passed; 10 V2 dashboards; 1,119 links checked | Local product contract, not live product or usability proof |
| Ingestion schema guard | Passed against retained `agentops-events-table-final.json` | Proposed local Bicep contract is compatible with that retained schema snapshot, not a fresh Azure schema read |
| Retained repaired full corpus, current authoritative grader | 12/12 passed; complete | Twelve retained live executions produced task outputs and actual synthetic sink artifacts accepted by current graders |
| Retained repeated F3 experiment, current sink grader | Baseline 3/3; candidate 3/3 | Actual synthetic task outcomes remain passing; no new execution |
| Retained agent-patterns native ledger | 12/12 semantic checks; 57 events; 49 spans | Ordered main A/B/A references then specialist A, named delegation, MCP success/failure, owned scripts, linked Python rejection, provenance and metadata privacy |
| Retained StockPilot MCP v3 ledger | 9/9 semantic checks; 24 events; 30 spans | One MCP success, one deliberate failure, then named specialist completion; stimulus-scoped provenance/privacy contract |

Raw logs are retained outside Git at `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-audit-2026-10-02/tests-evals/`. Storage identity was verified before suites: external volume selected, approximately 332 GiB free; internal approximately 25 GiB free. Suites used the storage wrapper and ran serially.

## KQL flag behavior and read-only Azure result

`dashboard kql-check` does **not** implement `--help` or `--local-only`. Those flags are ignored by `agentops-cli/src/lib/dashboard-kql-check.js`; its default `runQuery` calls Azure Log Analytics. The attempted local check therefore executed read-only Azure queries. Its retained output shows 35 successful panel smoke queries, 14 with rows and 21 empty. No `--require-rows` assertion was applied. This is current smoke-query execution proof, not a local KQL compiler check, complete dashboard validation, exact-run readback, or a new Azure delivery proof. No Azure mutation occurred.

The existing dashboard KQL tests exercise query selection and macro substitution with injected query results. The product audit reports `live_kql_checks: 0`; that local product audit must not be relabelled as hosted verification. A future CLI fix should reject unknown flags and handle help before performing operations, with an explicit local query-rendering mode if useful.

## Evaluation validity

```text
unit/fixture checks → retained live stimulus → task + sink grade
                   → native semantic receipt → independent cloud readback
                   → repeated compatible comparison → human change decision
```

The repaired twelve-task corpus is materially stronger than output-marker grading: `evals/stockpilot/scripts/full-corpus.js` reads bounded actual purchase-order, notification, and ERP sinks; checks workspace containment; rejects missing/duplicate task coverage; and applies task-specific supplier, cycle-count and escalation conditions. The original 10/12 result is separately retained. The first F3 failure was only one distinct notification where at least three were required. Fresh repaired execution and current regrading are distinct proof steps.

The full corpus still uses known synthetic data and published task prompts/graders. No blind held-out StockPilot corpus was found in the reviewed fixture/evaluation files. Its twelve tasks are one execution each, not twelve repetitions of each task or broad reliability evidence. No real customer outcome, production data correctness, reviewer time saved, or adoption improvement is established.

The repeated experiment is a legitimate bounded single-change comparison: healthy notification guidance versus removed batch guidance, three trials each, one worker, fixed model, no model judge. Its predeclared tool-call effect threshold is 20%. Baseline counts are 11/9/9; candidate counts 8/10/11. Medians are 9 versus 10, approximately 11% more calls for the candidate. Durations are per-trial medians; tokens and usage-event counts are totals. Six passing sink grades prove these task outcomes, not an efficiency gain. There is no held-out confirmation, larger statistical sample, or generally accepted improvement. Both stored experiments correctly remain inconclusive.

Architecture metrics require exact architecture-version agreement and `evidenceComplete === true` (`agentops-cli/src/lib/architecture/metrics.js`). Their default minimum denominator is 10 eligible observations and proportions carry Wilson intervals. Retained native/trajectory evidence has unknown global completeness or version identity; matching stimulus receipts cannot make it eligible for absence-based hypotheses. The rendered zero-eligible-runs posture is an honest limit, not a failed test. Three experiment trials cannot satisfy this separate architecture eligibility contract.

Process exit, successful transport, output text, and task success remain different measurements. The synthetic release intentionally fails even when the Copilot process exits successfully; Python native span outcome can remain unknown while its linked shell completion proves rejection. Semantic audits prove observed order/status in exported ledgers; they do not by themselves establish exhaustive source capture, physical span parentage, or provider-wide completeness. Metadata privacy checks prove absence of the named canary and content capture off in reviewed exports, not a general security certification.

## Required completion evidence

1. Define the target product acceptance separately from synthetic plumbing: for example, identify the failing component faster with AgentOps than with native logs, using representative user investigations.
2. Record pre-run inventory, effective configuration/model/runtime versions, independent expectations, and source capture denominators so intended architecture comparisons become eligible. Preserve unknowns where runtime evidence cannot support them.
3. Add unseen tasks/datasets and repeated matched baselines with predeclared task-quality and time/cost measures. Keep task/sink correctness primary; output-marker and delivery success are supporting evidence.
4. Independently verify hosted deployment and exact-run cloud/UI evidence for the actual target. Retained local receipt replay and historical schema snapshots cannot close that gate.
5. Resolve or explicitly constrain native CLI skill/MCP compatibility and script-outcome attribution, and verify Windows lifecycle on its supported host.

There were no failing fresh local regression checks in this audit. The outstanding items concern evidence quality, product value, compatibility and deployment scope; they should not be described as missing implementation solely because their live proof is incomplete.
