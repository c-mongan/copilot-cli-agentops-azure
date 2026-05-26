---
name: agentops-dashboard-ops
description: "Use when: opening AgentOps Grafana dashboards, rebuilding dashboard JSON, importing dashboards manually, or creating session and trace links."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to get users from telemetry to the right dashboard view without requiring Grafana or KQL knowledge.

Preferred local commands:

```bash
node agentops-cli/src/index.js open
node agentops-cli/src/index.js link session <conversation>
node agentops-cli/src/index.js link trace <operationId>
node scripts/build-grafana-dashboard-pack.js
AZURE_RESOURCE_GROUP=rg-agentops-dev GRAFANA_NAME=graf-agentops-dev ./scripts/grafana-import-dashboard.sh
```

When reporting dashboard help, include:

- Which dashboard or panel to open.
- The generated Grafana URL when available.
- The generated Azure Log Analytics query when useful.
- Whether the user needs to set `AGENTOPS_GRAFANA_BASE_URL`.
- The smallest rebuild or import command if dashboard JSON changed.

Keep imports explicit. Do not deploy or modify Azure resources beyond the dashboard import command unless the user asks for deployment.
