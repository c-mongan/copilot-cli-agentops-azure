# StockPilot pilot fixture (Task 9)

Local/fixture-only adaptation of the Code with Claude 2026
`agent-decomposition` workshop's StockPilot agent to Copilot CLI
conventions, for the AgentOps architecture engine's eventual Vally
single-change experiment loop. The initial implementation was fixture-only. Live smoke and experiment trials
subsequently ran; see [live evidence](../../docs/research/2026-10-01-agentops-live-followup.md). See
`../../.superpowers/sdd/2026-09-30-agentops-overnight-build/task-9-report.md`
for the full task report, scope boundary, and self-review.

## Map

| Path | What it is |
|---|---|
| `PROVENANCE.md` | Exact workshop URL, pinned commit SHA, license, file-level sha256 record |
| `LICENSE-WORKSHOP` | Verbatim copy of the workshop repo's Apache-2.0 license |
| `ATTRIBUTION.md` | Claude/CMA → Copilot CLI plumbing mapping; what was/wasn't adapted |
| `manifest.yaml` | Recorded effective agent/model/skill/MCP settings (declared, not observed) |
| `mcp-delegation-contract.json` | Scoped expected order/status and runtime provenance for the MCP/delegation stimulus |
| `expectations.mcp-delegation.json` | AgentOps component receipt expectations for that stimulus; unsupported zeroes stay explicit |
| `scripts/audit-mcp-delegation.js` | Semantic ledger audit for exact MCP statuses/order, named delegation, provenance, and metadata-only capture |
| `fixtures/` | The healthy, decomposed StockPilot agent profile + 5 skills + synthetic CSV data |
| `fixtures/mcp/stockpilot-readonly.js` | Dependency-free local stdio MCP; two read-only synthetic tools, 64 KiB request bound, 1 MiB source bound |
| `fixtures/agents/stock-risk-auditor.agent.md` | Read-only delegated specialist staged only by the dedicated stimulus |
| `variants/` | 4 single-change planted-flaw variants (one per Task 6 architecture rule) |
| `test/fixture-architecture-proof.test.js` | Proves the fixture's static structure is *capable* of producing each planted finding, via Task 6's own engine functions — zero model calls |
| `graders/` | Deterministic JS graders (ported from the workshop's `evals/graders.py`) + 12-task contract + grader unit tests |
| `package.json` / `package-lock.json` | Isolated Vally dependency pin — **not** part of `agentops-cli/package.json` |
| `VALLY-PIN.md` | `npm view`/install/`--help`/`lint`/`--dry-run` evidence; bundled-vs-native Copilot version record |
| `vally/` | Real Vally evals + experiment (bounded, single-worker, explicit skill/MCP allowlists), including the dedicated MCP/delegation stimulus |

## Relationship to Task 6

Task 6 (commits `52567b1`/`ef8ac86`/`3261d2b`) built the architecture
engine's own hand-built, generically-named fixture ledgers directly in
`agentops-cli/test/architecture.test.js` to test the detection engine
**in isolation**. This directory is a different, complementary surface:
the actual StockPilot **application** adaptation — real agent/skill
files a real Copilot CLI run would execute against, with StockPilot's
own component names — for the eventual live Vally trials. The two do
not duplicate each other; `test/fixture-architecture-proof.test.js` here
is a *local proof* (no model calls) that this fixture's structure, once
run for real, would be capable of producing Task 6's findings — it is
not a replacement for Task 6's own unit tests on the engine itself, and
it is not a live trial.

## Running the local tests (zero model calls)

```bash
node --test evals/stockpilot/test/*.test.js
```

The deterministic suite calls the server directly and over stdio. It verifies
the successful latest-stock result, planted tool error, JSON-RPC errors,
malformed-row recovery, the 64 KiB request limit, the 1 MiB data limit, and the
read-only specialist contract. It makes no model calls.

Validate the actual Vally 0.17.0 schema and experiment resolution without an
agent run:

```sh
cd evals/stockpilot
VALLY_TELEMETRY_OPTOUT=1 DO_NOT_TRACK=1 node_modules/.bin/vally lint --eval-spec vally/eval.stockpilot-mcp-delegation.yaml --verbose
VALLY_TELEMETRY_OPTOUT=1 DO_NOT_TRACK=1 node_modules/.bin/vally experiment run vally/experiment.yaml --dry-run --workers 1
```

## Full live corpus

Generate the pinned 12-task specification, then run it serially against synthetic
workspaces and grade actual sink artifacts:

```sh
node evals/stockpilot/scripts/full-corpus.js spec /path/to/new-eval.json
evals/stockpilot/node_modules/.bin/vally eval --eval-spec /path/to/new-eval.json --workers 1 --runs 1 --max-retries 0 --workspace /path/to/synthetic-workspaces --output-dir /path/to/results
node evals/stockpilot/scripts/full-corpus.js grade /path/to/results.jsonl /path/to/synthetic-workspaces
```

The Vally output pattern checks only execution output. The final command applies
the authoritative 12-task graders to actual synthetic sink files and fails on
missing/duplicate tasks, malformed sinks, or failing outcomes. It makes no model
calls. The generated full-corpus spec now declares only the owned
`stockpilot-readonly` MCP; its 12 stimuli and authoritative graders are
unchanged. Verify included model access before the live execution step.

The dedicated `vally/eval.stockpilot-mcp-delegation.yaml` is the live proof path
for MCP success, planted MCP failure, and named specialist completion. Its JSON
contract is stimulus-scoped and never establishes global capture completeness.
Its output-match graders check presentation only; marker text, `312`, or an
`AUDIT_*` string cannot prove tool use. Local lint/tests/dry-run do not prove
that the agent actually invoked either tool or delegated; that remains a later
authorized, observed live run whose ledger must pass the semantic audit.

After exporting a captured run, validate the semantic contract separately from
component counts:

```sh
node evals/stockpilot/scripts/audit-mcp-delegation.js /path/to/exported-run
```
