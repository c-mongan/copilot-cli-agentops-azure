# Telemetry Schema

Expected Copilot attributes are based on OpenTelemetry GenAI semantic conventions plus the current GitHub Copilot CLI, VS Code Copilot Chat, and Copilot SDK telemetry surfaces.

Copilot OpenTelemetry is opt-in. Copilot CLI turns on when `COPILOT_OTEL_ENABLED=true`, when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, or when `COPILOT_OTEL_FILE_EXPORTER_PATH` is set. VS Code Copilot Chat uses the `github.copilot.chat.otel.*` settings. Copilot SDK apps can pass a telemetry config with an OTLP endpoint. Keep content capture off unless a trusted debugging session explicitly needs prompt, response, or tool argument content.

AgentOps supports two ingestion modes:

- Wrapper mode: `copilot-agentops` or optional plain-`copilot` shadowing starts the collector, adds AgentOps labels, and calls the real Copilot CLI.
- Bring-your-own-OTel mode: VS Code Copilot Chat, Copilot CLI, Copilot SDK, or another GenAI-compatible agent sends OTLP directly to the AgentOps collector.

Use this helper to generate native Copilot settings and env vars:

```bash
agentops otel-setup
agentops otel-setup --shell powershell
```

Use this helper to check whether recent incoming spans have enough schema coverage for dashboards and evals:

```bash
agentops compat-check --last 2h
```

Important fields:

- `gen_ai.operation.name`
- `gen_ai.agent.id`
- `gen_ai.agent.name`
- `gen_ai.agent.version`
- `gen_ai.conversation.id`
- `github.copilot.interaction_id`
- `gen_ai.request.model`
- `gen_ai.tool.name`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `github.copilot.turn_count`
- `github.copilot.skill.name`
- `github.copilot.hook.type`
- `error.type`

Important metrics:

- `gen_ai.client.operation.duration`
- `gen_ai.client.token.usage`
- `gen_ai.client.operation.time_to_first_chunk`
- `gen_ai.client.operation.time_per_output_chunk`
- `github.copilot.tool.call.count`
- `github.copilot.tool.call.duration`
- `github.copilot.agent.turn.count`
- `copilot_chat.tool.call.count`
- `copilot_chat.tool.call.duration`
- `copilot_chat.agent.invocation.duration`
- `copilot_chat.agent.turn.count`
- `copilot_chat.session.count`
- `copilot_chat.time_to_first_token`
- `copilot_chat.edit.acceptance.count`
- `copilot_chat.chat_edit.outcome.count`
- `copilot_chat.lines_of_code.count`
- `copilot_chat.edit.survival.four_gram`
- `copilot_chat.edit.survival.no_revert`
- `copilot_chat.user.action.count`
- `copilot_chat.user.feedback.count`
- `copilot_chat.agent.edit_response.count`
- `copilot_chat.agent.summarization.count`
- `copilot_chat.pull_request.count`
- `copilot_chat.cloud.session.count`
- `copilot_chat.cloud.pr_ready.count`

Important events and span events:

- `gen_ai.client.inference.operation.details`
- `copilot_chat.session.start`
- `copilot_chat.tool.call`
- `copilot_chat.agent.turn`
- `copilot_chat.edit.feedback`
- `copilot_chat.edit.hunk.action`
- `copilot_chat.inline.done`
- `copilot_chat.edit.survival`
- `copilot_chat.user.feedback`
- `copilot_chat.cloud.session.invoke`
- `github.copilot.hook.start`
- `github.copilot.hook.end`
- `github.copilot.hook.error`
- `github.copilot.session.truncation`
- `github.copilot.session.compaction_start`
- `github.copilot.session.compaction_complete`
- `github.copilot.skill.invoked`
- `github.copilot.session.shutdown`
- `github.copilot.session.abort`
- `exception`

AgentOps shim fields:

