# Architecture

Copilot CLI AgentOps for Azure is a local-first telemetry loop.

```text
Copilot CLI -> copilot-observe -> localhost OTel Collector -> Azure Monitor/App Insights/Log Analytics/Grafana -> Azure MCP/Grafana MCP -> telemetry-investigator -> patch proposal
```

The v0.1 implementation focuses on metadata-only telemetry and patch proposals. It does not capture prompts, responses, tool arguments, or file contents by default.
