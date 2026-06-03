# Observability Product Patterns Roadmap

This note summarizes product and architecture patterns from mature OpenTelemetry observability tools that can make Azure AgentOps more useful. It intentionally describes reusable ideas rather than naming or copying any third-party implementation.

Use this document as a product roadmap, not as source-code guidance. Reimplement patterns independently, keep the Azure Monitor and Grafana architecture, and avoid third-party product names in user-facing feature names.

## Product Patterns Worth Adapting

Mature observability products are useful because they turn raw telemetry into investigation workflows:

- Explorer-first navigation for sessions, traces, runtime events, quality signals, alerts, dashboards, and saved views.
- Quick filters that map typed telemetry fields to usable controls.
- Saved views that preserve query, filters, panel type, tags, route context, and time range.
- Timeline and span-detail surfaces for fast root-cause inspection.
- Related-signal navigation from one session/span into logs, events, policy decisions, and infrastructure health.
- Shareable context links that preserve time range, filters, selected columns, and query state.
- Alert tuning as a guided flow: query, condition, evaluation settings, notification policy, and history.
- Alert history with timeline graph plus table so thresholds are evidence-based.
- Metadata/query-suggestion flows that discover available fields and values from ingested telemetry.
- Assistant workflows that include page context, tool-call steps, confirmations, and feedback.

## Best Ideas To Adapt Here

### 1. Investigation Views, Not Just Dashboards

Current state: the v0.3 Grafana dashboard pack has overview, sessions, session detail, traces/spans, runtime events, and quality dashboards.

Next improvement: make each dashboard feel like a workflow step:

- Sessions: find a suspicious session.
- Detail: explain exactly what happened.
- Related signals: jump to raw spans, runtime events, policy decisions, and Azure logs for the same time window.
- Quality: recommend tuning actions with evidence.

Implementation surface:

- `scripts/build-grafana-dashboard-pack.js`
- `grafana/agentops-*.json`
- `kql/*.kql`

### 2. Saved Investigations

Saved views are a major usability primitive. AgentOps should add a lightweight equivalent before building a full custom app.

Recommended MVP:

- Add `agentops-cli saved-view` commands backed by local JSON files under an ignored user directory such as `~/.agentops/views.json`.
- Save name, description, tags, dashboard UID, Grafana URL, KQL query, time range, variables, and created timestamp.
- Add README examples for saving a high-cost session, a recurring tool failure query, and a content-capture audit.

Future Azure-backed version:

- Store shared team views in Azure Table Storage, Blob Storage, or App Configuration.
- Surface saved views as a Grafana dashboard table generated from KQL or static dashboard links.

Implementation surface:

- `agentops-cli/src/index.js`
- `agentops-cli/test/index.test.js`
- `README.md`
- `docs/testing-and-next-steps.md`

### 3. Shareable Deep Links

Context links should encode query state, time range, and selected filters. AgentOps should generate consistent links for Grafana and Azure Portal.

Recommended MVP:

- Add helper functions in `scripts/build-grafana-dashboard-pack.js` for data links that preserve:
  - `var-conversation`
  - `var-model`
  - `var-agent`
  - `var-repo`
  - `var-tool`
  - current time range where Grafana supports it
- Add Azure Portal Log Analytics links from tables with copied KQL snippets in panel descriptions or dashboard links.

Recommended CLI addition:

- `agentops link session <conversation>` prints the Grafana session detail URL and an Azure Log Analytics query.
- `agentops link trace <operationId>` prints the traces dashboard URL and raw `AppDependencies` query.

Implementation surface:

- `scripts/build-grafana-dashboard-pack.js`
- `agentops-cli/src/index.js`
- `agentops-cli/test/index.test.js`

### 4. Quick Filters From Telemetry Metadata

Grafana variables get part of the way there, but AgentOps can make the field model more explicit.

Recommended MVP:

