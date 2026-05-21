# Secure By Default

Defaults:

- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- Collector binds only to `127.0.0.1`.
- Repo URL is hashed in `copilot-observe`.
- MCP samples use read-only Azure Monitor scope.
- Agents produce patch plans before edits.
- Hook scripts do not call remote services.

Never commit secrets, Grafana tokens, Azure credentials, `.env` files, or raw prompt/tool content telemetry.
