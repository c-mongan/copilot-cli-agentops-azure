# Copilot CLI AgentOps for Azure

**A Copilot CLI-first Azure observability, MCP, and self-improvement loop for custom agents, subagents, skills, hooks, plugins, and OTel telemetry.**

**Status:** implementation blueprint / agent handoff brief
**Primary target:** GitHub Copilot CLI
**Secondary targets:** VS Code Copilot agent mode, GitHub Copilot SDK, OpenClaw, Claude Code, other OTel-capable coding agents
**Default posture:** secure, privacy-preserving, metadata-first, content capture off
**Recommended name:** `copilot-cli-agentops-azure`

---

## 0. One-line mission

Build a secure Azure-native **AgentOps control plane** for GitHub Copilot CLI that:

1. captures Copilot CLI OpenTelemetry signals locally,
2. forwards them through a privacy-safe OpenTelemetry Collector,
3. stores and visualizes them in Azure Monitor, Application Insights, Log Analytics, Azure Monitor Workspace, and Azure Managed Grafana,
4. exposes the telemetry back to Copilot CLI through Azure MCP / Azure Managed Grafana MCP,
5. lets specialist Copilot custom agents diagnose their own runs,
6. turns repeated failures into proposed patches for `.agent.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `SKILL.md`, hooks, MCP config, and tool policies,
7. validates whether those patches improved the next runs.

The intended loop is:

```text
Copilot CLI runtime
  -> OpenTelemetry traces, metrics, events
  -> Local secure OTel Collector
  -> Azure Monitor / App Insights / Log Analytics / Managed Grafana
  -> Azure MCP + Grafana MCP
  -> Copilot CLI telemetry-investigator custom agent
  -> proposed changes to agents, skills, hooks, instructions, MCP/tool policy
  -> validation query against future runs
