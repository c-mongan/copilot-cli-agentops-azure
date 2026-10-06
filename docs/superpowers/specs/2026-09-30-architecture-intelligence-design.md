# Architecture intelligence and evaluation loop — design

Status: **draft for review, 30 September 2026.** Section 1 was presented in session; sections 2–4 are
proposed and awaiting approval. The [master plan](../../plans/2026-09-29-copilot-agentops-observability.md)
remains the single roadmap and release gate; this spec defines master-plan gates 4 (architecture
intelligence) and 5 (evaluation and improvement loop) only. Requirement numbers (§) refer to the
[full requirements](../../plans/source-material/2026-09-29-full-agent-observability-requirements.txt).

## Goal

Turn observed Copilot runs into evidence-backed, testable hypotheses about an agent system's structure
(agents, subagents, skills, references, scripts, tools), and test one proposed change at a time against a
protected baseline. Target users are enterprise agent teams on Azure; development uses synthetic and
public fixtures only.

## Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Where analytics are computed | One deterministic engine in the CLI over the run ledger. It uploads rows; Grafana, Workbooks and App Insights only display them. | One implementation, testable offline, identical numbers everywhere. |
| Proving ground | StockPilot-derived baseline plus a planted-flaw variant with expected findings and healthy negative controls (see master plan). | Known right answers for detection; single-change variants for attributing improvement. |
| Evaluation harness | Microsoft Vally, pinned `@microsoft/vally-cli@0.17.0`, `copilot-sdk` executor. | Microsoft stack; has repeated trials, baseline/variant experiments, `compare`, drift and experiment hashes. |
| Evidence labels | `exact` / `logical` / `inferred` / `ambiguous` / `missing` / `unsupported` / `unknown`, shared with capture. | One vocabulary from waterfall to finding. |
| Ownership | This spec's code: `agentops-cli/src/lib/architecture/`, `evals/`, `experiments/`. Capture, waterfall, Azure and master plan: capture owner. | Parallel work without overlapping edits. |
| Timing | Build and test the engine against fixture ledgers now. Optimisation experiments, paid sweeps and new Azure resources wait for gates 1–3 and explicit authorisation. | Matches the master-plan sequence. |

## 1. Architecture and data flow

```text
 Copilot CLI run (observed)        Vally trials (copilot-sdk executor)
        │ existing capture                 │ same OTel → strict Collector + experiment/variant/trial tags
        ▼                                  ▼
 Run ledger: session events, native + script spans, ReferenceName, AgentId/ParentAgentId/ParentToolCallId
        │                     ▲
        │                     │ static inventory (existing attach: agents/skills/references/scripts + sha256)
        ▼                     │
 agentops architecture  (agentops-cli/src/lib/architecture/)
   graph.js     static graph ⋈ observed graph, per architecture version
   metrics.js   deterministic statistics with numerator, denominator and coverage
   findings.js  rules (§§39, 42–43, 48–53) → hypothesis cards, never verdicts
   report.js    health report (markdown + JSON) and Azure rows
        │ existing Logs Ingestion upload path
        ▼
 AgentOpsInsights_CL / AgentOpsRecommendations_CL → Grafana / Workbook / App Insights (display only)
        │
        ▼
 agentops experiment: hypothesis → one change → Vally experiment (baseline vs one variant)
   → acceptance gate (§65) → experiments/{accepted,rejected}/ → PR for human review (never auto-merge)
```

- **Architecture version** = SHA-256 over the sorted `(path, sha256)` pairs of the attach inventory. Every
  run and Vally trial carries it; comparisons are always baseline version vs candidate version.
