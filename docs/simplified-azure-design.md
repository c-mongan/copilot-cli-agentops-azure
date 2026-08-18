# Simplified Azure-native design

Status: target architecture for the next AgentOps developer-preview version.
The local implementation is built and locally validated; the configured Azure
target still needs to be re-established before this is a live-pilot claim.

## The short version

AgentOps should be a small privacy and evidence layer around services Azure
already provides:

```text
Copilot CLI / SDK / VS Code + MCP
  -> AgentOps wrapper, SDK adapter, or MCP proxy
  -> localhost OpenTelemetry Collector
       strict metadata allowlist
       content and secret scrubbing
       bounded private queue
  -> Azure Monitor / Application Insights
       standard OTLP agent telemetry
       Log Analytics custom tables for AgentOps receipts and outcomes
  -> primary: Application Insights Agents view
  -> optional advanced: Workbooks or Azure Managed Grafana
```

The primary user should not need to know KQL, Grafana, DCRs, or collector
configuration. They run Copilot normally, see a safe receipt, and follow the
native Azure investigation link. Grafana remains useful for fleet trends,
privacy posture, custom outcomes, and operator workflows, but it is not a
first-run dependency.

Microsoft documents the Application Insights Agents view as the unified place
to inspect agent executions, token usage, costs, errors, tools, and traces:
[Monitor AI agents with Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view).

## Minimum Azure footprint

The default path needs only the Azure resources that back the native experience
and the metadata-only receipt contract:

| Service | Role | Required for first value |
| --- | --- | --- |
| Application Insights | Native agent telemetry and Agents view | yes |
| Log Analytics workspace | Application Insights backing store and KQL evidence | yes |
| Data Collection Endpoint + Data Collection Rule | Authenticated Logs Ingestion for durable AgentOps custom-table receipts | only when receipt ingestion is enabled |
| Azure Managed Grafana | Advanced dashboards and fleet views | no |
| Compute, database, hosted agent service, Key Vault | Not part of the default design | no |

The local collector remains the privacy boundary. Azure receives only the
allowlisted metadata contract by default: identifiers, timing, model and token
metadata, tool names and statuses, outcome counters, hashes, and privacy
signals. Prompts, responses, source code, file contents, tool arguments,
results, and secrets stay local unless a user explicitly opts into the
separate content path.

The Bicep entrypoint follows this split: the default deployment creates only
Log Analytics and Application Insights. `deployAdvancedServices=true` is an
explicit opt-in for Azure Monitor Workspace, Managed Grafana, and Key Vault;
the post-provision Grafana hook exits cleanly when that option is disabled.

The guarded recovery entrypoint is `scripts/azure-minimal-deploy.sh`. It
requires both `AGENTOPS_APPROVE_AZURE_CHANGES=yes` and
`AGENTOPS_CONFIRM_MINIMAL_DEPLOY=yes`, performs a what-if before deployment,
and never enables the advanced services by default.

## First-value flow

```text
1. agentops setup
   read-only prerequisite and target check
2. agentops init --full
   preview only
3. agentops init --full --yes
   execute the reviewed local/cloud stages
4. agentops smoke --real-copilot --open-browser
   safe observed run and metadata-only receipt
5. agentops open latest
   native Azure Agents view first; Run Story/Grafana fallback and advanced links
```

Every step reports its evidence boundary. A configured URL or workspace ID is
not treated as proof that the resource exists. `agentops setup` and
`agentops validate-azure` check the configured resource group before calling a
binding ready, and they never silently switch to another group.

## Product states

```text
local-only
  local privacy and demo evidence work; no Azure claim

configured
  identifiers are saved, but the Azure target is not yet verified

cloud-verified
  subscription, resource group, resources, schema, and query access pass

native-ready
  cloud-verified plus a user-approved Application Insights Agents URL

advanced-ready
  native-ready plus optional Managed Grafana import and rendered browser proof
```

Only `cloud-verified`, `native-ready`, and `advanced-ready` support live Azure
claims. Local tests, generated demo rows, static dashboard checks, and a URL in
config do not promote the product between these states.

## Current boundary

The approved Visual Studio Enterprise subscription is available, but the
configured `rg-copilot-agentops-dev` resource group is absent from the current
subscription listing. The existing workspace, DCR, DCE, Application Insights,
and Grafana identifiers are therefore historical configuration, not current
deployment proof. No Azure write or silent redirect is part of this change.

The next external gate is explicit: confirm the intended resource group, then
re-establish or provision the minimal Azure footprint and rerun live validation.
