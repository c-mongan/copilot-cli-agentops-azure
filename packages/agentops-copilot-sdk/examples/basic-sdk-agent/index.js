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
        return { dryRun: true, config };
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
  const session = await client.createSession(client.createAgentOpsSessionConfig());
  console.log(`created session: ${Boolean(session)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
