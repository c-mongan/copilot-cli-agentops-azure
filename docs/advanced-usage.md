# Advanced Usage

This page holds the deeper workflows that are useful after the basic quickstart works.

Most commands on this page are intentionally outside the quick path. Run them through `agentops experimental ...` unless the README lists them as core.

## Native Copilot OTel Without The Wrapper

You can use the observability stack without installing the `agentops` command or the `copilot-agentops` shim. AgentOps is an OTLP receiver plus Azure/Grafana/KQL content on top. If your Copilot surface emits OpenTelemetry to the local collector, the stack can observe it.

VS Code Copilot Chat:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "otlp-http",
  "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:4318",
  "github.copilot.chat.otel.captureContent": false
}
```

Copilot CLI:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT='http://127.0.0.1:4318'
export OTEL_EXPORTER_OTLP_PROTOCOL='http/protobuf'
export COPILOT_OTEL_ENABLED='true'
export COPILOT_OTEL_EXPORTER_TYPE='otlp-http'
export OTEL_SERVICE_NAME='github-copilot'
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT='false'
```

Copilot SDK:

```ts
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: "http://127.0.0.1:4318",
    exporterType: "otlp-http",
    sourceName: "github.copilot",
    captureContent: false
  }
});
```

Print setup snippets:

```bash
agentops experimental otel-setup
agentops experimental otel-setup --shell powershell
agentops experimental otel-setup --endpoint "http://localhost:4318" --service-name copilot-chat
```

Then start the collector and check compatibility:

```bash
agentops collector start
agentops experimental compat-check --last 2h
```

## Custom Agent Telemetry

Default Copilot telemetry covers the broad runtime. Custom telemetry is for agent-specific lifecycle facts that the runtime cannot know, such as "this subagent found evidence", "this gate passed", or "this policy blocked a risky action".

Use the same contract from Copilot CLI, VS Code extensions, Copilot SDK apps, hooks, MCP servers, or plain scripts:

```bash
agentops experimental custom emit --event agent.run.started --agent my-agent --workflow investigation --step start --outcome started
agentops experimental custom emit --event agent.evidence.found --agent my-agent --workflow investigation --step collect --outcome found --risk low --custom evidence_type=build-signal
agentops experimental custom emit --event agent.eval.scored --agent my-agent --workflow eval-gate --step candidate --score 0.91 --outcome measured
agentops experimental custom emit --event agent.run.completed --agent my-agent --workflow investigation --step finish --outcome passed
```

For orchestrators or scripts that delegate work, add parent/delegation metadata. Live Replay uses those fields to split the run into lanes:

```bash
agentops experimental custom emit --event agent.delegation.started --agent investigator --parent-agent agentops-orchestrator --delegation-id investigate-001 --workflow investigation --step delegate --outcome started
agentops experimental custom emit --event agent.delegation.completed --agent investigator --parent-agent agentops-orchestrator --delegation-id investigate-001 --workflow investigation --step delegate --outcome completed
```

For trusted agents or scripts that need to light up first-class safety panels, use explicit telemetry attributes:

```bash
agentops experimental custom emit --event agent.policy.blocked --agent policy-reviewer --workflow safety-review --step pre-tool --outcome blocked --risk policy --attribute github.copilot.policy.decision=blocked
agentops experimental custom emit --event agent.content.signal --agent debug-agent --workflow local-debug --step capture-check --outcome observed --risk content --attribute agentops.content_capture.signal=true
```

Keep raw prompt, response, tool argument, and file content out of these attributes unless you are doing a trusted local debugging session.

For config or release changes that may explain a regression, emit a metadata-only annotation:

```bash
agentops annotation config-change --component skill --target agentops-latest-run --change-type updated --change-id change-123 --version 2026.06.03 --dry-run
```

This emits `agentops.config.changed` with `content.capture.enabled=false`. Use `--run-id`, `--session`, or `--trace-id` to attach the annotation to a specific run.

For JSONL-producing agents:

```bash
agentops experimental custom import ./agent-events.jsonl --agent my-agent --workflow investigation
```

Minimal JSONL row:

```json
{"event_name":"agent.step.started","agent":"my-agent","workflow":"investigation","step":"collect","outcome":"started"}
```

Recommended event names:

- `agent.run.started`
- `agent.step.started`
- `agent.tool.used`
- `agent.evidence.found`
- `agent.decision.made`
- `agent.policy.blocked`
- `agent.eval.scored`
- `agent.run.completed`
- `agent.run.failed`

Installed smoke agents exercise this pattern without depending on a specific CI system:

```text
Use agentops-ci-pattern-smoke to emit a generic CI-style investigation lifecycle.
Use agentops-review-pattern-smoke to emit review and policy lifecycle events.
Use agentops-eval-gate-smoke to emit eval score and gate events.
```

Keep this metadata-only. Do not emit prompts, responses, source code, logs, tool inputs, tool outputs, secrets, full URLs, or raw customer identifiers.

Docs used for this support matrix:

