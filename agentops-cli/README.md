# agentops CLI

Small local utility for the Copilot CLI AgentOps for Azure scaffold.

## Commands

```bash
node src/index.js doctor --local-only
node src/index.js scan
node src/index.js import-jsonl ../tests/sample-otel/tool-failure.jsonl
node src/index.js validate-collector
node src/index.js validate-azure
```

`validate-azure` is intentionally a handoff reminder in v0.1. Run Azure validation before any deployment.
