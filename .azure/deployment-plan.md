# Deployment Plan: copilot-cli-agentops-azure

Status: Deployed - Core Azure Telemetry Stack Provisioned

## Summary

Prepare a v0.1 implementation skeleton for `copilot-cli-agentops-azure`: a secure, metadata-first AgentOps control plane for GitHub Copilot CLI telemetry on Azure.

The first implementation slice will prove the core loop:

1. Run Copilot CLI through local telemetry wrappers.
2. Send OpenTelemetry data to a localhost OpenTelemetry Collector.
3. Export locally for debug and optionally to Azure Monitor/Application Insights.
4. Query telemetry through KQL.
5. Package Copilot CLI custom agents, skills, hooks, and MCP samples that can investigate telemetry and propose safe improvements.

## Workspace Mode

Mode: NEW scaffold in an existing workspace.

Existing files:

- `copilot-cli-agentops-azure-implementation-brief.md`
- `copilot-cli-agentops-azure-implementation-brief.html`

## Scope

### In Scope for v0.1

- Project skeleton and documentation.
- Bash and PowerShell `copilot-observe` wrappers.
- Local OpenTelemetry Collector debug configuration.
- Azure Monitor/Application Insights collector configuration with privacy-safe processors.
- Docker Compose for local collector.
- AZD/Bicep infrastructure skeleton for:
  - Resource group-scoped deployment
  - Log Analytics Workspace
  - Application Insights
  - Azure Monitor Workspace
  - Azure Managed Grafana
  - Key Vault
  - Storage Account
  - Function App placeholder for future alert actioner
- KQL query pack for discovery, runs, tool failures, tokens, skills, hooks, truncation, and improvement candidates.
- Copilot CLI plugin skeleton:
  - custom agents
  - skills
  - hooks config
  - MCP sample config
  - hook scripts
- Minimal Node.js `agentops` CLI skeleton with `doctor`, `scan`, `import-jsonl`, `validate-collector`, and `validate-azure` commands.
- Basic JSONL fixtures and parser tests.
- README quickstart and security posture docs.

### Out of Scope for v0.1

- Deploying the optional Azure Function actioner.
- Automatic remediation or auto-apply of agent/skill patches.
- Prompt, response, file content, or tool argument capture.
- Broad Azure write access through MCP.
- Production-grade alert actioner behavior.
- Full Grafana dashboard polish.
- Multi-tenant enterprise RBAC isolation.

## Azure Architecture

Recommended first path:

```text
Copilot CLI
  -> copilot-observe wrapper
  -> localhost OpenTelemetry Collector
  -> debug exporter and Azure Monitor/Application Insights exporter path
  -> Log Analytics/Application Insights/Azure Managed Grafana
  -> Azure MCP/Grafana MCP read-only investigation
  -> telemetry-investigator proposes a patch plan
```

## Secure Defaults

- Content capture disabled.
- Collector binds to `127.0.0.1` only.
- Repo URL is hashed before export.
- Azure MCP samples are read-only and monitor-scoped.
- Patch workflow is proposal-only.
- Secrets are environment variables or Key Vault references, never committed.

## Resource Naming

Default environment: `dev`

- Resource group: `rg-copilot-agentops-dev`
- Application Insights: `appi-copilot-agentops-dev`
- Log Analytics Workspace: `law-copilot-agentops-dev`
- Azure Monitor Workspace: `amw-copilot-agentops-dev`
- Azure Managed Grafana: `graf-copilot-agentops-dev`
- Function App: `func-copilot-agentops-actioner-dev`
- Storage Account: generated with prefix `stagentops`
- Key Vault: generated with prefix `kv-agentops`

The Function App actioner is optional and disabled by default in v0.1 (`deployActioner=false`) so the first deployment focuses on the core telemetry stack.

## Implementation Tasks

1. Create repository skeleton.
2. Add local Copilot CLI telemetry wrappers.
3. Add collector configurations and Docker Compose.
4. Add AZD/Bicep infrastructure skeleton.
5. Add KQL query pack.
6. Add Copilot CLI plugin skeleton with agents, skills, hooks, and MCP samples.
7. Add `agentops` CLI skeleton and tests.
8. Add README and security/troubleshooting docs.
9. Validate local files with package tests and configuration checks where possible.

## Validation Plan

Local validation:

- Run `npm test` in `agentops-cli`.
- Run `node agentops-cli/src/index.js doctor --local-only`.
- Validate YAML/JSON parseability for collector, plugin, hooks, and dashboard/workbook skeletons.
- Confirm shell wrappers are executable and set secure telemetry defaults.

