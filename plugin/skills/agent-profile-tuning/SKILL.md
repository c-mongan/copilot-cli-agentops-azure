---
name: agent-profile-tuning
description: "Use when: tuning Copilot CLI .agent.md custom-agent profiles with telemetry evidence, least-privilege tools, safer descriptions, or validation KQL."
license: MIT
user-invocable: true
allowed-tools:
  - read
  - search
  - edit
  - azure-mcp/*
---

Use this skill to improve `.agent.md` files.

Steps:
1. Read the current agent profile.
2. Identify intended purpose from `description` and body.
3. Query telemetry for that agent id, name, and version.
4. Evaluate tool use, failures, turns, duration, tokens, truncation, subagent fanout, skill invocation, and permission prompts.
5. Recommend smaller descriptions, safer tools, explicit MCP scope, read-only posture, split agents, or moving details into skills.
6. Keep diffs small and include validation KQL.
