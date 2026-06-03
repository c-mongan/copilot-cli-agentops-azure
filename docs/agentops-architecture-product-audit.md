# AgentOps Architecture And Product Audit

Date: 2026-05-24

Scope: current repository state at the time of audit.

Related SVG: `docs/agentops-architecture-dataflow.svg`.

## Executive Verdict

This repository is a credible, privacy-first AgentOps control plane for GitHub Copilot CLI. It already has the important bones:

- A local Copilot wrapper that enables OpenTelemetry and adds privacy-safe AgentOps labels.
- A local OpenTelemetry Collector path for debug and an Azure Monitor exporter path for production telemetry.
- Azure infrastructure for Log Analytics, Application Insights, Azure Monitor Workspace, Managed Grafana, Key Vault, and disabled proposal-only alert rules.
- A CLI that can summarize latest runs, replay sessions, generate KQL, create links, install skills, run benchmark gates, and recommend next actions.
- A Copilot plugin shape with agents, skills, hooks, and read-only MCP configs for Azure Monitor and Grafana investigation.
- A Grafana dashboard pack that is already organized around sessions, traces, runtime events, MCP/tools, safety/policy, quality, experiments, and data quality.

The short answer to the product questions:

- Is it easy to use and set up for anyone using Copilot? Better than before. The installer now creates a direct `agentops` command, `copilot-agentops`, optional plain `copilot` shadowing, bundled skills, local setup checks, Azure validation, and closed-loop smoke verification. It still assumes users have or can create the Azure resources.
- Do we have really good observability? Good metadata observability, yes. The latest slice adds collector health, real-ingestion checks, Grafana datasource/dashboard validation, and anti-cheat blockers. World-class agent observability still needs a purpose-built investigation UI and stronger eval isolation.
- Does it make it simple to use? Simpler. The CLI now covers first-run setup, Azure/Grafana validation, smoke verification, latest-run summaries, ask-context bundles, and benchmark gates. The remaining complexity is cloud provisioning/binding and dashboard import automation.
- Is it native to Copilot? Locally, almost. The shadow shim, bundled skills, custom agents, hooks, and MCP config all point in the right direction. The missing piece is a single Copilot-facing install/configure/check loop that hides infrastructure details until needed.
- Can a coding agent monitor another agent through MCP? The architecture supports this concept. The repo includes read-only Azure Monitor MCP and Grafana MCP configs plus telemetry-investigator/optimizer agents. The current implementation is an evidence and prompt workflow, not yet a seamless page-context-aware "Ask AgentOps about this run" product.
- Can it detect cheating in evals? Only at a starter level. The benchmark runner checks success commands, sealed command harness files, expected files, forbidden files, external answer-source tools, safety signals, content capture, tool failures, policy blocks, tokens, and cost. It now has hidden checks, sealed fixture pack manifests, deterministic semantic/rubric checks, and pre-run allowed-tool policy blocking, but it does not yet provide robust OS-level anti-cheat isolation or network egress controls.

My product judgment: keep the current metadata-first/privacy-first foundation. Do not add prompt/content capture as the default. To become a world-class Copilot AgentOps product, the next major move should be a session-first UI and setup wizard, not more scattered KQL. The user should land on "what happened, why, what changed, what should I do next" within one minute of running `copilot`.

## Assumptions

- The target runtime is GitHub Copilot CLI, not a separate Copilot SDK application. I found no `@github/copilot-sdk` or `CopilotClient` marker in the Node package manifest.
- "Native to Copilot" means the user can keep using `copilot`, Copilot skills, Copilot agents, hooks, and MCP rather than opening a separate developer workflow first.
- "Observability" means metadata-safe tracing, session reconstruction, tool/MCP attribution, safety/policy posture, cost/token analysis, eval comparisons, and agent-improvement workflows.
- "Cheating" means undesirable eval behavior such as modifying forbidden files, bypassing tests, using leaked ground truth, enabling content capture, broadening permissions silently, or improving metrics without improving the intended task outcome.
- This audit does not prove Azure resources are deployed or dashboards render against live data. It evaluates code, docs, generated assets, and local CLI behavior.

## Current Repo Inventory

Observed by `node agentops-cli/src/index.js scan` and `node agentops-cli/src/index.js primitives --last 7d`:

- 5 custom agent profiles:
  - `plugin/agents/telemetry-investigator.agent.md`
  - `plugin/agents/agent-optimizer.agent.md`
  - `plugin/agents/hook-policy-reviewer.agent.md`
  - `plugin/agents/skill-doctor.agent.md`
  - `plugin/agents/subagent-architect.agent.md`
- 13 bundled Copilot skills:
  - setup, operations, live triage, retrospective, evidence prompts, KQL telemetry, MCP triage, flow lineage, dashboard ops, subagent tree analysis, benchmark gate, primitive inventory, agent profile tuning.
- 5 hook event types:
  - `preToolUse`
  - `postToolUseFailure`
  - `agentStop`
  - `subagentStop`
  - `notification`
- 2 MCP server configs discovered by primitive inventory:
  - `azure-mcp`
  - `agent-grafana`
- 1 plugin manifest:
  - `plugin/plugin.json`
- 1 benchmark suite:
  - `benchmarks/starter/suite.json`
- 12 Grafana dashboards in the dashboard pack:
  - overview
  - sessions
  - session detail
  - traces/spans
  - tools/MCP
  - runtime events
  - safety/policy
  - permission friction
  - alert tuning
  - quality
  - experiments
  - data quality
- 21 KQL files covering discovery, runs, failures, tokens/cost, context pressure, skill usage, hooks, permission friction, lineage, MCP, policy, primitives, and alert tuning.

Local `doctor --local-only` reports OK in this environment:

- Required files found.
- Content capture disabled.
- Local collector config uses localhost for HTTP and gRPC.
- Agents and skills are present.
- `copilot-agentops` is installed.
- Plain `copilot` is currently routed through the AgentOps shadow shim.
- Real Copilot CLI path is `/opt/homebrew/bin/copilot`.

## Top-Level ASCII Architecture

