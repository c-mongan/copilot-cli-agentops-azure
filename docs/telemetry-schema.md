# Telemetry Schema

Expected Copilot CLI attributes are based on OpenTelemetry GenAI semantic conventions and Copilot CLI telemetry documentation.

Copilot CLI OpenTelemetry is opt-in. It turns on when `COPILOT_OTEL_ENABLED=true`, when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, or when `COPILOT_OTEL_FILE_EXPORTER_PATH` is set. Keep `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` unless a trusted debugging session explicitly needs prompt, response, or tool argument content.

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

AgentOps shim fields:

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

The shim records only privacy-safe run dimensions and counts from Copilot CLI flags. It does not record prompt text, tool arguments, allow/deny pattern values, URLs, paths, attachment names, plugin directories, session IDs, or secret variable names. For MCP lineage, it records MCP config basenames, configured server names, disabled server names, and explicitly selected GitHub MCP tool/toolset names when those values are provided by CLI flags or readable MCP config files.

MCP tool server attribution is exact when tool names use documented namespaced forms such as `mcp__<server>__<tool>` or `<server>/<tool>`. It is inferred when a session has exactly one configured MCP server and a non-built-in tool span has no server prefix.

## Token Rollups

Do not blindly sum token and cost fields across every span in a trace. Copilot CLI emits:

- `invoke_agent` spans with aggregate token, cost, AIU, and turn-count fields for the whole user-message invocation.
- `chat` spans with per-LLM-request token, cost, and AIU fields.
- `execute_tool` spans for tool calls, usually without token usage.

For session-level grouping, prefer non-empty `gen_ai.conversation.id`, then `github.copilot.interaction_id`, then a deterministic agent/turn/hour fallback.

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

These queries are also available through:

```bash
node agentops-cli/src/index.js policy --last 7d
node agentops-cli/src/index.js mcp --last 7d
node agentops-cli/src/index.js lineage --last 24h
node agentops-cli/src/index.js primitives --last 7d
```
