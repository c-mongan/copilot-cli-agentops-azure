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
./setup-agentops.sh
node agentops-cli/src/index.js init --full
```

PowerShell:

```powershell
az login
./setup-agentops.ps1
node agentops-cli/src/index.js init --full
```

Verify:

- `copilot-agentops` is installed.
- Plain `copilot` shadowing is either observed or the user has the PATH command to enable it.
- Content capture is off.
- Collector endpoints are localhost.
- The guided `init --full` output reports cloud provision, dashboard import, real smoke, and latest triage status.
- The response includes a Run Replay link when available, or the exact follow-up command when telemetry is missing.
- The response includes one evidence-backed next action or recommendation.

Do not ask the user to enable content capture, paste secrets, or expose prompt/code/tool argument content.