Azure validation and deployment:

- Use `azure-validate` before any deployment.
- Deploy only after explicit user approval.
- After deployment, run KQL discovery queries to verify telemetry tables and fields.

## Local Validation Results

Completed on 2026-05-20:

- `npm --prefix agentops-cli test` passed.
- `az bicep build --file infra/bicep/main.bicep --stdout` passed.
- JSON configs parsed successfully.
- `node agentops-cli/src/index.js doctor --local-only` passed.
- `docker compose -f collector/docker-compose.yaml config` passed.
- VS Code diagnostics reported no errors.

Azure resources have been deployed for the core v0.1 telemetry stack. The optional actioner Function remains disabled by default.

## Azure Validation Proof

Completed on 2026-05-20 against `Visual Studio Enterprise Subscription` (`0222a208-955a-45fd-b6d8-ca4704421bf0`):

- Registered `Microsoft.Monitor`.
- Started/confirmed registration for `Microsoft.Dashboard`; final what-if succeeded for `Microsoft.Dashboard/grafana`.
- Created resource group `rg-copilot-agentops-dev` in `northeurope`.
- Fixed Managed Grafana workspace naming to satisfy the 23-character limit.
- Made the placeholder actioner Function optional and disabled by default (`deployActioner=false`) for the v0.1 core stack.
- `az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-arm.json` passed with only the Azure CLI Bicep-version update notice.
- `./scripts/azure-what-if.sh` passed with `exit_code=0`.

Final what-if result:

```text
Resource changes: 5 to create.
```

Resources previewed for creation:

- `Microsoft.OperationalInsights/workspaces/law-copilot-agentops-dev`
- `Microsoft.Insights/components/appi-copilot-agentops-dev`
- `Microsoft.Monitor/accounts/amw-copilot-agentops-dev`
- `Microsoft.Dashboard/grafana/graf-copilotagentops-de`
- `Microsoft.KeyVault/vaults/kv-copilotagentops-dev-u`

Actual provisioning has now been run and succeeded. See the Azure Deployment Proof section below.

## Azure Deployment Proof

Completed on 2026-05-20 against `Visual Studio Enterprise Subscription` (`0222a208-955a-45fd-b6d8-ca4704421bf0`) in resource group `rg-copilot-agentops-dev`.

- Deployment name: `agentops-core-20260520233918`
- Provisioning state: `Succeeded`
- ARM timestamp: `2026-05-20T22:42:12.912911+00:00`
- Grafana endpoint: `https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com`
- Log Analytics Workspace: `law-copilot-agentops-dev`
- Log Analytics Workspace ID: `81513958-e9aa-4a35-aeab-953e1d26e797`
- Application Insights resource: `appi-copilot-agentops-dev`
- Azure Monitor Workspace resource: `amw-copilot-agentops-dev`
- Azure Managed Grafana resource: `graf-copilotagentops-de`
- Key Vault resource: `kv-copilotagentops-dev-u`

The Application Insights connection string was returned by ARM and is intentionally not copied into this plan. Retrieve it from Azure CLI, Azure Portal, or Key Vault workflow when configuring the collector locally.

## Azure RBAC Proof

Completed on 2026-05-20 after opening the Grafana endpoint showed `No Grafana Role Assigned`.

- Signed-in user object ID: `1e822670-52ce-41e9-923c-607a4f2fa556`
- User assignment: `Grafana Admin` scoped to `graf-copilotagentops-de`
- Grafana managed identity principal ID: `d27179f3-da49-4023-b100-3e14240609af`
- Managed identity assignment: `Monitoring Reader` scoped to `rg-copilot-agentops-dev`
- Managed identity assignment: `Log Analytics Reader` scoped to `rg-copilot-agentops-dev`

Grafana role propagation can take several minutes and may take up to an hour on newly created instances.

## Azure Ingestion Smoke Proof

Completed on 2026-05-20 after provisioning and RBAC setup.

- Added `scripts/azure-smoke-appinsights.sh` to send a privacy-safe synthetic `AgentOpsSmokeTest` event.
- The script retrieves the Application Insights connection string from Azure at runtime and does not write it to the repo.
- Smoke event ID: `agentops-20260520235529`
- Ingestion response: `itemsReceived=1`, `itemsAccepted=1`, `errors=[]`
- App Insights query returned the event from `customEvents` at `2026-05-20T22:55:30.662Z`.
- Log Analytics query returned the same event from `AppEvents` at `2026-05-20T22:55:30.662Z`.

