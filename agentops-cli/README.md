# agentops CLI

Small local utility for the Copilot CLI AgentOps for Azure scaffold.

AgentOps records run metadata, tool names, failures, latency, token usage,
estimated cost, privacy signals, and outcomes without recording prompts, code,
file contents, tool arguments, or tool results by default. Prompt/response rows
remain opt-in and isolated in `AgentOpsContent_CL`; check the current policy with
`agentops content status`.

The shortest native first-value loop is:

```bash
agentops setup --json
eval "$(agentops init --local-only --yes --shell zsh)"
agentops smoke --local
copilot -p "Reply with exactly: agentops smoke."
agentops open latest
```

The local init command applies only AgentOps-owned files and native Copilot OTel
environment exports. The local smoke starts or health-checks the strict
loopback Collector and reads back a metadata-only receipt. For native everyday
sessions, plain `copilot ...` is the execution command; `agentops copilot ...`
remains a compatibility path, and transparent routing is still opt-in with
`--shadow-copilot`.

For a beginner-friendly end-to-end walkthrough, use the
[junior quickstart](https://github.com/c-mongan/copilot-cli-agentops-azure/blob/main/docs/junior-quickstart.md). The Azure-native
helper discovers the approved DCR and signal endpoints from Application
Insights, so operators do not have to transcribe long URLs.

For an already-approved legacy cloud binding, `agentops init --full` remains a
preview and `agentops init --full --yes` applies the reviewed stages. The
compatibility command `agentops copilot ...` and `agentops open latest` remain
available during the native migration.

## Commands

```bash
node src/index.js doctor --local-only
node src/index.js install --shadow-copilot
node src/index.js configure show
node src/index.js configure set --resource-group rg-agentops-dev --workspace-id <workspace-id> --grafana-url https://<your-grafana>.grafana.azure.com
node src/index.js configure import-azd
node src/index.js start
node src/index.js stop
node src/index.js copilot -p "Reply with exactly: agentops smoke."
node src/index.js codex
node src/index.js otel-setup
node src/index.js otel-setup --shell powershell
node src/index.js compat-check --last 2h
node src/index.js init --dry-run
node src/index.js init --full
node src/index.js init --full --yes
node src/index.js init --import-dashboards
node src/index.js init --run-smoke
node src/index.js init --triage-latest
node src/index.js scan
node src/index.js primitives --last 7d
node src/index.js import-jsonl ../fixtures/sample-otel/tool-failure.ndjson.fixture
node src/index.js validate-collector
node src/index.js validate-azure
node src/index.js smoke --dry-run
node src/index.js smoke --wait 2m --poll 10s
node src/index.js attribution-smoke --wait 5m --poll 15s
node src/index.js live-replay-smoke --wait 5m --poll 15s
node src/index.js ask-context latest --last 2h
node src/index.js plugin install
node src/index.js plugin uninstall
node src/index.js agents install
node src/index.js agents list
node src/index.js skills install
node src/index.js skills list
node src/index.js workflows list
node src/index.js workflows show orchestrate
node src/index.js workflows show latest-run
node src/index.js link session <conversation>
node src/index.js link trace <operationId>
node src/index.js fields --last 7d
node src/index.js context --last 7d
node src/index.js collector-health --last 24h
node src/index.js attribution --last 7d
node src/index.js live --last 2h
node src/index.js replay latest --last 7d
node src/index.js recommend latest --last 7d
node src/index.js permission-friction --last 7d
node src/index.js lineage --last 24h
node src/index.js alert recommend --last 14d
node src/index.js saved-view add latest-risk --session <conversation>
```

`init` performs the local first-run checklist, installs or dry-runs bundled agents and skills, checks shim posture, and prints the next commands needed for Azure validation, a real Copilot smoke run, and latest-run triage. Pass `--full` to run the explicit cloud provision, dashboard import, smoke, and triage stages together.

`install` installs the `agentops` and `copilot-agentops` commands into `~/.local/bin`. Pass `--shadow-copilot` when you want plain `copilot` to route through AgentOps too.

`start` and `stop` are short aliases for `collector start` and `collector stop`.

`copilot` starts the collector if needed and runs the real Copilot CLI through
the AgentOps shim. After the run it prints an immediate metadata-only receipt
using the changed local Copilot event stream: actual Copilot session ID, model,
input/output tokens, AI credits, wall/API time, safe tool names/count, and code
change counts when present. Prompts, answers, tool arguments/results, paths and
file names are never copied into the receipt. Ordered wrapper lifecycle receipts
are fsynced into a bounded private queue. The receipt labels that evidence
`waiting for Azure` until the configured ingestion endpoint accepts the exact
event; native Copilot detail is labelled separately as best-effort collector
coverage.

Inspect the queue at any time:

```bash
agentops delivery status
agentops delivery drain                 # preview only
agentops delivery drain --yes           # requires configured endpoint + DCR
```

`delivery drain` fails closed unless the exact approved subscription, Azure
Monitor ingestion hostname, and DCR identifier pass validation. Endpoint `2xx`
means accepted for ingestion, not yet visible in Log Analytics.

`codex` starts the collector if needed, sets privacy-safe OTLP environment defaults, and runs the local Codex CLI. Add Azure Monitor MCP with `codex mcp add azure-mcp -- npx -y @azure/mcp@latest server start --read-only --namespace monitor`.

Dashboard verification path:

```bash
node src/index.js validate-azure --last 2h
copilot plugin install c-mongan/copilot-cli-agentops-azure:plugin
node src/index.js copilot --agent agentops-orchestrator --allow-tool=bash --add-dir . --no-ask-user --no-remote --no-remote-export -p "Do not edit files. Use read-only shell commands: pwd and ls docs | head."
node src/index.js custom emit --event agent.delegation.started --agent investigator --parent-agent agentops-orchestrator --delegation-id real-delegation --workflow investigation --step delegate --outcome started
node src/index.js custom emit --event agent.policy.blocked --agent policy-reviewer --workflow safety-review --step pre-tool --outcome blocked --risk policy --attribute github.copilot.policy.decision=blocked
node src/index.js open
```

`agentops open` prints the configured Azure Monitor Agents view first when one is available. Use the native view for the normal investigation flow; the Run Story link is the local/metadata fallback and the V2 Grafana pages are an optional advanced operator pack. Use a real observed Copilot run when you want to seed quieter pages.

`configure` stores non-secret Azure/Grafana identifiers in `~/.agentops/config.json` so users do not need to export terminal environment variables for every shell. Environment variables still override saved config for CI and advanced workflows.

`otel-setup` prints copyable VS Code Copilot Chat settings, Copilot CLI terminal environment variables, and a Copilot SDK TypeScript snippet that point native Copilot OTel at the AgentOps collector. This is the no-wrapper path: users can emit OTLP directly without installing `copilot-agentops`.

The optional native Azure preview uses `agentops collector validate --mode azure-native --privacy strict` and `agentops collector start --mode azure-native --privacy strict`. It merges the strict local privacy config with the Azure `otlp_http`/Entra `azure_auth` overlay; provide only the signal-specific endpoints copied from Application Insights OTLP Connection Info, then set `AGENTOPS_APPROVE_NATIVE_OTLP=yes`. See `docs/azure-native-otlp-preview.md` for the read-only readiness gate.

`compat-check` prints a Log Analytics query that checks whether recent Copilot/GenAI OTel has the fields dashboards and evals need: operation, session, model, tool, token usage, and cost or AIU signals.

`validate-azure` runs read-only Azure checks for CLI login, resource group, Log Analytics query access, Application Insights, Grafana resource, datasource UID, and imported dashboard UIDs.

`smoke` sends or dry-runs a privacy-safe OTLP trace through the local collector. In live mode it polls Log Analytics for the smoke id by default; use `--no-verify` only when you want a collector-only check.

`attribution-smoke` sends a privacy-safe synthetic trace that exercises custom agent, skill, Azure MCP, and script/hook attribution fields. Keep it as a collector/filter wiring diagnostic; do not use it for README screenshots or product demos when real traffic is available.

`live-replay-smoke` sends a privacy-safe synthetic orchestrator trace with a delegated sub-agent, skill, Azure MCP tool call, and hook/script event. Keep it as a diagnostic. For normal dashboard population, emit real lifecycle metadata with `custom emit --parent-agent ... --delegation-id ...` from the orchestrator, sub-agent, hook, SDK app, or script doing the work.

For Runtime Events, Safety & Policy, Permission Friction, and Alert Tuning, prefer real signals: install the Copilot plugin, run an observed agent task, and trigger a safe policy-block check with a fake Key Vault secret-read command. Compaction and truncation panels stay quiet until a real run actually hits context pressure.

`custom emit --attribute key=value` is the explicit opt-in path for first-class dashboard fields from trusted agents or scripts. It only accepts known telemetry namespaces such as `agentops.*`, `gen_ai.*`, and `github.copilot.*`; use `--custom key=value` for generic private dimensions.

`collector-health` prints a KQL query for latest real Copilot/AgentOps spans and collector error/warning signals.

`attribution` prints KQL that groups usage, failures, tokens, cost, and tools by custom agent, skill, MCP server, and script/hook attribution fields.

`ask-context` builds a copyable telemetry-investigator prompt with the session id, Grafana URL, Log Analytics query, workspace id, and read-only MCP config references.

`plugin install` copies the bundled AgentOps agents and skills into `COPILOT_HOME/agents` and `COPILOT_HOME/skills`, or `~/.copilot/agents` and `~/.copilot/skills` when `COPILOT_HOME` is not set. Existing local files are skipped unless you pass `--force`.

`plugin uninstall` removes only the known bundled AgentOps agent and skill files from Copilot home. It leaves unrelated user agents and skills alone.

`agents install` and `skills install` manage those pieces separately when users do not want the full plugin bundle.

`workflows` maps the main README workflows to both CLI commands and invocable Copilot skills, so users can start from a goal instead of memorizing command names.

Start with `workflows show orchestrate` when the user does not know which AgentOps skill to use. The orchestrator routes setup, live triage, attribution, dashboard, benchmark, and operations requests.

`link` prints a Grafana URL plus the raw Azure Log Analytics KQL for a session or trace.

`fields` prints a field-catalog KQL query that discovers observed `Properties` keys and example values from recent Copilot CLI spans.

`context` prints a context-pressure KQL query that ranks sessions with large inputs, low output yield, weak cache leverage, or high estimated cost.

`live` and `replay` print a compact privacy-safe session timeline without prompt, response, tool argument, or file-content capture.

`recommend latest` converts the latest-session classification into the AgentOps recommendation contract: evidence, observed pattern, proposed files, expected metric movement, validation, and rollback.

`permission-friction` prints KQL for policy blocks, broad allow modes, retry hints, tool failures, and restricted tool/MCP posture.

`lineage` prints KQL for reconstructing custom-agent, subagent, LLM, tool, MCP tool, skill, hook, context, and error flow using span parent-child ids when available.

`primitives` inventories configured Copilot primitives locally and includes a runtime KQL coverage query. Use `--root <path>` to scan another customization repo.

`alert recommend` prints proposal-only alert threshold guidance for the disabled Azure Monitor rules.

`saved-view` stores repeat investigations in `~/.agentops/views.json` by default, or at the path set by `AGENTOPS_VIEWS_PATH` when defined.
