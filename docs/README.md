# AgentOps Documentation

This directory is the product manual for Copilot AgentOps for Azure.

Start here when you want the shortest path through the repo:

```text
README.md
  -> docs/README.md                 # docs index
  -> docs/operator-guide.md          # full command reference (moved from README)
  -> docs/simplified-azure-design.md # next-version product shape
  -> docs/architecture.md            # system shape
  -> docs/grafana-dashboard-tour-v2.md
  -> docs/public-release.md             # package and public-release checklist
  -> docs/release-checklist-v2.md
```

## Product In One Screen

```text
Copilot CLI / SDK / VS Code + MCP
  -> local AgentOps privacy boundary
  -> Azure Monitor / Application Insights
  -> native Agents view first
  -> optional Workbooks or Managed Grafana for advanced operators
```

AgentOps answers:

- what Copilot did;
- which run, session, agent, skill, sub-agent, model, tool, or MCP server was involved;
- what failed, slowed down, or cost too much;
- what privacy or policy signals fired;
- whether code changed, tests ran, CI passed, or a PR was opened.

## Visual Architecture

Use the ASCII diagrams in [architecture.md](architecture.md) for terminal-friendly reading.

For rendered docs and presentations:

- source SVG: [agentops-architecture-dataflow.svg](agentops-architecture-dataflow.svg)
- rendered PNG: [images/agentops-architecture-dataflow.png](images/agentops-architecture-dataflow.png)

![AgentOps architecture](images/agentops-architecture-dataflow.png)

## Reading Paths

### Product Direction

1. [Copilot AgentOps master plan](plans/2026-09-29-copilot-agentops-observability.md)
2. [Full agent observability requirements](requirements/full-agent-observability-requirements.md)
3. [Requirements reconciliation and current research](research/2026-09-29/README.md)

The master plan is the delivery and acceptance authority. The full requirements remain the exhaustive long-term scope. Build the Copilot CLI pilot first; defer other surfaces and the architecture-improvement loop until the synthetic end-to-end, process-isolation, onboarding, UX, and Azure security gates pass.

### New User

1. [CLI-first flight recorder](cli-first-flight-recorder.md)
2. [Simplified Azure-native design](simplified-azure-design.md)
3. [Secure by default](secure-by-default.md)
4. [Collector modes](collector-modes.md)
5. [Privacy modes](privacy-modes.md)
6. [E2E validation](e2e-validation.md)

### Operator

1. [Grafana dashboard tour V2](grafana-dashboard-tour-v2.md)
2. [KQL query library](kql-query-library.md)
3. [Evals and insights](evals-and-insights.md)
4. [Weekly digest and failure clusters](digest.md)
5. [GitHub outcome enrichment](github-outcome-enrichment.md)
6. [Troubleshooting](troubleshooting.md)

### Implementer

1. [Agent run data model](agent-run-data-model.md)
2. [OTel GenAI and MCP schema](otel-genai-mcp-schema.md)
3. [Copilot CLI instrumentation](copilot-cli-instrumentation.md)
4. [Copilot SDK adapter](copilot-sdk-adapter.md)
5. [MCP observability proxy](mcp-observability-proxy.md)
6. [Azure V2 ingestion](azure-v2-ingestion.md)
7. [Azure production hardening](azure-production-hardening.md)
8. [Azure schema migration recovery](azure-schema-migration-recovery.md)

### Coding Agent Or LLM

Use [llm-map.md](llm-map.md). It names the core files, safe edit zones, verification commands, and product invariants.

## What Is Stable

Stable product surface:

- `agentops setup`
- `agentops collector ...`
- `agentops copilot ...`
- `agentops latest`, `replay`, `open`
- `agentops dashboard validate|links-check|ux-check|content-check|verify|import`
- V2 dashboards in `grafana/dashboards/v2/`
- strict privacy mode and local collector boundary

Experimental or data-dependent:

- custom actioner destinations;
- benchmark promotion loops;
- prompt/response transcript viewer, which is explicit opt-in only;
- legacy raw-OTel dashboards.

## Documentation Rules

Keep docs useful to both humans and LLMs:

- put the answer first;
- prefer ASCII diagrams for architecture and flows;
- link to exact commands and files;
- call out privacy defaults clearly;
- avoid raw prompt, response, source-code, tool-argument, or secret examples unless they are fake poison fixtures;
- keep README short and move deep detail here.
