---
name: agentops-evidence-prompts
description: "Use when: prompting Copilot CLI agents to investigate AgentOps telemetry through read-only Azure MCP or Azure Managed Grafana MCP and propose evidence-backed improvements."
license: MIT
user-invocable: true
allowed-tools:
  - azure-mcp/*
  - agent-grafana/*
  - read
  - search
---

Use these templates when asking Copilot CLI agents to analyze AgentOps telemetry. Keep MCP read-only, do not require prompt/content capture, and never paste secrets into prompts or config.

Every recommendation must include: evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s) to change, expected metric movement, validation benchmark or query, and rollback condition.

## Build An Investigation Bundle

Prefer a concrete `ask-context` bundle before prompting another agent. It includes the session ID, time range, Run Replay URL, KQL query, latest recommendation, benchmark run ID when present, and metadata-only evidence rows:

```bash
node agentops-cli/src/index.js ask-context latest \
  --last 24h \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl \
  --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl \
  --privacy .agentops/demo/latest/AgentOpsPrivacy_CL.jsonl \
  --github .agentops/demo/latest/AgentOpsGithubOutcomes_CL.jsonl \
  --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl \
  --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl \
  --recommendations .agentops/demo/latest/AgentOpsRecommendations_CL.jsonl \
  --json
```

Use the returned `prompt`, `kql_query`, `replay_url`, `last_recommendation`, and `benchmark_run_id` fields. Do not paste raw prompts, responses, source code, tool arguments, tool results, URLs, file contents, or secrets into follow-up prompts.

## Investigate Latest Session

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Investigate the latest Copilot CLI session using the AgentOps ask-context bundle:
<paste metadata-only ask-context JSON or prompt field>

Use the bundle's Run Replay URL, KQL query, latest recommendation, and benchmark run ID before writing any new query.

Return only evidence-backed findings. For each recommendation include:
evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not edit files yet. Do not request prompt/content capture.
```

## Explain Tool Failure

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Explain repeated tool failure for <tool-name> over <time-range>.
Use `AppDependencies` where `Properties has "github.copilot"` and inspect related `execute_tool` spans, hook events, and policy blocks.

Return the likely failure pattern, affected agents/skills/hooks, and one minimal fix proposal.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not auto-remediate.
```

## Compare Benchmark Variants

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Compare AgentOps benchmark or experiment variants <variant-a> and <variant-b> over <time-range>.
Use telemetry labels such as `agentops.experiment`, model, agent name, repo hash, and conversation id.

Compare success rate, failure rate, p95 duration, tool retries, token usage, AIU, estimated cost, policy blocks, and truncation/compaction signals.
Recommend the safer variant only if the evidence is consistent.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not implement CLI benchmark commands.
```

## Propose Agent Improvement

```text
Use the agent-optimizer agent with read-only Azure MCP and Grafana MCP.

Analyze <agent-file> against telemetry from <time-range>.
Find repeated failures, high token use, excessive tool scope, missing skill triggers, subagent fanout, policy blocks, and retry loops.

Propose the smallest agent/skill/hook/MCP config change that should improve the measured pattern.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not edit files until I approve the patch plan.
```

## Tune Hook Policy

```text
Use the hook-policy-reviewer agent with read-only Azure MCP and Grafana MCP.

Review hook policy behavior for <hook-name-or-event> over <time-range>.
Focus on deterministic preToolUse decisions, postToolUseFailure hints, agentStop/subagentStop gates, timeout risk, and false positives.

Recommend only minimal hook-policy changes.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not add network calls to blocking hooks and do not capture prompt/tool content.
```

## Find MCP/Tool Regressions

```text
Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.

Find MCP or tool regressions introduced after <date-or-version>.
Compare failure rate, retry rate, latency, policy blocks, disabled MCP server counts, additional MCP config counts, and likely MCP/extension tool usage against the prior baseline.

Return suspected regressions with affected tools, agents, and sessions.
For each recommendation include evidence query or dashboard link, observed failure/cost/safety pattern, proposed file(s), expected metric movement, validation benchmark/query, and rollback condition.
Do not loosen permissions or enable non-read-only MCP access without explicit approval.
```