Confirmed query shape:

```kql
customEvents
| where name == 'AgentOpsSmokeTest'
| where customDimensions.smokeId == 'agentops-20260520235529'
| project timestamp, name, customDimensions
```

## Grafana Dashboard Proof

Completed on 2026-05-20 after the ingestion smoke test succeeded.

- Updated `grafana/agentops-dashboard.json` from a placeholder to a starter dashboard with Log Analytics panels.
- Confirmed Managed Grafana data source: `Azure Monitor` with UID `azure-monitor-oob`.
- Imported dashboard status: `success`.
- Dashboard UID: `copilot-agentops`.
- Dashboard path: `/d/copilot-agentops/copilot-cli-agentops`.
- Dashboard URL: `https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/copilot-agentops/copilot-cli-agentops`.
- Re-imported on 2026-05-21 after real Copilot CLI telemetry proof to add `AppDependencies` panels for Copilot spans.
- Re-imported again on 2026-05-21 for v0.2 with panels for runs, spans, tokens, AIU, p95 duration, model usage, and operation failures.

## Collector OTLP Export Proof

Completed on 2026-05-21 using Docker and the deployed Application Insights resource.

- Updated `collector/otelcol.azuremonitor.yaml` to use the OpenTelemetry Collector `azuremonitor` exporter with `APPLICATIONINSIGHTS_CONNECTION_STRING`.
- Added `collector/docker-compose.azuremonitor.yaml` for the Azure-exporting collector path.
- Added `scripts/collector-azuremonitor-up.sh` to retrieve the Application Insights connection string at runtime and start the collector without writing the string to disk.
- Added `scripts/otlp-smoke-trace.sh` to send a privacy-safe synthetic OTLP trace to `http://127.0.0.1:4318/v1/traces`.
- Docker published OTLP only on host loopback: `127.0.0.1:4318` for HTTP and `127.0.0.1:4317` for gRPC.
- Collector startup confirmed OTLP HTTP and gRPC receivers were ready inside the container.
- OTLP trace smoke ID: `otlp-agentops-20260521001248`.
- A graceful collector shutdown flushed the batch.
- Log Analytics query returned the synthetic span from `AppDependencies` at `2026-05-20T23:12:48.218Z` with `Name=agentops.otlp_smoke` and `agentops.smoke_id=otlp-agentops-20260521001248`.

Confirmed query shape:

```kql
AppDependencies
| where TimeGenerated > ago(2h)
| where Properties has 'otlp-agentops-20260521001248'
| project TimeGenerated, Name, Properties
```

## Real Copilot CLI Telemetry Proof

Completed on 2026-05-21 by running a non-interactive Copilot CLI task through `copilot-observe` while the Azure Monitor collector was running.

- Command path: `./copilot/copilot-observe -p "Reply with exactly: agentops real telemetry smoke."`
- Copilot CLI response: `agentops real telemetry smoke.`
- Collector was stopped gracefully afterward with `docker compose -f collector/docker-compose.azuremonitor.yaml down` to flush the batch.
- Log Analytics returned real Copilot CLI spans from `AppDependencies`.
- Returned span names included `invoke_agent` and `chat claude-opus-4.7-1m-internal`.
- App role name: `copilot-agentops.github-copilot`.
- Returned metadata included `agent.runtime=github-copilot-cli`, `service.namespace=copilot-agentops`, `service.name=github-copilot`, `agentops.profile=safe-default`, `agentops.experiment=baseline`, and a hashed repo identifier.
- No prompt or response content fields were present in the returned rows.

Confirmed query shape:

```kql
AppDependencies
| where TimeGenerated > ago(2h)
| where Properties has 'github.copilot' and Properties has 'github-copilot-cli'
| project TimeGenerated, Name, AppRoleName, Properties
| order by TimeGenerated desc
| take 20
```

## v0.2 AgentOps Operationalization Proof

Completed on 2026-05-21 after the real telemetry path was proven.

- Ran three additional real Copilot CLI wrapper sessions through `copilot-observe`:
  - `agentops run one.`
  - `agentops run two.`
  - `agentops run three.`