```text
                                       +--------------------------------------+
                                       | Human / coding agent using Copilot   |
                                       |                                      |
                                       | Normal command: copilot ...          |
                                       | Optional command: copilot-agentops   |
                                       | Skills: "Use agentops-latest-run"    |
                                       +------------------+-------------------+
                                                          |
                                                          v
+---------------------------------------------------------+----------------------------------------------------------+
|                                               Local Developer Machine                                             |
|                                                                                                                    |
|  +-------------------------+      +-------------------------+      +-------------------------+                    |
|  | ~/.local/bin/copilot    | ---> | scripts/copilot-agentops| ---> | copilot/copilot-observe |                    |
|  | shadow shim             |      | collector bootstrap     |      | OTel env + attributes   |                    |
|  +-------------------------+      +-----------+-------------+      +-----------+-------------+                    |
|                                                |                                |                                  |
|                                                | starts or verifies             | execs real Copilot               |
|                                                v                                v                                  |
|                                      +---------------------+         +-------------------------+                    |
|                                      | Docker Compose      |         | Real GitHub Copilot CLI |                    |
|                                      | otelcol             | <------ | emits OTel              |                    |
|                                      +----------+----------+         +-------------------------+                    |
|                                                 | OTLP http/grpc                                                     |
|                                                 v                                                                  |
|                                      +---------------------+                                                       |
|                                      | OTel Collector      |                                                       |
|                                      | privacy processors  |                                                       |
|                                      | Azure exporter      |                                                       |
|                                      +----------+----------+                                                       |
|                                                 |                                                                  |
|  +----------------------------------------------+--------------------------------------------------------------+  |
|  |                                                                                                             |  |
|  | AgentOps local UX                                                                                          |  |
|  |                                                                                                             |  |
|  | +----------------------+   +-------------------------+   +----------------------------------------------+  |  |
|  | | agentops CLI         |   | plugin agents/skills    |   | hooks                                         |  |  |
|  | | latest/live/replay   |   | telemetry investigator  |   | preToolUse policy, failure hints, gates      |  |  |
|  | | benchmark/link/KQL   |   | optimizer, skill doctor |   | notification sidecar event                   |  |  |
|  | +----------------------+   +-------------------------+   +----------------------------------------------+  |  |
|  +-------------------------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------+----------------------------------------------------------+
                                                          |
                                                          | Azure Monitor exporter
                                                          v
+---------------------------------------------------------+----------------------------------------------------------+
|                                                   Azure Cloud                                                      |
|                                                                                                                    |
| +--------------------+      +----------------------+      +----------------------+      +----------------------+  |
| | Application        | ---> | Log Analytics        | ---> | Azure Managed        | ---> | Dashboard users /    |  |
| | Insights workspace |      | AppDependencies,     |      | Grafana dashboard   |      | investigators        |  |
| | based component    |      | AppTraces, AppEvents |      | pack                |      |                      |  |
| +--------------------+      +----------+-----------+      +----------+-----------+      +----------------------+  |
|                                        |                             ^                                           |
|                                        | KQL                         | dashboard import                          |
|                                        v                             |                                           |
|                             +----------------------+                 |                                           |
|                             | Azure Monitor alerts |                 |                                           |
|                             | disabled/proposal    |                 |                                           |
|                             +----------------------+                 |                                           |
|                                        |                                                                         |
|                                        v                                                                         |
|                             +----------------------+                                                          |
|                             | future actioner      |                                                          |
|                             | placeholder Function |                                                          |
|                             +----------------------+                                                          |
+---------------------------------------------------------+----------------------------------------------------------+
                                                          ^
                                                          |
                         +--------------------------------+----------------------------------+
                         | MCP meta-agent path                                               |
                         |                                                                    |
                         | Copilot agent -> Azure Monitor MCP / Grafana MCP -> telemetry KQL  |
                         | -> evidence-backed recommendation -> patch plan / benchmark gate   |
                         +--------------------------------------------------------------------+
```

## Detailed Data Flow

```text
1. User runs Copilot
   |
   |  a. Explicit path:
   |       copilot-agentops <args>
   |
   |  b. Native-feeling path:
   |       copilot <args>
   |       ~/.local/bin/copilot shadow shim sets COPILOT_CLI_BIN to real Copilot path.
   v

2. scripts/copilot-agentops
   |
   |  Checks whether Docker Compose collector service `otelcol` is running.
   |  If not running, calls scripts/collector-azuremonitor-up.sh.
   |  If collector startup fails, warns and falls back to real Copilot with no telemetry.
   v

3. scripts/collector-azuremonitor-up.sh
   |
   |  Reads Azure context from env:
   |    AZURE_SUBSCRIPTION_ID
   |    AZURE_RESOURCE_GROUP
   |    APPLICATIONINSIGHTS_NAME
   |
   |  Uses az CLI to retrieve Application Insights connection string.
   |  Starts collector/docker-compose.azuremonitor.yaml.
   |  Does not write connection string to repo.
   v

4. copilot/copilot-observe
   |
   |  Sets Copilot OTel defaults:
   |    COPILOT_OTEL_ENABLED=true
   |    COPILOT_OTEL_EXPORTER_TYPE=otlp-http
   |    OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
   |    OTEL_SERVICE_NAME=github-copilot-cli
   |    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
   |    COPILOT_OTEL_SOURCE_NAME=github.copilot
   |
   |  Computes privacy-safe repo metadata:
   |    repo URL -> SHA-256 hash
   |    git branch
   |    short commit
   |
   |  Parses Copilot CLI flags into counts and booleans:
   |    mode, model, agent, output format, remote, stream, ACP
   |    allow-all / allow-tool / deny-tool / allow-url / deny-url
   |    attachment count
   |    plugin-dir count
   |    additional MCP config count
   |    disabled MCP server count
   |    GitHub MCP selected tool/toolset counts
   |
   |  Reads MCP config basenames and server names where provided.
   |  Prepends all of this to OTEL_RESOURCE_ATTRIBUTES.
   v

5. Real Copilot CLI
   |
   |  Emits OTel spans/logs/events using Copilot and GenAI semantic fields.
   |  Important operations expected:
   |    invoke_agent
   |    chat
   |    execute_tool
   |
   |  Important dimensions expected:
   |    gen_ai.conversation.id
   |    github.copilot.interaction_id
   |    gen_ai.agent.id/name/version
   |    gen_ai.request.model
   |    gen_ai.tool.name
   |    token/cost/AIU fields
   |    hook and skill events
   |    errors and status
   v

6. Local OpenTelemetry Collector
   |
   |  Receives OTLP on localhost-mapped ports:
   |    http 127.0.0.1:4318
   |    grpc 127.0.0.1:4317
   |
   |  Applies memory limiter, privacy-safe attributes processor, batching.
   |
   |  Deletes prompt/message/tool-content fields:
   |    gen_ai.system_instructions
   |    gen_ai.input.messages
   |    gen_ai.output.messages
   |    gen_ai.prompt
   |    gen_ai.completion
   |    gen_ai.tool.input
   |    gen_ai.tool.output
   |    github.copilot.message
   |    url.full
   |    http request/response body content
   |
   |  Local debug and Azure Monitor configs also hash code.filepath.
   v

7. Azure Monitor / Application Insights / Log Analytics
   |
   |  Azure Monitor exporter maps telemetry mainly into:
   |    AppDependencies for spans/dependencies
   |    AppTraces for traces/log-style events
   |    AppEvents for synthetic smoke event checks
   |
   |  KQL convention in this repo:
   |    AppDependencies
   |    | where Properties has "github.copilot"
   |    | where Properties has "github-copilot-cli"
   |
   |  Session key convention:
   |    prefer gen_ai.conversation.id
   |    else github.copilot.interaction_id
   |    else gen_ai.agent.id + turn_count + hourly time bucket
   v

8. Query and product surfaces
   |
   |  agentops CLI:
   |    status, doctor, scan
   |    latest, live, replay, explain, recommend
   |    fields, context, token-rollup-audit
   |    lineage, policy, mcp, permission-friction
   |    link session/trace
   |    saved-view
   |    benchmark list/fixture-pack/run/report/compare
   |
   |  Grafana dashboard pack:
   |    sessions -> detail -> traces/runtime/policy/tools/quality
   |
   |  Copilot plugin:
   |    agents + skills + hooks + MCP configs
   |
   |  Meta-agent loop:
   |    Copilot agent reads telemetry through MCP/CLI/KQL,
   |    proposes a minimal change,
   |    validates with benchmark or query,
   |    gives rollback condition.
```

