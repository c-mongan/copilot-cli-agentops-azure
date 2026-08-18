const { createAgentOpsCopilotClient } = require('../../src');

function loadCopilotClient() {
  try {
    return require('@github/copilot-sdk').CopilotClient;
  } catch {
    return class DryRunCopilotClient {
      constructor(options) {
        this.options = options;
      }

      async createSession(config) {
        return { dryRun: true, config, on: () => () => {} };
      }
    };
  }
}

const CopilotClient = loadCopilotClient();
const client = createAgentOpsCopilotClient(CopilotClient, {
  serviceName: 'basic-sdk-agent',
  otlpEndpoint: 'http://localhost:4318',
  privacyMode: 'strict',
  captureContent: false,
  emit: event => {
    console.log(JSON.stringify(event));
  }
});

async function main() {
  // One call composes privacy hooks, enables streaming, and attaches the
  // ordered metadata-only session observer.
  const session = await client.createAgentOpsSession();
  try {
    console.log(`created session: ${Boolean(session)}`);
  } finally {
    if (typeof session?.destroy === 'function') await session.destroy();
    if (typeof client.stop === 'function') await client.stop();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
