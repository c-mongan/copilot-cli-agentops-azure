---
name: agentops-operations
description: "Use when: checking AgentOps health, disabling plain copilot shadowing, stopping the collector, uninstalling shims, or choosing a safe cleanup path."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
---

Use this skill for operational maintenance and reversible cleanup.

Preferred local commands:

```bash
node agentops-cli/src/index.js status
node agentops-cli/src/index.js doctor --local-only
node agentops-cli/src/index.js validate-collector
node agentops-cli/src/index.js disable-shadow
node agentops-cli/src/index.js collector stop
node agentops-cli/src/index.js uninstall
```

Choose the least disruptive action:

- Use `status` or `doctor --local-only` before changing anything.
- Use `disable-shadow` when the user wants plain `copilot` to bypass AgentOps but keep `copilot-agentops`.
- Use `collector stop` when only the local Azure Monitor collector should stop.
- Use `uninstall` when the user wants the installed shims removed.

Do not delete telemetry workspaces, dashboards, or Azure resources from this skill. Hand off to the Azure deployment or validation workflow if resource changes are requested.