## Component Map

### Setup And Installation Plane

Primary files:

- `setup-agentops.sh`
- `setup-agentops.ps1`
- `install-agentops.sh`
- `install-agentops.ps1`
- `scripts/install-copilot-agentops-shim.sh`
- `scripts/install-copilot-agentops-shim.ps1`
- `scripts/uninstall-copilot-agentops-shim.sh`
- `scripts/uninstall-copilot-agentops-shim.ps1`
- `agentops-cli/src/index.js`

What works well:

- `agentops install --shadow-copilot` is now the product-style installer command.
- `setup-agentops.sh` is a short path that installs the shim and then shows status, init dry-run output, and the latest-run workflow.
- The installer can install explicit `agentops` and `copilot-agentops` commands.
- The installer can optionally shadow plain `copilot`, which is the most Copilot-native path.
- The shadow shim records the real Copilot path in `COPILOT_CLI_BIN` to avoid recursive calls.
- The installer also installs bundled AgentOps skills into the default Copilot home.
- `agentops status` gives a beginner-readable privacy/setup summary.
- `agentops doctor --local-only` has good basic checks; default `agentops doctor` also surfaces Grafana base URL, resource, datasource, and dashboard validation from the Azure preflight path.
- Uninstall and disable-shadow paths are present.

Current friction:

- The install path assumes Node.js, Azure CLI, Docker, Copilot CLI, Azure resources, and Grafana endpoint knowledge.
- The happy path requires users to know or obtain:
  - `AZURE_RESOURCE_GROUP`
  - `AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID`
  - `AGENTOPS_GRAFANA_BASE_URL`
  - sometimes `APPLICATIONINSIGHTS_NAME`
- The CLI is usually invoked as `node agentops-cli/src/index.js`, even though `package.json` exposes a bin name. That feels less native than `agentops`.
- Cloud readiness is available through `agentops doctor` for quick Grafana readiness and `agentops validate-azure` for the full read-only Azure CLI/resource/query preflight.
- Grafana import assumes the Azure Managed Grafana CLI extension, dashboard data source UID, Grafana RBAC, and workspace access are correct.

Product recommendation:

- Continue expanding `agentops init` into the single guided command:
  - detects Copilot, Node, Docker, az, subscription, resource group, and existing resources
  - deploys or binds to Azure resources
  - imports dashboards
  - validates collector ingestion
  - installs shadow shim and skills
  - runs a smoke Copilot task
  - opens or prints the exact session link
- Keep folding high-signal Azure readiness into `agentops doctor` while preserving `--local-only` for offline setup checks.

### Copilot Wrapper And Attribute Enrichment Plane

Primary files:

- `scripts/copilot-agentops`
- `scripts/copilot-agentops.ps1`
- `copilot/copilot-observe`
- `copilot/copilot-observe.ps1`
- `docs/telemetry-schema.md`

What works well:

- The wrapper keeps content capture off by default.
- It hashes repository URL before export.
- It captures git branch and short commit.
- It captures safe run dimensions and counts rather than raw values:
  - allow/deny counts
  - attachment count
  - plugin-dir count
  - MCP config file basenames and server names
  - disabled MCP server names
  - selected GitHub MCP tool/toolset names
- It detects risky broad modes like `--allow-all` and `--yolo`.
- It preserves user-provided OTel resource attributes by prepending AgentOps labels.
- It tracks experiment/profile/pack version:
  - `AGENTOPS_PROFILE`
  - `AGENTOPS_EXPERIMENT`
  - `AGENTOPS_PACK_VERSION`
- `agentops product audit` now includes a wrapper sync contract check that keeps the Bash and PowerShell `copilot-observe` scripts aligned on shared env defaults, safe resource attributes, and counted Copilot flags.
- The Copilot flag contract now classifies tracked, ignored, and AgentOps-only flags, and can audit future Copilot help snapshots for unknown flags before wrapper changes ship.

Key implementation detail:

The wrapper does not create spans itself. It relies on Copilot CLI OTel output and enriches that output through resource attributes. This is simple and low-risk, but it means AgentOps quality depends heavily on Copilot's emitted fields and Azure Monitor mapping.

Current gaps:

- The Bash and PowerShell wrappers still have separate implementations; the shared contract catches drift, but it does not generate either script.
- Flag parsing is hand-rolled. The flag contract can catch unknown help-snapshot flags, but future Copilot CLI changes still need an explicit classification and wrapper update.
- Metadata is mostly resource attributes, so depending on exporter behavior, every span may carry the same per-run attributes. That is fine for analysis but can increase cardinality and storage cost.
- The CLI wrapper now writes durable metadata-only lifecycle rows to `.agentops/wrapper-events.jsonl`: `agentops.run.start`, `agentops.run.end`, `agentops.collector.start_failed`, and `agentops.wrapper.fallback_unobserved`.

Product recommendation:

- Keep real Copilot OTel fixture snapshot contract tests in CI as Copilot fields evolve.
- Keep Copilot help snapshots current and classify new flags as tracked or intentionally ignored.
- Generate Bash/PowerShell flag metadata from one source of truth if this grows further.

### Collector And Privacy Plane

Primary files:

- `collector/otelcol.local.yaml`
- `collector/otelcol.azuremonitor.yaml`
- `collector/docker-compose.yaml`
- `collector/docker-compose.azuremonitor.yaml`
- `scripts/collector-azuremonitor-up.sh`
- `scripts/collector-azuremonitor-up.ps1`
- `docs/secure-by-default.md`

What works well:

- Local debug collector binds directly to `127.0.0.1`.
- Docker Compose maps the Azure collector ports to `127.0.0.1`, even though the collector process listens on `0.0.0.0` inside the container.
- The privacy processor deletes known high-risk GenAI and HTTP content fields.
- The field catalog query now labels exact content keys and unknown sensitive key families for review.
- Collector health now counts queue, retry, timeout, drop, and backpressure log signals instead of only generic collector errors.
- Application Insights connection string is fetched at runtime and not committed.
- Content capture is off in wrapper defaults and checked by `doctor`.
- The design deliberately avoids capturing prompts, code, tool args, tool outputs, URLs, and file contents.

Important nuance:

Both local and Azure Monitor collector configs now hash `code.filepath`. The remaining privacy risk is future sensitive attributes that do not match the current denylist.

Current gaps:

- The collector image is pinned by default and checked by `doctor`, but the chosen pin still needs an intentional release cadence.
- Collector health now has a local health endpoint, Data Quality dashboard panel, and log-derived queue/drop/backpressure counters, but it still does not scrape dedicated collector exporter metrics.
- `validate-collector` checks OTLP reachability plus the health endpoint; Azure export is proven by `agentops smoke --wait ...`.
- `doctor` checks local collector localhost endpoints, Azure Monitor compose localhost bindings, pinned image defaults, and Azure Monitor privacy/exporter config essentials.
- Privacy filters still depend on explicit schema decisions. The field-catalog detector now flags likely sensitive future keys, but production export policy still needs periodic review.

Product recommendation:

- Keep collector image pins fresh through releases.
- Expand collector health telemetry from log-derived queue/drop/backpressure counters into dedicated collector exporter metrics when those are available.
- Continue tightening toward a stricter allowlist mode for exported attributes and review field-catalog content-risk findings during releases.

