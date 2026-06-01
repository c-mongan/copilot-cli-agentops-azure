# OTel GenAI And MCP Schema

Use OpenTelemetry semantic conventions first, then add `agentops.*` fields only for Copilot-specific metadata.

## GenAI

Required or strongly recommended fields:

- `gen_ai.operation.name`
- `gen_ai.provider.name`
- `gen_ai.conversation.id`
- `gen_ai.request.model`
- `gen_ai.response.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.reasoning.output_tokens`
- `gen_ai.usage.cache_read.input_tokens`
- `gen_ai.usage.cache_creation.input_tokens`
- `error.type`
- `server.address`

AgentOps also accepts safe context/cache metadata:

- `agentops.context.window_pct`
- `agentops.context.tokens_removed`
- `agentops.cache.read_input_tokens`
- `agentops.cache.creation_input_tokens`
- `agentops.permission.wait_ms`

Do not export content fields in strict mode:

- `gen_ai.input.messages`
- `gen_ai.output.messages`
- `gen_ai.system_instructions`
- `gen_ai.tool.definitions`
- `gen_ai.tool.call.arguments`
- `gen_ai.tool.call.result`

## MCP

MCP tool spans should also look like GenAI tool spans:

- `mcp.method.name`
- `mcp.session.id`
- `mcp.transport`
- `mcp.server.name`
- `mcp.client.name`
- `gen_ai.operation.name = execute_tool`
- `gen_ai.tool.name`
- `agentops.mcp.server.hash`
- `agentops.mcp.tool.risk`
- `agentops.mcp.allowed`
- `agentops.mcp.denied_reason`
- `agentops.mcp.sandboxed`
- `agentops.mcp.args_schema_hash`
- `agentops.mcp.result_size_bytes`

Risk labels are advisory observability metadata, not a sandbox or security boundary.
