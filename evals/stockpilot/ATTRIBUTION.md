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
| `agent_toolset_20260401` (CMA's bundled Bash/Read/Write/Task toolset) | An explicit, narrow Copilot CLI `tools:` allowlist (`read`, `bash` scoped to the fixture's own `data/` and skill `scripts/` paths) — no implicit Task/subagent delegation primitive exists in Copilot CLI's custom-agent format, so the workshop's `forecaster`/`procurement`/`writing` subagents are represented as **explicit alternative code paths inside the skill files** (e.g. the forecasting skill's "Path A: script" vs "Path B: ask the forecasting skill's documented escalation" instead of a live second agent invocation) rather than as a live delegated agent call. No live subagent call is made by this fixture at rest; any future live Vally trial would need its own authorized configuration for that. |
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

No `azure-mcp/*`, no `agent-grafana/*`, no network tools, and no implicit
inheritance of host skills/MCP servers. `evals/stockpilot/fixtures/tools/legacy-tools-manifest.md`
documents the 12 legacy tool names from `agents/before/tools.py` for
narrative/provenance purposes only; none of those 12 Python functions are
wired up as live Copilot CLI tools or an MCP server in this fixture. A real
pilot would need an actual "owned fixture MCP" server exposing read-only
CSV queries scoped to `fixtures/data/`; building and running that MCP server
is a live-environment step this task does not perform (no live budget — see
scope boundary). `evals/stockpilot/vally/experiment.yaml` documents the
intended empty/narrow MCP allowlist for when that MCP exists.

## Effective agent/model/skill/MCP settings (bullet 1 requirement)

Recorded in `evals/stockpilot/manifest.yaml`.