### Azure Infrastructure Plane

Primary files:

- `azure.yaml`
- `.azure/deployment-plan.md`
- `infra/bicep/main.bicep`
- `infra/bicep/log-analytics.bicep`
- `infra/bicep/app-insights.bicep`
- `infra/bicep/azure-monitor-workspace.bicep`
- `infra/bicep/grafana.bicep`
- `infra/bicep/key-vault.bicep`
- `infra/bicep/alerts.bicep`
- `infra/bicep/actioner-function.bicep`
- `scripts/azure-readiness.sh`
- `scripts/azure-what-if.sh`
- `scripts/azure-prereqs.sh`

Provisioned resources:

- Log Analytics workspace.
- Workspace-based Application Insights component.
- Azure Monitor workspace.
- Azure Managed Grafana with system-assigned identity.
- Key Vault.
- Optional Function App actioner placeholder.
- Optional disabled Azure Monitor scheduled query rules.

What works well:

- Bicep is modular and readable.
- Alerts are disabled by default, which is the right behavior before thresholds are tuned.
- There is a guarded prerequisites script requiring `AGENTOPS_APPROVE_AZURE_CHANGES=yes`.
- There is a `what-if` script before deployment.
- `azure.yaml` includes a postprovision hook to import dashboards.

Current gaps:

- Managed Grafana RBAC and Log Analytics data source access are not fully automated in the Bicep shown.
- Dashboard JSON assumes a data source UID of `azure-monitor-oob` unless overridden.
- Public network access is enabled for Application Insights query/ingestion, Grafana, and Key Vault. That may be acceptable for a dev scaffold, but enterprise users will ask about private networking.
- Key Vault is deployed but not strongly integrated into the current flow.
- Actioner Function is only a placeholder.
- There is no environment-specific policy for dev/test/prod retention, alert actions, or RBAC.

Product recommendation:

- Automate Grafana data source/RBAC or validate it explicitly.
- Add named deployment outputs that can be consumed directly by `agentops init`.
- Add a secure enterprise mode:
  - private endpoints where appropriate
  - managed identity data access
  - Grafana viewer/editor role assignment guidance
  - Key Vault-backed tokens if Grafana MCP needs long-lived service tokens
- Implement or remove the actioner from the core story until it is real.

### Query, CLI, And Analysis Plane

Primary files:

- `agentops-cli/src/index.js`
- `agentops-cli/src/telemetry.js`
- `agentops-cli/src/recommendations.js`
- `agentops-cli/src/primitives.js`
- `agentops-cli/src/alerts.js`
- `agentops-cli/src/saved-views.js`
- `agentops-cli/test/index.test.js`
- `kql/*.kql`

Core CLI commands:

```text
status
doctor
scan
latest
live / tail
replay
explain latest
recommend latest
open
workflows list/show
skills list/path/install
primitives
fields
context
token-rollup-audit
permission-friction
lineage
policy
mcp
alert recommend
saved-view add/list/show/open
link session/trace
benchmark list/fixture-pack/run/report/compare
validate-collector
validate-azure
enable-shadow / disable-shadow / uninstall / collector start/stop
```

What works well:

- The CLI is the strongest product surface right now.
- It gives plain-English latest-run output.
- It can work offline from JSONL fixtures.
- It can query Azure with `az monitor log-analytics query`.
- It has KQL injection protection for lookback durations.
- It handles session grouping when tool spans are missing direct conversation IDs.
- It avoids double-counting parent `invoke_agent` token usage when child `chat` spans exist.
- It generates evidence-backed recommendations with:
  - dashboard/query evidence
  - observed pattern
  - proposed files
  - expected metric movement
  - validation
  - rollback condition
- It includes saved views, metadata-only saved-view export artifacts, links, primitive inventory, and benchmark compare.
- Recommendation artifacts now have an internal JSON schema and validator before `AgentOpsRecommendations_CL` rows are written.
- Tests are broad for the CLI.

Current gaps:

- `validate-azure` now does read-only Azure preflight checks, including Grafana datasource and dashboard UID validation, but it does not create/fix resources.
- Live Azure query depends on local `az` login and workspace ID.
- Some KQL files are investigation scripts with more than one final tabular expression. That is fine for manual use, but dashboard panels usually need one predictable result shape.
- `agentops health --json` now exposes a stable machine-readable setup and latest-run health contract for setup wizards and UI adapters.
- Recommendations are rule-based heuristics, not evidence ranking over recurring patterns.
- `open` prints links. Real-Copilot smoke can open the Run Replay link directly with `--open-browser` after latest-run visibility is verified.

Product recommendation:

- Keep `agentops` as the default installed command in docs and skills.
- Extend `agentops smoke` so it can optionally run Copilot and print the exact session URL after closed-loop ingestion verification.
- Keep `agentops health --json` as the contract for a UI/setup wizard.
- Add recurring-pattern analysis:
  - same tool failing across sessions
  - same agent causing high context pressure
  - same MCP server correlated with failures
  - same policy false-positive pattern

### Grafana UI Plane

Primary files:

- `scripts/build-grafana-dashboard-pack.js`
- `scripts/grafana-import-dashboard.sh`
- `grafana/agentops-*.json`
- `docs/grafana-llm-observability-ui.md`
- `docs/observability-product-patterns-roadmap.md`

Dashboard pack:

- `agentops-dashboard.json` - overview.
- `agentops-sessions.json` - session explorer.
- `agentops-session-detail.json` - single-session investigation.
- `agentops-traces-spans.json` - raw span explorer.
- `agentops-tools-mcp.json` - tool and MCP attribution.
- `agentops-runtime-events.json` - hooks, skills, lifecycle, context, errors.
- `agentops-safety-policy.json` - content capture, allow-all, policy, MCP posture.
- `agentops-permission-friction.json` - permission and policy friction.
- `agentops-alert-tuning.json` - threshold evidence for disabled alerts.
- `agentops-quality.json` - slow/costly/failing sessions and tuning candidates.
- `agentops-experiments.json` - benchmark/eval comparison.
- `agentops-data-quality.json` - field catalog and token rollup audit.

What works well:

- The dashboard structure is already session-first, not only aggregate metrics.
- It has drill links from sessions to detail, traces, and runtime events.
- It exposes safety and content-capture signals.
- It includes token rollup/data quality checks.
- It includes experiments/evals panels.
- It uses Grafana variables for model, operation, agent, repo, tool, risk, and session.
- It is practical because Azure Managed Grafana can import dashboards now.

Current gaps:

- Grafana dashboards are not the same as an "amazing UI." They are operationally useful but not a polished product.
- The user still sees Grafana mechanics:
  - variables
  - dashboard UIDs
  - data source assumptions
  - table-heavy layouts
  - raw KQL behaviors
- There is no first-class span waterfall with collapsible parent/child tree.
- There is no integrated "ask AgentOps about this session" side panel.
- There is no workflow that turns a dashboard-selected session into a Copilot MCP prompt automatically.
- No visual encoding for "agent cheated" beyond benchmark/safety fields.
- No annotation system yet for:
  - agent profile changes
  - skill changes
  - hook changes
  - model changes
  - benchmark versions
  - deployments

Product recommendation:

Short term: make the dashboard pack feel finished.