- Confirmed the live `AppDependencies` schema includes `TimeGenerated`, `Name`, `AppRoleName`, `DurationMs`, `Success`, `ResultCode`, and dynamic `Properties`.
- Updated all KQL query-pack files under `kql/` from classic `dependencies/customDimensions` assumptions to the verified `AppDependencies/Properties` workspace schema.
- Updated `plugin/agents/telemetry-investigator.agent.md`, `plugin/skills/agentops-retrospective/SKILL.md`, and `plugin/skills/kql-copilot-telemetry/SKILL.md` with the verified workspace, dashboard, table, and query contract.
- Added `infra/bicep/alerts.bicep` and wired it from `infra/bicep/main.bicep` with `deployAlerts` and `enableAlerts` parameters.
- Deployed three proposal-only Azure Monitor scheduled query rules with `enableAlerts=false`:
  - `sqr-copilot-agentops-dev-high-aiu`
  - `sqr-copilot-agentops-dev-content-capture`
  - `sqr-copilot-agentops-dev-failures`
- Deployment name: `agentops-alerts-v02-20260521003659`.
- Deployment state: `Succeeded`.
- Deployment timestamp: `2026-05-20T23:37:34.633841+00:00`.
- Live alert verification confirmed all three rules have `enabled=false`.
- Live telemetry summary over the last two hours returned `Spans=8`, `Runs=4`, `InputTokens=255160`, `OutputTokens=92`, `AIU=89971050000`, `Cost=8`, and `P95DurationMs=2639.851`.

Validation completed:

- `az bicep build --file infra/bicep/main.bicep --stdout >/tmp/agentops-main-v02-arm.json` passed.
- Disabled-alert what-if showed `3 to create`, `5 to deploy`, and `1 to ignore` before deployment.
- All KQL files under `kql/` executed successfully against workspace `81513958-e9aa-4a35-aeab-953e1d26e797`.
- Expanded Grafana dashboard JSON parsed and imported successfully with UID `copilot-agentops`.

Confirmed operational summary query:

```kql
AppDependencies
| where TimeGenerated > ago(2h)
| where Properties has 'github.copilot' and Properties has 'github-copilot-cli'
| summarize Spans=count(), Runs=countif(tostring(Properties['gen_ai.operation.name']) == 'invoke_agent'), InputTokens=sum(todouble(Properties['gen_ai.usage.input_tokens'])), OutputTokens=sum(todouble(Properties['gen_ai.usage.output_tokens'])), AIU=sum(todouble(Properties['github.copilot.aiu'])), Cost=sum(todouble(Properties['github.copilot.cost'])), P95DurationMs=percentile(DurationMs, 95)
```

## Azure Read-Only Validation Findings

Initially checked on 2026-05-20 using the current Azure CLI login. These findings were later remediated by the guarded prerequisite script and final deployment.

- Current subscription: `Visual Studio Enterprise Subscription`.
- Subscription ID: `0222a208-955a-45fd-b6d8-ca4704421bf0`.
- Tenant ID: `cf17fc39-219d-4d2b-9cd5-a49dc7ad0898`.
- Target region default: `northeurope`.
- Target resource group default: `rg-copilot-agentops-dev`.
- `Microsoft.OperationalInsights`: Registered.
- `Microsoft.Insights`: Registered.
- `Microsoft.Monitor`: Registered.
- `Microsoft.Dashboard`: Registered.
- `Microsoft.KeyVault`: Registered.
- `Microsoft.Web`: Registered.
- `Microsoft.Storage`: Registered.
- `rg-copilot-agentops-dev` exists.

Completed user-approved Azure prerequisite changes before what-if/provisioning:

1. Register `Microsoft.Monitor`.
2. Register `Microsoft.Dashboard`.
3. Create the target resource group.

Guarded scripts are available:

- `scripts/azure-readiness.sh` performs read-only checks.
- `scripts/azure-prereqs.sh` registers missing providers and creates the resource group only when `AGENTOPS_APPROVE_AZURE_CHANGES=yes` is set.
- `scripts/azure-what-if.sh` runs the deployment what-if after prerequisites exist.

Local collector smoke testing now works through Docker. See `docs/testing-and-next-steps.md`.

## Open Decisions

- Decide whether to keep the Azure Monitor collector running during local Copilot CLI sessions or start it only for explicit smoke tests.
- Decide when to enable and deploy the optional actioner Function.

## Approval

Implementation of local scaffold and deployable artifacts is approved by the user request: "Start implementation".

Actual Azure deployment was approved by the follow-up user request: "ok go". The core telemetry stack has been provisioned; the optional actioner remains out of scope until explicitly enabled.
