# StockPilot workshop provenance (Task 9)

## Source

- Repository: `https://github.com/anthropics/cwc-workshops`
- Workshop path: `agent-decomposition/` ("StockPilot — Compose multi-agent
  systems with Skills and MCP", Code with Claude 2026, Workshop W5)
- Pinned commit SHA: `0b445c70eccfe3814f7cbdcec59d5a8102e391f8`
  ("Remove reference solution from agent-decomposition workshop", authored
  2026-05-07T17:37:39Z)
- Repository license (verbatim copy at `evals/stockpilot/LICENSE-WORKSHOP`):
  Apache License 2.0, copyright 2026 Anthropic PBC
- Fetch method: `curl` against
  `https://raw.githubusercontent.com/anthropics/cwc-workshops/<sha>/<path>`
  and the GitHub REST API (`/repos/anthropics/cwc-workshops/git/trees`,
  `/commits`) for tree listing and commit metadata. Fetched on 2026-10-01.
  No `git clone` of the workshop repo was performed; only the specific
  files listed below were read, at the pinned commit.

All source files quoted here carry the workshop's own header:
`Copyright 2026 Anthropic PBC` / `SPDX-License-Identifier: Apache-2.0`.
That header, and the Apache-2.0 license terms, are preserved verbatim in
every adapted file under `evals/stockpilot/fixtures/` and
`evals/stockpilot/variants/` (see each file's header comment/frontmatter).

## Files read at the pinned commit (sha256, as fetched)

| Workshop path | sha256 |
|---|---|
| `LICENSE` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `agent-decomposition/README.md` | `c52cab926675facaf03b9d4da3df601505671e3e20c0ea6e72a87bed8af14a5c` |
| `agent-decomposition/.claude/CLAUDE.md` | `aaea106f3df2da9539be217f10adb242e046aab3ea4bc1ba15280510d988143e` |
| `agent-decomposition/agents/before/stockpilot.py` | `50337d4bda0c2ced8bba0d6da13d00522a8413745b3ed66816ad9355a9548c5b` |
| `agent-decomposition/agents/before/tools.py` | `160e4679c72e9a544457fc5a3cf0f527bf777c295be22bbf84f2e7366d9b76cc` |
| `agent-decomposition/agents/before/prompts.py` | `e2ece16a6c7f0f2d87caa0a2899dac2b6f403a7c6fb95f82f87a89606e84f849` |
| `agent-decomposition/agents/before/subagents.py` | `f274e7cb01485cad7d8f82c4154b9c4c847ed098214940c6f6ca351fbc5b4da1` |
| `agent-decomposition/agents/starter/agent.py` | `71555762d6d23487b63ae4f6270cc08fdbacd0845ec7516437bc011702124008` |
| `agent-decomposition/agents/sandbox_tools.py` | `17344ade3d9edaaa29bf0b86a7ac7292a20dec080c01e9366f798712f58cdb05` |
| `agent-decomposition/.claude/skills/forecasting/SKILL.md` | `d3ebecbf37c62af8501be89f25f8958245c3699257c84cf6c574e132ba8326fe` |
| `agent-decomposition/.claude/skills/notify-templates/SKILL.md` | `719913c84c21f53d1f7bb4b3ec8bc436bc735de1851541559af33ced007b2cfa` |
| `agent-decomposition/.claude/skills/reorder-policy/SKILL.md` | `a1aac6d9cccfe90c53c46b51c4ea5460b0929e6af7e73dd4bbcd60a3b42ad3df` |
| `agent-decomposition/.claude/skills/submit-solution/SKILL.md` | `26e9a8668869b901c6348c6fbc104b6ee5313f784073daf772051a5e3033c21a` |
| `agent-decomposition/.claude/skills/supplier-selection/SKILL.md` | `0d4f991cb39df4022333cd50eec4c00c1cfa241c20a7b021784db23f65f6ea6a` |
| `agent-decomposition/.claude/skills/weekly-report/SKILL.md` | `31bc7f0eb45ff5d951b0b5a5335d68cb810100da9751963033d02f1cc66f2ac2` |
| `agent-decomposition/.claude/skills/forecasting/batch_days_of_cover.py` | `75fe8314e0664988f3edfe26fd7983d500a71444f559dc2eea3dedc52f31d903` |
| `agent-decomposition/.claude/skills/forecasting/rolling_mean.py` | `96f04199008d2121399430eea9bee64c68424d82d3395875abb8445ffabf74fd` |
| `agent-decomposition/evals/tasks.yaml` | `97c35550b0b6a7d470eecbd0aa743a4caacbc42c07b44ea55f00c5c8b0101cd1` |
| `agent-decomposition/evals/graders.py` | `d7e2961a0a27faff984020606da4eae5721b429968bf2d0402a477df5ba52de3` |
| `agent-decomposition/evals/baseline_starter.json` | `7a3fad86bdbaf20e0c403b212b7cc31582e38920cb1a119057770acc3004898c` |
| `agent-decomposition/evals/reference_scores.json` | `669c9d5d3d8c6fc0883192766209ab1c968a2992ccc89db2cc49f9797a7faf33` |
| `agent-decomposition/data/seed.py` | `8ade5c7fb477ff13d9893564310ce302a4d819e4354b5b3881ee4e38ee268f67` |
| `agent-decomposition/.env.example` | `837b0f5329d4e03a316050685780b9d7da8bacd63f0927eedade0c0440435889` |

These are plain-text records of what was read; they are not a cryptographic
attestation of GitHub's content (no GPG/commit signature verification was
performed). The fetch used `https://raw.githubusercontent.com/...` at the
exact pinned SHA, which GitHub serves only for content that exists at that
commit, so the path+SHA pairing above is a reasonable provenance anchor for
a workshop/teaching repository.

## What was adapted vs intentionally not adapted

Adapted into this repo's conventions (`evals/stockpilot/fixtures/`):

- The **before-agent's 12 tools and 402-line `SYSTEM_PROMPT`**
  (`agents/before/tools.py`, `agents/before/prompts.py`) — read for the
  original failure-mode narrative (F1 context bloat, F2 confidence-drop,
  F3 per-SKU notification spam, supplier-ranking-as-prose) that motivates
  which planted flaw goes where.
- The **5 business-logic skills**
  (`forecasting`, `notify-templates`, `reorder-policy`, `supplier-selection`,
  `weekly-report`) — adapted into `evals/stockpilot/fixtures/skills/*/SKILL.md`
  using this repo's existing skill frontmatter shape (see
  `plugin/skills/*/SKILL.md`), with Claude-Code-specific paths/APIs replaced
  per `evals/stockpilot/ATTRIBUTION.md`.
