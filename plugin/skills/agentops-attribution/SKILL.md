---
name: agentops-attribution
description: "Use when: the user wants telemetry filtered by custom agent, skill, MCP server/tool, script, hook, or wants to know which agent components are being used, failing, or costing money."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to answer: which agent component was used, what it cost, what failed, and what should be inspected next.

Preferred local commands:

```bash
node agentops-cli/src/index.js attribution --last 7d
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js link session <conversation-id>
```

Useful dashboards:

- `/d/agentops-attribution`
- `/d/agentops-tools-mcp`
- `/d/agentops-runtime-events`
- `/d/agentops-session-detail`

Attribution fields:

- `agentops.agent.name`
- `agentops.agent.file`
- `agentops.agent.hash`
- `agentops.skill.name`
- `agentops.skill.file`
- `agentops.skill.hash`
- `agentops.mcp.server`
- `agentops.mcp.tool`
- `agentops.script.name`
- `agentops.script.file`
- `agentops.script.hash`
- `agentops.hook.name`
- `agentops.cli.agent`
- `github.copilot.skill.name`
- `github.copilot.hook.type`
- `gen_ai.tool.name`

If exact attribution fields are missing, infer MCP server only from documented tool-name shapes such as `mcp__<server>__<tool>` or `<server>/<tool>`. Say clearly when a result is inferred rather than directly observed.

Report:

- Selected filter: agent, skill, MCP server/tool, script, hook, or all attribution.
- Sessions, spans/events, failures, tool calls, tokens, AI credits, and estimated cost.
- Top tools, models, and errors for the selected attribution.
- Whether attribution was direct (`agentops.*`) or inferred from Copilot/GenAI fields.
- One evidence-backed next action.

Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.
