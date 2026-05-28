# Troubleshooting

## No Collector Data

1. Confirm the collector is running.
2. Confirm it is listening on `127.0.0.1:4318` (the default OTLP/HTTP port).
3. Confirm the health endpoint is reachable on `127.0.0.1:13133`.
4. Run `node agentops-cli/src/index.js collector validate --mode auto --privacy strict`.
5. Confirm `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`.
6. Confirm `COPILOT_OTEL_ENABLED=true`.
7. Run `node agentops-cli/src/index.js experimental smoke --wait 2m --poll 10s` to verify Azure ingestion.

## Content Capture Detected

If telemetry includes prompt or completion message content (which may contain sensitive data), disable content capture by setting:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

Then restart the Copilot CLI session.

## KQL Returns No Rows

Run [../kql/00-discover-tables.kql](../kql/00-discover-tables.kql) first and verify table names and column mappings in your environment.
For smoke-test ingestion, run `node agentops-cli/src/index.js experimental collector-health --last 24h` and inspect the generated query.
