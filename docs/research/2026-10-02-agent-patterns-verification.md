# GitHub agent pattern selection and live verification

Selected structural patterns from `github/awesome-copilot` at
`143a3d976b3c1603cc8932984d5e1f28501cb5fc`. The
[fixture README](../../evals/agent-patterns/README.md) records exact upstream
links, review limits, and CLI adaptations. No upstream code or cloud MCP was
installed. The definitions and fixtures are original, synthetic, and local.

## Delivered

Three agents: evidence-orchestrator, incident-triager, and release-auditor.
Two skill packages include three references, a Node probe, and a Python gate.
The dependency-free local MCP server advertises only status and unavailable.
Separate stimulus manifests describe orchestrator and standalone-auditor
expectations. The semantic audit checks actual ordering and named delegation,
MCP outcomes, script failure evidence, model usage, and metadata privacy.

## Current proof

| Layer | Observed result |
| --- | --- |
| Local fixture tests | 5 passed, including malformed MCP rows, bounded input, protocol/tool failures, deliberate Python exit 7, and incorrect-order rejection |
| Full orchestrator | Run `agentops_patterns_20261002_v2`, session `6e5fdfa6-e28c-45c2-bcba-d7431244b783`; 57 exported events, 49 spans; all 12 semantic checks passed |
| Named specialist | incident-triager completed; main A/B/A reads preceded its A read |
| Standalone auditor | Run `agentops_patterns_20261002_release_auditor_v2`, session `dc06393a-2bd3-4b9f-bc40-56915975c8f5`; 21 events, 21 spans; skill/reference/script/failure checks passed, no MCP/delegation |
| Privacy | Orchestrator canary absent from exported metadata; content capture off |
| Static verification | Final repository static check passed: 936 files checked |
| Product generation | Runs, Architecture, Compare, and per-run replay HTML generated from the new ledger; global coverage remains unknown |

Four serial Copilot launches used the pinned 1.0.85 npm-loader and explicit
gpt-5.4-mini selection. Two launches also delegated to the named specialist.
The CLI summaries reported approximately 7.30 AI credits in total, including
the unsuccessful first attempts. This is reported CLI usage, not a billing
reconciliation or a measure of Codex development tokens. Existing included
Enterprise model access was reused; no model/provider configuration was changed.

## Failures preserved and repaired

The first orchestrator launch captured the expected counts but delegated before
the third main-agent read. The audit rejects that run. Stronger agent instructions
and an explicit [acceptance prompt](../../evals/agent-patterns/ACCEPTANCE-PROMPT.md)
produced the passing run. One passing repeat does not prove broad model reliability.

The first standalone auditor printed Python exit 7 through a printf wrapper;
its surrounding shell tool completed successfully. Exact-command instructions
produced a failed shell tool in the second run. Native Python script Outcome
remains unknown: the failure proof comes from the linked shell completion,
not an invented native script outcome. Script-to-tool association is recorded
as inferred from a unique session window, not a physical parent span.

The prior screenshot report used an external artifact as a repository-local
Markdown link. The static checker restricts local links to repository files.
The report now records the existing artifact path as text; checker policy was
preserved. Unrelated dirty plans and evidence documents were untouched.

## Evidence paths and limits

Disposable artifacts are under
`/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-patterns-20261002/`:
`result-v2.json`, `audit-v2.json`, `result-auditor-v2.json`,
`audit-auditor-v2.json`, local launch logs, exported ledger, and `product-final/`.
All launches completed with the scoped collector lifecycle completed and no
invalid native records. Stimulus missing counts are zero; global evidenceComplete
remains false. CLI exit 0 is distinct from the rejected synthetic release.

These new runs were not uploaded to Azure and their generated HTML was not
browser-verified in this step. Existing Azure/screenshots proof is documented
in [the earlier report](2026-10-02-agentops-multi-agent-azure-e2e.md); it must not
be relabelled as proof of these new runs. No experiment was merged, no proposed
refactor was applied, and no infrastructure or production deployment occurred.