- Generate a `docs/field-catalog.md` or `kql/00-field-catalog.kql` from recent telemetry.
- Include top values for model, operation, agent, tool, repo hash, error type, skill, hook type, policy decision, and content-capture fields.
- Add a CLI command: `agentops fields --last 7d` that emits field names, observed count, and example values using `az monitor log-analytics query`.

Why it matters:

- Users stop guessing whether a field exists.
- Dashboard filters can be tuned from actual data.
- Agents can ground recommendations in the current schema.

Implementation surface:

- `agentops-cli/src/index.js`
- `kql/00-discover-tables.kql`
- `docs/telemetry-schema.md`

### 5. Span Detail As A Real Explanation Surface

Span-detail experiences should combine attributes, events, linked spans, related logs/events, and percentile context.

In Grafana, approximate this with a richer session detail dashboard:

- Add a selected span table section grouped by `OperationId` and `Id`.
- Add a span attributes panel that projects key/value pairs from `Properties` using `bag_unpack` where supported.
- Add a related runtime-events panel filtered by `OperationId`, session, and a +/- 5 minute window.
- Add percentile context for the same operation/model/tool across the last 7 days.

Implementation surface:

- `scripts/build-grafana-dashboard-pack.js`
- `grafana/agentops-session-detail.json`
- `grafana/agentops-traces-spans.json`

### 6. Related Signals For AgentOps

AgentOps should move from a session/span to:

- Copilot runtime events.
- Hook decisions.
- Skill invocations.
- MCP/tool failures.
- Policy blocks.
- Content-capture detector hits.
- Azure collector/exporter health logs.

Recommended dashboard additions:

- In session detail, add small link columns for related runtime events, related quality candidates, and raw Azure queries.
- In runtime events, add reverse links back to session detail.

Implementation surface:

- `scripts/build-grafana-dashboard-pack.js`
- `grafana/agentops-runtime-events.json`
- `grafana/agentops-session-detail.json`

### 7. Alert Timeline And Threshold Tuning

Alert history should be part of the product, not just notifications. AgentOps alerts are currently disabled proposal-only rules, which is the right default. The next step is an alert-tuning dashboard.

Implemented local MVP:

- Alert Tuning dashboard now includes threshold recommendations and fired-alert candidate review.
- `agentops alert history`, `agentops alert detail`, `agentops alert action-plan`, and `agentops alert export` generate metadata-only review/action/artifact JSON.
- `agentops alert tune-plan` generates proposal-only threshold-change metadata with Bicep patch targets and validation queries.
- `agentops alert policy` generates local ownership, dedupe/noise, quiet-hours placeholder, and manual-escalation metadata.
- `agentops alert resources` reports current Azure scheduled-query enabled/disabled state and action-group routing without mutating Azure.
- `agentops incident timeline` collects exported alert artifacts into a durable metadata-only incident review record.
- `agentops alert handoff` bundles alert detail, tune-plan, policy, resource-state placeholder, and incident timeline evidence into one operator review packet.
- `agentops alert route-plan` generates preview-only GitHub Issue and Azure DevOps Work Item payloads from safe handoff metadata.
- `agentops alert route-github` dry-runs a guarded GitHub Issue route and only posts when `--yes`, `--repo`, and `--owner` are supplied.
- `agentops alert route-azure-devops` dry-runs a guarded Azure DevOps Work Item route and only posts when `--yes`, `--org`, `--project`, and `--owner` are supplied.
- `agentops alert action-group-plan` previews Azure Monitor action group receiver setup without creating or updating the action group.
- `agentops alert route-action-group` dry-runs a guarded Azure Monitor action-group attachment and only updates scheduled-query rules when `--yes`, `--resource-group`, `--scheduled-query`, `--action-group`, and `--owner` are supplied.

Remaining MVP:

- Keep automated remediation proposal-only.

Implementation surface:

- `infra/bicep/alerts.bicep`
- `scripts/build-grafana-dashboard-pack.js`
- `alerts/README.md`
- `kql/10-agent-improvement-candidates.kql`

### 8. Guided Alert Creation Pattern

