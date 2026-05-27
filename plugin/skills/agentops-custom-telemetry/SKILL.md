---
name: agentops-custom-telemetry
description: "Use when: an agent, hook, MCP server, VS Code extension, SDK app, or script needs to emit custom metadata-only AgentOps lifecycle telemetry."
license: MIT
user-invocable: true
allowed-tools:
  - bash
---

Use this skill when a workflow needs custom telemetry beyond the default Copilot CLI spans.

Emit lifecycle events with the local CLI:

```bash
node agentops-cli/src/index.js custom emit --event agent.step.started --agent my-agent --workflow investigation --step collect --outcome started
node agentops-cli/src/index.js custom emit --event agent.eval.scored --agent my-agent --workflow eval-gate --step candidate --score 0.91 --outcome measured
node agentops-cli/src/index.js custom import ./agent-events.jsonl --agent my-agent --workflow investigation
```

Recommended event names:

- `agent.run.started`
- `agent.step.started`
- `agent.tool.used`
- `agent.evidence.found`
- `agent.decision.made`
- `agent.policy.blocked`
- `agent.eval.scored`
- `agent.run.completed`
- `agent.run.failed`

Recommended fields:

- `agentops.agent.name`
- `agentops.workflow.name`
- `agentops.step.name`
- `agentops.outcome`
- `agentops.risk`
- `agentops.score`
- `agentops.entity.type`
- `agentops.entity.id_hash`
- `agentops.custom.*`

Privacy rule: emit metadata only. Do not emit prompts, responses, source code, logs, tool inputs, tool outputs, secrets, full URLs, or raw customer identifiers.
