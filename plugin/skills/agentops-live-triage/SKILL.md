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

If the local CLI is unavailable, use read-only Azure MCP or Grafana MCP against `AppDependencies` where `Properties has "github.copilot"` and `Properties has "github-copilot-cli"`.

Report:

- Session id and time range.
- Agent, model, tool, policy, context, and error timeline.
- Failure, policy, token, cost, or content-capture signals.
- Which Copilot primitives are configured locally and which require runtime observation.
- One evidence-backed next action.
- Grafana or KQL evidence link when available.

Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.
