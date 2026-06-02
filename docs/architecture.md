# Architecture

Copilot AgentOps for Azure is a local-first observability loop for Copilot CLI, Copilot SDK apps, VS Code/MCP tools, and GitHub code outcomes.

The default product path is V2: Agent Run tables plus the `AgentOps for Azure` Grafana dashboards.

## One Screen

```text
Surfaces
  Copilot CLI
  Copilot SDK
  VS Code + MCP
  GitHub outcomes
      |
      v
Local AgentOps boundary
  wrapper / SDK adapter / MCP proxy
  OTLP endpoint on 127.0.0.1
  strict privacy defaults
      |
      v
OpenTelemetry Collector
  allowlist safe metadata
  drop/redact content-like fields
  normalize GenAI + MCP spans
  roll up Agent Run tables
      |
      v
Azure
  Application Insights
  Log Analytics custom tables
  Azure Managed Grafana
      |
      v
Operator workflows
  Home -> Runs -> Replay -> Tools -> Models
  Privacy -> Outcomes -> Evals -> Insights -> Collector
```

Rendered architecture assets:

- source SVG: [agentops-architecture-dataflow.svg](agentops-architecture-dataflow.svg)
- PNG: [images/agentops-architecture-dataflow.png](images/agentops-architecture-dataflow.png)

![AgentOps architecture](images/agentops-architecture-dataflow.png)

## Runtime Paths

```text
Copilot CLI
  -> agentops copilot
  -> real Copilot binary
  -> safe run metadata
  -> local OTLP collector

Plain copilot command
  -> optional local shim
  -> agentops wrapper
  -> real Copilot binary

Copilot SDK app
  -> @agentops/copilot-sdk adapter
  -> captureContent=false
  -> W3C trace context
  -> local OTLP collector

VS Code MCP server
  -> agentops mcp-proxy
  -> real MCP server
  -> MCP call metadata
  -> local OTLP collector

GitHub outcome enrichment
  -> gh CLI metadata
  -> hashed repo/branch/PR identifiers
  -> AgentOpsGithubOutcomes_CL
```

## Privacy Boundary

The local Collector is the scrub-before-export boundary.

```text
raw local event
  -> strict allowlist
  -> content-signal detector
  -> secret-like redaction
  -> safe metadata export
```

Strict mode does not export by default:

- prompts or responses;
- source code or file contents;
- tool arguments or tool results;
- system instructions;
- request or response bodies;
- full URLs;
- secrets.

If content-like fields appear, strict mode drops or redacts them and emits metadata-only signals such as `agentops.content_capture.signal`.

## Agent Run Model

One Agent Run is one trace-level story.

```text
agentops.run
  agentops.session
  gen_ai.chat
  gen_ai.execute_tool
  mcp.tools.call
  agentops.tool.shell
  agentops.file.edit
  agentops.test.run
  agentops.policy.decision
  agentops.privacy.signal
  github.pr.outcome
  agentops.eval
```

The V2 rollup writes metadata-only custom table rows:

```text
AgentOpsRunSummary_CL
AgentOpsEvents_CL
AgentOpsToolCalls_CL
AgentOpsMcpCalls_CL
AgentOpsPrivacy_CL
AgentOpsEval_CL
AgentOpsGithubOutcomes_CL
AgentOpsInsights_CL
AgentOpsCollectorHealth_CL
```

See [Agent run data model](agent-run-data-model.md) and [OTel GenAI and MCP schema](otel-genai-mcp-schema.md).

## Dashboard Product

```text
AgentOps Home
  -> executive health and next actions

Runs Explorer
  -> trace-list style run search

Agent Run Replay
  -> metadata-only timeline for one run

Models, Cost & Tokens
  -> model ROI and token posture

Tools & MCP Risk
  -> tool failure, denial, MCP, and risk analysis

Safety, Privacy & Policy
  -> trust posture and strict-mode proof

Code Outcomes
  -> tests, PRs, CI, review, merge, revert

Evals & Quality
  -> deterministic quality scoring

Insights & Regressions
  -> anomaly and recurring-pattern surfacing

Collector Health
  -> supportability and ingestion state
```

Legacy raw-OTel dashboards are debug views. They are not imported by default.

## Azure Resources

The Bicep deployment can provision:

- Log Analytics Workspace;
- Application Insights;
- Azure Monitor Workspace;
- Azure Managed Grafana;
- Key Vault;
- optional alerts, actioner, RBAC, and budget modules.

The intended default is enterprise-safe and cost-bounded: local privacy boundary, metadata-only telemetry, capped Azure ingestion profiles, and disabled automation until explicitly enabled.

## Validation Flow

```text
npm test
  -> schema validate
  -> collector validate strict
  -> poison smoke
  -> dashboard validate
  -> dashboard links/ux checks
  -> optional live Azure/Grafana audit
```

Core commands:

```bash
npm --prefix agentops-cli test
npm --prefix agentops-cli run coverage:check
node agentops-cli/src/index.js schema validate
node agentops-cli/src/index.js collector validate --mode auto --privacy strict --json
node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
node agentops-cli/src/index.js dashboard verify
```

See [Release checklist V2](release-checklist-v2.md).
