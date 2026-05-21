# agentops CLI

Small local utility for the Copilot CLI AgentOps for Azure scaffold.

## Commands

```bash
node src/index.js doctor --local-only
node src/index.js scan
node src/index.js import-jsonl ../tests/sample-otel/tool-failure.jsonl
node src/index.js validate-collector
node src/index.js validate-azure
node src/index.js link session <conversation>
node src/index.js link trace <operationId>
node src/index.js fields --last 7d
```

`validate-azure` is intentionally a handoff reminder in v0.1. Run Azure validation before any deployment.

`link` prints a Grafana URL plus the raw Azure Log Analytics KQL for a session or trace.

`fields` prints a field-catalog KQL query that discovers observed `Properties` keys and example values from recent Copilot CLI spans.