- `agentops.agent.name`
- `agentops.agent.file`
- `agentops.agent.hash`
- `agentops.skill.name`
- `agentops.skill.file`
- `agentops.skill.hash`
- `agentops.mcp.server`
- `agentops.mcp.tool`
- `agentops.script.name`
- `agentops.script.file`
- `agentops.script.hash`
- `agentops.hook.name`
- `agentops.cli.mode`
- `agentops.cli.model`
- `agentops.cli.remote`
- `agentops.cli.output_format`
- `agentops.cli.reasoning_effort`
- `agentops.cli.stream`
- `agentops.cli.allow_all`
- `agentops.cli.allow_all_tools`
- `agentops.cli.allow_all_paths`
- `agentops.cli.allow_all_urls`
- `agentops.cli.acp`
- `agentops.cli.cwd_changed`
- `agentops.cli.session_id_provided`
- `agentops.cli.share`
- `agentops.cli.share_gist`
- `agentops.cli.allow_tool.count`
- `agentops.cli.allow_url.count`
- `agentops.cli.deny_tool.count`
- `agentops.cli.deny_url.count`
- `agentops.cli.available_tools.count`
- `agentops.cli.excluded_tools.count`
- `agentops.cli.secret_env_vars.count`
- `agentops.cli.attachment.count`
- `agentops.cli.plugin_dir.count`
- `agentops.cli.additional_mcp_config.count`
- `agentops.cli.disabled_mcp_server.count`
- `agentops.cli.github_mcp_tool.count`
- `agentops.cli.github_mcp_toolset.count`
- `agentops.mcp.config.files`
- `agentops.mcp.config.servers`
- `agentops.mcp.disabled.servers`
- `agentops.mcp.github.tools`
- `agentops.mcp.github.toolsets`

Custom agent lifecycle fields:

- `agentops.custom_event_id`
- `agentops.schema.version`
- `agentops.event.kind`
- `agentops.event.name`
- `agentops.agent.name`
- `agentops.parent_agent.name`
- `agentops.delegation.id`
- `agentops.workflow.name`
- `agentops.step.name`
- `agentops.outcome`
- `agentops.risk`
- `agentops.score`
- `agentops.entity.type`
- `agentops.entity.id_hash`
- `agentops.tags`
- `agentops.custom.*`

Recommended lifecycle event names:

- `agent.run.started`
- `agent.delegation.started`
- `agent.step.started`
- `agent.tool.used`
- `agent.evidence.found`
- `agent.decision.made`
- `agent.policy.blocked`
- `agent.eval.scored`
- `agent.delegation.completed`
- `agent.run.completed`
- `agent.run.failed`

The shim records only privacy-safe run dimensions and counts from Copilot CLI flags. It does not record prompt text, tool arguments, allow/deny pattern values, URLs, paths, attachment names, plugin directories, session IDs, or secret variable names. For MCP lineage, it records MCP config basenames, configured server names, disabled server names, and explicitly selected GitHub MCP tool/toolset names when those values are provided by CLI flags or readable MCP config files.

When the wrapper sees `--agent <name>`, it emits `agentops.agent.name`. If a matching local agent file is present under `COPILOT_HOME/agents`, `.copilot/agents`, or `agents`, it also emits the basename and content hash. Skills, hooks, scripts, and exact MCP server/tool attribution are supported when spans or sidecar events provide `agentops.skill.*`, `agentops.script.*`, `agentops.hook.*`, or `agentops.mcp.*`. Native Copilot CLI runs may instead expose loaded skills in `github.copilot.context.skills`; dashboards surface that as context rather than charging every loaded skill for session cost. MCP server attribution is inferred from tool names such as `mcp__<server>__<tool>`, `<server>/<tool>`, and observed Azure MCP tool names such as `azure-mcp-monitor`.

For orchestrator-style agents, emit the same session/conversation ID on every span and keep normal OpenTelemetry parent-child span IDs when available. If the runtime has explicit delegation metadata, add `agentops.parent_agent.name` and `agentops.delegation.id`. Agents without sub-agents do not need those fields; they still appear as a single run timeline with LLM calls, tool calls, MCP calls, scripts/hooks, timings, and errors.