```

---

## 1. Why this is worth building

This project is stronger than a generic dashboard because Copilot CLI exposes a rich agent runtime surface:

- custom agents defined as Markdown profiles,
- subagents with isolated context windows,
- built-in agents such as Explore, Task, General purpose, Code review, Research, and Rubber duck,
- `/fleet` for parallel task decomposition,
- skills as task-specific instruction/resource/script bundles,
- hooks at deterministic lifecycle points,
- MCP servers as external tool providers,
- tool availability and permission controls,
- OpenTelemetry export for agent invocations, model calls, tool executions, token usage, cost-like metrics, hooks, skill invocations, truncation, compaction, shutdown, files modified, and errors.

That combination means this can become a feedback loop for improving agent systems, not just a monitoring panel.

The repo should be positioned as:

> **Azure-native AgentOps for GitHub Copilot CLI: observe custom agents, subagents, skills, hooks, MCP tools, token/cost behavior, and failure patterns; then use Azure MCP to turn real telemetry into safer, sharper Copilot CLI configurations.**

---

## 2. Key source-backed facts

| Area | Fact | Source |
| --- | --- | --- |
| Copilot CLI OTel | Copilot CLI can export traces and metrics through OpenTelemetry, covering agent interactions, LLM calls, tool executions, and token usage; signal names and attributes follow OTel GenAI semantic conventions. | GitHub Copilot CLI command reference |
| OTel activation | OTel activates when `COPILOT_OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT` is set, or `COPILOT_OTEL_FILE_EXPORTER_PATH` is set. | GitHub Copilot CLI command reference |
| Content capture | By default, Copilot CLI does not capture prompts, responses, or tool arguments; full content capture requires `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` and may include sensitive code/file/prompt content. | GitHub Copilot CLI command reference |
| Runtime events | Copilot CLI emits events such as hook start/end/error, session truncation, compaction start/complete, skill invoked, session shutdown, session abort, and exception. | GitHub Copilot CLI command reference |
| Custom agents | Copilot CLI custom agents are Markdown `.agent.md` files and can live at project or user level. | Creating custom agents for Copilot CLI |
| Subagents | Work performed by a custom agent is carried out by a temporary subagent with its own context window. | Creating custom agents for Copilot CLI |
| `/fleet` | `/fleet` decomposes work into independent subtasks and can execute them in parallel via subagents. | GitHub Copilot CLI `/fleet` docs |
| Skills | Skills are folders with `SKILL.md` plus optional resources/scripts; use skills for detailed relevant workflows rather than always-on guidance. | Adding agent skills for Copilot CLI |
| Hooks | Hooks execute external commands at lifecycle points; Copilot CLI supports all hook events locally. | GitHub hooks reference |
| Hook control | `preToolUse` can allow, deny, ask, or modify tool calls; `agentStop`/`subagentStop` can block and force another turn; `postToolUseFailure` can provide recovery guidance. | GitHub hooks reference |
| MCP | MCP lets Copilot integrate with external tools and data sources; Copilot CLI supports local and remote MCP servers. | GitHub MCP docs |
| Agent tool scoping | Custom-agent `tools` controls available built-in and MCP tools; MCP tools can be namespaced by server. | Custom agents configuration |
| Azure Monitor OTLP | Azure Monitor supports preview OTLP ingestion; Collector ingestion is suited to flexible/hybrid/local environments. | Azure Monitor OTLP ingestion docs |
| Azure Collector auth | OTel Collector direct ingestion to Azure Monitor requires Microsoft Entra authentication and DCR permissions. | Azure Monitor OTel Collector docs |
| App Insights | Application Insights supports OTel and AI agent experiences; agents should have distinct names. | Application Insights OTel overview |
| Azure MCP | Azure MCP exposes Azure tools, including Log Analytics querying; it uses Azure credentials/RBAC and supports read-only and namespace/tool scoping. | Azure MCP Server tools docs |
| Grafana MCP | Azure Managed Grafana MCP can query Application Insights traces, resource logs/metrics, and GenAI agent insights following OTel GenAI conventions. | Azure Managed Grafana MCP docs |

---

## 3. Product shape

### 3.1 Product name

Recommended repo name:

```text
copilot-cli-agentops-azure
```

Alternative names:

- `agentops-azure-copilot-cli`
- `copilot-agent-observability-azure`
- `azure-copilot-agentops`
- `copilot-cli-telemetry-loop`
- `tracehound-azure-copilot`

### 3.2 Product promise

The project should make this promise:

```text
Run one installer, point GitHub Copilot CLI at localhost:4318, deploy Azure infrastructure, and get:
- Copilot CLI agent/subagent telemetry in Azure Monitor
- App Insights / Log Analytics / Managed Grafana dashboards
- Azure MCP and Grafana MCP access to telemetry
- custom Copilot agents that analyze their own telemetry
- safe recommendations for improving .agent.md, AGENTS.md, skills, hooks, MCP, and tool permissions
```

### 3.3 Non-goals

Do **not** start with:

- a full hosted SaaS,
- prompt/content capture by default,
- automatic remediation without approval,
- direct secret-reading tools,
- broad Azure write access,
- support for every coding agent before Copilot CLI is excellent.

### 3.4 First-class Copilot CLI stance

This should not be “generic OTel for agents.” Make Copilot CLI first-class by explicitly modeling:

- `invoke_agent` spans,
- `chat` spans,
- `execute_tool` spans,
- `github.copilot.tool.call.count`,
- `github.copilot.tool.call.duration`,
- `github.copilot.agent.turn.count`,
- `github.copilot.skill.invoked`,
- `github.copilot.hook.*`,
- `github.copilot.session.truncation`,
- `github.copilot.session.compaction_*`,
- `github.copilot.session.shutdown`,
- `github.copilot.lines_added`,
- `github.copilot.lines_removed`,
- `github.copilot.files_modified_count`,
- `gen_ai.agent.id`,
- `gen_ai.agent.name`,
- `gen_ai.agent.description`,
- `gen_ai.agent.version`,
- `gen_ai.conversation.id`,
- `gen_ai.request.model`,
- `gen_ai.usage.input_tokens`,
- `gen_ai.usage.output_tokens`,
- `error.type`,
- custom wrapper attributes like `agentops.repo.hash`, `agentops.agent_profile_hash`, and `agentops.skill_pack_version`.

---

## 4. Reference architecture

### 4.1 Local development architecture

```text
Developer machine
├─ GitHub Copilot CLI
├─ copilot-observe wrapper
├─ custom agents: .github/agents/*.agent.md
├─ instructions: AGENTS.md / .github/copilot-instructions.md
├─ skills: .github/skills/**/SKILL.md
├─ hooks: .github/hooks/*.json / ~/.copilot/hooks/*.json
├─ MCP config: ~/.copilot/mcp-config.json
└─ OpenTelemetry Collector on 127.0.0.1:4318
       ↓
Azure
├─ Application Insights
├─ Log Analytics Workspace
├─ Azure Monitor Workspace
├─ Azure Managed Grafana
├─ Azure Workbooks
├─ Azure Monitor Alerts
├─ Azure Function actioner
├─ Azure MCP Server
└─ Azure Managed Grafana MCP Server
```

### 4.2 Closed-loop runtime

```text
1. User runs:
   copilot-observe --agent telemetry-investigator

2. Copilot CLI emits OTel:
   invoke_agent -> chat / execute_tool spans
   skill/hook/truncation/shutdown events
   token/cost/turn/tool metrics

3. Local collector:
   receives OTLP on localhost
   redacts risky attrs
   enriches resource attrs
   batches/retries
   exports to Azure

4. Azure stores/visualizes:
   App Insights + LAW + AMW + Grafana + Workbooks

5. Copilot CLI connects back through MCP:
   azure-mcp -> Log Analytics / resources
   grafana-mcp -> dashboards / App Insights trace / agent insights

6. Specialist agents inspect telemetry:
   telemetry-investigator
   agent-optimizer
   subagent-architect
   skill-doctor
   hook-policy-reviewer

7. Agent proposes patches:
   .github/agents/*.agent.md
   .github/skills/**/SKILL.md
   AGENTS.md
   .github/copilot-instructions.md
   .github/hooks/*.json
   ~/.copilot/mcp-config.json

8. Human approves patch.

9. Validation query compares next N sessions to baseline.
```

---

## 5. Azure resources

### 5.1 Required resources

| Resource | Purpose |
| --- | --- |
| Resource Group | Holds all AgentOps Azure resources. |
| Application Insights | Main application/agent observability surface. |
| Log Analytics Workspace | Queryable logs/traces via KQL. |
| Azure Monitor Workspace | Metrics backend; useful for Prometheus/Grafana-style metrics. |
| Data Collection Rule / Endpoint | OTLP ingestion route when using native Azure Monitor OTLP ingestion. |
| Azure Managed Grafana | Rich dashboards and Grafana MCP endpoint. |
| Azure Function | Narrow actioner for alert workflows. |
| Storage Account | Optional raw JSONL archive / reports / actioner state. |
| Key Vault | Secrets for service principals, Grafana service tokens, webhook tokens. |
| Managed Identity / Entra App | Auth for collector/actioner. |
| Azure Monitor Alerts / Action Groups | Fire alerts and call actioner. |

### 5.2 Recommended resource naming

```text
rg-copilot-agentops-dev
appi-copilot-agentops-dev
law-copilot-agentops-dev
amw-copilot-agentops-dev
graf-copilot-agentops-dev
func-copilot-agentops-actioner-dev
stagentopsdev001
kv-copilot-agentops-dev
mi-copilot-agentops-collector-dev
```

### 5.3 Deployment approach

Use `azd` or Bicep.

```text
infra/
├─ main.bicep
├─ app-insights.bicep
├─ log-analytics.bicep
├─ azure-monitor-workspace.bicep
├─ grafana.bicep
├─ alerts.bicep
├─ actioner-function.bicep
├─ key-vault.bicep
└─ outputs.bicep
```

The Bicep deployment should output:

```text
APPLICATIONINSIGHTS_CONNECTION_STRING
APPLICATIONINSIGHTS_RESOURCE_ID
LOG_ANALYTICS_WORKSPACE_ID
LOG_ANALYTICS_WORKSPACE_NAME
AZURE_MONITOR_WORKSPACE_ID
GRAFANA_ENDPOINT
GRAFANA_RESOURCE_ID
OTLP_TRACES_ENDPOINT
OTLP_METRICS_ENDPOINT
OTLP_LOGS_ENDPOINT
DCR_RESOURCE_ID
```

---

## 6. Ingestion design

### 6.1 Mode A — fast local collector to Application Insights

Best for first MVP.

```text
Copilot CLI -> localhost OTel Collector -> Azure Monitor / Application Insights exporter
```

Pros:

- easiest to demo,
- works on local Mac/Linux/Windows,
- can be privacy-safe,
- collector can debug/export to file,
- collector can transform/enrich/drop attributes.

Cons:

- connection-string based export may be simpler but less enterprise-auth ideal,
- exact Azure Monitor exporter/OTLP path may change as preview matures.

### 6.2 Mode B — Collector to native Azure Monitor OTLP preview

Best for enterprise-compatible direction.

```text
Copilot CLI -> localhost OTel Collector -> Azure Monitor OTLP endpoint -> LAW/AMW/App Insights
```

Important requirements from Azure docs:

- Use OpenTelemetry Collector contrib distribution.
- Authenticate to Azure Monitor with Microsoft Entra / managed identity / service principal.
- Assign `Monitoring Metrics Publisher` to the identity for the DCR.
- Configure HTTP/Protobuf export.
- Configure metrics with delta temporality and exponential histograms for App Insights experiences.
- Treat Azure Monitor OTLP ingestion as preview.

### 6.3 Mode C — JSONL fallback

Copilot CLI can write OTel-style JSON-lines output via `COPILOT_OTEL_FILE_EXPORTER_PATH`.

Use this for:

- offline labs,
- air-gapped/local test data,
- deterministic golden test fixtures,
- replay into collector,
- bug reports without giving Azure access.

```text
Copilot CLI -> JSONL file -> agentops import-jsonl -> Blob / Log Analytics custom table / replay collector
```

---

## 7. Local wrapper: `copilot-observe`

This wrapper makes telemetry setup ergonomic and enriches all runs with safe metadata.

### 7.1 Bash wrapper

```bash
#!/usr/bin/env bash
set -euo pipefail

export COPILOT_OTEL_ENABLED="${COPILOT_OTEL_ENABLED:-true}"
export COPILOT_OTEL_EXPORTER_TYPE="${COPILOT_OTEL_EXPORTER_TYPE:-otlp-http}"
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}"
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-github-copilot}"

# Secure default: metadata only, no prompt/response/tool-arg content.
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT="${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}"

repo_url="$(git remote get-url origin 2>/dev/null || echo unknown)"
repo_hash="$(printf '%s' "$repo_url" | shasum -a 256 | awk '{print $1}')"
branch="$(git branch --show-current 2>/dev/null || echo unknown)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
agentops_version="${AGENTOPS_PACK_VERSION:-0.1.0}"
profile="${AGENTOPS_PROFILE:-safe-default}"
experiment="${AGENTOPS_EXPERIMENT:-baseline}"

export OTEL_RESOURCE_ATTRIBUTES="service.namespace=copilot-agentops,agent.runtime=github-copilot-cli,agentops.profile=${profile},agentops.experiment=${experiment},agentops.pack.version=${agentops_version},agentops.repo.hash=${repo_hash},git.branch=${branch},git.commit=${commit}"

exec copilot "$@"
```

### 7.2 PowerShell wrapper

```powershell
$env:COPILOT_OTEL_ENABLED = if ($env:COPILOT_OTEL_ENABLED) { $env:COPILOT_OTEL_ENABLED } else { "true" }
$env:COPILOT_OTEL_EXPORTER_TYPE = if ($env:COPILOT_OTEL_EXPORTER_TYPE) { $env:COPILOT_OTEL_EXPORTER_TYPE } else { "otlp-http" }
$env:OTEL_EXPORTER_OTLP_ENDPOINT = if ($env:OTEL_EXPORTER_OTLP_ENDPOINT) { $env:OTEL_EXPORTER_OTLP_ENDPOINT } else { "http://127.0.0.1:4318" }
$env:OTEL_SERVICE_NAME = if ($env:OTEL_SERVICE_NAME) { $env:OTEL_SERVICE_NAME } else { "github-copilot" }
$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = if ($env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT) { $env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT } else { "false" }

$repoUrl = git remote get-url origin 2>$null
if (-not $repoUrl) { $repoUrl = "unknown" }
$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($repoUrl)
$repoHash = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
$branch = git branch --show-current 2>$null
if (-not $branch) { $branch = "unknown" }
$commit = git rev-parse --short HEAD 2>$null
if (-not $commit) { $commit = "unknown" }
$version = if ($env:AGENTOPS_PACK_VERSION) { $env:AGENTOPS_PACK_VERSION } else { "0.1.0" }
$profile = if ($env:AGENTOPS_PROFILE) { $env:AGENTOPS_PROFILE } else { "safe-default" }
$experiment = if ($env:AGENTOPS_EXPERIMENT) { $env:AGENTOPS_EXPERIMENT } else { "baseline" }

$env:OTEL_RESOURCE_ATTRIBUTES = "service.namespace=copilot-agentops,agent.runtime=github-copilot-cli,agentops.profile=$profile,agentops.experiment=$experiment,agentops.pack.version=$version,agentops.repo.hash=$repoHash,git.branch=$branch,git.commit=$commit"

copilot @args
```

### 7.3 Wrapper principles

Do:

- bind collector to localhost,
- hash repo URL by default,
- capture branch and commit only if acceptable,
- add explicit experiment/profile labels,
- keep content capture off.

Do not:

- send raw repo URL by default,
- send user prompt text by default,
- send file contents by default,
- expose collector beyond localhost,
- enable `--allow-all` globally.

---

## 8. Collector configuration

### 8.1 Local debug collector

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
      grpc:
        endpoint: 127.0.0.1:4317

processors:
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
  batch: {}

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [debug]
```

### 8.2 Privacy-safe processor policy

Drop attributes that are likely to contain content if they appear.

```yaml
processors:
  attributes/privacy_safe:
    actions:
      - key: gen_ai.system_instructions
        action: delete
      - key: gen_ai.input.messages
        action: delete
      - key: gen_ai.output.messages
        action: delete
      - key: gen_ai.prompt
        action: delete
      - key: gen_ai.completion
        action: delete
      - key: gen_ai.tool.input
        action: delete
      - key: gen_ai.tool.output
        action: delete
      - key: github.copilot.message
        action: delete
      - key: code.filepath
        action: hash
      - key: url.full
        action: delete
      - key: http.request.body.content
        action: delete
      - key: http.response.body.content
        action: delete
```

Exact attribute names should be verified against real Copilot CLI output. Treat this as a starting policy.

### 8.3 Azure Monitor OTLP collector skeleton

```yaml
extensions:
  azureauth/monitor:
    # For managed identity on Azure compute, leave managed_identity blank.
    # For local/service principal/non-Azure identity, configure client_id as required.
    scopes:
      - https://monitor.azure.com/.default

receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
      grpc:
        endpoint: 127.0.0.1:4317

processors:
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
  batch: {}
  attributes/privacy_safe:
    actions:
      - key: gen_ai.input.messages
        action: delete
      - key: gen_ai.output.messages
        action: delete
      - key: gen_ai.system_instructions
        action: delete
      - key: github.copilot.message
        action: delete
  cumulativetodelta: {}

exporters:
  otlphttp/azuremonitor:
    traces_endpoint: "${env:AZURE_MONITOR_OTLP_TRACES_ENDPOINT}"
    metrics_endpoint: "${env:AZURE_MONITOR_OTLP_METRICS_ENDPOINT}"
    logs_endpoint: "${env:AZURE_MONITOR_OTLP_LOGS_ENDPOINT}"
    auth:
      authenticator: azureauth/monitor

service:
  extensions: [azureauth/monitor]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/privacy_safe, batch]
      exporters: [otlphttp/azuremonitor]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, cumulativetodelta, batch]
      exporters: [otlphttp/azuremonitor]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes/privacy_safe, batch]
      exporters: [otlphttp/azuremonitor]
```

### 8.4 Docker Compose

```yaml
services:
  otelcol:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otelcol/config.yaml"]
    ports:
      - "127.0.0.1:4318:4318"
      - "127.0.0.1:4317:4317"
    environment:
      AZURE_MONITOR_OTLP_TRACES_ENDPOINT: ${AZURE_MONITOR_OTLP_TRACES_ENDPOINT}
      AZURE_MONITOR_OTLP_METRICS_ENDPOINT: ${AZURE_MONITOR_OTLP_METRICS_ENDPOINT}
      AZURE_MONITOR_OTLP_LOGS_ENDPOINT: ${AZURE_MONITOR_OTLP_LOGS_ENDPOINT}
    volumes:
      - ./otelcol.azuremonitor.yaml:/etc/otelcol/config.yaml:ro
```

---

## 9. Copilot CLI plugin packaging

The distribution should be a Copilot CLI plugin because plugins can bundle agents, skills, hooks, and MCP server configs.

### 9.1 Plugin structure

```text
copilot-agentops-azure/
├── plugin.json
├── README.md
├── agents/
│   ├── telemetry-investigator.agent.md
│   ├── agent-optimizer.agent.md
│   ├── subagent-architect.agent.md
│   ├── skill-doctor.agent.md
│   └── hook-policy-reviewer.agent.md
├── skills/
│   ├── agentops-retrospective/
│   │   └── SKILL.md
│   ├── kql-copilot-telemetry/
│   │   └── SKILL.md
│   ├── agent-profile-tuning/
│   │   └── SKILL.md
│   └── subagent-tree-analysis/
│       └── SKILL.md
├── hooks.json
├── .mcp.json
└── scripts/
    ├── pre-tool-policy.js
    ├── post-tool-failure-hints.js
    ├── agent-stop-quality-gate.js
    └── emit-sidecar-event.js
```

### 9.2 `plugin.json`

```json
{
  "name": "copilot-agentops-azure",
  "description": "Azure-native observability and self-improvement loop for GitHub Copilot CLI custom agents, subagents, skills, hooks, MCP, and OpenTelemetry.",
  "version": "0.1.0",
  "author": {
    "name": "Conor Mongan"
  },
  "license": "MIT",
  "keywords": [
    "copilot-cli",
    "azure",
    "opentelemetry",
    "agentops",
    "mcp",
    "observability",
    "custom-agents",
    "subagents"
  ],
  "agents": "agents/",
  "skills": ["skills/"],
  "hooks": "hooks.json",
  "mcpServers": ".mcp.json"
}
```

### 9.3 Install commands

```bash
copilot plugin install ./copilot-agentops-azure
copilot plugin list
```

Inside Copilot CLI:

```text
/plugin list
/agent
/skills list
/mcp show
```

---

## 10. Custom agents

### 10.1 Design principles

Each custom agent should have:

- a clear `description`, because Copilot uses this to infer when to use it;
- narrow tools;
- explicit MCP tool scoping;
- `disable-model-invocation: true` for sensitive agents until proven safe;
- `user-invocable: true` for agents the user can call manually;
- metadata such as owner, risk, purpose, and version;
- instructions that require telemetry-backed recommendations, not vibes.

### 10.2 `telemetry-investigator.agent.md`

```md
---
name: telemetry-investigator
description: Investigates GitHub Copilot CLI telemetry in Azure Monitor and Azure Managed Grafana, reconstructs custom-agent and subagent behavior, and recommends improvements to agents, skills, hooks, instructions, MCP, and tool policy.
target: github-copilot
model: gpt-5.5
disable-model-invocation: true
user-invocable: true
tools:
  - read
  - search
  - azure-mcp/*
  - agent-grafana/*
  - shell
metadata:
  owner: agentops
  risk: read-mostly
  purpose: telemetry-investigation
  version: "0.1.0"
---

You are the Copilot CLI AgentOps telemetry investigator.

Mission:
Use Azure Monitor, Application Insights, Log Analytics, and Azure Managed Grafana telemetry to explain how Copilot CLI custom agents, subagents, skills, hooks, MCP servers, and tools are behaving in real usage.

Operating rules:
1. Query telemetry before inspecting files.
2. Prefer Azure MCP / Grafana MCP queries over speculation.
3. Reconstruct the agent/subagent tree when possible.
4. Focus on repeated patterns, not single-run noise.
5. Never enable content capture.
6. Never loosen tool permissions without explicit user approval.
7. Do not edit files by default; produce a patch plan first.
8. Every recommendation must include:
   - telemetry evidence,
   - suspected root cause,
   - target config file,
   - minimal proposed change,
   - validation query.

Analysis checklist:
- Agent/subagent invocations by name/id/version.
- Failure rate by agent and tool.
- p50/p95/p99 duration by agent and tool.
- Token usage and AIU/cost-like signals by model/agent.
- High-turn sessions.
- Context truncation and compaction events.
- Skill invocation events.
- Hook start/end/error events.
- Session shutdown stats: files modified, lines added, lines removed.
- Permission-heavy or risky tool patterns.
- MCP server/tool usage patterns.

Output format:
## Findings
For each finding:
- Evidence
- Why it matters
- Likely fix
- Proposed target file
- Validation query

## Recommended patch plan
Rank by impact and risk.

## Do not change
List things that look noisy but are not worth changing.
```

### 10.3 `agent-optimizer.agent.md`

```md
---
name: agent-optimizer
description: Improves GitHub Copilot CLI custom agent profiles based on Azure telemetry, repeated failures, high token usage, unsafe tool exposure, and subagent fanout problems.
target: github-copilot
model: gpt-5.5
disable-model-invocation: true
user-invocable: true
tools:
  - read
  - search
  - edit
  - azure-mcp/*
  - shell
metadata:
  owner: agentops
  risk: can-edit-agent-config
  purpose: agent-profile-optimization
  version: "0.1.0"
---

You improve Copilot CLI custom-agent profiles.

Rules:
1. Only edit these files unless explicitly told otherwise:
   - .github/agents/*.agent.md
   - .github/agents/*.md
   - AGENTS.md
   - .github/copilot-instructions.md
   - .github/skills/**/SKILL.md
   - .github/hooks/*.json
2. Do not edit source code.
3. Every edit must map to a telemetry finding.
4. Prefer reducing tool scope before adding long instructions.
5. Prefer sharper descriptions over broad vague personas.
6. Prefer adding one targeted skill over bloating an agent prompt.
7. Prefer read-only agents for investigation workflows.
8. Never add tools: ["*"] unless explicitly approved.
9. Never enable content capture.
10. Always include a before/after validation plan.

Optimization patterns:
- Repeated shell failures -> add repo command guidance or restrict shell.
- High token usage -> add exploration summary pattern or split into a custom agent.
- High tool failure rate -> scope tools and add postToolUseFailure hint.
- High truncation rate -> add context compaction guidance and log-summarization hook.
- Skill never invoked -> rewrite skill description and reference it from agent.
- Skill invoked but run fails -> tighten SKILL.md steps and acceptance criteria.
- Too many files changed -> add agentStop quality gate.
- Many permission prompts -> split read-only investigator from mutating implementer.

Output:
1. Telemetry evidence.
2. Proposed diff.
3. Risk analysis.
4. Validation query.
```

### 10.4 `subagent-architect.agent.md`

```md
---
name: subagent-architect
description: Designs safe custom-agent and subagent decomposition for Copilot CLI workflows using telemetry from Azure Monitor.
target: github-copilot
model: gpt-5.5
disable-model-invocation: true
user-invocable: true
tools:
  - read
  - search
  - edit
  - azure-mcp/*
metadata:
  owner: agentops
  risk: workflow-design
  purpose: subagent-architecture
  version: "0.1.0"
---

You design Copilot CLI custom-agent and subagent workflows.

Use subagents when they provide:
- isolated context,
- parallel exploration,
- specialist review,
- separate tool permissions,
- reusable workflow boundaries,
- lower main-context pollution.

Avoid subagents when:
- simple custom instructions would solve it,
- a skill is sufficient,
- the task is sequential and tightly coupled,
- telemetry shows subagent fanout causing truncation or repeated work.

Design output:
- Main-agent responsibilities.
- Subagent responsibilities.
- Required custom agents.
- Required skills.
- Tool scope per agent.
- Hook guardrails.
- MCP scope.
- Telemetry metrics to validate.
```

### 10.5 `skill-doctor.agent.md`

```md
---
name: skill-doctor
description: Diagnoses GitHub Copilot CLI skill usage from telemetry and improves SKILL.md trigger descriptions, steps, examples, and validation criteria.
target: github-copilot
model: gpt-5.5
disable-model-invocation: true
user-invocable: true
tools:
  - read
  - search
  - edit
  - azure-mcp/*
metadata:
  owner: agentops
  risk: can-edit-skills
  purpose: skill-optimization
  version: "0.1.0"
---

You improve Copilot CLI skills.

Diagnose:
- Skills that should have triggered but did not.
- Skills invoked too broadly.
- Skills invoked but followed by failure.
- Skills with vague descriptions.
- Skills missing concrete steps or examples.
- Skills missing acceptance criteria.

Rules:
- Keep SKILL.md focused.
- Make description trigger-friendly.
- Include exact commands/paths only when stable.
- Prefer checklists and examples.
- Include validation queries if telemetry is involved.
```

### 10.6 `hook-policy-reviewer.agent.md`

```md
---
name: hook-policy-reviewer
description: Reviews Copilot CLI hook telemetry and hook configs to improve security gates, recovery hints, quality gates, and safe automation.
target: github-copilot
model: gpt-5.5
disable-model-invocation: true
user-invocable: true
tools:
  - read
  - search
  - edit
  - azure-mcp/*
metadata:
  owner: agentops
  risk: can-edit-hooks
  purpose: hook-policy-review
  version: "0.1.0"
---

You review Copilot CLI hooks for security and runtime quality.

Focus areas:
- preToolUse deny/modify rules.
- postToolUseFailure recovery hints.
- agentStop/subagentStop quality gates.
- permissionRequest behavior.
- notification hooks.
- hook failures and timeouts.
- fail-open vs fail-closed posture.

Rules:
- Security hooks should be small and deterministic.
- Avoid expensive network calls inside blocking hooks.
- Use deny for obvious destructive/secret actions.
- Use warning/recovery hints for command mistakes.
- Prevent infinite loops in agentStop gates.
- Never exfiltrate prompt content, tool args, or file contents.
```

---

## 11. Skills

### 11.1 Skill design principles

Use skills for detailed, relevant workflows that Copilot should load only when needed.

Do not use skills for broad always-on rules; use custom instructions or `AGENTS.md` for that.

### 11.2 `agentops-retrospective/SKILL.md`

```md
---
name: agentops-retrospective
description: Analyze recent GitHub Copilot CLI telemetry and recommend improvements to custom agents, subagents, skills, hooks, instructions, MCP config, and tool policies.
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
1. Identify the workspace/Application Insights resource containing Copilot CLI telemetry.
2. Query recent `github-copilot` traces and metrics.
3. Group by:
   - agent id/name/version,
   - model,
   - operation name,
   - tool name,
   - skill name,
   - hook type,
   - conversation id,
   - repo hash,
   - experiment label.
4. Find repeated patterns:
   - failed tool calls,
   - long-running agents,
   - high turn count,
   - context truncation,
   - compaction failures,
   - hook errors,
   - skill invoked but outcome failed,
   - skill missing when expected,
   - high token usage with low output value,
   - many files modified without test evidence.
5. Map each pattern to one improvement type:
   - agent profile patch,
   - AGENTS.md patch,
   - copilot-instructions patch,
   - skill patch,
   - hook patch,
   - MCP/tool-scope patch,
   - no action.
6. Produce minimal recommendations.
7. Include validation KQL for each recommendation.
```

### 11.3 `kql-copilot-telemetry/SKILL.md`

```md
---
name: kql-copilot-telemetry
description: Write KQL queries for GitHub Copilot CLI OpenTelemetry data in Application Insights and Log Analytics.
license: MIT
user-invocable: true
allowed-tools:
  - azure-mcp/*
  - agent-grafana/*
---

When writing KQL for Copilot CLI telemetry:
1. First discover table names.
2. Prefer known Application Insights tables when present:
   - dependencies
   - requests
   - traces
   - customMetrics
   - exceptions
3. Also check OTLP/native/custom tables.
4. Do not assume exact column mapping until verified.
5. Use `customDimensions` for OTel span attributes when data lands in classic App Insights tables.
6. Filter by `cloud_RoleName == "github-copilot"` where appropriate.
7. Use these key attributes:
   - gen_ai.operation.name
   - gen_ai.agent.id
   - gen_ai.agent.name
   - gen_ai.agent.version
   - gen_ai.conversation.id
   - gen_ai.request.model
   - gen_ai.tool.name
   - gen_ai.usage.input_tokens
   - gen_ai.usage.output_tokens
   - github.copilot.turn_count
   - github.copilot.cost
   - github.copilot.aiu
   - github.copilot.skill.name
   - github.copilot.hook.type
   - error.type
8. Always include a time bound.
9. Always include a small sample query before a broad aggregate query.
```

### 11.4 `agent-profile-tuning/SKILL.md`

```md
---
name: agent-profile-tuning
description: Tune Copilot CLI .agent.md custom-agent profiles using telemetry evidence and least-privilege tool design.
license: MIT
user-invocable: true
allowed-tools:
  - read
  - search
  - edit
  - azure-mcp/*
---

Use this skill to improve `.agent.md` files.

Steps:
1. Read the current agent profile.
2. Identify intended purpose from `description` and body.
3. Query telemetry for that agent id/name/version.
4. Evaluate:
   - tool use,
   - tool failures,
   - turn count,
   - duration,
   - tokens,
   - truncation,
   - subagent fanout,
   - skill invocation,
   - permission prompts if available.
5. Recommend changes:
   - narrower `description`,
   - safer `tools`,
   - explicit `mcp-servers`,
   - `disable-model-invocation: true` for sensitive agents,
   - better instructions,
   - split into multiple agents,
   - move workflow details into a skill.
6. Keep diffs small.
```

### 11.5 `subagent-tree-analysis/SKILL.md`

```md
---
name: subagent-tree-analysis
description: Reconstruct and analyze Copilot CLI custom-agent and subagent execution trees from OpenTelemetry traces.
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
3. Identify root agent and child subagent invocations.
4. Compute:
   - fanout count,
   - max depth,
   - parallelism window,
   - subagent failure rate,
   - tool failures inside each subagent,
   - tokens per subagent,
   - output value proxy: success/files changed/tests run.
5. Flag:
   - repeated exploration,
   - too much parallel fanout,
   - subagents doing overlapping work,
   - subagents with broad tools,
   - subagents causing truncation,
   - subagents failing without recovery hints.
6. Recommend architecture changes.
```

---

## 12. Hooks

Hooks are the active guardrail layer. Use them carefully.

### 12.1 Hook config

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "node .github/hooks/pre-tool-policy.js",
        "powershell": "node .github/hooks/pre-tool-policy.js",
        "timeoutSec": 5
      }
    ],
    "postToolUseFailure": [
      {
        "type": "command",
        "bash": "node .github/hooks/post-tool-failure-hints.js",
        "powershell": "node .github/hooks/post-tool-failure-hints.js",
        "timeoutSec": 5
      }
    ],
    "agentStop": [
      {
        "type": "command",
        "bash": "node .github/hooks/agent-stop-quality-gate.js",
        "powershell": "node .github/hooks/agent-stop-quality-gate.js",
        "timeoutSec": 5
      }
    ],
    "subagentStop": [
      {
        "type": "command",
        "bash": "node .github/hooks/subagent-stop-quality-gate.js",
        "powershell": "node .github/hooks/subagent-stop-quality-gate.js",
        "timeoutSec": 5
      }
    ],
    "notification": [
      {
        "type": "command",
        "bash": "node .github/hooks/emit-sidecar-event.js",
        "powershell": "node .github/hooks/emit-sidecar-event.js",
        "timeoutSec": 2
      }
    ]
  }
}
```

### 12.2 `pre-tool-policy.js`

```js
#!/usr/bin/env node

const fs = require('fs');

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }));
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({ permissionDecision: 'allow' }));
  process.exit(0);
}

(async () => {
  const input = JSON.parse(await readStdin() || '{}');
  const tool = input.toolName || input.tool_name || '';
  const args = input.toolArgs || input.tool_input || {};
  const argText = JSON.stringify(args).toLowerCase();

  const destructive = [
    'rm -rf /',
    'rm -rf ~',
    'sudo rm',
    'git push --force',
    'git reset --hard',
    'az keyvault secret show',
    'printenv',
    'cat .env',
    'type .env'
  ];

  for (const pattern of destructive) {
    if (argText.includes(pattern)) {
      return deny(`Blocked by AgentOps preToolUse policy: risky command or secret access pattern "${pattern}".`);
    }
  }

  if ((tool.includes('write') || tool.includes('edit')) && argText.includes('.env')) {
    return deny('Blocked by AgentOps policy: writing .env files is not allowed.');
  }

  // Empty output would also fall through to default behavior; explicit allow is used only for low-risk examples.
  process.exit(0);
})();
```

### 12.3 `post-tool-failure-hints.js`

```js
#!/usr/bin/env node

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  const input = JSON.parse(await readStdin() || '{}');
  const tool = input.toolName || input.tool_name || '';
  const error = String(input.error || '').toLowerCase();
  const args = JSON.stringify(input.toolArgs || input.tool_input || {}).toLowerCase();

  const hints = [];

  if (args.includes('npm test') || error.includes('npm')) {
    hints.push('Recovery hint: check whether this repo uses pnpm/yarn/workspaces before retrying npm commands.');
  }

  if (error.includes('permission denied') || error.includes('eacces')) {
    hints.push('Recovery hint: avoid sudo. Check file ownership, workspace path, and whether the command should be run from a different directory.');
  }

  if (error.includes('no such file') || error.includes('cannot find')) {
    hints.push('Recovery hint: run `pwd`, list the relevant directory, and verify repo-relative paths before retrying.');
  }

  if (hints.length === 0) process.exit(0);

  process.stdout.write(hints.join('\n'));
  process.exit(2); // For postToolUseFailure, stdout is appended as additionalContext.
})();
```

### 12.4 `agent-stop-quality-gate.js`

```js
#!/usr/bin/env node

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

(async () => {
  const input = JSON.parse(await readStdin() || '{}');

  // Keep v0 intentionally conservative. Do not block by default.
  // Later versions can inspect transcriptPath and block when:
  // - files changed but no diff summary was produced
  // - files changed but no tests/lint were run or explicitly skipped
  // - the final message lacks validation evidence

  process.exit(0);
})();
```

### 12.5 Hook policy rules

Use hooks for:

- obvious destructive command denial,
- secret access denial,
- repo-specific recovery hints,
- deterministic quality gates,
- metadata sidecar events.

Avoid hooks that:

- call expensive external services synchronously,
- send prompt/tool args to remote services,
- require network to allow normal development,
- block aggressively and create loops,
- edit files themselves unless very controlled.

---

## 13. MCP configuration

### 13.1 Azure MCP

Use Azure MCP for Log Analytics, Azure resource queries, and read-only Azure investigation.

Example install from Copilot CLI:

```bash
copilot mcp add azure-mcp \
  --type local \
  --tools "*" \
  -- npx -y @azure/mcp@latest server start --read-only true --namespace monitor
```

Recommended posture:

```text
read-only: true
namespace: monitor
specific tools only where possible
no disable-user-confirmation
Azure RBAC least privilege
```

### 13.2 Azure Managed Grafana MCP

Use Grafana MCP for dashboard inspection, Application Insights trace querying, and GenAI agent insights.

```json
{
  "servers": {
    "agent-grafana": {
      "type": "http",
      "url": "https://<grafana-endpoint>/api/azure-mcp"
    }
  }
}
```

For service-account-token mode:

```json
{
  "servers": {
    "agent-grafana": {
      "type": "http",
      "url": "https://<grafana-endpoint>/api/azure-mcp",
      "headers": {
        "Authorization": "Bearer ${AZURE_GRAFANA_MCP_TOKEN}"
      }
    }
  }
}
```

### 13.3 Agent-level MCP scoping

A telemetry investigator should not need broad Azure tools. Scope it.

```md
---
name: azure-agentops-reader
description: Reads Copilot CLI telemetry from Azure Monitor and Application Insights. Does not modify Azure resources.
target: github-copilot
tools:
  - azure-mcp/azmcp_monitor_workspace_log_query
  - azure-mcp/azmcp_monitor_table_list
  - agent-grafana/amgmcp_insights_get_agents
  - agent-grafana/amgmcp_query_application_insights_trace
mcp-servers:
  azure-mcp:
    type: local
    command: npx
    args: ["-y", "@azure/mcp@latest", "server", "start", "--read-only", "true", "--namespace", "monitor"]
    tools: ["*"]
---

You are a read-only telemetry analyst for Copilot CLI AgentOps.
```

---

## 14. AgentOps data model

Start with KQL functions/views over App Insights tables. Later, add custom tables for catalog metadata.

### 14.1 Logical entities

```text
CopilotAgentDefinitions
CopilotSkillDefinitions
CopilotHookDefinitions
CopilotMcpDefinitions
CopilotInstructionDefinitions

CopilotAgentRuns
CopilotSubagentRuns
CopilotToolCalls
CopilotChatTurns
CopilotSkillInvocations
CopilotHookEvents
CopilotSessionEvents
CopilotTruncationEvents
CopilotOptimizationRecommendations
```

### 14.2 Agent definition record

```json
{
  "agent_id": "telemetry-investigator",
  "name": "telemetry-investigator",
  "description": "Investigates GitHub Copilot CLI telemetry...",
  "source": "project|user|plugin",
  "path": ".github/agents/telemetry-investigator.agent.md",
  "target": "github-copilot",
  "model": "gpt-5.5",
  "tools": ["read", "search", "azure-mcp/*", "agent-grafana/*"],
  "mcp_servers": ["azure-mcp", "agent-grafana"],
  "disable_model_invocation": true,
  "user_invocable": true,
  "definition_hash": "sha256:...",
  "metadata": {
    "owner": "agentops",
    "risk": "read-mostly",
    "version": "0.1.0"
  }
}
```

### 14.3 Skill definition record

```json
{
  "skill_name": "agentops-retrospective",
  "path": ".github/skills/agentops-retrospective/SKILL.md",
  "description": "Analyze recent GitHub Copilot CLI telemetry...",
  "allowed_tools": ["azure-mcp/*", "agent-grafana/*", "read", "search"],
  "definition_hash": "sha256:...",
  "source": "project|user|plugin"
}
```

### 14.4 Run record

```json
{
  "timestamp": "2026-05-20T20:00:00Z",
  "trace_id": "...",
  "span_id": "...",
  "conversation_id": "...",
  "operation": "invoke_agent",
  "agent_id": "telemetry-investigator",
  "agent_name": "telemetry-investigator",
  "agent_version": "0.1.0",
  "model": "gpt-5.5",
  "duration_ms": 123456,
  "success": true,
  "error_type": null,
  "turn_count": 8,
  "input_tokens": 100000,
  "output_tokens": 12000,
  "cache_read_tokens": 50000,
  "cost": 0.0,
  "aiu": 0.0,
  "repo_hash": "...",
  "experiment": "baseline"
}
```

---

## 15. KQL pack

Exact table names may vary. Start every environment by discovering tables and sampling rows.

### 15.1 Discover tables

```kusto
search "github-copilot"
| summarize count() by $table
| order by count_ desc
```

```kusto
union withsource=TableName *
| where TimeGenerated > ago(24h) or timestamp > ago(24h)
| where tostring(*) has "gen_ai" or tostring(*) has "github.copilot"
| summarize rows=count() by TableName
| order by rows desc
```

### 15.2 Recent Copilot runs

```kusto
dependencies
| where timestamp > ago(24h)
| where cloud_RoleName in ("github-copilot", "copilot-chat")
| extend operation = tostring(customDimensions["gen_ai.operation.name"])
| where operation in ("invoke_agent", "chat", "execute_tool")
| project
    timestamp,
    operation,
    name,
    duration,
    success,
    resultCode,
    agent_id=tostring(customDimensions["gen_ai.agent.id"]),
    agent_name=tostring(customDimensions["gen_ai.agent.name"]),
    model=tostring(customDimensions["gen_ai.request.model"]),
    conversation=tostring(customDimensions["gen_ai.conversation.id"]),
    tool=tostring(customDimensions["gen_ai.tool.name"]),
    error=tostring(customDimensions["error.type"])
| order by timestamp desc
| take 100
```

### 15.3 Agent performance

```kusto
dependencies
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| extend operation = tostring(customDimensions["gen_ai.operation.name"])
| where operation == "invoke_agent"
| extend
    agent_id = tostring(customDimensions["gen_ai.agent.id"]),
    agent_name = tostring(customDimensions["gen_ai.agent.name"]),
    agent_version = tostring(customDimensions["gen_ai.agent.version"]),
    model = tostring(customDimensions["gen_ai.request.model"]),
    turns = toint(customDimensions["github.copilot.turn_count"]),
    input_tokens = todouble(customDimensions["gen_ai.usage.input_tokens"]),
    output_tokens = todouble(customDimensions["gen_ai.usage.output_tokens"]),
    cost = todouble(customDimensions["github.copilot.cost"]),
    aiu = todouble(customDimensions["github.copilot.aiu"]),
    err = tostring(customDimensions["error.type"])
| summarize
    runs=count(),
    failures=countif(success == false or isnotempty(err)),
    failure_rate=round(100.0 * failures / runs, 2),
    p50_duration=percentile(duration, 50),
    p95_duration=percentile(duration, 95),
    p95_turns=percentile(turns, 95),
    total_input=sum(input_tokens),
    total_output=sum(output_tokens),
    total_cost=sum(cost),
    total_aiu=sum(aiu)
  by agent_id, agent_name, agent_version, model
| order by failures desc, p95_turns desc
```

### 15.4 Tool failures

```kusto
dependencies
| where timestamp > ago(7d)
| where cloud_RoleName == "github-copilot"
| extend operation = tostring(customDimensions["gen_ai.operation.name"])
| extend tool = tostring(customDimensions["gen_ai.tool.name"])
| extend err = tostring(customDimensions["error.type"])
| where operation == "execute_tool"
| summarize
    calls=count(),
    failures=countif(success == false or isnotempty(err)),
    failure_rate=round(100.0 * failures / calls, 2),
    p95_duration_ms=percentile(duration, 95)
  by tool
| order by failures desc, failure_rate desc
```

### 15.5 High-turn / long-running sessions

```kusto
dependencies
| where timestamp > ago(7d)
| where cloud_RoleName == "github-copilot"
| extend operation = tostring(customDimensions["gen_ai.operation.name"])
| where operation == "invoke_agent"
| extend
    conversation=tostring(customDimensions["gen_ai.conversation.id"]),
    agent_name=tostring(customDimensions["gen_ai.agent.name"]),
    model=tostring(customDimensions["gen_ai.request.model"]),
    turns=toint(customDimensions["github.copilot.turn_count"]),
    input_tokens=todouble(customDimensions["gen_ai.usage.input_tokens"]),
    output_tokens=todouble(customDimensions["gen_ai.usage.output_tokens"]),
    cost=todouble(customDimensions["github.copilot.cost"]),
    aiu=todouble(customDimensions["github.copilot.aiu"])
| where turns >= 10 or duration > 30s or input_tokens > 100000
| project timestamp, conversation, agent_name, model, duration, turns, input_tokens, output_tokens, cost, aiu, success
| order by duration desc
```

### 15.6 Skill invocations

```kusto
traces
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| where message has "github.copilot.skill.invoked" or tostring(customDimensions) has "github.copilot.skill"
| extend
    skill=tostring(customDimensions["github.copilot.skill.name"]),
    skill_path=tostring(customDimensions["github.copilot.skill.path"]),
    plugin=tostring(customDimensions["github.copilot.skill.plugin_name"]),
    plugin_version=tostring(customDimensions["github.copilot.skill.plugin_version"])
| summarize invocations=count() by skill, skill_path, plugin, plugin_version
| order by invocations desc
```

### 15.7 Hook errors

```kusto
traces
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| where message has "github.copilot.hook.error" or tostring(customDimensions) has "github.copilot.hook.error"
| extend
    hook_type=tostring(customDimensions["github.copilot.hook.type"]),
    invocation_id=tostring(customDimensions["github.copilot.hook.invocation_id"]),
    error_message=tostring(customDimensions["github.copilot.hook.error_message"])
| summarize errors=count(), examples=make_set(error_message, 5) by hook_type
| order by errors desc
```

### 15.8 Context truncation / compaction

```kusto
traces
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| where message has "github.copilot.session.truncation"
   or message has "github.copilot.session.compaction"
   or tostring(customDimensions) has "github.copilot.tokens_removed"
| extend
    pre_tokens=toint(customDimensions["github.copilot.pre_tokens"]),
    post_tokens=toint(customDimensions["github.copilot.post_tokens"]),
    tokens_removed=toint(customDimensions["github.copilot.tokens_removed"]),
    messages_removed=toint(customDimensions["github.copilot.messages_removed"]),
    performed_by=tostring(customDimensions["github.copilot.performed_by"])
| project timestamp, message, pre_tokens, post_tokens, tokens_removed, messages_removed, performed_by, customDimensions
| order by timestamp desc
```

### 15.9 Subagent fanout proxy

```kusto
dependencies
| where timestamp > ago(7d)
| where cloud_RoleName == "github-copilot"
| extend operation = tostring(customDimensions["gen_ai.operation.name"])
| where operation == "invoke_agent"
| extend
    conversation = tostring(customDimensions["gen_ai.conversation.id"]),
    agent_id = tostring(customDimensions["gen_ai.agent.id"]),
    agent_name = tostring(customDimensions["gen_ai.agent.name"]),
    turns = toint(customDimensions["github.copilot.turn_count"])
| summarize
    agent_invocations=count(),
    agents=make_set(agent_name),
    agent_ids=make_set(agent_id),
    total_turns=sum(turns),
    max_turns=max(turns)
  by conversation
| where agent_invocations >= 3 or max_turns >= 10
| order by agent_invocations desc, total_turns desc
```

### 15.10 Agent improvement candidates

```kusto
let failures =
dependencies
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| extend operation=tostring(customDimensions["gen_ai.operation.name"])
| extend conversation=tostring(customDimensions["gen_ai.conversation.id"])
| extend tool=tostring(customDimensions["gen_ai.tool.name"])
| extend error=tostring(customDimensions["error.type"])
| where operation == "execute_tool"
| where success == false or isnotempty(error)
| summarize failed_tools=make_set(tool), failure_count=count() by conversation;

let roots =
dependencies
| where timestamp > ago(14d)
| where cloud_RoleName == "github-copilot"
| extend operation=tostring(customDimensions["gen_ai.operation.name"])
| where operation == "invoke_agent"
| extend conversation=tostring(customDimensions["gen_ai.conversation.id"])
| extend agent_name=tostring(customDimensions["gen_ai.agent.name"])
| extend model=tostring(customDimensions["gen_ai.request.model"])
| extend turns=toint(customDimensions["github.copilot.turn_count"])
| extend files_modified=toint(customDimensions["github.copilot.files_modified_count"])
| project timestamp, conversation, agent_name, model, duration, turns, files_modified, success;

roots
| join kind=leftouter failures on conversation
| where failure_count >= 2 or turns >= 10 or duration > 30s
| project timestamp, conversation, agent_name, model, duration, turns, files_modified, failure_count, failed_tools
| order by failure_count desc, turns desc
```

---

## 16. Dashboards

### 16.1 Executive dashboard

Panels:

- Active Copilot CLI sessions by day.
- Runs by agent/model/repo hash.
- Success/failure rate.
- Token usage by model.
- Cost/AIU by model/agent.
- Top repos by runs.
- Top agents by usage.
- Adoption over time.

### 16.2 Reliability dashboard

Panels:

- p50/p95/p99 agent duration.
- p50/p95/p99 tool duration.
- Tool failure rate.
- Model call failures.
- Error type breakdown.
- Agent aborts.
- Session shutdown reasons.
- High-turn sessions.

### 16.3 Agent behavior dashboard

Panels:

- Agent/subagent tree.
- Subagent fanout per session.
- `/fleet` sessions if detectable.
- Skill invocations by skill.
- Hook start/end/error counts.
- Context truncation events.
- Compaction events.
- Files modified / lines added / lines removed.

### 16.4 Governance dashboard

Panels:

- Content capture detector.
- Risky tool attempts.
- MCP usage by server/tool.
- Permission-heavy sessions.
- Secret-access denial events.
- Broad tool agents.
- Agent profiles with `tools: ["*"]`.
- Agents with automatic inference enabled and write tools.

### 16.5 Optimization dashboard

Panels:

- Candidate config improvements.
- Before/after experiments.
- Skill invoked but run failed.
- Skill should-have-triggered proxy.
- Agent failure trend after patch.
- Token/turn reduction after patch.

---

## 17. Azure MCP prompt pack

### 17.1 Initial environment discovery

```text
Use Azure MCP to find my Copilot CLI AgentOps telemetry.

Steps:
1. List my accessible subscriptions.
2. Find Log Analytics workspaces and Application Insights resources with names containing "copilot", "agentops", or "github-copilot".
3. List tables in the likely Log Analytics workspace.
4. Search for rows containing "github-copilot", "gen_ai", or "github.copilot".
5. Tell me which tables contain traces, dependencies, logs, and metrics.
6. Produce a minimal KQL query that lists the latest 20 Copilot CLI agent runs.
```

### 17.2 Weekly retrospective

```text
Use Azure MCP and Grafana MCP to analyze the last 7 days of GitHub Copilot CLI telemetry.

Find:
- top custom agents by usage,
- top custom agents by failure rate,
- long-running sessions,
- high-turn sessions,
- repeated failed tools,
- skill invocation patterns,
- hook errors,
- context truncation and compaction events,
- expensive token/model patterns,
- sessions with many files modified.

Then inspect .github/agents, AGENTS.md, .github/copilot-instructions.md, .github/skills, and .github/hooks.

Propose minimal changes that should improve the top two issues. Do not apply changes without approval. Include validation KQL for each change.
```

### 17.3 Agent profile tuning

```text
Analyze telemetry for the custom agent named <AGENT_NAME>.

Use Azure MCP to query:
- invocation count,
- success/failure rate,
- p95 duration,
- p95 turn count,
- token usage,
- tool calls and failures,
- subagent fanout,
- skill invocations,
- hook errors,
- truncation events.

Then read the agent profile file and recommend whether to:
- narrow tools,
- split into another agent,
- move workflow steps into a skill,
- improve description for invocation accuracy,
- disable automatic invocation,
- add an agentStop or postToolUseFailure hook.

Give a minimal diff and validation query.
```

### 17.4 Skill doctor

```text
Use Azure MCP to identify skills that were invoked in failed Copilot CLI runs.

For each skill:
- show invocation count,
- failure correlation,
- agents that invoked it,
- common failed tools after invocation,
- truncation/compaction correlation.

Then inspect the matching SKILL.md files and suggest tighter descriptions, steps, examples, or acceptance criteria.
```

### 17.5 Subagent architecture review

```text
Use Azure MCP to find Copilot CLI sessions with high subagent fanout, high turn count, or context truncation.

Reconstruct the agent/subagent execution shape as much as possible.

Tell me:
- which subagents seem useful,
- which are duplicating work,
- whether /fleet is helping or hurting,
- whether a custom agent should be split or merged,
- whether subagent concurrency/depth limits should be adjusted,
- what telemetry should validate the proposed change.
```

---

## 18. Feedback engine

### 18.1 Pattern-to-patch mapping

| Telemetry pattern | Likely root cause | Patch target | Suggested change |
| --- | --- | --- | --- |
| Repeated shell failures | Agent lacks repo command knowledge | `AGENTS.md` or `SKILL.md` | Add exact install/test/build commands and working directories. |
| High token usage, low file changes | Agent over-explores | `.agent.md` | Add “plan before exploring”; narrow tools; add codebase-map skill. |
| Context truncation before failures | No summarization/compaction discipline | `AGENTS.md`, hook, skill | Add log summarization guidance; avoid full logs; add preCompact instructions. |
| Skill invoked but task still fails | Skill vague or incomplete | `SKILL.md` | Add checklist, examples, acceptance criteria. |
| Skill never invoked | Description weak | `SKILL.md` | Rewrite description with trigger terms. |
| Agent has many permission prompts | Tool scope too broad/unclear | `.agent.md`, CLI command | Split read-only vs mutating agents; add explicit allowlist. |
| Tool failures concentrated in one agent | Agent tool mismatch | `.agent.md` | Remove unnecessary tools or add missing safe tools. |
| Hook errors | Hook brittle or too slow | `.github/hooks/*.json` / script | Reduce timeout risk, add error handling, fail open except security. |
| Files changed with no tests | Agent stops too early | `agentStop` hook | Block with reason: run tests or explicitly justify not running. |
| Many files modified | Agent too broad | `.agent.md` | Add constraints; require incremental diffs. |
| MCP failures | Server config/tool surface wrong | `.mcp.json`, `.agent.md` | Scope tools, fix auth, add timeout/retry guidance. |
| High subagent fanout | Over-delegation | `.agent.md`, `AGENTS.md` | Add “do shared inventory before spawning subagents”; reduce fanout. |

### 18.2 Recommendation schema

```json
{
  "recommendation_id": "rec_2026_05_20_001",
  "severity": "high",
  "confidence": 0.82,
  "pattern": "repeated_shell_failures",
  "evidence": {
    "time_window": "7d",
    "agent_name": "backend-engineer",
    "failure_rate": 0.42,
    "failed_tools": ["bash"],
    "example_conversations": ["hash1", "hash2"]
  },
  "root_cause_hypothesis": "Agent repeatedly runs npm commands in a pnpm workspace.",
  "target_file": "AGENTS.md",
  "proposed_patch_summary": "Add repo command guidance for install/test/build.",
  "risk": "low",
  "validation_query": "...KQL...",
  "rollback": "Revert AGENTS.md section 'Build/test commands'."
}
```

### 18.3 Patch workflow

```text
1. Query telemetry.
2. Generate recommendation JSON.
3. Rank by impact/risk.
4. User approves one recommendation.
5. Agent applies minimal patch.
6. Agent prints diff.
7. Agent adds validation query to PR/comment/report.
8. After N sessions, compare metrics.
```

---

## 19. Security model

### 19.1 Hard defaults

```text
Content capture: OFF
Prompt capture: OFF
Tool arg/result capture: OFF
File content capture: OFF
Collector bind: 127.0.0.1 only
Repo URL: hashed
User identity: pseudonymous
Azure MCP: read-only and namespace-scoped where possible
Grafana MCP: read/query-only where possible
Automation: propose before patching
Alerts: deterministic Azure Function, not broad LLM write access
Secrets: Key Vault / environment variables, never committed
```

### 19.2 Never do by default

- Never set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` in shared environments.
- Never expose the collector on `0.0.0.0`.
- Never ship Grafana service-account tokens in config.
- Never enable Azure MCP “disable user confirmation” in production.
- Never grant broad Azure Contributor to the telemetry investigator.
- Never use `tools: ["*"]` for agents that can mutate files or Azure resources.
- Never let telemetry agents auto-apply patches without approval.

### 19.3 Security tiers

| Tier | Use case | Behavior |
| --- | --- | --- |
| `safe-default` | normal personal/team use | metadata only, read-only MCP, patch proposals only |
| `team` | shared team workspace | RBAC, DCR filtering, no content, short retention |
| `lab-debug` | local private debugging | optional local JSONL content capture, never exported |
| `enterprise` | organization-wide | managed identity, policy allowlists, private networking where possible, audit trails |

### 19.4 MCP risk controls

Use:

- Azure RBAC least privilege,
- Azure MCP `--read-only true`,
- Azure MCP `--namespace monitor`,
- explicit tool allowlists,
- Grafana service account with least privileges,
- Copilot CLI deny rules for dangerous tools,
- enterprise MCP allowlists where available.

### 19.5 Tool permission pattern examples

```bash
copilot --agent telemetry-investigator \
  --available-tools='read,grep,glob,azure-mcp,agent-grafana,shell' \
  --allow-tool='read' \
  --allow-tool='shell(git status)' \
  --allow-tool='shell(git diff)' \
  --allow-tool='azure-mcp' \
  --allow-tool='agent-grafana' \
  --deny-tool='shell(git push)' \
  --deny-tool='shell(rm:*)' \
  --deny-tool='write(.env)' \
  --deny-tool='write(**/*secret*)'
