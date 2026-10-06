# Attribution and Claude → Copilot CLI plumbing mapping

This fixture is derived from the Anthropic "Code with Claude 2026" workshop
`agent-decomposition` (StockPilot). See `PROVENANCE.md` for the exact pinned
commit, license, and file-level sha256 record. The workshop's copyright
header (`Copyright 2026 Anthropic PBC`, `SPDX-License-Identifier: Apache-2.0`)
is preserved in every adapted file below.

## Why an adaptation, not a direct copy

The workshop runs on **Claude Managed Agents (CMA)**: a hosted sandbox per
session, Claude-specific `callable_agents`/`Task` subagent delegation, and
Anthropic's `.claude/skills/` skill-loading convention. This repo is a
**Copilot CLI** AgentOps project. The business logic (inventory domain,
skill content, the four decomposition smells) is what this fixture needs;
the hosting/execution plumbing had to be replaced with verified Copilot CLI
primitives.

| Workshop (Claude / CMA) | This fixture (Copilot CLI) |
|---|---|
| `.claude/skills/<name>/SKILL.md` | `evals/stockpilot/fixtures/skills/<name>/SKILL.md` — same YAML-frontmatter-plus-markdown shape; frontmatter fields trimmed to this repo's own convention (`name`, `description`, `license`, `allowed-tools`) as used in `plugin/skills/*/SKILL.md` (verified by reading `plugin/skills/agentops-benchmark-gate/SKILL.md` before writing this fixture). |
| CMA agent config (`agents/starter/agent.py` → `build_config()`, uploaded via `uv run deploy starter`) | `evals/stockpilot/fixtures/agents/stockpilot.agent.md` — a Copilot CLI custom-agent profile using this repo's existing `name`/`description`/`target: github-copilot`/`model`/`tools`/`metadata` frontmatter, verified against `plugin/agents/telemetry-investigator.agent.md` before writing. |
| `agent_toolset_20260401` (CMA's bundled Bash/Read/Write/Task toolset) | The main StockPilot profile keeps the explicit `read`/`bash` list used by the 12-task corpus. The original workshop's broad `forecaster`/`procurement`/`writing` decomposition remains represented by skills, while one new, narrower Copilot-native path stages `.github/agents/stock-risk-auditor.agent.md` for a dedicated synthetic delegation stimulus. That specialist has only `read`, receives one exact snapshot to verify, and cannot delegate. It is an original compatibility fixture, not a claim that CMA's hosted Task primitive was ported wholesale. |
| `uv run seed` (`data/seed.py`, Python + `random.gauss`, ~250 SKUs / ~67k rows) | Hand-written, fixed, small synthetic CSVs under `evals/stockpilot/fixtures/data/` using the same column schema (see `PROVENANCE.md`) — no Python runtime dependency, no RNG, auditable by inspection. |
| Anthropic Messages API (`anthropic.Anthropic().messages.create(...)`) inside `agents/before/subagents.py` | Not invoked. This fixture makes **zero model calls** of any kind, by design (see the root-level scope boundary for this task). |
| `uv run evals --agent starter` / `evals/graders.py` (Python, one `llm_judge` grader calls the Anthropic API) | `evals/stockpilot/graders/index.js` (Node, deterministic graders only — the workshop's paid `llm_judge` grader for task R9 was **not** ported; R9 is left with a `TODO` deterministic approximation, documented in `graders/index.js`, since an LLM-judged grader is explicitly out of scope and optional per the plan's `--compare` guidance). |
| `.claude/CLAUDE.md` ("explain-then-edit" instructions for Claude Code) | Not applicable — this is guidance for a human using Claude Code while doing the workshop exercise, not part of the StockPilot agent/skill surface itself. Not adapted. |
| `agent-decomposition/.claude/skills/submit-solution/SKILL.md` | Not adapted (see `PROVENANCE.md` — workshop-submission meta-skill, no StockPilot domain content). |

## Narrow, explicit tool list (bullet 1 requirement)

`evals/stockpilot/fixtures/agents/stockpilot.agent.md` declares exactly:

```yaml
tools:
  - read
  - bash
```

No `azure-mcp/*`, `agent-grafana/*`, remote MCP, or network tool is declared.
The one server, `stockpilot-readonly`, is dependency-free local stdio. It
exposes only `stock_snapshot` (latest exact SKU/warehouse lookup from the pinned
synthetic CSV) and `unavailable_snapshot` (a planted read failure); it accepts
no caller-selected path, writes nothing, caps a request at 64 KiB, and refuses
a source above 1 MiB. `fixtures/tools/legacy-tools-manifest.md` still documents
the workshop's 12 legacy Python tool names for provenance only; none is wired
as a live tool. The Vally executor disables its hosted GitHub MCP when the eval
does not explicitly declare that exact server name, and the specs list the one
owned server directly rather than discovering workspace MCP configuration.

## Effective agent/model/skill/MCP settings (bullet 1 requirement)

Recorded in `evals/stockpilot/manifest.yaml`. The dedicated sequence,
Vally/Copilot pins, and stimulus-only coverage boundary are recorded separately
in `evals/stockpilot/mcp-delegation-contract.json`. These are configuration and
expectation provenance; only a captured live run can establish execution.
