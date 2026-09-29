# Full requirements reconciled with a simpler first delivery

Reviewed 29 September 2026 against the user's 113-section **Full Requirements: Agent Observability, Evaluation and Architecture Improvement System**, the attached research bundle, and `c-mongan/copilot-cli-agentops-azure` at commit `090d337d4226d7f8a3ebadc2228e9cb4c8e326b5`. This is a design assessment, not implementation or a live Azure certification.

**Implementation update:** The tool-completion join and a local synthetic session waterfall described below now exist on `feat/enterprise-flight-recorder`; see [CLI-first flight recorder](../../cli-first-flight-recorder.md). The isolated synthetic Azure EVAL resources have been deployed, and four rich content rows were read back from Log Analytics. The rest of the slice 1 acceptance matrix remains open.

## Correction to the earlier simplification

The original request explicitly requires a chronological run waterfall as the main debugging screen (§74). It also requires repo-wide structural observation with scoped filtering (§§6–7), static and dynamic architecture graphs (§§37–39), agent/skill/reference/script analytics (§§10–26, 42–53), evaluations and protected experiments (§§55–70), and multiple aggregate views (§§75–81). A three-screen-only *product scope* would omit requirements. A three-entry-point *navigation* can simplify the experience while preserving the deeper capabilities.

The first detailed view is one complete run, regardless of whether it succeeded or failed. Failure categories are filters and test fixtures, not the identity of the view. A wrong-tool run is a good first fixture because it exercises prompt → model → tool choice → arguments → result → recovery → answer.

## Product shape

```text
Copilot CLI / VS Code / scripts / eval runner
       │ native OTel + session events + bounded adapters
       ▼
Versioned run ledger: original IDs, timestamps, parentage, coverage, architecture version
       ├── restricted local EVAL/FORENSIC content + waterfall
       └── strict local Collector → approved Azure metadata → fleet analytics
```

The normal user journey has three entry points: **Runs** (find a task and open its waterfall), **Architecture** (declared versus observed agents, skills, references, scripts and their use), and **Compare** (baseline/candidate quality, reliability and cost). Collector health, privacy, KQL, and specialist metric pages remain operator tools. This changes navigation and priority, not the eventual requirements.

The waterfall should show agent/subagent lanes and timed model, tool, reference and script events; skills and context events are timestamped markers. Clicking a step opens its source, input/output where permitted, status, duration, error, identifiers and confidence/coverage. Parallel steps overlap; the system preserves a causal partial order when exact global ordering is unavailable. It must say **not observed** rather than infer success from missing evidence.

## Delivery slices and acceptance

| Slice | Deliverable | Minimum proof |
|---|---|---|
| 1. Copilot CLI flight recorder | One local run list and waterfall using native session events plus native OTel; STANDARD metadata and synthetic EVAL detail | Direct agent, model, two tools, one failed/completed tool, skill, reference read, script, subagent, content on/off, and overlapping sessions are correctly represented or marked unsupported. Synthetic-only data. |
| 2. Enterprise telemetry boundary | Existing strict Collector route and Azure run metadata; supported runtime matrix | Synthetic canaries absent after cloud readback; authenticated ingestion, RBAC, retention/cost cap, dropped-event detection, version tags, and negative tests verified. No live claim from config alone. |
| 3. Architecture intelligence | Static definitions joined to observed runs; deterministic skill/reference/tool/subagent analytics | Frequencies carry denominator and coverage; declared versus observed differences are reproducible and do not classify unobserved as unused. |
| 4. Evaluation and improvement | Vally or proven equivalent, protected holdout, one-change candidate and human-reviewed proposal | Baseline/candidate on identical tasks; critical regressions fail; rejected experiments retained; no auto-merge. |

CLI-first is an **implementation order**, not a deletion of required VS Code, automated, nested and cloud-agent compatibility. Each surface needs a versioned FULL/PARTIAL/METADATA ONLY/ADAPTER REQUIRED/UNAVAILABLE/UNKNOWN profile before its telemetry is treated as complete.

The original requirement to start with 30–50 real tasks (§56) conflicts with the current development constraint: work agents and work data cannot be used for development. Begin with synthetic and public-agent cases, then collect approved work cases only in the permitted work environment. The first synthetic suite does not establish enterprise quality or real-task effectiveness.

## What the existing repository proves and does not prove

The repository already has a localhost Collector, strict allowlists, receipts, Azure templates, KQL, Grafana dashboards and tests. This should be reused. Its `03-run-replay.json` currently has an **Ordered timeline table**, not a timed waterfall panel; the same Run Story is distributed across 11 mostly table panels. The full V2 pack has 10 dashboards and 88 panels, with 22 variables on each dashboard. This is evidence of UX complexity, not evidence that the underlying capabilities should be removed.

A read-only check of its `session-enricher.js` against the known synthetic Copilot CLI 1.0.89 session produced one `tool.call` and zero `tool.completed` records. The completion event has `toolCallId`, result and status but no `toolName`; the parser requires `toolName` at completion. Fixing this schema join and adding an exact fixture is a prerequisite for a trustworthy waterfall.

The repository's own simplified Azure design says the previously configured resource group is absent and the live Azure pilot must be re-established. Static dashboards and local tests are not Azure readback proof.

## Enterprise-ready means

1. **Evidence fidelity:** exact producer/version/schema; original IDs retained; coverage and gaps visible; no fabricated causal order; errors and aborted runs correctly classified.
2. **Privacy and access:** STANDARD content excluded through a tested allowlist; synthetic EVAL content restricted locally; incident FORENSIC mode separately authorized; clear retention/deletion and role-based access.
3. **Operational reliability:** bounded overhead, durable or explicitly lossy export, ingestion health, sampling policy, deduplication, Azure readback, rollback, and cost controls.
4. **Decision quality:** architecture findings are hypotheses; evaluations preserve correctness and critical safety before latency/cost; candidate changes remain isolated and reviewed.

The next implementation work belongs in the existing repository: repair the current CLI event mapping, define the versioned run ledger and coverage contract, then build the first waterfall against synthetic records. Azure and architecture analytics can consume the same trustworthy ledger afterward.