- Add a landing dashboard that starts with Sessions, not metrics.
- Add a single "Session Health" table with:
  - status
  - risk
  - root agent
  - model
  - tool failures
  - policy blocks
  - content capture
  - context pressure
  - eval/benchmark tags
  - "recommended next action"
- Add data links that preserve time range and all filters.
- Add annotation events for config changes and benchmark runs.

Long term: build a purpose-built AgentOps UI.

The product should feel closer to:

```text
AgentOps
  Runs
  Run Detail
  Trace Waterfall
  Tools And MCP
  Evaluations
  Policy And Safety
  Data Quality
  Settings
  Ask AgentOps
```

The purpose-built UI should show:

- A trace waterfall with agent/subagent/LLM/tool/hook lanes.
- A side-by-side run comparison.
- A promptless metadata timeline.
- A policy decision strip.
- MCP server/tool posture.
- Eval scorecard and anti-cheat warnings.
- Built-in "ask a coding agent about this run" context export.
- One-click generation of a benchmark or validation query from a run.

### Plugin, Agents, Skills, Hooks, And MCP Plane

Primary files:

- `plugin/plugin.json`
- `plugin/.mcp.json`
- `plugin/hooks.json`
- `plugin/agents/*.agent.md`
- `plugin/skills/*/SKILL.md`
- `plugin/scripts/*.js`
- `copilot/mcp.azure-monitor.sample.json`
- `copilot/mcp.grafana.sample.json`
- `docs/copilot-mcp-agentops-prompts.md`

What works well:

- The plugin manifest clearly packages agents, skills, hooks, and MCP.
- Agents are targeted to GitHub Copilot and are purpose-specific:
  - telemetry investigator
  - agent optimizer
  - hook policy reviewer
  - skill doctor
  - subagent architect
- Skills map directly to user workflows:
  - setup
  - latest run triage
  - benchmark gate
  - dashboard ops
  - MCP tool triage
  - lineage
  - retrospective
  - primitive inventory
- Agents and skills repeatedly enforce the right safety model:
  - query telemetry first
  - use read-only MCP
  - do not enable content capture
  - propose changes by default
  - include evidence, validation, rollback
- Hooks provide deterministic guardrails:
  - block obvious risky commands and `.env` writes
  - offer failure recovery hints
  - allow stop/notification hooks to exist as extension points
- MCP config is read-only for Azure Monitor and tokenized for Grafana.

Current gaps:

- `agent-stop-quality-gate.js` currently parses input and exits 0. It is a placeholder, not a quality gate.
- `emit-sidecar-event.js` writes a minimal event to stdout but does not export telemetry directly.
- `pre-tool-policy.js` blocks a small set of risky strings. It is useful but not comprehensive.
- Hook behavior depends on the exact shape of Copilot hook stdin, which needs real compatibility validation.
- The MCP meta-agent loop is documented and scaffolded, but not fully productized.
- There is no automatic wiring from a Grafana session to a Copilot prompt with the relevant query, dashboard link, and session ID.

Product recommendation:

- Make `agentops-evidence-prompts` generate a concrete investigation bundle:
  - session ID
  - time range
  - Grafana URL
  - KQL query
  - last known recommendation
  - benchmark run ID if present
- Make the stop quality gate real but non-blocking at first:
  - detect unresolved tool failures
  - detect content-capture signals
  - detect missing benchmark validation after config changes
  - emit a warning/recommendation, not a hard failure
- Add hook telemetry that does not require prompt/tool content:
  - hook type
  - decision
  - reason category
  - duration
  - timeout/failure

### Benchmark, Evaluation, And "Cheating" Plane

Primary files:

- `benchmarks/starter/suite.json`
- `benchmarks/starter/tasks/create-note.json`
- `agentops-cli/src/index.js` benchmark functions
- `agentops-cli/test/fixtures/benchmark-runs/summaries.json`
- `grafana/agentops-experiments.json`
- `plugin/skills/agentops-benchmark-gate/SKILL.md`

What works well:

- Benchmark runs execute in a copied temp fixture, not the repository.
- Each repeat uses isolated `COPILOT_HOME`.
- Run metadata is added to OTel resource attributes:
  - run ID
  - suite
  - task ID
  - variant
  - permission profile
  - repeat
  - hypothesis
- The runner records stdout/stderr under temp run folders.
- It checks:
  - Copilot exit status
  - success commands
  - hidden success commands with masked command text
  - sealed hidden check packs with masked command text
  - sealed fixture file checksums
  - semantic evaluator adapters
  - expected files
  - forbidden files and forbidden path globs
  - timeout
- It records artifact diffs in run summaries and reports:
  - added files
  - modified files
  - deleted files
  - total changed artifacts
- It scores reports and emits keep/investigate/reject.
- It can enrich local summaries with Azure telemetry:
  - spans
  - tool calls
  - failures
  - token usage
  - cache tokens
  - cost
  - AIU
  - models/tools/conversations
- It rejects safety violations, content capture, forbidden file changes, severe quality regressions, missing approval evidence, and configured promotion gate misses in reports and comparisons.
- It can reject observed risky tool telemetry through per-task tool policies, for example network, secret-access, browser-control, or destructive tool categories.

Current anti-cheat limitations:

- The starter task uses `--allow-all`, which is acceptable for an isolated tiny fixture but should not be the default posture for serious evals.
- Permission profiles enforce broad-flag validation and read-only workspace immutability for benchmark fixture copies. Task tool policies block explicitly allowed tools with forbidden risk classes before Copilot runs, can still reject observed risky tool telemetry after the run, and the Evals & Quality dashboard surfaces metadata-only policy review including OS sandbox mode/activity. Tasks can now opt into macOS `sandbox-exec` network egress blocking through `osSandbox.mode: "macos-network-blocked"`, which fails closed on unsupported platforms.
- Hidden check packs exist as separate masked command packs, fixture seals can reject checksum drift, reusable fixture seal pack manifests can distribute fixture checksum sets across tasks, and the CLI can generate and verify Ed25519-signed fixture pack manifests from fixture directories. Suites can now require fixture pack signatures to match configured trust-root public keys, reject revoked signing key IDs, and enforce trust-root rotation windows. The Evals & Quality dashboard surfaces metadata-only hidden pack review.
- Network egress isolation is available only for opt-in macOS `sandbox-exec` benchmark tasks; network tool policies can also block explicit `--allow-tool` network allowances before execution, but cross-platform OS-level egress prevention is still missing.
- Read-only benchmark profiles now block any workspace file change in the copied fixture.
- Semantic evaluator adapters exist for deterministic file-content, regex, file-rubric checks, and command-backed `llm-judge` scoring, and suites can configure reusable judge provider command templates for hosted judge CLIs. The CLI now includes hosted judge provider setup guidance with a non-mutating Azure Container Apps provisioning plan. The Evals & Quality dashboard surfaces metadata-only semantic check review. Hosted judge service deployment is still external to the benchmark runner.
- Candidate promotion gates can require approval evidence from an approval file, named approver identities, approval counts, and approved external review metadata such as a GitHub PR, Azure DevOps PR, Jira ticket, or change workflow URL. The CLI can generate run-scoped approval evidence, and `benchmark report` / `benchmark compare` can now verify GitHub PR review evidence through `gh pr view`, Azure DevOps PR reviewer/status evidence through `az repos pr show`, plus Jira issue status evidence through the Jira REST API when `--verify-external-review` is set. The Evals & Quality dashboard surfaces metadata-only approval review status. Other change-management system API verification is still not integrated.
- Suites can seal command harness files with `commandFileSeal`; benchmark runs now reject candidates that change sealed test scripts or command files in the copied fixture. This is not a replacement for OS-level sandboxing.
- The Evals & Quality dashboard now includes artifact diff counts, per-file artifact path review, capped artifact content diff previews, hidden check pack review, policy review, and semantic check review for benchmark recommendations. The CLI can now review artifact file paths and explicit fixture-to-workspace content diffs for local benchmark runs, and Grafana can review capped benchmark artifact content diff previews when those recommendation rows include `BenchmarkArtifactContentDiffs`.
- Benchmark reports flag network and browser-control tool usage as external answer-source evidence for review. This is metadata-only and does not prove the answer came from an external source.
- Benchmark comparisons now warn when an offline-improved candidate has worse Azure-backed token, cost, tool-failure, or safety telemetry. This is still a benchmark-run telemetry comparison, not a full production cohort analysis.

