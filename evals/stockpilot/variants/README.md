# Variants (Task 9, bullet 2)

Each subdirectory here isolates **exactly one** of the four planted
architecture flaws as a single-file diff from the healthy base at
`evals/stockpilot/fixtures/`. Per the brief's resolved ambiguity: per-flaw
variants never combine flaws; a combined variant (if built) would be for
detection testing only, never for attribution of which change caused an
improvement. **No combined variant is built in this task** — see
`../PROVENANCE.md`/task report for why (kept out of scope to avoid diluting
the single-change-isolation guarantee without a live trial to justify it).

| Variant | Single changed file | Expected architecture-engine rule (Task 6 naming) |
|---|---|---|
| `planted-reference-near-mandatory/` | `reorder-policy/SKILL.md` | `REFERENCE_NEAR_MANDATORY` |
| `planted-coactivated-skill-pair/` | `weekly-report/SKILL.md` | `SKILL_PAIR_COACTIVATED` |
| `planted-mechanical-llm-step/` | `supplier-selection/SKILL.md` | `MECHANICAL_LLM_STEP` |
| `planted-tool-thrash/` | `notify-templates/SKILL.md` | `TOOL_THRASH` |

Each variant directory contains:

- `CHANGE.md` — the exact single-line/section diff from the healthy base,
  in prose, plus why it's expected to trigger the named rule.
- The one modified skill file (same relative path it has in
  `fixtures/skills/`), so a reviewer can diff it directly against the
  healthy base with e.g. `diff fixtures/skills/reorder-policy/SKILL.md
  variants/planted-reference-near-mandatory/reorder-policy/SKILL.md`.
- `expected-finding.json` — the finding shape Task 6's
  `agentops-cli/src/lib/architecture/findings.js` is expected to produce,
  for documentation purposes.

To actually use a variant, copy `fixtures/` to a scratch directory and
overlay the variant's one modified file on top — all other skills, the
agent profile, and the data stay identical to the healthy base, by
construction.

## Local proof (no model calls)

`evals/stockpilot/test/fixture-architecture-proof.test.js` hand-builds a
StockPilot-shaped static inventory (mirroring these component names) and
synthetic event ledgers for the healthy base and all four planted
variants, then runs them directly through Task 6's
`agentops-cli/src/lib/architecture/{graph,metrics,findings}.js` functions
(the same functions `agentops-cli/test/architecture.test.js` uses, same
require path) to confirm:

- each planted ledger triggers its one expected rule;
- the healthy ledger triggers **none** of the four rules.

This proves the fixture's static structure is *capable* of producing the
expected findings once a real recorded run exists. It is not a live trial
and makes no model calls.
