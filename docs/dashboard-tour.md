# AgentOps Dashboard Tour

Use the dashboards in this order: start broad, then drill down only when you need more detail.

```text
Overview
   |
   +--> Sessions ---------> Session Detail
   |        |                    |
   |        |                    +--> replay-style span/event timeline
   |        |                    +--> Live Replay
   |        |
   |        +--------------> Traces / Spans
   |
   +--> Tools & MCP -------> failed tools, MCP servers, tool waterfall
   |
   +--> Attribution -------> custom agents, skills, MCP, scripts/hooks
   |
   +--> Safety & Policy ---> content capture signals, broad permissions, policy blocks
   |
   +--> Alert Tuning ------> threshold evidence before enabling real alert rules
```

## Overview

Use this as the front door. It answers: **is Copilot/agent activity flowing, how much did it cost, how many tools ran, and are failures rising?**

Good for daily health checks and quick demos. If this page is empty after setup, run the smoke test first.

![AgentOps overview dashboard](screenshots/agentops-overview-live.png)

## Sessions

Use this when someone asks: **which run should I look at?**

Each row is a session. Sort by failures, cost, token use, duration, or risk. This is usually the best place to start an incident or cost investigation.

![AgentOps sessions dashboard](screenshots/agentops-sessions-live.png)

## Session Detail

Use this after choosing one session. It answers: **what happened during this run?**

You get span count, failures, token/cost summary, tool waterfall, runtime events, and safety signals for one conversation/session.

Think of this as the first version of live session replay. For a simple agent, it shows one run timeline with LLM calls, tools, MCP calls, scripts/hooks, timings, cost, and errors. For an orchestrator agent, the same view can become a delegation tree when spans include parent/child IDs or optional `agentops.parent_agent.*` and `agentops.delegation.*` fields. No sub-agents are required.

![AgentOps session detail dashboard](screenshots/agentops-session-detail-live.png)

## Live Replay

Use this when you want to watch a full run unfold. It answers: **which agent lane did each event belong to, what tools/MCP servers/scripts ran, what took time, and where did failures or policy/content signals appear?**

Single-agent runs show one lane. Orchestrator runs become a tree when spans include parent/child IDs or optional `agentops.parent_agent.name` and `agentops.delegation.id` fields. This keeps the dashboard generic: it works for Copilot CLI, Codex, VS Code, SDK agents, CI agents, and agents that never delegate.

![AgentOps live replay dashboard](screenshots/agentops-live-replay-live.jpg)

## Traces / Spans

Use this when you need raw evidence. It answers: **what exact spans did Copilot emit?**

This page is intentionally lower-level: operation IDs, parent/child spans, durations, tool names, models, result codes, and errors.

![AgentOps traces dashboard](screenshots/agentops-traces-live.png)

## Tools & MCP

Use this for tool reliability. It answers: **which tools or MCP servers are being used, and which ones fail?**

This is where Azure MCP, shell tools, custom tools, and likely MCP-provided tools show up. Tools are auto-detected from `gen_ai.tool.name`; MCP server/tool attribution is exact for names such as `mcp__server__tool` or `server/tool`, and inferred for known prefixes such as Azure MCP.

![AgentOps tools and MCP dashboard](screenshots/agentops-tools-live.png)

## Attribution

Use this to understand ownership. It answers: **which custom agents, skills, MCP servers, scripts, or hooks are responsible for usage and failures?**

This is useful when teams share one Azure workspace but want to know what agent/plugin/workflow generated the traffic.

![AgentOps attribution dashboard](screenshots/agentops-attribution-live.png)

## Runtime Events

Use this for Copilot runtime behavior. It answers: **did hooks, skills, truncation, compaction, policy, or lifecycle events happen?**

Some panels should be quiet in healthy runs. For example, content capture should be empty when privacy defaults are working.

![AgentOps runtime events dashboard](screenshots/agentops-runtime-live.png)

## Safety & Policy

Use this for enterprise review. It answers: **are broad permissions, content capture, sharing, remote mode, policy blocks, or risky session settings present?**

No data in content-capture panels is good when content capture is intentionally disabled.

![AgentOps safety and policy dashboard](screenshots/agentops-safety-policy-live.png)

## Permission Friction

Use this to tune developer experience. It answers: **where are permissions, denied tools, policy blocks, or repeated failures slowing people down?**

This helps decide whether a tool should be allowed, denied, documented, or replaced.

![AgentOps permission friction dashboard](screenshots/agentops-permission-friction-live.png)

## Alert Tuning

Use this before enabling real alerts. It answers: **what thresholds are reasonable for failures, tool failures, AIU/cost, latency, and content capture?**

The alert rules are disabled by default. This page is evidence for choosing thresholds, not an emergency console on day one.

![AgentOps alert tuning dashboard](screenshots/agentops-alert-tuning-live.png)

## Quality

Use this for improvement work. It answers: **which sessions are slow, expensive, failing, or inefficient?**

This page is where you find candidates for better prompts, safer tools, smaller context, cheaper models, or workflow changes.

![AgentOps quality dashboard](screenshots/agentops-quality-live.png)

## Experiments

Use this for benchmark and variant comparisons. It answers: **did a change help or regress?**

Run `agentops benchmark run ...` or label real runs with experiment metadata, then compare pass rate, score, token use, cost, safety issues, and failures.

![AgentOps experiments dashboard](screenshots/agentops-experiments-live.png)

## Data Quality

Use this when something looks wrong. It answers: **are the fields, token rollups, collector health, and smoke-ingestion assumptions valid?**

This is the troubleshooting dashboard for schema drift and ingestion issues.

![AgentOps data quality dashboard](screenshots/agentops-data-quality-live.png)

## Expected Empty Panels

Some panels are expected to show no data until matching telemetry exists:

- **Safety & Policy** stays mostly empty when content capture is off and no policy block happened.
- **Runtime Events** needs hook, skill, truncation, compaction, shutdown, or policy events.
- **Alert Tuning** is evidence-first; alert rules are disabled by default until you have enough clean history.
- **Experiments** needs benchmark telemetry or experiment labels.
- **Attribution** needs custom agent, skill, MCP, or script labels. Use `agentops attribution-smoke --wait 5m --poll 15s` to verify the wiring.
- **Live Replay** needs at least one session inside the selected time range. Use `agentops live-replay-smoke --wait 5m --poll 15s` to generate a fresh orchestrator/sub-agent replay and open the printed URL.
