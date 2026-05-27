---
name: agentops-live-triage
description: "Use when: the user asks what happened in the latest Copilot CLI session, wants a live AgentOps view, replay, explanation, or next recommended action."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to answer: what happened, why it mattered, and where to look next.

Preferred local commands:

```bash
node agentops-cli/src/index.js live --last 2h
node agentops-cli/src/index.js replay latest --last 24h
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js recommend latest --last 24h
```

If the local CLI is unavailable, use read-only Azure MCP or Grafana MCP against `AppDependencies` with the Copilot/Codex OTel compatibility filter: `Properties has "github.copilot" or Properties has "gen_ai.operation.name" or Properties has "agentops." or AppRoleName in ("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli") or tostring(Properties["service.name"]) in ("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli") or tostring(Properties["agent.runtime"]) in ("codex", "openai-codex-cli")`.

Report:

- Session id and time range.
- Agent, model, tool, policy, context, and error timeline.
- Failure, policy, token, cost, or content-capture signals.
- Which Copilot primitives are configured locally and which require runtime observation.
- One evidence-backed next action.
- Grafana or KQL evidence link when available.

Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.
