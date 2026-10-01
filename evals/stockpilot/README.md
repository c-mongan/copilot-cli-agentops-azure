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
| `fixtures/` | The healthy, decomposed StockPilot agent profile + 5 skills + synthetic CSV data |
| `variants/` | 4 single-change planted-flaw variants (one per Task 6 architecture rule) |
| `test/fixture-architecture-proof.test.js` | Proves the fixture's static structure is *capable* of producing each planted finding, via Task 6's own engine functions — zero model calls |
| `graders/` | Deterministic JS graders (ported from the workshop's `evals/graders.py`) + 12-task contract + grader unit tests |
| `package.json` / `package-lock.json` | Isolated Vally dependency pin — **not** part of `agentops-cli/package.json` |
| `VALLY-PIN.md` | `npm view`/install/`--help`/`lint`/`--dry-run` evidence; bundled-vs-native Copilot version record |
| `vally/` | Real Vally `eval.yaml` + `experiment.yaml` (bounded, single-worker, narrow allowlist), validated with `lint`/`--dry-run` only |

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
calls. Verify included model access before the live execution step.
