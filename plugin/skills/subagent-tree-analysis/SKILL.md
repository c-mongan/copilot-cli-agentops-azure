---
name: subagent-tree-analysis
description: "Use when: reconstructing and analyzing Copilot CLI custom-agent and subagent execution trees from OpenTelemetry traces, /fleet runs, fanout, or parallel tasks."
license: MIT
user-invocable: true
allowed-tools:
  - azure-mcp/*
  - agent-grafana/*
---

Use this skill when a task involves subagents, `/fleet`, parallel execution, or multi-agent orchestration.

Procedure:
1. Query recent `invoke_agent` spans.
2. Group by trace id and conversation id.
3. Identify root agents and child subagent invocations.
4. Compute fanout count, max depth, parallelism window, subagent failure rate, tool failures, tokens, and output value proxies.
5. Flag repeated exploration, excessive fanout, overlapping work, broad tools, truncation, and missing recovery hints.
6. Recommend architecture changes with validation metrics.