- [VS Code: Monitor agent usage with OpenTelemetry](https://code.visualstudio.com/docs/copilot/guides/monitoring-agents)
- [VS Code: GitHub Copilot settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings#_observability-settings)
- [GitHub Docs: Copilot CLI OpenTelemetry monitoring](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring)
- [GitHub Docs: Copilot SDK OpenTelemetry](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry)

## Shadow Install And Plugin Files

The setup script is the shortest local wrapper. It installs the tested Collector binary, installs shims, and makes plain `copilot` observed when `~/.local/bin` is first on `PATH`:

```bash
./setup-agentops.sh
```

The product-style CLI installer is:

```bash
agentops install
```

The installer adds `agentops`, `copilot-agentops`, the tested local Collector binary, and the plain-`copilot` shim by default. Skip the plain shim with:

```bash
agentops install --no-shadow-copilot
```

If you deployed with `azd` and the environment contains the expected outputs, use:

```bash
agentops configure import-azd
```

To install or refresh only the Copilot plugin files:

```bash
agentops plugin install
agentops experimental agents install
agentops experimental skills install
```

To remove only the AgentOps Copilot agents and skills while keeping the CLI/shim installed:

```bash
agentops plugin uninstall
```

To stop routing plain `copilot` through AgentOps while keeping the explicit `copilot-agentops` command:

```bash
agentops experimental disable-shadow
```

To stop the local Azure Monitor collector:

```bash
agentops collector stop
```

To remove installed shims:

```bash
agentops plugin uninstall
agentops uninstall
```

To remove everything installed by the one-shot path, including the local Collector binary:

```bash
./uninstall-agentops.sh --purge
```

## Useful Agent Prompts

After `agentops init --full` or `agentops plugin install`, you can ask Copilot:

```text
Use agentops-orchestrator to figure out which AgentOps workflow I need and run the first read-only check.
Use agentops-live-triage to explain my latest Copilot run and recommend one next action.
Use agentops-attribution to show usage and failures by custom agent, skill, MCP server, and hook.
Use agentops-benchmark-gate to compare my baseline and candidate benchmark runs.
Use agentops-primitive-inventory to show which agents, skills, hooks, and MCP tools are configured.
```

## Science Mode

Science mode means you compare one Copilot setup against another using repeatable tasks.

Use this when you want to answer: "Did my new prompt, agent, model, or tool setup actually help?"

1. Pick one benchmark: a small task you can run the same way more than once.
2. Run the baseline: the current setup.
3. Run the variant: the changed setup.
4. Compare success, failures, tokens, duration, and policy blocks in Grafana.

Start with a dry run:

```bash
agentops benchmark list
agentops benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy --dry-run
```

Run the benchmark for real:

```bash
agentops benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy
agentops benchmark report <run-id>
```

Add Azure enrichment:

```bash
agentops benchmark report <run-id> --azure --last 24h
agentops benchmark compare <baseline-run-id> <variant-run-id> --azure --last 24h
```

For manual comparisons, label each run:

```bash
AGENTOPS_EXPERIMENT=baseline copilot -p "Run the benchmark task."
AGENTOPS_EXPERIMENT=variant-shorter-prompt copilot -p "Run the benchmark task."
```

Do not turn on content capture for science mode. The default metadata is enough for first-pass comparisons.

## Azure MCP Analyst Mode

Analyst mode is for people who want Copilot or an MCP client to inspect telemetry for them.

Safe default prompt:

```text
Use the telemetry-investigator agent to analyze the last 24 hours of Copilot CLI telemetry and propose one safe improvement. Do not edit files yet.
```

Read-only Azure Monitor MCP, Azure Managed Grafana MCP, and copyable prompt templates are documented in [Copilot MCP AgentOps prompts](copilot-mcp-agentops-prompts.md).

For Codex, add the same read-only Azure Monitor MCP server globally:

```bash
az login
codex mcp add azure-mcp -- npx -y @azure/mcp@latest server start --read-only --namespace monitor
codex mcp list
```

To verify custom agent, skill, MCP, and script attribution:

```bash
copilot plugin install c-mongan/copilot-cli-agentops-azure:plugin
agentops copilot --agent agentops-orchestrator --allow-tool=bash --add-dir . --no-ask-user --no-remote -p "Do not edit files. Use read-only shell commands: pwd and ls docs | head."
agentops custom emit --event agent.delegation.started --agent investigator --parent-agent agentops-orchestrator --delegation-id attribution-check --workflow investigation --step delegate --outcome started
agentops attribution --last 2h
agentops mcp --last 2h
agentops lineage --last 2h
```

## CLI Helper Cheatsheet

```bash
agentops status
agentops init --dry-run
agentops init --full
agentops validate-azure
agentops smoke --dry-run
agentops smoke --real-copilot --wait 2m --poll 10s --open-browser
agentops experimental attribution-smoke --wait 5m --poll 15s
agentops open
agentops experimental link session <conversation>
agentops experimental link trace <operationId>
agentops ask-context latest --last 24h
agentops experimental fields --last 7d
agentops experimental context --last 7d
agentops experimental token-rollup-audit --last 14d
agentops experimental collector-health --last 24h
agentops experimental attribution --last 7d
agentops experimental primitives --last 7d
agentops experimental policy --last 7d
agentops experimental mcp --last 7d
agentops experimental lineage --last 24h
agentops experimental permission-friction --last 7d
agentops experimental alert recommend --last 14d
agentops saved-view add latest-risk --session <conversation-id> --tag risk --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl
agentops saved-view list
agentops saved-view export --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl --out .agentops/saved-views/latest
```

These commands print Grafana links or Azure Log Analytics queries. You can use them without learning KQL first, and an analyst can inspect the generated query when needed.

## Glossary

- **context pressure** = Copilot had too much to remember
- **tool failure** = a tool Copilot tried did not work
- **primitive inventory** = the support matrix for agents, subagents, skills, hooks, MCP, tools, instructions, plugins, workflows/commands, LSP, benchmarks, and runtime flags
- **lineage** = the session flow across agents, subagents, LLM calls, tools, MCP tools, skills, hooks, context, and errors
- **policy block** = a safety rule stopped something risky
- **content capture** = recording prompts/code/tool arguments
- **benchmark** = a repeatable task
- **baseline** = before
- **variant** = after/version being tested
- **regression** = got worse
