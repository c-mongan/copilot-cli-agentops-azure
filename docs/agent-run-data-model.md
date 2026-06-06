# Agent Run Data Model

An Agent Run is the durable unit of investigation for Copilot AgentOps.

## Trace Shape

```text
trace = one Agent Run

root span:
  agentops.run

children:
  agentops.session
  gen_ai.chat
  gen_ai.execute_tool
  mcp.tools.call
  agentops.tool.shell
  agentops.file.edit
  agentops.test.run
  agentops.policy.decision
  agentops.privacy.signal
  github.pr.outcome
  agentops.eval
```

## Required Metadata

Every run should include:

- `agentops.schema.version`
- `agentops.run.id`
- `agentops.session.id`
- `agentops.surface`
- `agentops.privacy.mode`
- `agentops.content_capture.mode`
- `agentops.repo.hash`
- `agentops.branch.hash`
- `agentops.task.type`
- `agentops.agent.name`
- `agentops.skill.name`
- `agentops.parent_agent.name`
- `agentops.sub_agent.name`
- `agentops.delegation.id`
- `agentops.outcome.status`
- `agentops.duration.ms`

Identifiers that could reveal local paths, users, branches, repo names, or prompts must be hashed before export.

## Conceptual Tables

Every `AgentOps*_CL` row should include `SchemaVersion` so ingest planning and Collector Health can flag mixed or legacy exports before operators trust the dashboards.

- `AgentOpsRunSummary_CL`: one row per run.
- `AgentOpsEvents_CL`: timeline events.
- `AgentOpsToolCalls_CL`: tool calls.
- `AgentOpsMcpCalls_CL`: MCP calls.
- `AgentOpsPrivacy_CL`: dropped/redacted content signals.
- `AgentOpsEval_CL`: deterministic quality scores.
- `AgentOpsGithubOutcomes_CL`: PR, CI, review, merge, close, revert outcomes, plus run-to-PR and run-to-merge timing.
- `AgentOpsInsights_CL`: anomalies and regressions.
- `AgentOpsRecommendations_CL`: metadata-only next actions generated from runs, evals, insights, and recurring patterns.
- `AgentOpsCollectorHealth_CL`: collector/export/schema health.
- `AgentOpsContent_CL`: optional prompt/response viewer rows. This table must be empty or absent in strict default deployments.

Agent and skill fields make sub-agent workflows debuggable without content capture:

- `AgentName`: active agent or surface actor.
- `SkillName`: skill or playbook invoked by the agent.
- `ParentAgentName`: orchestrator or delegating agent.
- `SubAgentName`: delegated worker agent.
- `DelegationId`: hashed/opaque delegation correlation id.

Context/cache fields make Lapdog-style context pressure visible without storing prompts:

- `ContextWindowPct`: maximum observed context-window utilization percentage.
- `TokensRemoved`: tokens removed by truncation, compaction, or context cleanup.
- `CacheReadTokens`: cached input tokens reused by the model/provider.
- `CacheCreationTokens`: input tokens written into cache.
- `PermissionWaitMs`: observed tool-permission wait time or approval friction.

## Optional Content Table

`AgentOpsContent_CL` is for explicit opt-in debugging only. It is not part of the strict privacy path.

Fields:

- `TimeGenerated`
- `RunId`
- `SessionId`
- `TraceId`
- `SpanId`
- `TurnIndex`
- `Role`
- `ContentKind`
- `CaptureMode`
- `PromptText`
- `ResponseText`
- `ToolName`
- `ModelActual`
- `RedactionStatus`
- `ContentHash`
- `ContentLength`

Use a separate restricted workspace/dashboard when this table contains real prompts or responses.

## Local Rollup

Convert a raw span JSONL export into the V2 custom-table shape with:

```bash
agentops run-summary generate --file tests/sample-otel/tool-failure.jsonl --json
```

The command writes metadata-only `AgentOps*_CL.jsonl` files under `.agentops/run-summary/latest` by default. It drops content-like attributes from exported rows and records privacy-signal counts in `AgentOpsPrivacy_CL`.
