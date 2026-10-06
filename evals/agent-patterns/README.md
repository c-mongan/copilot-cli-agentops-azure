# Synthetic agent patterns

Three original Copilot CLI agent definitions exercise AgentOps' observation
contracts. Nothing is installed globally. All tools and evidence are synthetic.
The fixture has no dependencies beyond Node, Python 3, and the separately pinned
Copilot CLI used by the StockPilot harness.

| Agent | Shape | Intended outcome |
| --- | --- | --- |
| evidence-orchestrator | Two skills → references A/B/A → specialist → MCP success/error → Node/Python | TASK_FAILED with evidence |
| incident-triager | Read-only delegated specialist | Bounded incident conclusion |
| release-auditor | Skill, reference, owned Python gate | Rejected release; exit 7 |

```text
orchestrator → skills → references → incident-triager
             → local MCP → owned scripts → observed ledger
```

Run local fixture checks with `npm test --prefix evals/agent-patterns`.
For a live run, copy `fixtures/` into a disposable Git repository, attach that
repository to AgentOps before launch, and select `--agent evidence-orchestrator`.
Pass the exact task in `ACCEPTANCE-PROMPT.md`; ordering must also be explicit in
the task prompt. A live attempt with a less specific prompt delegated too early.
Supply this additional MCP configuration, replacing the two absolute paths:

```json
{"mcpServers":{"fixture":{"type":"local","command":"/absolute/node","args":["/absolute/fixture/scripts/mcp.js"],"tools":["*"]}}}
```

Use the existing observed-launch interface with `--expectations` pointing to
this directory's `expectations.json`. Use metadata-only capture, disable builtin
MCPs and automatic update, and run one worker. Copilot 1.0.85 supports the tested
`--dynamic-retrieval skills=off` eager skill-discovery setting. Verify included
model entitlement before execution. The expectations apply only to the full
orchestrator stimulus, not a standalone release-auditor run.

Acceptance requires actual skill calls, reference reads in A/B/A order followed
by the delegated A read, a named specialist completion, both MCP outcomes, and
two owned script observations. Counts alone cannot prove this semantic contract.
Expected observations do not establish complete global coverage. A failed gate
must remain rejected even if the Copilot process exits 0. Script outcome can be
unknown in native telemetry; preserve the shell's observed exit code separately.
Run `node evals/agent-patterns/audit.js <exported-run-directory>` to audit the
semantic ledger contract. It rejects incorrect delegation order, missing model
usage, missing script failure evidence, and content capture. It does not replace
browser or Azure readback verification.

## Reviewed GitHub patterns

Source: [github/awesome-copilot](https://github.com/github/awesome-copilot), pinned
at `143a3d976b3c1603cc8932984d5e1f28501cb5fc`. Research inspected repository paths
and the following definitions; these original fixtures do not vendor their text.

| Source | Pattern considered | Adaptation and review limit |
| --- | --- | --- |
| [debug.agent.md](https://github.com/github/awesome-copilot/blob/143a3d976b3c1603cc8932984d5e1f28501cb5fc/agents/debug.agent.md) | Reproduce, inspect, verify | Fully read; synthetic rejection replaces repair, CLI tools replace editor tools |
| [aws-incident-triage.agent.md](https://github.com/github/awesome-copilot/blob/143a3d976b3c1603cc8932984d5e1f28501cb5fc/agents/aws-incident-triage.agent.md) | Read-only evidence chain and confidence | Excerpt reviewed; local MCP replaces AWS integrations |
| [gem-orchestrator.agent.md](https://github.com/github/awesome-copilot/blob/143a3d976b3c1603cc8932984d5e1f28501cb5fc/agents/gem-orchestrator.agent.md) | Specialist orchestration | Excerpt reviewed; omit its team config and broad workflow |
| [acquire-codebase-knowledge/SKILL.md](https://github.com/github/awesome-copilot/blob/143a3d976b3c1603cc8932984d5e1f28501cb5fc/skills/acquire-codebase-knowledge/SKILL.md) | Skill packages with scripts and references | Excerpt reviewed; bounded synthetic evidence replaces repository scanning |

These are selected structural patterns, not an endorsement or security audit of
the full upstream repository. No remote MCP, upstream script, or upstream agent
was installed or executed. Upstream uses MIT; no substantial upstream text is
copied here. Model selection is an explicit run option rather than silently
overwriting a user's pinned agent model.
