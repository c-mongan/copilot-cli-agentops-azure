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
agentops init --full
agentops init --full --yes
agentops copilot -p "Reply with exactly: agentops smoke."
```

PowerShell:

```powershell
az login
./setup-agentops.ps1
agentops init --full
agentops init --full --yes
agentops copilot -p "Reply with exactly: agentops smoke."
```

Verify:

- `copilot-agentops` is installed.
- Everyday observed work uses `agentops copilot ...`. Plain `copilot ...` stays unchanged unless the user explicitly enables transparent routing.
- Content capture is off.
- Collector endpoints are localhost.
- The guided `init --full` output reports cloud provision, dashboard import, real smoke, and latest triage status.
- The response includes a Run Story link when available, or the exact follow-up command when telemetry is missing.
- The response includes one evidence-backed next action or recommendation.

Do not ask the user to enable content capture, paste secrets, or expose prompt/code/tool argument content.
