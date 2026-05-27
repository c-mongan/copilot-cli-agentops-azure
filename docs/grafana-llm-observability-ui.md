# Grafana LLM Observability UI Plan

This project can deliver a session-first LLM observability experience in Grafana, but it should be designed as an operator workflow rather than a single metrics dashboard.

## Target Experience

The UI should answer five questions quickly:

1. What sessions happened?
2. Which sessions were expensive, slow, failed, or risky?
3. What happened inside one session?
4. Which models, tools, repos, skills, hooks, and policies are driving behavior?
5. What should be tuned next?

The current dashboard mostly answers aggregate questions. The next step is a session-first workflow with drilldowns.

## Datadog-Style UX Shape

### 1. Session Explorer

Default landing page.

Panels:

- Search/filter bar using Grafana variables for model, operation, agent, repo, success, and risk.
- Session table grouped by `gen_ai.conversation.id`.
- Columns: start time, duration, model, agent, repo hash, spans, tool calls, failures, input tokens, output tokens, cache read/write, estimated USD, AI credits, AIU, content-capture signals, compaction/truncation events, policy blocks.
- Sorting defaults to highest risk or highest estimated cost.
- Row links to a session detail dashboard with `var-conversation=<id>`.

### 2. Session Detail

Single-session view.

Panels:

- Session header with status, model, agent, repo hash, duration, cost, tokens, and failure count.
- Timeline of spans by operation/tool.
- Trace/span table ordered by time.
- Logs/events table for hooks, skills, compaction, truncation, shutdown, and policy blocks.
- Token and cost breakdown for the session.
- Tool waterfall: tool name, duration, success, error type.
- Safety strip: content capture, secret/policy denials, risky command attempts.

### 3. Trace / Span Explorer

Datadog-like low-level inspection.

Panels:

- Trace search by operation, model, tool, repo, result code, and error type.
- Span table with `OperationId`, parent/span identifiers where available, `Name`, `DurationMs`, `Success`, `ResultCode`, and selected `Properties`.
- Drilldown links to Azure Portal Log Analytics for the raw query.

### 4. Logs / Events Explorer

Agent runtime events that are not naturally span-shaped.

Panels:

- Hook events.
- Skill invocations.
- Session compaction/truncation.
- Session shutdown/abort/exception.
- Policy decisions.
- Content-capture detector hits.

### 5. Quality And Optimization

Higher-level AgentOps page.

Panels:

- Slowest sessions.
- Most expensive sessions.
- Highest failure-rate tools.
- Models by cost and latency.
- Repos with repeated failures.
- Agents/skills that correlate with failures or high token usage.
- Candidate tuning actions.

## Grafana Implementation Options

### Option A: Dashboard Pack

Best next step.

Create multiple dashboards with linked variables:

- `agentops-overview`
- `agentops-sessions`
- `agentops-session-detail`
- `agentops-traces-spans`
- `agentops-runtime-events`
- `agentops-quality`

Pros:

- Works in Azure Managed Grafana today.
- No custom frontend build.
- Easy to import through the existing post-provision hook.

Cons:

- Less polished than a custom app.
- Some drilldown behavior is limited by Grafana table/data-link support.

### Option B: Grafana Scenes App

Best long-term Datadog-like UI.

Build a Grafana app plugin using Grafana Scenes. This gives a real product surface with tabs, split panes, persistent filters, drilldowns, and custom interaction patterns.

Pros:

- Closest to a purpose-built observability product UX.
- Can create a session explorer with proper master/detail navigation.
- Can hide Grafana dashboard mechanics from the user.

Cons:

- More engineering work.
- Azure Managed Grafana plugin support must be checked for custom plugin deployment/signing constraints.

### Option C: Azure Workbook Companion

Useful for Azure-native operators.

Use Azure Workbooks for guided investigations and keep Grafana for live dashboarding.

Pros:

- Excellent Azure Portal integration.
- Good for runbooks and guided incident review.

Cons:

- Not as polished for LLM session exploration.

## Data Model Requirements

The UI becomes much better if every span/event consistently has these fields:

- `gen_ai.conversation.id`
- `gen_ai.operation.name`
- `gen_ai.request.model`
- `gen_ai.agent.name`
- `gen_ai.tool.name`
- `agentops.repo.hash`
- `agentops.profile`
- `agentops.experiment`
- `agentops.pack.version`
- `git.branch`
- `git.commit`
- `github.copilot.cost`
- `github.copilot.aiu`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.cache_read.input_tokens`
- `gen_ai.usage.cache_creation.input_tokens`
- `error.type`

Where Azure Monitor exposes trace/span identifiers, dashboards should surface:

- `OperationId`
- `ParentId`
- `Id`

## Recommended V0.3 Build

1. Split the current dashboard into an overview plus a dedicated session explorer.
2. Add a `conversation` dashboard variable populated from `gen_ai.conversation.id`.
3. Add a session table grouped by conversation.
4. Add a session-detail dashboard filtered by `conversation`.
5. Add table data links from session rows to the detail dashboard.
6. Add Azure Portal Log Analytics links for raw span/event inspection.
7. Keep content capture disabled and show content-capture hits as a red safety signal.

## Recommended V0.4 Build

1. Add a runtime-events dashboard for hooks, skills, compaction, truncation, and policy blocks.
2. Add a trace/span explorer dashboard with raw `OperationId` and span details.
3. Add annotation support for deployments, config changes, and alert threshold updates.
4. Add a daily summary panel that matches what an AgentOps retrospective agent would report.

## Recommended V0.5 Build

Evaluate a Grafana Scenes app if Azure Managed Grafana allows the deployment path.

The app should feel like:

```text
AgentOps
  Overview
  Sessions
  Session Detail
  Traces
  Runtime Events
  Quality
  Settings
```

This is the route to a truly Datadog-level UI, while the dashboard pack is the fastest path to a much better experience.

## Design Notes

- Keep the first screen operational and dense, not a marketing hero.
- Use status/risk color sparingly: green for healthy, yellow for needs attention, red for safety/failure.
- Prefer table drilldowns over decorative charts when investigating sessions.
- Use short labels: `Runs`, `Cost`, `Tokens`, `Failures`, `Policy Blocks`, `Compactions`.
- Put safety panels near the top: content capture should be impossible to miss.
- Keep raw prompt/message content out of dashboards by default.
