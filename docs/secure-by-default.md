# Secure By Default

Security posture:

```text
content capture off at Copilot runtime
+ local collector privacy scrub
+ localhost-only host binding
+ no secret persistence
+ Azure ingestion caps / RBAC / disabled automation by default
```

## Defaults

- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- `COPILOT_OTEL_CAPTURE_CONTENT=false`
- `AGENTOPS_PRIVACY_MODE=strict`
- `AGENTOPS_COLLECTOR_MODE=auto`
- Collector host ports bind to `127.0.0.1`.
- Application Insights connection strings are retrieved at runtime and not stored in repo config.
- Alert rules, actioners, RBAC assignment automation, and budgets are opt-in.

## Not Captured By Default

- prompts
- responses
- code or file contents
- tool arguments or tool results
- system instructions
- request/response bodies
- full URLs
- secrets

## Unsafe Modes

`AGENTOPS_COLLECTOR_MODE=none` is unsafe because no local scrub guarantee exists. It requires `AGENTOPS_ALLOW_NO_COLLECTOR=1` or `--unsafe-no-collector`.

Content capture requires an explicit local debug override and should not be used for normal Azure export.

## Policy Hooks

The bundled hooks are transparent demo guardrails. They can block obvious risky patterns, but they are not comprehensive security enforcement.

Never commit secrets, Grafana tokens, Azure credentials, `.env` files, or raw prompt/tool-content telemetry.