Product recommendation:

Build a real Eval Center:

- Test suites with public checks, hidden check packs, and sealed fixture packs.
- Enforced policy profiles:
  - read-only workspace immutability
  - least privilege
  - allow selected tools
  - no network
  - no secrets
- Anti-cheat controls:
  - immutable test harness
  - hidden assertions
  - network/process restrictions where possible
  - content-capture detector
  - policy bypass detector
  - diff and artifact review
- Scorecards:
  - task success
  - deterministic semantic quality
  - safety
  - cost
  - latency
  - tool failure rate
  - context pressure
  - reproducibility
- Promotion gates:
  - compare baseline vs candidate
  - require no safety regression
  - require acceptable token/cost delta
  - require live telemetry validation after merge/adoption

### Alerts And Actioner Plane

Primary files:

- `infra/bicep/alerts.bicep`
- `agentops-cli/src/alerts.js`
- `kql/18-alert-threshold-recommendations.kql`
- `alerts/README.md`
- `actioner/README.md`

What works well:

- Alerts are proposal-only and disabled by default.
- Alert recommendation logic uses historical p95/p99 evidence.
- Content-capture alert is strict at threshold 0.
- Failure and high-AIU alerts exist as infrastructure.
- No action groups are attached by default.
- `agentops alert history` and `agentops alert detail` provide metadata-only fired-alert candidate review with KQL and session links.
- `agentops alert open` turns an alert rule/session pair into Run Replay, Runs Explorer, session detail, content-viewer, and Azure Logs links.
- `agentops alert review` bundles alert detail, open links, action-plan metadata, and export evidence into one metadata-only packet.
- The Alert Tuning dashboard includes metadata-only threshold recommendations, suggested threshold impact, and fired-alert candidates with session detail, replay, Azure Logs links, and `agentops alert review` commands.
- `agentops alert action-plan` generates deterministic GitHub issue or Azure DevOps work-item payload metadata with KQL, session links, and guardrails.
- `agentops alert export` writes durable metadata-only alert artifacts for later incident review.
- `agentops alert tune-plan` generates proposal-only threshold-change metadata with Bicep patch targets, validation queries, and fired-alert history evidence.
- `agentops alert threshold-simulate` generates preview-only KQL for comparing current and proposed alert-window counts before applying a threshold diff.
- `agentops alert threshold-patch` generates a preview-only Bicep threshold diff for direct rules after an owner supplies an approved numeric threshold.
- `agentops alert policy` generates local ownership, dedupe/noise, quiet-hours placeholder, and manual-escalation metadata.
- `agentops alert resources` reports current Azure scheduled-query enabled/disabled state and action-group routing without mutating Azure.
- `agentops incident timeline` collects exported alert artifacts into a durable metadata-only incident review record.
- `agentops alert handoff` bundles alert detail, tune-plan, policy, resource-state placeholder, and incident timeline evidence into one metadata-only operator review packet.
- `agentops alert route-plan` generates preview-only GitHub Issue and Azure DevOps Work Item payloads from safe handoff metadata.
- `agentops alert route-github` can create a GitHub Issue only with explicit `--yes`, a repo, and an owner; without `--yes`, it prints the exact `gh issue create` command.
- `agentops alert route-azure-devops` can create an Azure DevOps Work Item only with explicit `--yes`, organization, project, and owner; without `--yes`, it prints the exact `az boards work-item create` command.
- `agentops alert action-group-plan` previews Azure Monitor action group email/webhook receiver setup without mutating Azure.
- `agentops alert route-action-group` can attach approved Azure Monitor action groups only with explicit `--yes`, resource group, scheduled-query rule, action group ID, and owner.

Current gaps:

- Alert action routing is partially manual; the CLI can now post GitHub Issues, Azure DevOps Work Items, preview email/webhook action group receivers, and attach Azure Monitor action groups behind explicit review gates, but Teams and paging destinations still depend on approved receiver setup outside the CLI.
- Alert history and timeline review now have a local metadata-only handoff bundle, route preview, guarded ticket creation, and guarded action-group attachment, but not yet broad paging automation.
- Threshold changes now have preview-only Bicep diffs for direct rules, but there is no automatic threshold tuning loop.
- Alert-to-run opening is now available as a CLI link artifact, but not yet a fully guided visual workflow.

Product recommendation:

- Keep alert rules disabled until real history exists.
- Implement actioner only for deterministic notifications/artifacts:
  - create an issue/work item with KQL, session URL, and safe metadata
  - never auto-edit repo or resources
  - never call broad LLM tools without explicit approval
- Promote the alert detail and tune-plan artifacts into a guided UI workflow after more real traffic exists.

## Sessionization And Data Model

The session model is one of the most important parts of this repo.

Preferred session key:

```text
gen_ai.conversation.id
```

Fallbacks:

```text
github.copilot.interaction_id
gen_ai.agent.id + github.copilot.turn_count + hourly bucket
```

Why this matters:

- Tool spans can sometimes lack a direct conversation ID.
- The KQL joins spans by `OperationId` to recover conversation from sibling/root spans.
- Dashboards, CLI latest/replay, lineage, MCP usage, and benchmarks all depend on stable session grouping.

Token rollup rule:

```text
If chat spans exist:
  use sum(chat span tokens/cost/AIU)
Else:
  use invoke_agent aggregate tokens/cost/AIU
```

This avoids double-counting parent and child usage.

Important data tables:

```text
AppDependencies
  Main span/dependency table for Copilot CLI OTel.

AppTraces
  Runtime/log event table for hooks, skills, lifecycle, policy, exceptions.

AppEvents
  Used by synthetic Application Insights smoke test.
```

Important fields:

```text
gen_ai.operation.name
gen_ai.agent.id
gen_ai.agent.name
gen_ai.agent.version
gen_ai.conversation.id
github.copilot.interaction_id
gen_ai.request.model
gen_ai.tool.name
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.usage.cache_read.input_tokens
gen_ai.usage.cache_creation.input_tokens
github.copilot.cost
github.copilot.aiu
github.copilot.turn_count
github.copilot.skill.name
github.copilot.hook.type
error.type
agentops.repo.hash
agentops.profile
agentops.experiment
agentops.pack.version
agentops.cli.*
agentops.mcp.*
agentops.benchmark.*
```

