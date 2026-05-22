---
name: agentops-primitive-inventory
description: "Use when: checking which GitHub Copilot CLI primitives are configured, observed, inferred, or not seen in an AgentOps repo or plugin corpus."
license: MIT
user-invocable: true
allowed-tools:
  - bash
  - powershell
---

Use this skill to avoid overclaiming primitive support.

Preferred local commands:

```bash
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js primitives --root <path-to-copilot-customization-repo> --last 7d
```

Interpret statuses as:

- `configured`: found in local Copilot/plugin files.
- `observed_query`: not configured locally, but covered by runtime telemetry query.
- `inferred`: reconstructable when parent-child telemetry exists.
- `not_seen`: no local config and no dedicated runtime signal in this pack yet.

Check at least these primitives: custom agents, subagents, skills, hooks, MCP servers, MCP tools, built-in tools, instructions, plugins, workflows/commands, LSP servers, benchmarks, ACP, attachments, policy, and context events.

Do not claim full support for a primitive unless the inventory shows `configured`, `observed_query`, or `inferred` with a clear limitation.
