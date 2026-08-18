const { CopilotClient } = require('@github/copilot-sdk');
const { createAgentOpsCopilotClient } = require('../../src');

const events = [];
const runId = process.env.AGENTOPS_SDK_SMOKE_RUN_ID || `sdk_live_${Date.now()}`;
const sessionId = process.env.AGENTOPS_SDK_SMOKE_SESSION_ID || `${runId}_session`;

const client = createAgentOpsCopilotClient(CopilotClient, {
  runId,
  sessionId,
  serviceName: 'agentops-sdk-live-smoke',
  otlpEndpoint: process.env.AGENTOPS_OTLP_ENDPOINT || 'http://127.0.0.1:4318',
  privacyMode: 'strict',
  captureContent: false,
  emit: event => events.push(event)
});

async function main() {
  const session = await client.createAgentOpsSession({ model: 'auto', streaming: true });
  try {
    await session.sendAndWait({
      prompt: 'Reply with exactly SDK_OBSERVABILITY_OK. Do not call tools or modify anything.'
    }, 120000);
  } finally {
    if (typeof session.destroy === 'function') await session.destroy();
    await client.stop();
  }

  const eventNames = [...new Set(events.map(event => event.EventName).filter(Boolean))];
  process.stdout.write(`${JSON.stringify({
    ok: events.length > 0,
    run_id: runId,
    session_id: sessionId,
    privacy_mode: 'strict',
    content_capture: false,
    ordered_events: events.length,
    first_sequence: events.at(0)?.Sequence || null,
    last_sequence: events.at(-1)?.Sequence || null,
    event_names: eventNames
  }, null, 2)}\n`);
  if (!events.length) process.exitCode = 1;
}

main().catch(async error => {
  await client.stop().catch(() => {});
  process.stderr.write(`SDK metadata smoke failed: ${error.message}\n`);
  process.exitCode = 1;
});