Alert creation should be staged: choose signal/query, set condition, configure evaluation, configure notifications.

Recommended MVP:

- `agentops alert recommend` and `agentops alert tune-plan` print disabled-rule suggestions and review artifacts:
  - name
  - KQL
  - percentile evidence
  - suggested threshold
  - validation query
  - Bicep parameter or patch target
- Alert tuning docs frame threshold changes as a staged workflow.

Implementation surface:

- `agentops-cli/src/index.js`
- `infra/bicep/alerts.bicep`
- `docs/testing-and-next-steps.md`

### 9. AgentOps Assistant With Explicit Page Context

AgentOps already has custom agents. The next level is to make the telemetry investigator act from explicit dashboard/session context.

Recommended MVP:

- Add prompt templates for:
  - investigate latest session
  - explain tool failure
  - compare benchmark variants
  - propose agent improvement
  - tune hook policy
  - find MCP/tool regressions
- Each template should include the Grafana URL, conversation id, time range, and starter KQL.
- Add copyable prompt panels or README snippets.

Implementation surface:

- `plugin/agents/telemetry-investigator.agent.md`
- `plugin/agents/agent-optimizer.agent.md`
- `docs/testing-and-next-steps.md`
- `scripts/build-grafana-dashboard-pack.js`

### 10. Funnel Analysis For Agent Workflows

Trace-funnel concepts are a good fit for agent workflows.

AgentOps funnel examples:

- `invoke_agent -> execute_tool -> tool_success -> files_modified`
- `invoke_agent -> policy_block -> recovery_hint -> successful_retry`
- `invoke_agent -> context_truncation -> follow-up_failure`
- `subagent_start -> subagent_finish -> parent_success`

Recommended MVP:

- Add KQL queries that calculate step counts and drop-off rates by session.
- Add a dashboard panel for workflow funnel health.

Implementation surface:

- `kql/11-agent-workflow-funnels.kql`
- `scripts/build-grafana-dashboard-pack.js`
- `grafana/agentops-quality.json`

## Implementation Priority

### P0: Make v0.3 Feel Finished

- Update README status from in-progress to validated after manual Grafana click-through.
- Keep the new Grafana UI plan doc in git.
- Add dashboard data links that preserve more variables.
- Add a field-catalog KQL query.

### P1: Make Investigation Repeatable

- Add saved investigation views to `agentops-cli`.
- Add `agentops link session` and `agentops link trace`.
- Add richer session detail panels for attributes, percentile context, and related runtime events.

### P2: Make Quality Tuning Operational

- Add alert-threshold simulation panels.
- Add workflow funnel KQL.
- Add `agentops alert recommend` as a proposal-only CLI workflow.

### P3: Make It Product-Grade

- Evaluate Grafana Scenes only after Azure Managed Grafana plugin constraints are known.
- If Scenes is viable, build a first-class AgentOps app with tabs, master/detail navigation, persistent saved views, and a session drawer.
- If Scenes is not viable, build a static Azure-native companion using Workbooks plus the current Grafana dashboards.

## What Not To Copy

- Do not copy third-party frontend components or backend source.
- Do not adopt an unrelated datastore just to mirror another product; Azure Monitor is already the system of record here.
- Do not build a custom frontend before Grafana dashboard limits are actually blocking the workflow.
- Do not enable content capture to mimic richer LLM observability. Keep privacy-safe telemetry as the default.
- Do not enable alert actions until thresholds are tuned from real sessions.

## Concrete Next Change Set

The smallest high-value implementation batch is:

1. Add `kql/11-agent-workflow-funnels.kql`.
2. Add a field catalog query or CLI command.
3. Add `agentops link session <conversation>` and tests.
4. Add richer Grafana data links in `scripts/build-grafana-dashboard-pack.js`.
5. Import dashboards and validate with the already working smoke path.

That batch gives AgentOps the product qualities that matter most: discoverability, repeatability, deep links, and workflow-level insight.
