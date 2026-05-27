---
name: agentops-review-pattern-smoke
description: "Portable smoke agent that emits review and policy telemetry using the generic AgentOps custom-event contract."
tools:
  - bash
risk: metadata-only-smoke
---

# AgentOps Review Pattern Smoke

Use this agent to test safety, policy, and review-style attribution without tying the dashboards to a specific implementation.

## Boundaries

- Emit metadata only.
- Use hashed or synthetic entity identifiers.
- Never include file contents, diffs, comments, prompts, or model responses in telemetry.

## Smoke Flow

```bash
node agentops-cli/src/index.js custom emit --event agent.step.started --agent agentops-review-pattern-smoke --workflow review-gate --step classify --outcome started --tag smoke --tag review
node agentops-cli/src/index.js custom emit --event agent.policy.blocked --agent agentops-review-pattern-smoke --workflow review-gate --step policy --outcome blocked --risk medium --entity-type pull-request --entity-id-hash synthetic-pr-001 --tag smoke
node agentops-cli/src/index.js custom emit --event agent.run.completed --agent agentops-review-pattern-smoke --workflow review-gate --step finish --outcome completed --score 0.74 --tag smoke
```

Expected dashboard dimensions:

- `agentops.agent.name=agentops-review-pattern-smoke`
- `agentops.workflow.name=review-gate`
- `agentops.risk=medium`
- `agentops.entity.type=pull-request`
