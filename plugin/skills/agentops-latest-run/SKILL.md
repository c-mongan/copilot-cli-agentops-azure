---
name: agentops-latest-run
description: "Use when: the user asks Copilot to find, open, explain, or inspect the latest observed AgentOps/Copilot CLI run without remembering AgentOps CLI commands."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill to get from a plain-language Copilot request to the newest AgentOps run.

Memorable ask:

```text
Use agentops-latest-run to find my latest AgentOps run, open the Run Replay link, explain it, and recommend one next action.
```

Preferred local commands:

```bash
node agentops-cli/src/index.js ask-context latest --last 2h
node agentops-cli/src/index.js open latest --last 2h
node agentops-cli/src/index.js latest --last 2h
node agentops-cli/src/index.js explain latest --last 2h
node agentops-cli/src/index.js recommend latest --last 2h
```

Start with `ask-context` when the user wants investigation, because it bundles the Run Replay link, KQL query, latest recommendation, and metadata-only evidence rows for the Copilot investigator path.

If the local CLI has V2 JSONL exports, prefer the run-scoped commands:

```bash
node agentops-cli/src/index.js open latest --runs <AgentOpsRunSummary_CL.jsonl>
node agentops-cli/src/index.js triage latest --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>
```

Report:

- Run Replay link or the reason a link could not be created.
- Latest run/session/trace id when available.
- Status, likely reason, and one evidence-backed next action.
- The exact follow-up command if local telemetry is missing.

Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.