The collector marks content-capture attempts with `agentops.content_capture.signal=true`, then strips content-capture attributes before Azure export, including `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.definitions`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, legacy `gen_ai.prompt`/`gen_ai.completion`, request/response bodies, raw URLs, and file paths.

Scoped content capture is opt-in for local debugging. The Copilot wrapper keeps capture off by default, but can enable Copilot-side capture for a narrow allowlist:

```bash
AGENTOPS_CAPTURE_CONTENT_AGENTS=agentops-review-pattern-smoke copilot --agent agentops-review-pattern-smoke -p "synthetic debug prompt"
AGENTOPS_CAPTURE_CONTENT_SKILLS=agentops-custom-telemetry AGENTOPS_ACTIVE_SKILLS=agentops-custom-telemetry copilot -p "synthetic debug prompt"
```

Use `AGENTOPS_CAPTURE_CONTENT=true` only for an explicitly approved local debugging run. The default Azure collector still scrubs raw content and exports the signal marker so Safety & Policy panels can alert without storing prompt or tool payload text.

MCP tool server attribution is exact when tool names use documented namespaced forms such as `mcp__<server>__<tool>` or `<server>/<tool>`. It is inferred for observed Azure MCP prefixes such as `azure-mcp-*`, and when a session has exactly one configured MCP server and a non-built-in tool span has no server prefix.

## Token Rollups

Do not blindly sum token and cost fields across every span in a trace. Copilot CLI emits:

- `invoke_agent` spans with aggregate token, cost, AIU, and turn-count fields for the whole user-message invocation.
- `chat` spans with per-LLM-request token, cost, and AIU fields.
- `execute_tool` spans for tool calls, usually without token usage.

For session-level grouping, prefer non-empty `gen_ai.conversation.id`, then `github.copilot.interaction_id`, then a deterministic agent/turn/hour fallback.

For broad Copilot/GenAI discovery, use a compatibility filter that accepts native VS Code and CLI service names as well as Copilot-specific properties:

```kql
Properties has "github.copilot"
or Properties has "gen_ai.operation.name"
or Properties has "agentops."
or AppRoleName in ("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli")
or tostring(Properties["service.name"]) in ("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli")
or tostring(Properties["agent.runtime"]) in ("codex", "openai-codex-cli")
```

For session-level token panels, prefer summing `chat` spans when they exist and falling back to the `invoke_agent` aggregate when they do not. Use `kql/13-token-rollup-audit.kql` or:

```bash
node agentops-cli/src/index.js token-rollup-audit --last 14d
```

The audit compares all-span sums against the recommended rollup and flags sessions where parent/child token fields appear to be double-counted.

Validate these against real Copilot CLI OTel output before treating dashboards as stable.

## Governance and MCP Queries

- `kql/15-policy-governance.kql` summarizes content-capture signals, allow-all/yolo sessions, policy blocks, remote state, output format, mode, and secret redaction counts.
- `kql/16-mcp-tool-usage.kql` summarizes tool calls, inferred MCP server/tool lineage, configured MCP posture, and documented built-in tools.
- `kql/19-agent-flow-lineage.kql` reconstructs session flow across agent, subagent, LLM, built-in tool, MCP tool, skill, hook, context, and error events using span parent-child ids when present.
- `kql/20-copilot-primitives-inventory.kql` shows runtime coverage for Copilot primitives and complements the local `agentops primitives` configuration scan.
- `kql/23-attribution-usage.kql` groups usage, failures, token/cost signals, tools, and sessions by custom agents, skills, MCP servers, and scripts/hooks.

These queries are also available through:

```bash
node agentops-cli/src/index.js policy --last 7d
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js primitives --last 7d
node agentops-cli/src/index.js attribution --last 7d
```

For a Copilot-native route into these workflows, ask:

```text
Use agentops-orchestrator to show the right AgentOps workflow for this telemetry question.
Use agentops-attribution to show usage and failures for this custom agent, skill, MCP server, or hook.
```
