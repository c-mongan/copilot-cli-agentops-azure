# CLI-first flight recorder

For the product roadmap, low-friction setup contract, and script tracing acceptance checks, see the [Copilot agent observability plan](plans/2026-09-29-copilot-agentops-observability.md).

This is the first usable slice of the broader [requirements](requirements/full-agent-observability-requirements.md). It combines Copilot CLI's native session events with exact-session native OpenTelemetry spans from local Collector receipts to build a timed waterfall. The Azure route continues to use the existing Collector and optional `AgentOpsContent_CL` path.

## Inspect one synthetic run

```bash
node agentops-cli/src/index.js copilot-session view <session-id> \
  --output /path/to/synthetic-run.html --allow-content
```

The command reads the local `native-receipt.jsonl` and `native-azure-receipt.jsonl` files when present, or accepts `--otel-file <native-receipt.jsonl>` for a specific Collector receipt. It matches spans only when `gen_ai.conversation.id` or `agentops.session.id` exactly equals the selected Copilot session ID. The page reports the count of matched spans and exact tool-call ID joins; zero means OTel coverage was not observed. The receipt is local, and this command does not upload anything.

[GitHub's Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) defines `gen_ai.conversation.id` as the session identifier and documents its native OTel model/tool spans. The local receipt format is Collector OTLP JSONL; this view does not directly query Azure traces.

The output is a self-contained local HTML file created with owner-only permissions. The command refuses to overwrite an existing file. It opens with a failure detail panel: captured error, previous user message, tool arguments, and links to the full event, preceding assistant message, and exact matching native span when available. "Failure signals" can count the same operation twice when both the session event and native span report it; the panel does not infer a root cause. A no-failure result means only that no failure signal was observed in the available evidence.

The end-to-end timeline shows elapsed position and duration for model turns, tools, hooks, and matched native OTel spans. Overlap is visible. Filters show all events, failures, tools, or native spans. Click a row to see its source and full fields, including prompt and tool payloads from the session file. Tool completions without names are paired to starts through `toolCallId`; missing starts are marked.

The current waterfall joins native OTel and session events by the exact Copilot session ID; tool spans may additionally join by exact call ID. It does not infer a link from timestamp proximity. Full parent/child trace-tree rendering, subagent intervals, static architecture references, causality across processes, and a run list are not yet complete. This is a working first detailed view, not an enterprise-ready observability claim.

Microsoft now documents an [Application Insights Agents view](https://learn.microsoft.com/en-us/azure/azure-monitor/app/agents-view) and [prebuilt Copilot/Codex dashboards](https://learn.microsoft.com/en-us/azure/managed-grafana/grafana-opentelemetry-app-insights). Use those for fleet operations, tokens, latency, and error triage. The product's custom view should focus on the rich single-run evidence and correlation that the native summaries do not yet prove for this Copilot CLI path. See the [link assessment](research/2026-09-29/new-azure-observability-links.md).

## Rich synthetic EVAL content in Azure

The user chose to test rich cloud content with synthetic agents and fixtures. The [synthetic EVAL Azure path](synthetic-eval-azure.md) now has a content producer, content-only validation/upload plan, and isolated Bicep template. The default strict Collector drops prompt, tool argument, and result content, so simply switching on the native Copilot OTel content flag would **not** make rich content reach Azure.

Cloud uploads cannot be undone by changing future redaction settings. Keep STANDARD as a separately verified metadata policy; mark EVAL/FORENSIC runs and their content explicitly. Development here uses synthetic/public content only. The [deployment plan](../.azure/deployment-plan.md) records the existing Azure resources and the template migration risk before any upload.

## MCP setup for repo users

- GitHub Copilot CLI: [`.github/mcp.json`](../.github/mcp.json) defines read-only Azure Monitor, Microsoft Learn, and Context7 for trusted repository sessions. The Azure Monitor server exposes Log Analytics KQL tools; no Azure Data Explorer cluster is required.
- Codex: [`.codex/config.toml`](../.codex/config.toml) defines the same servers for trusted project sessions.
- Context7 uses its OAuth endpoint; a client may request a browser sign-in on first use. No API key is committed.
- Always target Visual Studio Enterprise subscription `0222a208-955a-45fd-b6d8-ca4704421bf0` in Azure queries. The machine's current default subscription is Pay-As-You-Go.

The MCP files have valid JSON/TOML syntax. Active project loading and authenticated tool calls still need a fresh Copilot/Codex session verification; current global MCP listings alone do not prove project loading.