## Product Experience Assessment

### First-Time Setup

Current experience:

```text
az login
node agentops-cli/src/index.js install --shadow-copilot
./setup-agentops.sh
export PATH="$HOME/.local/bin:$PATH"
agentops configure set --resource-group ... --workspace-id ... --grafana-url ...
copilot --help
agentops status
```

This is good for a developer preview. It is not yet consumer-grade for a broad Copilot audience.

Why it is promising:

- Short path exists.
- Safe defaults are clear.
- Shadow mode makes normal `copilot` observed.
- Skills let users ask Copilot for workflows.
- Fallback behavior does not block Copilot if telemetry setup fails.

Why it is still hard:

- Users must already have Azure resources or know how to provision them.
- Dashboard import and data source setup can fail independently.
- Troubleshooting spans CLI, Docker, az, Application Insights, Log Analytics, and Grafana.
- The command names expose implementation details.

Target experience:

```text
agentops init
agentops smoke
copilot -p "Reply with exactly: agentops smoke."
agentops latest
```

Then:

```text
Use agentops-latest-run to find my latest AgentOps run, open the Run Replay link, explain it, and recommend one next action.
```

### Daily Copilot Use

Current experience:

- If shadow shim is first on PATH, plain `copilot` is observed.
- If collector is missing, wrapper tries to start it.
- If collector fails to start, Copilot still runs without observation.
- Successful wrapped runs print an optional `AgentOps Run Replay` link scoped to the wrapper run/session IDs.
- The user can query latest run with CLI or ask `agentops-latest-run`.
- The first-run real-Copilot smoke command includes `--open-browser`, so Run Replay opens directly after latest-run visibility is verified.

This is close to native.

### Investigator Experience

Current experience:

- CLI can generate KQL and links.
- Grafana dashboards support drilldown.
- MCP configs let Copilot agents query Azure/Grafana in read-only mode.
- Prompt templates are clear.

This is strong for technical users.

Missing world-class behavior:

- The agent needs explicit session context.
- The dashboard does not have an embedded agent assistant.
- Recommendations are not integrated into the UI as first-class artifacts.
- Saved investigations can be exported as metadata-only `AgentOpsSavedViews_CL` artifacts, but there is still no shared hosted saved-view store.

Target experience:

```text
Open session -> click Ask AgentOps -> question includes:
  session id
  time range
  dashboard URL
  KQL query
  selected span/tool/policy event
  recent benchmark labels

Agent returns:
  evidence
  root cause candidates
  proposed minimal patch
  validation benchmark/query
  rollback condition
```

## Observability Scorecard

Scores are based on current repo implementation, not the intended roadmap.

```text
Area                                      Current Rating   Notes
----------------------------------------  ---------------  ----------------------------------------------
Copilot OTel capture                      Strong           Wrapper turns it on and enriches attributes.
Privacy defaults                          Strong           Content capture off, sensitive fields deleted.
Session reconstruction                    Strong           Conversation fallback and OperationId recovery.
Tool failure visibility                   Strong           CLI, KQL, dashboards, recommendation path.
MCP/tool attribution                      Good             Exact for namespaced tools; inferred otherwise.
Token/cost analysis                       Strong           Rollup audit avoids double-counting.
Context pressure analysis                 Good             Queries and dashboards exist.
Policy/safety telemetry                   Good             Hooks and dashboards exist, policy is basic.
Runtime hook/skill events                 Medium           Query support exists, actual hook telemetry is thin.
Grafana UI                                Good scaffold    Useful dashboards, not polished product UI.
Setup simplicity                          Medium           Good scripts, too many prerequisites/variables.
Azure validation                          Medium-good      Read-only CLI preflight includes Grafana datasource/dashboard checks; auto-remediation is incomplete.
Collector health                          Medium           Local health endpoint, KQL, and dashboard panel exist; exporter/drop/backpressure metrics are still thin.
Eval/benchmark support                    Medium           Nice starter gate, not robust eval platform.
Cheating detection                        Medium           Anti-cheat blockers exist; hidden tests, isolation, and semantic eval are still missing.
Meta-agent via MCP                        Medium-good      Good scaffolding, not seamless UI-integrated loop.
Enterprise readiness                      Medium-low       Needs RBAC/private networking/packaging hardening.
```

## What Is Already Differentiated

The most differentiated idea is not just "Copilot telemetry in Grafana." It is this loop:

```text
observe Copilot run
-> reconstruct session
-> classify failure/cost/context/policy pattern
-> ask Copilot agent to inspect telemetry through read-only MCP
-> propose a minimal agent/skill/hook/MCP change
-> validate with benchmark or KQL
-> promote, investigate, or reject
```

That loop is the right product direction. It is meta in a useful way: a coding agent can monitor and improve another coding agent, but only through safe telemetry and explicit validation.

## What Needs To Be True For "World-Class"

### 1. One-Minute First Value

Success criterion:

```text
A new Copilot CLI user can run one setup command, one smoke command, and see the latest run without reading KQL/Grafana docs.
```

Implemented first slice:

