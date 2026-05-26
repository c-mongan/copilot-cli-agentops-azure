# agentops CLI

Small local utility for the Copilot CLI AgentOps for Azure scaffold.

## Commands

```bash
node src/index.js doctor --local-only
node src/index.js install --shadow-copilot
node src/index.js configure show
node src/index.js configure set --resource-group rg-agentops-dev --workspace-id <workspace-id> --grafana-url https://<your-grafana>.grafana.azure.com
node src/index.js configure import-azd
node src/index.js otel-setup
node src/index.js otel-setup --shell powershell
node src/index.js compat-check --last 2h
node src/index.js init --dry-run
node src/index.js scan
node src/index.js primitives --last 7d
node src/index.js import-jsonl ../tests/sample-otel/tool-failure.jsonl
node src/index.js validate-collector
node src/index.js validate-azure
node src/index.js smoke --dry-run
node src/index.js smoke --wait 2m --poll 10s
node src/index.js ask-context latest --last 2h
node src/index.js skills install
node src/index.js skills list
node src/index.js workflows list
node src/index.js workflows show latest-run
node src/index.js link session <conversation>
node src/index.js link trace <operationId>
node src/index.js fields --last 7d
node src/index.js context --last 7d
node src/index.js collector-health --last 24h
node src/index.js live --last 2h
node src/index.js replay latest --last 7d
node src/index.js recommend latest --last 7d
node src/index.js permission-friction --last 7d
node src/index.js lineage --last 24h
node src/index.js alert recommend --last 14d
node src/index.js saved-view add latest-risk --session <conversation>
```

`init` performs the local first-run checklist, installs or dry-runs bundled skills, checks shim posture, and prints the next commands needed for Azure validation and a real Copilot smoke run.

`install` installs the `agentops` and `copilot-agentops` commands into `~/.local/bin`. Pass `--shadow-copilot` when you want plain `copilot` to route through AgentOps too.

`configure` stores non-secret Azure/Grafana identifiers in `~/.agentops/config.json` so users do not need to export terminal environment variables for every shell. Environment variables still override saved config for CI and advanced workflows.

`otel-setup` prints copyable VS Code Copilot Chat settings, Copilot CLI terminal environment variables, and a Copilot SDK TypeScript snippet that point native Copilot OTel at the AgentOps collector. This is the no-wrapper path: users can emit OTLP directly without installing `copilot-agentops`.

`compat-check` prints a Log Analytics query that checks whether recent Copilot/GenAI OTel has the fields dashboards and evals need: operation, session, model, tool, token usage, and cost or AIU signals.

`validate-azure` runs read-only Azure checks for CLI login, resource group, Log Analytics query access, Application Insights, Grafana resource, datasource UID, and imported dashboard UIDs.

`smoke` sends or dry-runs a privacy-safe OTLP trace through the local collector. In live mode it polls Log Analytics for the smoke id by default; use `--no-verify` only when you want a collector-only check.

`collector-health` prints a KQL query for smoke span counts, latest Copilot span, and collector error/warning signals.

`ask-context` builds a copyable telemetry-investigator prompt with the session id, Grafana URL, Log Analytics query, workspace id, and read-only MCP config references.

`skills install` copies the bundled AgentOps skills into `COPILOT_HOME/skills`, or `~/.copilot/skills` when `COPILOT_HOME` is not set. Existing local skills are skipped unless you pass `--force`.

`workflows` maps the main README workflows to both CLI commands and invocable Copilot skills, so users can start from a goal instead of memorizing command names.

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
