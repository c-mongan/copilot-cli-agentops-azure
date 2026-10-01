# Experiments

Reserved by the master plan for `experiments/{accepted,rejected}/` holding
Vally baseline-vs-variant experiment manifests and acceptance-gate
receipts. Task 6 does not populate this directory; the architecture
engine ends at hypothesis cards whose `rejectionTest` field is `pending`
until a live-authorized run wires the `agentops experiment plan|record`
subcommand.

**Status after Task 9 (local/fixture scope, no live budget authorized):**
`accepted/` and `rejected/` remain intentionally **empty**. Task 9 built
the StockPilot pilot fixture, the Vally harness pin, and bounded
single-change experiment configs under `evals/stockpilot/` (see
`evals/stockpilot/README.md`), including a real, locally-validated
`vally/experiment.yaml` declaring a healthy-base vs. planted-tool-thrash
single-change comparison — validated with `vally experiment run
--dry-run` only (zero execution, zero model calls; see
`evals/stockpilot/VALLY-PIN.md`). No trial has actually run, so there are
no accept/reject/inconclusive records to put here yet. Populating this
directory with real trial results requires explicit live-budget
authorization and an actual `vally experiment run` (without `--dry-run`)
— out of scope for Task 9, documented as blocked in
`.superpowers/sdd/2026-09-30-agentops-overnight-build/task-9-report.md`.