```

---

## 20. Alerting and action layer

### 20.1 Alert rules

| Alert | Condition | Action |
| --- | --- | --- |
| Long-running agent | `invoke_agent` duration > threshold | Notify Teams/GitHub issue. |
| Tool failure spike | Tool failure rate > 30% for 15m | Create incident summary. |
| Context truncation spike | Truncation events > baseline | Recommend compaction/log summarization. |
| Hook error spike | Hook errors > threshold | Create issue against hook script. |
| Content capture enabled | Content attrs detected | Security alert. |
| Cost/AIU spike | Usage > baseline | Notify owner. |
| Risky tool denied | preToolUse denial event | Record security event. |
| Files modified no validation | shutdown stats show changes but no test evidence | Quality gate report. |

### 20.2 Azure Function actioner

The Function should accept Azure Monitor alert payloads and perform narrow deterministic actions:

- send Teams/Slack/Telegram message,
- create GitHub issue,
- create Azure DevOps work item,
- write summary JSON to Blob,
- tag session as risky,
- create “investigate with telemetry-investigator” prompt artifact.

It should **not**:

- call a broad LLM with secrets,
- directly mutate Azure resources broadly,
- change repo files automatically,
- read Key Vault secrets except its own config.

### 20.3 Actioner payload example

```json
{
  "alert_type": "tool_failure_spike",
  "severity": "warning",
  "workspace": "law-copilot-agentops-dev",
  "query": "...",
  "summary": "bash tool failure rate reached 41% over 30 minutes",
  "recommended_prompt": "Use telemetry-investigator to analyze bash failures in the last 30 minutes and propose a repo command guidance patch."
}
```

---

## 21. CLI utilities

Build a small CLI called `agentops`.

### 21.1 Commands

```bash
agentops doctor
agentops scan
agentops upload-catalog
agentops import-jsonl ./copilot-otel.jsonl
agentops replay-jsonl ./copilot-otel.jsonl --endpoint http://127.0.0.1:4318
agentops validate-azure
agentops validate-collector
agentops validate-copilot-env
agentops kql install-functions
agentops dashboard install-workbook
agentops dashboard install-grafana
```

### 21.2 `agentops scan`

Scans:

```text
.github/agents/*.agent.md
.github/agents/*.md
~/.copilot/agents/*.agent.md
.github/skills/**/SKILL.md
~/.copilot/skills/**/SKILL.md
.github/hooks/*.json
~/.copilot/hooks/*.json
.github/copilot-instructions.md
AGENTS.md
~/.copilot/mcp-config.json
```

Outputs:

```json
{
  "repo_hash": "...",
  "timestamp": "...",
  "agents": [],
  "skills": [],
  "hooks": [],
  "instructions": [],
  "mcp_servers": []
}
```

### 21.3 `agentops doctor`

Checks:

- Copilot CLI installed,
- OTel env vars set,
- collector reachable,
- Azure login present,
- Azure resources exist,
- Log Analytics receives data,
- Azure MCP configured,
- Grafana MCP configured,
- content capture disabled,
- broad `tools: ["*"]` in risky agents,
- hooks valid JSON,
- SKILL.md frontmatter valid.

---

## 22. MVP roadmap

### v0.1 — Telemetry pipeline

Deliver:

- `copilot-observe` Bash/PowerShell wrappers,
- local OTel Collector config,
- debug exporter,
- Azure Monitor/App Insights exporter path,
- Bicep infra,
- basic KQL pack,
- one Workbook,
- one Grafana dashboard,
- secure defaults.

Acceptance criteria:

- run Copilot CLI locally,
- see `invoke_agent`, `chat`, and `execute_tool` telemetry in Azure,
- query latest 20 sessions with KQL,
- dashboard shows runs, models, tools, failures, token usage.

### v0.2 — Copilot CLI plugin

Deliver:

- plugin with custom agents,
- plugin with skills,
- hooks skeleton,
- MCP configs,
- installer/doctor.

Acceptance criteria:

- `copilot plugin install ./copilot-agentops-azure`,
- `/agent` shows telemetry agents,
- `/skills list` shows AgentOps skills,
- `/mcp show` shows Azure/Grafana MCP configs.

### v0.3 — MCP feedback loop

Deliver:

- Azure MCP prompt pack,
- Grafana MCP prompt pack,
- telemetry investigator agent,
- KQL functions,
- recommendation schema,
- patch proposal workflow.

Acceptance criteria:

- inside Copilot CLI, ask the telemetry investigator for a 7-day retrospective,
- it queries Azure telemetry,
- it proposes a targeted `.agent.md`/`SKILL.md`/`AGENTS.md` patch,
- it includes validation KQL.

### v0.4 — Guardrails

Deliver:

- preToolUse policy,
- postToolUseFailure hints,
- agentStop/subagentStop quality gates,
- content capture detector,
- risk dashboard,
- alert/actioner.

Acceptance criteria:

- destructive tool attempt is denied,
- repeated command failure gets recovery hint,
- hook errors appear in telemetry,
- risky session creates alert/action.

### v0.5 — Experiment system

Deliver:

- before/after experiment labels,
- baseline comparison KQL,
- recommendation effectiveness reports,
- generated “AgentOps weekly report.”

Acceptance criteria:

- tag runs with `AGENTOPS_EXPERIMENT=new-skill-pack`,
- compare metrics before/after,
- report whether failure rate/turns/tokens improved.

---

## 23. Testing strategy

### 23.1 Unit tests

Test:

- `.agent.md` frontmatter parser,
- `SKILL.md` parser,
- hook JSON validator,
- MCP config parser,
- repo hash generation,
- collector config linting,
- KQL string generation,
- recommendation rule engine.

### 23.2 Golden telemetry tests

Use JSONL fixtures:

```text
tests/sample-otel/
├─ simple-success.jsonl
├─ tool-failure.jsonl
├─ high-turn-session.jsonl
├─ truncation-before-error.jsonl
├─ skill-invoked-failure.jsonl
├─ hook-error.jsonl
├─ subagent-fanout.jsonl
└─ content-capture-leak.jsonl
```

Each fixture should validate:

- parser extracts correct fields,
- privacy filter removes content,
- recommendation engine returns expected finding,
- KQL examples still match expected columns.

### 23.3 Collector smoke tests

```bash
./agentops validate-collector
./agentops emit-test-span --endpoint http://127.0.0.1:4318
./agentops query-azure --last 15m --expect-test-span
```

### 23.4 Security tests

Test:

- `.env` write denied,
- `rm -rf` denied,
- Key Vault secret access denied unless explicitly approved,
- content capture env var detector fires,
- collector not listening on public interface,
- Grafana token absent from repo,
- service principal has minimal RBAC.

### 23.5 End-to-end demo test

```text
1. Deploy infra.
2. Start collector.
3. Run copilot-observe with a sample task.
4. Verify telemetry in Azure.
5. Ask telemetry-investigator to analyze last 1h.
6. Generate one patch proposal.
7. Apply patch manually.
8. Run another task with AGENTOPS_EXPERIMENT=patched.
9. Compare before/after.
```

---

## 24. Repo layout

```text
copilot-cli-agentops-azure/
├─ README.md
├─ LICENSE
├─ docs/
│  ├─ architecture.md
│  ├─ secure-by-default.md
│  ├─ telemetry-schema.md
│  ├─ azure-mcp-loop.md
│  ├─ custom-agents-and-subagents.md
│  ├─ feedback-loop-patterns.md
│  ├─ enterprise-hardening.md
│  └─ troubleshooting.md
│
├─ installer/
│  ├─ install.sh
│  ├─ install.ps1
│  ├─ uninstall.sh
│  ├─ doctor.sh
│  └─ doctor.ps1
│
├─ collector/
│  ├─ otelcol.local.yaml
│  ├─ otelcol.azuremonitor.yaml
│  ├─ otelcol.appinsights.yaml
│  ├─ processors.privacy-safe.yaml
│  └─ docker-compose.yaml
│
├─ infra/
│  ├─ azure.yaml
│  └─ bicep/
│     ├─ main.bicep
│     ├─ app-insights.bicep
│     ├─ log-analytics.bicep
│     ├─ azure-monitor-workspace.bicep
│     ├─ grafana.bicep
│     ├─ alerts.bicep
│     ├─ actioner-function.bicep
│     ├─ key-vault.bicep
│     └─ outputs.bicep
│
├─ plugin/
│  ├─ plugin.json
│  ├─ agents/
│  ├─ skills/
│  ├─ hooks.json
│  ├─ .mcp.json
│  └─ scripts/
│
├─ copilot/
│  ├─ copilot-observe
│  ├─ copilot-observe.ps1
│  ├─ env.sample.sh
│  ├─ env.sample.ps1
│  ├─ mcp.azure-monitor.sample.json
│  └─ mcp.grafana.sample.json
│
├─ agentops-cli/
│  ├─ src/
│  ├─ package.json
│  └─ README.md
│
├─ kql/
│  ├─ 00-discover-tables.kql
│  ├─ 01-agent-runs.kql
│  ├─ 02-tool-failures.kql
│  ├─ 03-token-cost-aiu.kql
│  ├─ 04-context-truncation.kql
│  ├─ 05-skill-usage.kql
│  ├─ 06-hook-errors.kql
│  ├─ 07-long-running-sessions.kql
│  ├─ 08-model-latency.kql
│  ├─ 09-files-modified.kql
│  ├─ 10-agent-improvement-candidates.kql
│  └─ functions/
│
├─ workbooks/
├─ grafana/
├─ alerts/
├─ actioner/
└─ tests/
```

---

## 25. README skeleton

````md
# Copilot CLI AgentOps for Azure

Secure Azure-native observability and self-improvement loop for GitHub Copilot CLI.

## What it gives you

- Copilot CLI OTel ingestion through a local collector.
- Azure Monitor / Application Insights / Log Analytics dashboards.
- Azure Managed Grafana dashboards.
- Azure MCP and Grafana MCP telemetry investigation.
- Custom Copilot agents for AgentOps retrospectives.
- Skills for KQL, telemetry diagnosis, skill tuning, and subagent analysis.
- Hooks for safe policy enforcement and recovery hints.
- Recommendations for improving .agent.md, SKILL.md, AGENTS.md, hooks, and MCP config.

## Secure defaults

- Content capture off.
- Collector binds to localhost.
- Repo URL hashed.
- MCP read-only by default.
- No automatic remediation.

## Quickstart

```bash
az login
azd up
./installer/install.sh
./collector/start.sh
source ./copilot/env.sample.sh
copilot-observe
```

Inside Copilot CLI:

```text
Use the telemetry-investigator agent to analyze the last 24 hours of Copilot CLI telemetry and propose one safe improvement. Do not edit files yet.
```
````

---

## 26. Source list

1. [GitHub Docs — GitHub Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
2. [GitHub Docs — Creating and using custom agents for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
3. [GitHub Docs — Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
4. [GitHub Docs — Using GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)
5. [GitHub Docs — Comparing GitHub Copilot CLI customization features](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features)
6. [GitHub Docs — Running tasks in parallel with `/fleet`](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/fleet)
7. [GitHub Docs — Adding agent skills for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
8. [GitHub Docs — Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
9. [GitHub Docs — GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
10. [GitHub Docs — About Model Context Protocol](https://docs.github.com/en/copilot/concepts/context/mcp)
11. [GitHub Docs — OpenTelemetry instrumentation for Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry)
12. [Microsoft Learn — Azure MCP Server tools](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/)
13. [Microsoft Learn — Azure MCP Server with GitHub Copilot CLI](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/how-to/github-copilot-cli)
14. [Microsoft Learn — Configure Azure Managed Grafana Remote MCP server](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-mcp-server)
15. [Microsoft Learn — OpenTelemetry ingestion options for Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-summary)
16. [Microsoft Learn — Use OpenTelemetry with Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/collect-use-observability-data)
17. [Microsoft Learn — Ingest OTLP data into Azure Monitor with OTel Collector](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/opentelemetry-protocol-ingestion)
18. [Microsoft Learn — Application Insights OpenTelemetry observability overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
19. [Microsoft Learn — Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)
20. [OpenTelemetry — Semantic conventions for GenAI spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
21. [OpenTelemetry — Semantic conventions for GenAI agent/framework spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
22. [OpenTelemetry — Semantic conventions for GenAI metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)

---

## 27. Final build instruction for the implementation agent

You are implementing `copilot-cli-agentops-azure`.

Build in this order:

1. Create the repo skeleton.
2. Add the local `copilot-observe` wrapper for Bash and PowerShell.
3. Add local OTel Collector debug config and Docker Compose.
4. Add Azure Monitor/App Insights collector config with privacy-safe processors.
5. Add Bicep infra for App Insights, Log Analytics, Azure Monitor Workspace, Grafana, Key Vault, Function, alerts.
6. Add KQL pack and KQL functions.
7. Add Copilot CLI plugin with custom agents, skills, hooks, and MCP sample configs.
8. Add `agentops` CLI with `doctor`, `scan`, `import-jsonl`, `validate-collector`, `validate-azure`.
9. Add Grafana dashboard JSON and Azure Workbook JSON.
10. Add tests using JSONL fixtures.
11. Add README quickstart.
12. Add enterprise hardening docs.

Acceptance test:

```text
Given a local Copilot CLI session launched through copilot-observe,
When it performs a task using a custom agent and one tool call fails,
Then telemetry appears in Azure,
And the KQL pack can show the agent run, tool failure, model, tokens, and conversation id,
And the telemetry-investigator agent can query that data via Azure MCP/Grafana MCP,
And it can propose a minimal patch to the relevant .agent.md/SKILL.md/AGENTS.md/hook file,
And it includes validation KQL.
```

If any step is ambiguous, default to the secure option:

```text
metadata only, read-only MCP, localhost collector, hashed identifiers, no automatic remediation.
```
