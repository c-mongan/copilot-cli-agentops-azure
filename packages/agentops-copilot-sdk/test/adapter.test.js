const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAgentOpsClientOptions,
  createAgentOpsCopilotClient,
  createAgentOpsHooks,
  composeHooks,
  safePromptMetadata,
  safeToolMetadata
} = require('../src');

test('client options force local OTLP and content capture off by default', () => {
  const events = [];
  const options = createAgentOpsClientOptions({ emit: event => events.push(event) });

  assert.equal(options.telemetry.otlpEndpoint, 'http://localhost:4318');
  assert.equal(options.telemetry.captureContent, false);
  assert.equal(options.telemetry.sourceName, 'agentops-copilot-sdk');
  assert.equal(options.agentops.privacyMode, 'strict');
  assert.equal(typeof options.onGetTraceContext().traceparent, 'string');
  assert.ok(options.hooks.onPreToolUse);
  assert.ok(options.createSessionConfig({}).hooks.onPreToolUse);
});

test('strict mode rejects content capture', () => {
  assert.throws(() => createAgentOpsClientOptions({ privacyMode: 'strict', captureContent: true }), /captureContent=false/);
});

test('hooks emit safe prompt and tool metadata only', async () => {
  const events = [];
  const hooks = createAgentOpsHooks({
    runId: 'run-sdk-test',
    sessionId: 'session-sdk-test',
    traceId: 'trace-sdk-test',
    emit: event => events.push(event)
  });

  await hooks.onUserPromptSubmitted({ prompt: 'SECRET_FAKE_TEST_VALUE please inspect code' });
  await hooks.onPreToolUse({ toolName: 'shell', toolArgs: { command: 'cat ~/.ssh/id_rsa' } });
  await hooks.onPostToolUse({ toolName: 'shell', toolResult: { output: 'api_key=SECRET_FAKE_TEST_VALUE' } });
  await hooks.onSessionStart({});
  await hooks.onSessionEnd({});
  await hooks.onError({ error: new TypeError('boom') });

  assert.equal(events.length, 6);
  assert.equal(events[0].PromptHash.startsWith('prompt_'), true);
  assert.equal(events[1].ToolName, 'shell');
  assert.equal(events[2].ResultSizeBytes > 0, true);
  assert.equal(events[5].ErrorType, 'TypeError');
  assert.doesNotMatch(JSON.stringify(events), /cat ~\/\.ssh|api_key=SECRET|please inspect code/);
  assert.equal(events.some(event => event.SecretLike === true), true);
});

test('factory passes AgentOps options to a CopilotClient constructor', () => {
  class FakeCopilotClient {
    constructor(options) {
      this.options = options;
    }
  }

  const client = createAgentOpsCopilotClient(FakeCopilotClient, {
    otlpEndpoint: 'http://127.0.0.1:4318',
    sourceName: 'custom-sdk-agent'
  });

  assert.equal(client.options.telemetry.otlpEndpoint, 'http://127.0.0.1:4318');
  assert.equal(client.options.telemetry.sourceName, 'custom-sdk-agent');
  assert.equal(client.options.telemetry.captureContent, false);
  assert.ok(client.agentopsHooks.onPreToolUse);
  assert.ok(client.createAgentOpsSessionConfig({}).hooks.onSessionStart);
});

test('session hooks compose with AgentOps hooks instead of replacing telemetry', async () => {
  const events = [];
  const options = createAgentOpsClientOptions({
    runId: 'run-compose-test',
    sessionId: 'session-compose-test',
    traceId: 'trace-compose-test',
    emit: event => events.push(event)
  });
  const sessionConfig = options.createSessionConfig({
    hooks: {
      onUserPromptSubmitted: async () => ({ userHook: true }),
      onPreToolUse: async () => ({ permissionDecision: 'deny', reason: 'user policy' })
    }
  });

  const promptResult = await sessionConfig.hooks.onUserPromptSubmitted({ prompt: 'hello from user hook' });
  const policyResult = await sessionConfig.hooks.onPreToolUse({ toolName: 'shell', toolArgs: { command: 'pwd' } });

  assert.deepEqual(promptResult, { userHook: true });
  assert.deepEqual(policyResult, { permissionDecision: 'deny', reason: 'user policy' });
  assert.equal(events.length, 2);
  assert.equal(events[0].EventName, 'agentops.prompt.submitted');
  assert.equal(events[1].EventName, 'agentops.policy.decision');
  assert.doesNotMatch(JSON.stringify(events), /hello from user hook|pwd/);
});

test('composeHooks keeps AgentOps result when user hook has no return value', async () => {
  const calls = [];
  const hooks = composeHooks({
    onPreToolUse: async () => {
      calls.push('agentops');
      return { permissionDecision: 'allow' };
    }
  }, {
    onPreToolUse: async () => {
      calls.push('user');
    }
  });

  const result = await hooks.onPreToolUse({});
  assert.deepEqual(calls, ['agentops', 'user']);
  assert.deepEqual(result, { permissionDecision: 'allow' });
});

test('metadata helpers hash content and report sizes', () => {
  const prompt = safePromptMetadata({ prompt: 'hello world' });
  const tool = safeToolMetadata({ toolName: 'read_file', toolArgs: { path: 'demo' }, toolResult: { ok: true } });
  assert.equal(prompt.promptHash.startsWith('prompt_'), true);
  assert.equal(prompt.promptSizeBytes, 11);
  assert.equal(tool.toolName, 'read_file');
  assert.equal(tool.argsSchemaHash.startsWith('schema_'), true);
});
