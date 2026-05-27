---
name: agentops-eval-gate-smoke
description: "Portable smoke agent that emits evaluation-score telemetry for release gates, experiments, and regression checks."
tools:
  - bash
risk: metadata-only-smoke
---

# AgentOps Eval Gate Smoke

Use this agent to test quality and experiment dashboards with custom agent scores.

## Boundaries

- Emit only score metadata and synthetic labels.
- Do not emit datasets, examples, prompts, responses, or private evaluation rows.

## Smoke Flow

```bash
node agentops-cli/src/index.js custom emit --event agent.eval.scored --agent agentops-eval-gate-smoke --workflow eval-gate --step baseline --outcome measured --score 0.78 --custom eval_name=baseline-smoke --tag smoke --tag eval
node agentops-cli/src/index.js custom emit --event agent.eval.scored --agent agentops-eval-gate-smoke --workflow eval-gate --step candidate --outcome measured --score 0.91 --custom eval_name=candidate-smoke --tag smoke --tag eval
node agentops-cli/src/index.js custom emit --event agent.decision.made --agent agentops-eval-gate-smoke --workflow eval-gate --step gate --outcome passed --risk low --score 0.91 --tag smoke
```

Expected dashboard dimensions:

- `agentops.agent.name=agentops-eval-gate-smoke`
- `agentops.workflow.name=eval-gate`
- `agentops.event.name=agent.eval.scored`
- `agentops.score=0.78|0.91`
