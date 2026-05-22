---
name: agentops-flow-lineage
description: "Use when: tracing custom agents, subagents, /fleet runs, nested agent calls, skill events, hook events, or full Copilot CLI execution flow lineage."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to reconstruct the flow of a Copilot CLI run.

Preferred local command:

```bash
node agentops-cli/src/index.js lineage --last 24h
```

Then query or inspect the returned KQL. Use `OperationId`, `Id`, and `ParentId` to reconstruct parent-child span relationships. Use session ordering as a fallback when parent-child ids are missing.

Interpret node types as:

- `agent`: root custom agent or subagent invocation when `invoke_agent` spans exist.
- `llm`: model calls.
- `tool`: built-in tool calls.
- `mcp_tool`: MCP tool calls inferred from `mcp__<server>__<tool>`, `<server>/<tool>`, or single configured MCP server metadata.
- `skill`: skill invocation events.
- `hook`: hook lifecycle events.
- `context`: truncation or compaction events.
- `error`: exceptions or failed spans.

Report fanout count, max observed depth, failed branches, expensive branches, noisy tools, and missing parent-child telemetry.

Do not expose internal prompts or child-agent transcript content.