- **Coverage before frequency.** A component's denominator is the set of runs where it could have been
  observed (its producer was active and the run's capture is complete for that boundary). Not observed is
  never reported as unused.
- **Vally supplies** execution, repeated trials, graders, `compare`, experiment and eval hashes. **We add**
  the trace-derived structural metrics Vally does not have.

## 2. Metrics and finding rules (proposed)

### Metrics

Every metric row carries `numerator`, `denominator`, `coverageRuns`, `architectureVersion`, and the
Wilson 95% interval for proportions. Rows with `denominator < minRuns` (default 10) are reported as
`insufficient evidence`, never as a finding.

| Metric | Definition | § |
| --- | --- | --- |
| Skill activation rate | runs activating skill S ÷ covered runs of the invoking agent | 13 |
| Skill co-activation | P(B \| A) and P(A \| B) over covered runs | 14, 48 |
| Independent use | runs activating B without A ÷ runs activating B | 20, 48 |
| Reference load given skill | runs reading reference R after its declaring skill ÷ runs activating that skill | 17, 50 |
| Reread rate | reads of R ÷ runs reading R | 17, 43 |
| Tool repetition | max consecutive same-tool calls with the same argument hash (if exported) or same name and status | 43 |
| Script health | failure rate, p50/p95 duration and slowest internal step per script | 23 |
| Subagent contribution | subagent share of run duration and tokens; delegation rate per parent agent | 52 |
| Context pressure | P(failure \| compaction), P(compaction \| references loaded ≥ N) | 42 |
| Declared vs observed | inventory components with zero observations in ≥ `minRuns` covered runs; observed file reads under skill folders missing from inventory | 39 |

### Finding rules → hypothesis cards

| Rule | Trigger (defaults, configurable) | Hypothesis and single candidate change | Planted flaw |
| --- | --- | --- | --- |
| `REFERENCE_NEAR_MANDATORY` | P(R \| skill) ≥ 0.9 | Promote the essential control information from R into `SKILL.md`; keep detail in R (§50) | Always-loaded reference |
| `SKILL_PAIR_COACTIVATED` | P(B \| A) ≥ 0.8, P(A \| B) ≥ 0.8, independent use of B ≤ 0.1 | Investigate merging A and B, or turning B into a reference (§§48–49) | Co-activated pair |
| `TOOL_THRASH` | ≥ 3 consecutive same-tool calls without a new tool result state, in ≥ 20% of covered runs | Batch script or clearer stopping instruction (§§43, 51) | Thrash-prone tool |
| `MECHANICAL_LLM_STEP` | A skill segment with ≥ N chat turns and high output tokens but no script call, where the task contract marks the step deterministic | Replace with a script (§51) | Mechanical LLM step |
| `SUBAGENT_LOW_VALUE` | Subagent ≥ 25% of duration or tokens with a predictable structured output | Compare direct execution with delegation (§52) | none (control) |
| `PROGRESSIVE_INDIRECTION` | Chain skill → reference → skill → reference in ≥ 50% of runs of one workflow | Collapse the chain (§22) | none (control) |
| `DECLARED_NOT_OBSERVED` | Zero observations across ≥ `minRuns` covered runs | Review whether the component is needed; never auto-remove (§39) | none (control) |

`MECHANICAL_LLM_STEP` cannot be proven from metadata alone. In STANDARD mode it needs a declared task
contract; the Vally single-change experiment is the only confirmation.

Each **hypothesis card** records: id, rule, component refs, metric evidence (numerator, denominator,
coverage, interval), up to 5 representative run IDs, coverage limits, one proposed change, the
rejection test (Vally experiment id or `pending`), and status (`open`, `testing`, `accepted`, `rejected`,
`insufficient evidence`).

## 3. Evaluation loop with Vally (proposed)

```text
evals/stockpilot/
  eval.yaml              stimuli + graders (deterministic code graders first; LLM judge only where needed)
  holdout/               protected tasks; never read by finding or candidate generation
  experiments/
    detect-flaws.yaml    baseline vs combined planted-flaw variant (detection test only)
    flaw-<name>.yaml     baseline vs one single-change fix (attribution)
experiments/{accepted,rejected}/<id>.json   hypothesis, change, Vally results, trace metrics, decision, reason
```

- Vally runs the Copilot SDK executor with OTLP pointed at the local strict Collector. Trials carry resource
  attributes `experiment.id`, `experiment.variant`, `trial.id` and `architecture.version`, so the engine
  computes trace metrics per variant from the same ledger.
- **Acceptance gate (§65), in order:** no critical regression, holdout correctness does not drop, target
  metric improves beyond run-to-run variation, security checks pass, normal tests pass. Then latency,
  tokens and simplicity. Trial count and comparison criteria are fixed per experiment before it runs.
- **Rejected experiments are kept**, and the engine suppresses a rule's recommendation when the same change
  was rejected for the same architecture version.
- Model calls consume Copilot quota; any sweep beyond fixture smoke runs needs explicit authorisation.

## 4. CLI, storage, errors and testing (proposed)

- **CLI:** `agentops architecture [--ledger <dir>] [--json] [--out <dir>]` prints the graph summary,
  metrics and cards; `--upload` sends rows through the existing Logs Ingestion path (preview first, as
  with other uploads). `agentops experiment plan|record` follows once section 3 is approved.
- **Azure rows:** reuse `AgentOpsInsights_CL` (one row per card) and `AgentOpsRecommendations_CL` (one row
  per proposed change). Required additive columns on Insights: `Rule`, `ArchitectureVersion`,
  `Numerator`, `Denominator`, `CoverageRuns`, `Status`, `ComponentRefs` (dynamic), `Evidence` (dynamic).
  The capture/Azure owner applies them with the existing additive-migration pattern and schema checks.
- **Privacy:** metadata only. Component paths come from the inventory; no file contents, prompts, tool
  arguments or results. Argument hashes are used only when the producer already exports them.
- **Errors:** malformed ledger rows are skipped and counted in the report; missing inventory stops with a
  clear message; low coverage yields `insufficient evidence`, not silence.
- **Testing:** unit tests per metric on hand-built ledgers; a golden test where the planted-flaw fixture
  ledger yields exactly the four expected cards and zero cards on negative controls; a property test that
  removing coverage never creates a finding.

## Open questions for review

1. Are the default thresholds in section 2 acceptable as starting values?
2. Should `SUBAGENT_LOW_VALUE` and `PROGRESSIVE_INDIRECTION` ship in the first slice, or wait until the
   four planted-flaw rules pass?
