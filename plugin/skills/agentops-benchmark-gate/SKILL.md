---
name: agentops-benchmark-gate
description: "Use when: deciding whether an agent, skill, hook, MCP config, prompt, or tool-policy change actually improved Copilot CLI behavior."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
---

Use this skill to turn a proposed change into benchmark evidence.

Preferred local commands:

```bash
node agentops-cli/src/index.js benchmark list
node agentops-cli/src/index.js benchmark run <suite> --variant baseline --repeat 1 --hypothesis <id>
node agentops-cli/src/index.js benchmark run <suite> --variant candidate --repeat 1 --hypothesis <id>
node agentops-cli/src/index.js benchmark compare <baseline-run-id> <candidate-run-id> --azure --last 24h
```

Require the report to include:

- Hypothesis id.
- Expected metric movement.
- Pass/fail status.
- Token, cost, AIU, duration, tool failure, and policy deltas.
- Promote, investigate, or reject recommendation.
- Rollback condition.

Do not keep agent, skill, hook, or MCP changes on intuition alone when a benchmark can reasonably exercise the behavior.
