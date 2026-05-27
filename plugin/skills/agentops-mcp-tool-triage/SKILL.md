---
name: agentops-mcp-tool-triage
description: "Use when: investigating MCP server/tool usage, MCP regressions, disabled MCP servers, GitHub MCP tool selection, or tool failures in Copilot CLI telemetry."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to answer which MCP servers and tools were involved and whether they helped or hurt.

Preferred local commands:

```bash
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js permission-friction --last 7d
node agentops-cli/src/index.js lineage --last 24h
```

Inspect:

- `gen_ai.tool.name`
- `agentops.mcp.config.servers`
- `agentops.mcp.disabled.servers`
- `agentops.mcp.github.tools`
- `agentops.mcp.github.toolsets`
- Tool failures, retry hints, policy blocks, and latency.

Treat MCP server attribution as exact when tool names use `mcp__<server>__<tool>` or `<server>/<tool>`. Treat it as inferred when there is only one configured MCP server and a non-built-in tool name.

Recommend least-privilege MCP scope such as `<server>/<tool>` or `<server>/*` only when supported by the agent/tool configuration. Do not loosen MCP access without explicit user approval.
