# Secure By Default

Defaults:

- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- Collector binds only to `127.0.0.1`.
- Repo URL is hashed in `copilot-observe`.
- MCP samples use read-only Azure Monitor scope.
- Azure MCP is scoped to `--namespace monitor` with `--read-only true`.
- Grafana MCP uses the Azure Managed Grafana endpoint with tokens supplied through environment variables.
- Agents produce patch plans before edits.
- Agent recommendations must include evidence, observed pattern, proposed files, expected metric movement, validation, and rollback.
- Hook scripts do not call remote services.

Never commit secrets, Grafana tokens, Azure credentials, `.env` files, or raw prompt/tool content telemetry.
