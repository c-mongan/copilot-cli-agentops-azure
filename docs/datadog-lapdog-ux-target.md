# Datadog/Lapdog UX Target

This project uses Datadog LLM Observability and Lapdog as product inspiration, while keeping Azure-native storage and strict privacy defaults.

## Target Shape

- One Agent Run is one trace.
- The root span is `agentops.run`.
- Child spans tell the story: session, model call, tool call, MCP call, shell command, file edit, test run, policy decision, privacy signal, GitHub outcome, and eval.
- The UI starts broad, then drills into a single run without requiring KQL.

## Lapdog Features To Mirror

- Per-session replay.
- Prompt/tool/response transcript when content capture is explicitly enabled.
- Token, cache, and cost breakdown.
- Permission friction and denied/gated tools.
- Context pressure and cache leverage.
- Live status using metadata only.
- Local-first developer loop with clear running, idle, blocked, and failed states.

## Privacy Difference

Lapdog is local-first and can show prompts/responses in its browser view. AgentOps for Azure must stay strict by default:

- do not export raw prompts, responses, source, file contents, tool args, or tool results;
- export only hashes, counts, sizes, statuses, risk labels, and content-signal metadata;
- show “content observed and dropped” instead of the content.

## Datadog-Level Drilldown Contract

The V2 Grafana control room should preserve this path without requiring KQL:

```text
Home
  -> Runs Explorer
  -> Run Replay
  -> span/tool/model/privacy/GitHub/eval detail
  -> related dashboard filtered to the same run, model, tool, repo, skill, or sub-agent
```

Content follows the same contract, but only after opt-in:

```text
Run Replay
  -> Content posture panel
  -> Prompt/response viewer
  -> related privacy signals and trace spans
```

The prompt/response viewer must make the mode obvious:

- `strict metadata only`: no transcript rows are expected;
- `signal_only`: content-like fields were observed and dropped;
- `redacted`: redacted prompt/response rows may be inspected;
- `full`: local/dev-only full content rows may be inspected.

## Source Inspiration

- Datadog LLM Observability: traces, spans, input/output, latency, privacy issues, errors, operational metrics, evaluations, patterns, and insights.
- Datadog Lapdog: local agent on `localhost`, per-session traces with prompts/tool calls/responses, token/cost breakdown, permission friction, context/cache signals, and live agent status.
- Datadog Patterns/Insights: clustering and anomaly surfacing should map to AgentOps insights, eval regressions, config hash changes, model regressions, and MCP/tool regressions.
