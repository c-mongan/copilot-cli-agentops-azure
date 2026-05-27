---
name: agentops-setup
description: "Use when: installing AgentOps for GitHub Copilot CLI, checking local prerequisites, refreshing bundled skills, or guiding a first successful smoke run."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
---

Use this skill to make first setup boring and verifiable.

Preferred local commands:

```bash
az login
export AZURE_RESOURCE_GROUP=rg-agentops-dev
export AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID="<workspace-id>"
export AGENTOPS_GRAFANA_BASE_URL="https://<your-grafana>.grafana.azure.com"
./setup-agentops.sh
node agentops-cli/src/index.js status
node agentops-cli/src/index.js workflows show latest-run
```

PowerShell:

```powershell
az login
$env:AZURE_RESOURCE_GROUP = "rg-agentops-dev"
$env:AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID = "<workspace-id>"
$env:AGENTOPS_GRAFANA_BASE_URL = "https://<your-grafana>.grafana.azure.com"
./setup-agentops.ps1
node agentops-cli/src/index.js status
node agentops-cli/src/index.js workflows show latest-run
```

Verify:

- `copilot-agentops` is installed.
- Plain `copilot` shadowing is either observed or the user has the PATH command to enable it.
- Content capture is off.
- Collector endpoints are localhost.
- Bundled skills are installed or skipped because local copies already exist.
- The next smoke command is clear.

Do not ask the user to enable content capture, paste secrets, or expose prompt/code/tool argument content.
