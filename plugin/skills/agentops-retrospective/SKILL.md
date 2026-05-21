---
name: agentops-retrospective
description: "Use when: analyzing recent GitHub Copilot CLI telemetry to recommend improvements to custom agents, subagents, skills, hooks, instructions, MCP config, and tool policies."
license: MIT
user-invocable: true
allowed-tools:
  - azure-mcp/*
  - agent-grafana/*
  - read
  - search
---

Use this skill when asked to improve Copilot CLI behavior based on telemetry.

Procedure:
1. Identify the Application Insights or Log Analytics resource containing Copilot CLI telemetry.
2. Query recent Copilot CLI spans from `AppDependencies` where `Properties has "github.copilot" and Properties has "github-copilot-cli"`.
3. Group by agent, model, operation, tool, skill, hook, conversation, repo hash, and experiment label.
4. Find repeated failures, high turn counts, truncation, hook errors, skill issues, and risky tool patterns.
5. Map each pattern to one improvement type.
6. Produce minimal recommendations with validation KQL.

Use `Properties` for OTel attributes in the verified Azure Monitor workspace path. Fall back to classic `customDimensions` only if discovery shows classic Application Insights tables are being queried.
