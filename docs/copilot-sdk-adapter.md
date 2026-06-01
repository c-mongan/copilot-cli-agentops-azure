# Copilot SDK Adapter

`@agentops/copilot-sdk` gives Copilot SDK apps the same AgentOps defaults as the CLI wrapper:

- local OTLP endpoint: `http://localhost:4318`;
- `captureContent=false`;
- source name: `agentops-copilot-sdk`;
- W3C trace context callback;
- safe hook telemetry for prompt, tool, session, and error events.

It does not store prompts, model responses, tool arguments, or tool results in strict mode.

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
    // Write to a local JSONL file, custom exporter, or test harness.
    console.log(JSON.stringify(event));
  }
});

const session = await client.createSession(
  client.createAgentOpsSessionConfig({
    hooks: {
      // Your app hooks can still be added here.
    }
  })
);
```

## Hook Mapping

- `onUserPromptSubmitted` -> `agentops.prompt.submitted`, prompt hash and size only.
- `onPreToolUse` -> `agentops.policy.decision`, tool name, args schema hash, args size.
- `onPostToolUse` -> `agentops.tool.result`, result size only.
- `onSessionStart` -> `agentops.session.start`.
- `onSessionEnd` -> `agentops.session.end`.
- `onError` -> `agentops.error`.

The adapter passes through user-provided hooks after emitting safe metadata.

## Docs Alignment

GitHub's Copilot SDK docs describe `TelemetryConfig` options including `otlpEndpoint`, `sourceName`, `captureContent`, and Node.js `onGetTraceContext` for W3C trace propagation. The hook overview documents pre/post tool, prompt, session lifecycle, and error hooks.

## Verify

```bash
npm --prefix packages/agentops-copilot-sdk test
```
