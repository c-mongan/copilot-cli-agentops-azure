---
name: agentops-ci-pattern-smoke
description: "Portable smoke agent that emits generic AgentOps lifecycle telemetry for a CI-style investigation without depending on any one CI provider."
tools:
  - bash
risk: metadata-only-smoke
---

# AgentOps CI Pattern Smoke

Use this agent to test whether custom agent lifecycle telemetry appears in AgentOps.

## Boundaries

- Emit metadata only: event names, agent name, workflow, step, outcome, risk, and scores.
- Do not emit prompts, source code, logs, secrets, tool arguments, tool results, URLs, or connection strings.
- Keep the test deterministic and safe to run in any repo.

## Smoke Flow

Run these commands from the repo root:

```bash
node agentops-cli/src/index.js custom emit --event agent.run.started --agent agentops-ci-pattern-smoke --workflow ci-investigation --step start --outcome started --tag smoke --tag ci-pattern
node agentops-cli/src/index.js custom emit --event agent.evidence.found --agent agentops-ci-pattern-smoke --workflow ci-investigation --step evidence --outcome found --risk low --custom evidence_type=build-signal --tag smoke
node agentops-cli/src/index.js custom emit --event agent.decision.made --agent agentops-ci-pattern-smoke --workflow ci-investigation --step rank --outcome selected --score 0.86 --tag smoke
node agentops-cli/src/index.js custom emit --event agent.run.completed --agent agentops-ci-pattern-smoke --workflow ci-investigation --step finish --outcome passed --tag smoke
```

Expected dashboard dimensions:

- `agentops.agent.name=agentops-ci-pattern-smoke`
- `agentops.workflow.name=ci-investigation`
- `agentops.event.name=agent.run.started|agent.evidence.found|agent.decision.made|agent.run.completed`