- `agentops init --dry-run` for setup readiness, bundled skill install planning, and first-run next steps.
- `agentops setup` now prints a read-only one-minute first-run loop: bind, strict poison smoke, `agentops smoke --real-copilot`, latest/open, dashboard import, and live dashboard verification.
- `agentops smoke --real-copilot` sends the synthetic OTLP smoke, runs a safe no-edit Copilot prompt with content capture off, waits for the latest Copilot run to appear, then prints the V2 Run Replay link.
- `agentops validate-azure` for read-only Azure CLI, subscription, resource group, workspace, App Insights, query, Grafana resource, datasource, and dashboard UID checks.
- `agentops validate-azure --import-dashboards` for explicit remediation when validation finds missing Grafana dashboards.
- `agentops init --dry-run` now points to the same core first-run loop instead of older experimental smoke/context commands.
- `agentops init` is now a core command, so users do not need to know about `agentops experimental`.
- `agentops init --dry-run` now detects azd AgentOps outputs and recommends `agentops configure import-azd` before manual workspace/Grafana binding.
- `agentops init --provision-cloud` is the explicit guided cloud deploy/bind path: it runs `azd provision` and imports azd outputs into AgentOps config.
- `agentops init --provision-cloud` now reports the failing setup stage and targeted remediation when `azd provision` or `agentops configure import-azd` fails.
- `agentops product audit` now verifies the local control-room contract: schema, strict privacy, Copilot CLI/SDK, MCP, GitHub outcomes, evals/insights, V2 dashboards, drilldowns, transcript opt-in, KQL library, and first-run wiring.
- `agentops product audit --live --last 2h --require-rows --json` now verifies that same contract plus live Azure resources and row-backed Grafana KQL checks. Latest observed result on 2026-05-31: 18/18 checks passed, live Azure verified, live Grafana verified, 19 live KQL checks, and 709 dashboard links checked.
- `agentops product audit --live --last 2h --require-rows --require-visual --json` is the final completion gate. It adds rendered Grafana dashboard proof through the same strict browser visual check used by E2E.
- `npm --prefix agentops-cli test` latest observed result on 2026-05-31: 171/171 tests passed.
- Read-only live validation on 2026-05-31 found the Azure resource group, Log Analytics workspace, Application Insights component, Managed Grafana resource, Azure Monitor datasource, and all 24 expected dashboards.
- `agentops dashboard verify --live --last 24h --json` passed 19 live KQL syntax checks, 10 V2 dashboard UX checks, and 709 dashboard links. Current live tables were mostly empty for run-specific panels, so row-presence proof still needs a fresh real Copilot smoke or demo ingest.
- Fresh strict real-Copilot smoke on 2026-05-31 produced `agentops-smoke-20260531122930-30d7a7`, verified one Log Analytics smoke row, and printed a V2 Run Replay link for session `github-copilot-cli_6729a76812fbd25604f1fd345c2fc29c_20260531_1200`.
- `agentops dashboard verify --live --last 2h --require-rows --json` then passed row-required live checks: 19 KQL checks, 10 V2 dashboards, 709 links, 16 row-required panels populated, and the explicit opt-in transcript/pattern panels allowed to remain empty.
- Fresh live E2E on 2026-05-31 produced `agentops-e2e-20260531T123920Z`, forced `AGENTOPS_PRIVACY_MODE=strict`, `AGENTOPS_CAPTURE_CONTENT=false`, and `COPILOT_OTEL_CAPTURE_CONTENT=false`, matched session `61a403b4-c5ea-4fff-bd88-a3a4b75ae1e5`, and generated a PASS browser report screenshot.
- Browser screenshot attempts against Azure Managed Grafana were blocked by Microsoft sign-in in this unauthenticated browser profile. The E2E checker records `auth-blocked` and no longer copies sign-in pages into `docs/screenshots/v2/`.
- `agentops e2e browser-check --require-grafana-visible` is now the strict visual gate: auth-blocked pages are acceptable for local report QA, but they fail authenticated dashboard visual verification.
- The strict visual gate now accepts `--browser-user-data-dir`, `--storage-state`, `--browser-executable`, and `--headed` so authenticated Grafana screenshot QA can reuse a deliberate signed-in browser profile instead of relying on the default automation profile.
- When the strict visual gate hits Microsoft SSO, `.agentops/e2e/latest/browser-notes.md` now includes an Auth Remediation section with the exact one-time sign-in command and the exact rerun command for the same report/profile.
- `agentops smoke --dry-run` plus live OTLP POST and Log Analytics polling for a privacy-safe synthetic trace.
- `agentops ask-context` for a copyable telemetry-investigator context bundle.
- direct installed `agentops` command through the installer.
- collector health endpoint, collector-health KQL, and Data Quality dashboard panel.
- benchmark anti-cheat blocker signals and an Experiments dashboard panel.

Remaining work:

- capture authenticated browser screenshots of the row-populated V2 dashboard path and keep polishing any visual issues found there.

### 2. Run-Centric UI

Success criterion:

```text
The default UI answers: what happened, why did it fail or cost money, what changed, what should I do next?
```

Required work:

- Session explorer as first screen.
- Trace waterfall.
- Policy/safety strip.
- Tool/MCP waterfall.
- Context/tokens panel.
- Recommendation panel.
- Eval/benchmark linkage.
- Ask AgentOps panel.

### 3. Agent Improvement Loop

Success criterion:

```text
Every suggested agent/skill/hook/MCP change has telemetry evidence, predicted metric movement, validation, and rollback.
```

Required work:

- Persist recommendations.
- Link recommendations to files and benchmark runs.
- Track before/after telemetry.
- Add annotation events for config changes.

### 4. Robust Eval Center

Success criterion:

```text
Users can compare baseline vs candidate agents and detect safety, quality, cost, and anti-cheat regressions before promotion.
```

Required work:

- Hidden tests.
- Rubric/semantic scoring beyond deterministic file-content adapters.
- Network and permission profiles.
- Managed immutable harness isolation beyond command-file seals.
- Artifact diffing.
- Scorecard UI.
- Promotion policy.

### 5. Trustworthy Data Quality

Success criterion:

```text
The product tells users when telemetry is missing, malformed, double-counted, dropped, or unsafe to share.
```

Implemented:

- Field catalog.
- Token rollup audit.
- Collector health.
- Content-capture detector.

Required work:

- Exporter failure visibility.
- Schema versioning.
- Real Copilot fixture regression tests.

## Recommended Roadmap

### P0 - Make The Current Pack Reliable

- Keep real Copilot OTel fixture snapshot contract tests in CI as Copilot fields evolve.
- Keep `agentops validate-azure --import-dashboards` and `agentops smoke --real-copilot` covered as first-run contracts evolve.

### P1 - Make It Native To Copilot

- Expand `agentops init` beyond local readiness/skill install into cloud bind/deploy, dashboard import, and first smoke run.
- Make skill install and shadow install part of one guided flow.
- Wire the "latest run" context bundle command into the Copilot skill path.
- Add a Copilot skill that calls the right CLI commands and returns session URL plus one recommendation.
- Add first-run docs that do not require users to learn Azure Monitor vocabulary.

### P2 - Make Observability Feel Amazing

- Polish dashboard pack:
  - session-first landing
  - richer run detail
  - timeline/waterfall
  - recommendation panels
  - annotations
  - better saved views
- Add "Ask AgentOps" prompt generation from session/trace links.
- Add collector health and data quality dashboards.
- Add run comparison views.

### P3 - Build Eval And Anti-Cheat

- Expand benchmark schemas.
- Add signed fixture pack distribution guidance for rotating benchmark trust roots.
- Add managed hosted judge service deployment for `llm-judge` semantic scoring beyond the current non-mutating Azure Container Apps provision plan.
- Expand opt-in macOS network sandboxing into cross-platform OS-level network and tool sandboxing.
- Expand Grafana-native artifact content diff review from capped previews into a full approved-artifact drilldown workflow.
- Add remaining change-management workflow API integrations for candidate promotion gates beyond GitHub, Azure DevOps, and Jira.
- Expand eval scorecard and regression dashboards as production usage reveals more review slices.

### P4 - Productize For Teams

- Package CLI with npm/Homebrew/GitHub releases.
- Add multi-workspace/team config.
- Add Azure RBAC automation and validation.
- Add enterprise network/security modes.
- Add shared saved views/recommendations storage.
- Add alert actioner implementation.

## Highest-Impact Fixes

If I had to choose only five next tasks:

1. Continue polishing the session-first dashboard landing page around latest-run triage and recommendation flow.
2. Expand benchmark/eval support with hidden checks, permission profiles, and artifact diffing.
3. Add Azure RBAC automation and validation for multi-team rollout.
4. Expand `agentops init` into a single cloud bind, dashboard import, smoke, and open-link flow.
5. Add run comparison views for before/after model, prompt, and workflow changes.

## Bottom Line

This is a strong v0.1/v0.2-style foundation. It is unusually thoughtful about privacy, Copilot primitives, MCP, and evidence-backed recommendations. The core architecture is coherent.

It is not yet a world-class AgentOps product because cloud provisioning, dashboard remediation, the run-centric UI, and robust eval isolation still need product integration. The next leap is one setup/bind command, one session-centric UI, one meta-agent investigation flow, and one credible eval/anti-cheat system.

The direction is right. Do not dilute it by capturing raw prompts or building generic observability dashboards. Double down on metadata-safe agent run understanding, Copilot-native workflows, and benchmark-backed improvement loops.
