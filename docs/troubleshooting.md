# Troubleshooting

## No Collector Data

1. Confirm the collector is running.
2. Confirm it is listening on `127.0.0.1:4318` (the default OTLP/HTTP port).
3. Confirm `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`.
4. Confirm `COPILOT_OTEL_ENABLED=true`.

## Content Capture Detected

If telemetry includes prompt or completion message content (which may contain sensitive data), disable content capture by setting:

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

Then restart the Copilot CLI session.

## KQL Returns No Rows

Run [../kql/00-discover-tables.kql](../kql/00-discover-tables.kql) first and verify table names and column mappings in your environment.