- The **two forecasting scripts** (`rolling_mean.py`, `batch_days_of_cover.py`)
  — copied with only path adjustments (sandbox `/mnt/user/data` →
  fixture-relative `fixtures/data`), copyright/SPDX headers preserved.
- The **starter agent's decomposition narrative**
  (`agents/starter/agent.py`'s `SHORT_PROMPT`, `LEGACY_TOOLS` comments) —
  used as the basis for `fixtures/agents/stockpilot.agent.md`'s "healthy,
  decomposed" system prompt and narrow tool list.
- The **12-task eval contract** (`evals/tasks.yaml`) and **deterministic
  graders** (`evals/graders.py`, excluding the one paid `llm_judge` grader)
  — ported to `evals/stockpilot/graders/` (JS) with the same IDs, prompts,
  and pass/fail semantics, scaled to this fixture's smaller synthetic
  dataset.
- The **CSV schema** from `data/seed.py` (column names and engineered SKUs
  such as `SKU-0183`, `SKU-0091`, `SKU-0012`, `SKU-0057`, `SKU-0116`,
  `SKU-0042`) — re-implemented as a small, hand-written, fixed-seed
  synthetic dataset (`evals/stockpilot/fixtures/data/*.csv`); the workshop's
  own `seed.py` (which generates ~250 SKUs / ~67k rows via `random.gauss`
  with Python-specific RNG state) was **not** executed, to avoid adding a
  Python runtime dependency to this fixture and to keep the dataset small
  and auditable by hand.

Deliberately **not** adapted:

- `agents/before/subagents.py`'s raw Anthropic Messages API calls and
  `.claude/skills/submit-solution/SKILL.md` (a meta-skill for workshop
  attendees to open a PR with their own solution — it is about the
  workshop's own submission process, not about StockPilot's inventory
  domain, and has no Copilot CLI equivalent worth preserving).
- `agents/cma.py`, `agents/deploy_cli.py`, `agents/sandbox_tools.py`'s
  Claude-Managed-Agents (CMA) deploy/session plumbing — CMA is an
  Anthropic-hosted runtime with no Copilot CLI equivalent; see
  `ATTRIBUTION.md` for the explicit mapping of what replaces it.
- The reference "after" solution that a prior commit on this branch of the
  workshop repo removed (`git log` shows a commit titled "Remove reference
  solution from agent-decomposition workshop" at the exact pinned SHA) —
  there is no official answer key to copy; the planted-flaw variants in
  this fixture were designed independently from the "before" agent's own
  documented smells (see each `variants/*/CHANGE.md`).

No real financial, customer, or company data was fetched or used. The
workshop's own data is itself synthetic (`data/seed.py` generates it with
`random.seed(42)`); this fixture's data is an independently hand-written,
much smaller synthetic dataset using the same column schema.
