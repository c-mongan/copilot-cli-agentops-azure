# Telemetry Schema

Expected Copilot CLI attributes are based on OpenTelemetry GenAI semantic conventions and Copilot CLI telemetry documentation.

Important fields:

- `gen_ai.operation.name`
- `gen_ai.agent.id`
- `gen_ai.agent.name`
- `gen_ai.agent.version`
- `gen_ai.conversation.id`
- `gen_ai.request.model`
- `gen_ai.tool.name`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `github.copilot.turn_count`
- `github.copilot.skill.name`
- `github.copilot.hook.type`
- `error.type`

Validate these against real Copilot CLI OTel output before treating dashboards as stable.
