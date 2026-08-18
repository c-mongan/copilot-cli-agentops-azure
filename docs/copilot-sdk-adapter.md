# Copilot SDK Adapter

`@agentops/copilot-sdk` gives Copilot SDK apps the same AgentOps defaults as the CLI wrapper:

- local OTLP endpoint: `http://localhost:4318`;
- `captureContent=false`;
- source name: `agentops-copilot-sdk`;
- W3C trace context callback;
- safe hook telemetry for prompt, tool, session, and error events;
- an ordered session-event observer for model, token, cost, custom-agent,
  subagent, skill, MCP, tool, command, permission, compaction, and outcome data;
- automatic privacy-safe OTLP/JSON export of those ordered events through the
  same localhost collector, with bounded transient retries and explicit flush
  after the underlying `client.stop()` completes.

It does not store prompts, model responses, tool arguments, or tool results in strict mode.
`captureContent=true` is rejected in every mode because upstream SDK content
export would occur before this adapter could safely redact it.

## Usage

```js
const { CopilotClient } = require('@github/copilot-sdk');
const { createAgentOpsCopilotClient } = require('@agentops/copilot-sdk');

const client = createAgentOpsCopilotClient(CopilotClient, {
  serviceName: 'my-copilot-agent',
  otlpEndpoint: 'http://localhost:4318',
  privacyMode: 'strict',
  captureContent: false,
  emit: event => {
    // Optional: receive the same safe event locally too.
    console.log(JSON.stringify(event));
  }
});

const session = await client.createAgentOpsSession({
  hooks: {
    // Your app hooks can still be added here.
  }
});

try {
  // Use the session normally.
} finally {
  await session.destroy();
  await client.stop(); // stops Copilot, then verifies AgentOps OTLP delivery
}
```

`createAgentOpsSession()` enables SDK streaming by default, composes your hooks,
and registers the observer through the SDK's early `onEvent` configuration so
session-start events cannot race session creation. Use
`client.resumeAgentOpsSession(id, config)` for the same behavior on resume. If
your application receives a session through another path, call
`client.observeAgentOpsSession(session)` and retain the returned detach function.
The ordered exporter is on by default. Set `exportOrderedEvents: false` only
when the host supplies and flushes its own event sink. Non-loopback HTTP
endpoints are rejected; remote collectors must use HTTPS.
The exporter retries network failures plus HTTP 408, 429, and 5xx responses up
to three times by default. Final delivery failures reject `flush()`/`stop()` and
may also be observed with `onExportError`; they are never reported as success.
Retries are in memory and target the local collector. Restart-safe downstream
delivery remains the collector's responsibility.
The queue is bounded to 1,000 pending metadata events by default; override it
with `maxPendingEvents` up to 10,000. Overflow is counted, reported through
`onExportError`, and makes the next flush fail. Inspect
`client.agentopsDeliveryStatus()` for accepted, sent, retried, failed, pending,
overflowed, and last-success evidence.
Test runners can set `AGENTOPS_DISABLE_ORDERED_EXPORT=1` so unit fixtures never
pollute a developer's running collector or Azure workspace.

Each exported row has a deterministic `Sequence`, hashed `EventId` and
`ParentEventId`, and safe attribution fields. Prompts, assistant messages,
reasoning, tool arguments/results, command arguments, repository paths, session
titles, summaries, and error text are measured and dropped. Repository, branch,
and working-directory values are represented only by stable hashes.
When the SDK supplies `ParentEventId`, the exporter also emits a deterministic
OTLP `parentSpanId`; the original safe parent event ID remains available for
ordered evidence.
Instant lifecycle facts use zero-duration spans; only events with measured
duration contribute latency. The W3C trace ID supplied to Copilot and the
ordered-event exporter are derived from the same trace seed.

`assistant.usage.data.cost` is emitted as `CopilotCost`, because the SDK defines
it as a billing/model cost unit rather than USD. `EstimatedCostUsd` remains zero
unless the caller explicitly supplies a reviewed `usdPerCostUnit` conversion.

## Hook Mapping

- `onUserPromptSubmitted` -> `agentops.prompt.submitted`, prompt hash and size only.
- `onPreToolUse` -> `agentops.policy.decision`, tool name, args schema hash, args size.
- `onPostToolUse` -> `agentops.tool.result`, result size only.
- `onPostToolUseFailure` -> failed `agentops.tool.result`, error type and size only.
- `onSessionStart` -> `agentops.session.start`.
- `onSessionEnd` -> `agentops.session.end`.
- `onErrorOccurred` -> `agentops.error`.

The session observer subscribes once to the complete event stream, so it also
records new SDK event types without retaining their payloads. Known event fields
provide safe attribution for subagents, skills, MCP tools, model usage, token
usage, permissions, and lifecycle timings.

The adapter passes through user-provided hooks after emitting safe metadata.
It does not add an allow or deny decision when the application has no policy
handler. Instrumentation callback failures are reported separately and do not
suppress the application's event or hook handler. Concurrent sessions receive
independent conversation IDs, trace IDs, sequences, and lifecycle state.

## Docs Alignment

GitHub's Copilot SDK docs describe `TelemetryConfig` options including
`otlpEndpoint`, `sourceName`, `captureContent`, and Node.js
`onGetTraceContext` for W3C trace propagation. The hook overview documents
pre/post tool, prompt, session lifecycle, and `onErrorOccurred` hooks. Streaming
session events are currently public preview; this adapter isolates that evolving
surface behind `createAgentOpsSessionObserver()`.

## Verify

```bash
npm --prefix packages/agentops-copilot-sdk test
npm --prefix packages/agentops-copilot-sdk run publish:check -- --json
```

For live proof, start the strict collector, run the example with the official
SDK installed, call `agentops latest --last 15m --json`, and confirm the SDK
session is sourced from Azure with no content-capture warning.

## Publish Readiness

Before publishing the adapter package, run the publish check. It validates package metadata, rejects wildcard Copilot SDK peer dependencies, and inspects `npm pack --dry-run --json` so the package contains only the intended source, type definitions, examples, and package metadata.

The `@github/copilot-sdk` peer dependency is optional but intentionally version-bounded. Do not publish with `*`, `latest`, or another open-ended peer range.
