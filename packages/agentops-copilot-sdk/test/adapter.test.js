const assert = require('node:assert/strict');
const test = require('node:test');

process.env.AGENTOPS_DISABLE_ORDERED_EXPORT = '1';

const {
  createAgentOpsClientOptions,
  createAgentOpsCopilotClient,
  createAgentOpsHooks,
  createAgentOpsSessionObserver,
  createOtlpJsonExporter,
  composeEventHandlers,
  composeHooks,
  safePromptMetadata,
  safeToolMetadata,
  createTelemetryConfig
} = require('../src');

function fakeSecretValue() {
  return ['ghp', '1234567890', '1234567890'].join('_');
}

test('client options force local OTLP and content capture off by default', () => {
  const events = [];
  const options = createAgentOpsClientOptions({ emit: event => events.push(event) });

  assert.equal(options.telemetry.otlpEndpoint, 'http://localhost:4318');
  assert.equal(options.telemetry.captureContent, false);
  assert.equal(options.telemetry.sourceName, 'agentops-copilot-sdk');
  assert.equal(options.agentops.privacyMode, 'strict');
  assert.equal(options.exporter, null);
  assert.equal(typeof options.onGetTraceContext().traceparent, 'string');
  assert.ok(options.hooks.onPreToolUse);
  assert.ok(options.createSessionConfig({}).hooks.onPreToolUse);
  assert.equal(options.createSessionConfig({}).streaming, true);
  assert.equal(options.createSessionConfig({ streaming: false }).streaming, false);
  assert.equal(typeof options.createSessionConfig({}).onEvent, 'function');
  assert.equal(options.createSessionConfig({}).onPermissionRequest, undefined);
  const permissionHandler = () => ({ kind: 'approve-once' });
  assert.equal(options.createSessionConfig({ onPermissionRequest: permissionHandler }).onPermissionRequest, permissionHandler);
});

test('instrumentation preserves host permission and tool-hook semantics', async () => {
  const errors = [];
  const options = createAgentOpsClientOptions({
    exportOrderedEvents: false,
    emit: () => { throw new Error('telemetry callback failed'); },
    onInstrumentationError: error => errors.push(error.message)
  });
  const config = options.createSessionConfig({});

  assert.equal(config.onPermissionRequest, undefined);
  assert.equal(await config.hooks.onPreToolUse({ toolName: 'shell', toolArgs: {} }), undefined);
  assert.deepEqual(errors, ['telemetry callback failed']);
});

test('instrumentation failures never suppress the host event handler', () => {
  const seen = [];
  const errors = [];
  const handler = composeEventHandlers(
    () => { throw new Error('observer failed'); },
    event => seen.push(event.type),
    error => errors.push(error.message)
  );

  handler({ type: 'assistant.message' });
  assert.deepEqual(seen, ['assistant.message']);
  assert.deepEqual(errors, ['observer failed']);
});

test('all modes fail closed when SDK content capture is requested', () => {
  assert.throws(() => createAgentOpsClientOptions({ privacyMode: 'strict', captureContent: true }), /must remain false/);
  assert.throws(() => createAgentOpsClientOptions({ privacyMode: 'compat', captureContent: true }), /must remain false/);
  assert.throws(() => createAgentOpsClientOptions({ telemetry: { captureContent: true } }), /must remain false/);
  assert.throws(() => createTelemetryConfig({ captureContent: true }), /must remain false/);
});

test('hooks emit safe prompt and tool metadata only', async () => {
  const events = [];
  const fakeSecret = fakeSecretValue();
  const hooks = createAgentOpsHooks({
    runId: 'run-sdk-test',
    sessionId: 'session-sdk-test',
    traceId: 'trace-sdk-test',
    emit: event => events.push(event)
  });

  await hooks.onUserPromptSubmitted({ prompt: 'SECRET_FAKE_TEST_VALUE please inspect code' });
  await hooks.onPreToolUse({ toolName: 'shell', toolArgs: { command: 'cat ~/.ssh/id_rsa' } });
  await hooks.onPostToolUse({ toolName: 'shell', toolResult: { output: 'api_key=SECRET_FAKE_TEST_VALUE' } });
  await hooks.onPostToolUseFailure({ toolName: 'shell', error: Object.assign(new Error(`credential=${fakeSecret}`), { code: 'E_TOOL' }) });
  await hooks.onSessionStart({});
  await hooks.onSessionEnd({});
  await hooks.onErrorOccurred({ error: new TypeError('boom') });

  assert.equal(events.length, 7);
  assert.equal(events[0].PromptHash.startsWith('prompt_'), true);
  assert.equal(events[1].ToolName, 'shell');
  assert.equal(events[2].ResultSizeBytes > 0, true);
  assert.equal(events[3].Status, 'failed');
  assert.equal(events[3].ErrorType, 'Error');
  assert.equal(events[6].ErrorType, 'TypeError');
  assert.doesNotMatch(JSON.stringify(events), /cat ~\/\.ssh|api_key=SECRET|please inspect code|ghp_123/);
  assert.equal(events.some(event => event.SecretLike === true), true);
  assert.equal(hooks.onError, undefined);
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
  assert.equal(typeof client.observeAgentOpsSession, 'function');
  assert.equal(typeof client.createAgentOpsSession, 'function');
});

test('client stop always stops Copilot before surfacing telemetry flush failure', async () => {
  const originalFetch = global.fetch;
  const previousDisable = process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
  const calls = [];
  delete process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
  global.fetch = async () => ({ ok: false, status: 503 });
  class FakeCopilotClient {
    async stop() {
      calls.push('copilot-stop');
      return 'stopped';
    }
  }
  try {
    const client = createAgentOpsCopilotClient(FakeCopilotClient, {
      otlpEndpoint: 'http://127.0.0.1:4318',
      maxAttempts: 1
    });
    client.agentopsHooks.onSessionStart({});

    await assert.rejects(client.stop(), /failed to export 1 telemetry request/);
    assert.deepEqual(calls, ['copilot-stop']);
  } finally {
    global.fetch = originalFetch;
    if (previousDisable === undefined) delete process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
    else process.env.AGENTOPS_DISABLE_ORDERED_EXPORT = previousDisable;
  }
});

test('trace callback keeps one W3C trace id and creates child span ids', () => {
  const options = createAgentOpsClientOptions({ traceId: 'agentops-shared-trace', exportOrderedEvents: false });
  const first = options.onGetTraceContext().traceparent.split('-');
  const second = options.onGetTraceContext().traceparent.split('-');
  assert.equal(first[1], second[1]);
  assert.notEqual(first[2], second[2]);
  assert.match(first[1], /^[a-f0-9]{32}$/);
  assert.match(first[2], /^[a-f0-9]{16}$/);
  const crypto = require('node:crypto');
  assert.equal(first[1], crypto.createHash('sha256').update('agentops-shared-trace').digest('hex').slice(0, 32));
});

test('session observer preserves order and attributes usage, subagents, skills, MCP and commands', () => {
  const events = [];
  const fakeSecret = fakeSecretValue();
  const observer = createAgentOpsSessionObserver({
    runId: 'run-stream',
    sessionId: 'session-stream',
    traceId: 'trace-stream',
    emit: event => events.push(event)
  });

  observer.observe({ id: 'one', timestamp: '2026-08-03T10:00:00.000Z', type: 'assistant.turn_start', data: {} });
  observer.observe({ id: 'two', parentId: 'one', timestamp: '2026-08-03T10:00:00.050Z', type: 'subagent.started', data: { agentName: 'test-reviewer', parentAgentName: 'main' } });
  observer.observe({ id: 'three', parentId: 'two', timestamp: '2026-08-03T10:00:00.100Z', type: 'skill.invoked', data: { name: 'qa', path: '/private/secret/qa/SKILL.md', content: 'SECRET_FAKE_TEST_VALUE' } });
  observer.observe({ id: 'four', parentId: 'two', timestamp: '2026-08-03T10:00:00.150Z', type: 'tool.execution_start', data: { toolCallId: 'tool-1', toolName: 'shell', mcpServerName: 'azure', mcpToolName: 'query', args: { command: `/usr/local/bin/az account show --auth ${fakeSecret}` } } });
  observer.observe({ id: 'five', parentId: 'four', timestamp: '2026-08-03T10:00:00.400Z', type: 'tool.execution_complete', data: { toolCallId: 'tool-1', toolName: 'shell', success: true, result: { output: 'sensitive result' } } });
  observer.observe({ id: 'six', timestamp: '2026-08-03T10:00:00.500Z', type: 'assistant.usage', data: { model: 'gpt-5.6-sol', inputTokens: 18729, outputTokens: 10, cost: 0.01, duration: 2329, apiEndpoint: 'copilot' } });

  assert.deepEqual(events.map(event => event.Sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(events[1].SubAgentName, 'test-reviewer');
  assert.equal(events[2].SkillName, 'qa');
  assert.equal(events[3].McpServerName, 'azure');
  assert.equal(events[3].McpToolName, 'query');
  assert.equal(events[3].CommandName, 'az');
  assert.equal(events[4].DurationMs, 250);
  assert.equal(events[5].ModelActual, 'gpt-5.6-sol');
  assert.equal(events[5].InputTokens, 18729);
  assert.equal(events[5].OutputTokens, 10);
  assert.equal(events[5].CopilotCost, 0.01);
  assert.equal(events[5].EstimatedCostUsd, 0);
  assert.equal(events[2].ContentAction, 'dropped');
  assert.equal(events[3].SecretLike, true);
  assert.doesNotMatch(JSON.stringify(events), /private\/secret|SECRET_FAKE|sensitive result|account show/);
});

test('session observer emits accounting totals only on the canonical assistant usage event', () => {
  const rows = [];
  const observer = createAgentOpsSessionObserver({ emit: row => rows.push(row) });
  observer.observe({ type: 'assistant.usage', data: { inputTokens: 100, outputTokens: 9, totalTokens: 109, cost: 0.2 } });
  observer.observe({ type: 'assistant.message', data: { outputTokens: 9, totalTokens: 109, cost: 0.2, content: 'not retained' } });

  assert.equal(rows[0].InputTokens, 100);
  assert.equal(rows[0].OutputTokens, 9);
  assert.equal(rows[1].InputTokens, 0);
  assert.equal(rows[1].OutputTokens, 0);
  assert.equal(rows[1].CopilotCost, 0);
  assert.equal(JSON.stringify(rows).includes('not retained'), false);
});

test('session observer attaches to official event names and detaches cleanly', () => {
  let handler;
  const detached = [];
  const session = {
    on(callback) {
      handler = callback;
      return () => detached.push('all');
    }
  };
  const events = [];
  const observer = createAgentOpsSessionObserver({ emit: event => events.push(event) });
  const detach = observer.attach(session);
  handler({ type: 'assistant.usage', data: { inputTokens: 42, totalPremiumRequests: 2, totalApiDurationMs: 900 } });
  handler({ type: 'session.shutdown', data: { totalPremiumRequests: 2, totalApiDurationMs: 900 } });

  assert.equal(events[0].InputTokens, 42);
  assert.equal(events[1].EventName, 'session.shutdown');
  assert.equal(events[0].PremiumRequests, 2);
  assert.equal(events[0].ApiDurationMs, 900);
  assert.equal(events[1].PremiumRequests, 0);
  detach();
  assert.deepEqual(detached, ['all']);
});

test('session observer keeps permission decisions and context hashes without sensitive values', () => {
  const events = [];
  const fakeSecret = fakeSecretValue();
  const observer = createAgentOpsSessionObserver({ emit: event => events.push(event) });
  observer.observe({ id: 'permission-a', type: 'permission.requested', data: {
    requestId: 'request-a',
    permissionRequest: {
      kind: 'mcp',
      serverName: 'github',
      toolName: 'create_pull_request',
      args: { credential: fakeSecret }
    }
  } });
  observer.observe({ id: 'permission-b', type: 'permission.completed', data: {
    requestId: 'request-a',
    result: { kind: 'denied-by-rules' }
  } });
  observer.observe({ id: 'context-a', type: 'session.context_changed', data: {
    cwd: '/workspace/example/customer-repo',
    repository: 'private-org/private-repo',
    branch: 'secret-feature'
  } });

  assert.equal(events[0].PermissionKind, 'mcp');
  assert.equal(events[0].McpServerName, 'github');
  assert.equal(events[0].ToolName, 'create_pull_request');
  assert.equal(events[0].ContentCaptureSignal, true);
  assert.equal(events[1].PermissionDecision, 'denied-by-rules');
  assert.match(events[2].RepoHash, /^repo_/);
  assert.match(events[2].BranchHash, /^branch_/);
  assert.match(events[2].WorkingDirectoryHash, /^cwd_/);
  assert.doesNotMatch(JSON.stringify(events), /ghp_|customer-repo|private-org|secret-feature/);
});

test('createAgentOpsSession composes hooks and automatically attaches streaming observer', async () => {
  class FakeCopilotClient {
    constructor(options) { this.options = options; }
    async createSession(config) {
      this.lastConfig = config;
      config.onEvent({ type: 'session.idle', data: {} });
      return { on: () => () => {} };
    }
  }
  const client = createAgentOpsCopilotClient(FakeCopilotClient);
  const session = await client.createAgentOpsSession({ hooks: { onSessionStart: async () => null } });
  assert.ok(session);
  assert.equal(typeof client.lastConfig.hooks.onErrorOccurred, 'function');
  assert.equal(typeof client.lastConfig.onEvent, 'function');
});

test('concurrent SDK sessions have independent identities and event sequences', async () => {
  const events = [];
  class FakeCopilotClient {
    constructor() { this.configs = []; }
    async createSession(config) {
      this.configs.push(config);
      return { on: () => () => {} };
    }
  }
  const client = createAgentOpsCopilotClient(FakeCopilotClient, {
    runId: 'shared-run',
    emit: event => events.push(event),
    exportOrderedEvents: false
  });
  await Promise.all([client.createAgentOpsSession({}), client.createAgentOpsSession({})]);
  client.configs[0].onEvent({ id: 'event-a', type: 'session.start', data: {} });
  client.configs[1].onEvent({ id: 'event-b', type: 'session.start', data: {} });

  assert.equal(events.length, 2);
  assert.notEqual(events[0].SessionId, events[1].SessionId);
  assert.notEqual(events[0].TraceId, events[1].TraceId);
  assert.deepEqual(events.map(event => event.Sequence), [1, 1]);
});

test('early onEvent observer runs before the application handler', () => {
  const calls = [];
  const handler = composeEventHandlers(
    () => calls.push('agentops'),
    () => calls.push('application')
  );
  handler({ type: 'session.idle', data: {} });
  assert.deepEqual(calls, ['agentops', 'application']);
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

test('ordered event exporter sends allowlisted OTLP JSON and flushes', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true };
  };
  try {
    const exporter = createOtlpJsonExporter({ otlpEndpoint: 'http://127.0.0.1:4318' });
    exporter.emit({
      TimeGenerated: '2026-08-03T10:00:00.000Z',
      Sequence: 7,
      EventId: 'event-seven',
      ParentEventId: 'event-six',
      RunId: 'run-safe',
      SessionId: 'session-safe',
      TraceId: 'trace-safe',
      EventName: 'skill.invoked',
      SkillName: 'qa',
      content: 'SECRET_FAKE_TEST_VALUE'
    });
    await exporter.flush();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:4318/v1/traces');
    const payload = JSON.parse(requests[0].init.body);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    assert.match(span.traceId, /^[a-f0-9]{32}$/);
    assert.match(span.spanId, /^[a-f0-9]{16}$/);
    assert.match(span.parentSpanId, /^[a-f0-9]{16}$/);
    assert.equal(span.startTimeUnixNano, span.endTimeUnixNano);
    assert.equal(span.attributes.find(item => item.key === 'agentops.event.sequence').value.intValue, '7');
    assert.equal(span.attributes.find(item => item.key === 'gen_ai.conversation.id').value.stringValue, 'session-safe');
    assert.doesNotMatch(requests[0].init.body, /SECRET_FAKE_TEST_VALUE|\"content\"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ordered event exporter rejects insecure non-loopback HTTP', () => {
  assert.throws(
    () => createOtlpJsonExporter({ otlpEndpoint: 'http://telemetry.example.test:4318' }),
    /requires HTTPS or a loopback HTTP endpoint/
  );
  assert.equal(
    createOtlpJsonExporter({ otlpEndpoint: 'https://telemetry.example.test/v1/traces' }).endpoint,
    'https://telemetry.example.test/v1/traces'
  );
});

test('ordered event exporter surfaces delivery failures when flushed', async () => {
  const originalFetch = global.fetch;
  const observed = [];
  global.fetch = async () => ({ ok: false, status: 503 });
  try {
    const exporter = createOtlpJsonExporter({
      otlpEndpoint: 'http://127.0.0.1:4318',
      maxAttempts: 1,
      onError: error => observed.push(error.message)
    });
    exporter.emit({ EventName: 'session.start', RunId: 'run-failure', EventId: 'event-failure' });

    await assert.rejects(exporter.flush(), /failed to export 1 telemetry request/);
    assert.deepEqual(observed, ['AgentOps OTLP export failed with HTTP 503']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ordered event exporter retries transient failures before reporting success', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => ({ ok: ++calls >= 3, status: 503 });
  try {
    const exporter = createOtlpJsonExporter({
      otlpEndpoint: 'http://127.0.0.1:4318',
      maxAttempts: 3,
      retryDelayMs: 0
    });
    exporter.emit({ EventName: 'session.start', RunId: 'run-retry', EventId: 'event-retry' });

    await exporter.flush();
    assert.equal(calls, 3);
    const status = exporter.deliveryStatus();
    assert.equal(status.queuedInMemory, 1);
    assert.equal(status.retryAttempts, 2);
    assert.equal(status.collectorAccepted, 1);
    assert.equal(status.pendingInMemory, 0);
    assert.equal(status.lastCollectorAcceptedAt !== null, true);
    for (const misleadingLegacyName of ['accepted', 'sent', 'retried', 'failed', 'pending', 'overflowed', 'lastSuccessAt']) {
      assert.equal(Object.hasOwn(status, misleadingLegacyName), false);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('ordered event exporter bounds its in-memory queue and reports overflow', async () => {
  const originalFetch = global.fetch;
  let release;
  global.fetch = () => new Promise(resolve => { release = () => resolve({ ok: true }); });
  try {
    const exporter = createOtlpJsonExporter({
      otlpEndpoint: 'http://127.0.0.1:4318',
      maxPendingEvents: 1
    });
    exporter.emit({ EventName: 'session.start', RunId: 'run-cap', EventId: 'event-one' });
    exporter.emit({ EventName: 'session.idle', RunId: 'run-cap', EventId: 'event-two' });
    assert.equal(exporter.deliveryStatus().pendingInMemory, 1);
    assert.equal(exporter.deliveryStatus().queueOverflowed, 1);
    release();
    await assert.rejects(exporter.flush(), /failed to export 1 telemetry request/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('hook and session events share one normalized ordered envelope and complete OTLP fields', async () => {
  const originalFetch = global.fetch;
  const previousDisable = process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
  const requests = [];
  delete process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
  global.fetch = async (url, init) => {
    requests.push({ url, body: init.body });
    return { ok: true };
  };

  try {
    const local = [];
    const options = createAgentOpsClientOptions({
      runId: 'run-realistic',
      sessionId: 'session-realistic',
      traceId: 'trace-realistic',
      usdPerCostUnit: 2,
      emit: event => local.push(event)
    });
    const config = options.createSessionConfig({});
    await config.hooks.onUserPromptSubmitted({ prompt: 'SECRET_POISON prompt body' });
    config.onEvent({
      id: 'subagent-one',
      type: 'subagent.started',
      data: { agentName: 'reviewer', parentAgentName: 'orchestrator' }
    });
    config.onEvent({
      id: 'skill-one',
      parentId: 'subagent-one',
      type: 'skill.invoked',
      data: { name: 'qa', content: 'SECRET_POISON skill body' }
    });
    config.onEvent({
      id: 'tool-one',
      parentId: 'subagent-one',
      type: 'tool.execution_start',
      data: {
        toolCallId: 'tool-one',
        toolName: 'shell',
        mcpServerName: 'azure',
        mcpToolName: 'monitor_query',
        args: { command: 'node /private/customer/check-results.js --token SECRET_POISON' }
      }
    });
    config.onEvent({
      id: 'tool-two',
      parentId: 'tool-one',
      type: 'tool.execution_complete',
      timestamp: new Date(Date.now() + 25).toISOString(),
      data: { toolCallId: 'tool-one', toolName: 'shell', success: true, result: 'SECRET_POISON result' }
    });
    config.onEvent({
      id: 'usage-one',
      type: 'assistant.usage',
      data: {
        model: 'gpt-test', inputTokens: 100, outputTokens: 20, reasoningTokens: 5,
        cacheReadTokens: 7, cacheWriteTokens: 3, totalTokens: 135, totalToolCalls: 1,
        cost: 0.25, durationMs: 42, totalPremiumRequests: 2, totalNanoAiu: 900,
        totalApiDurationMs: 41,
        codeChanges: { linesAdded: 8, linesRemoved: 2, filesModified: 1 },
        repository: 'private/customer', branch: 'secret-branch', cwd: '/private/customer'
      }
    });
    config.onEvent({
      id: 'permission-one',
      type: 'permission.completed',
      data: { requestId: 'request-one', permissionDecision: 'denied-by-rules' }
    });
    await options.flush();

    assert.deepEqual(local.map(event => event.Sequence), [1, 2, 3, 4, 5, 6, 7]);
    assert.ok(local.every(event => event.SchemaVersion === '2' && event.EventId));
    assert.equal(local[0].EventName, 'agentops.prompt.submitted');
    assert.equal(local[3].CommandName, 'node');
    assert.equal(local[3].ScriptName, 'check-results.js');
    assert.equal(local[5].EstimatedCostUsd, 0.5);
    assert.equal(local[6].PermissionDecision, 'denied-by-rules');

    const wire = requests.map(request => {
      const span = JSON.parse(request.body).resourceSpans[0].scopeSpans[0].spans[0];
      return Object.fromEntries(span.attributes.map(item => {
        const value = Object.values(item.value)[0];
        return [item.key, value];
      }));
    });
    assert.deepEqual(wire.map(attrs => Number(attrs['agentops.event.sequence'])), local.map(event => event.Sequence));
    assert.deepEqual(wire.map(attrs => attrs['agentops.custom_event_id']), local.map(event => event.EventId));
    const toolChildSpan = JSON.parse(requests[3].body).resourceSpans[0].scopeSpans[0].spans[0];
    assert.match(toolChildSpan.parentSpanId, /^[a-f0-9]{16}$/);
    const usage = wire[5];
    assert.equal(Number(usage['gen_ai.usage.reasoning.output_tokens']), 5);
    assert.equal(Number(usage['gen_ai.usage.total_tokens']), 135);
    assert.equal(Number(usage['agentops.tools.count']), 1);
    assert.equal(Number(usage['agentops.cost.estimated_usd']), 0.5);
    assert.equal(Number(usage['github.copilot.premium_requests']), 2);
    assert.equal(Number(usage['github.copilot.aiu.nano']), 900);
    assert.equal(Number(usage['agentops.api.duration_ms']), 41);
    assert.equal(Number(usage['agentops.lines.added']), 8);
    assert.equal(Number(usage['agentops.lines.removed']), 2);
    assert.equal(Number(usage['agentops.files.edited_count']), 1);
    assert.match(usage['agentops.repo.hash'], /^repo_/);
    assert.match(usage['agentops.branch.hash'], /^branch_/);
    assert.match(usage['agentops.workspace.hash'], /^cwd_/);
    assert.equal(wire[6]['agentops.permission.decision'], 'denied-by-rules');
    assert.equal(wire[2]['agentops.content.action'], 'dropped');
    assert.ok(requests.every(request => !/SECRET_POISON|private\/customer|secret-branch/.test(request.body)));
  } finally {
    global.fetch = originalFetch;
    if (previousDisable === undefined) delete process.env.AGENTOPS_DISABLE_ORDERED_EXPORT;
    else process.env.AGENTOPS_DISABLE_ORDERED_EXPORT = previousDisable;
  }
});

test('script identity recognizes interpreter and package-run invocations without retaining paths or arguments', () => {
  const events = [];
  const observer = createAgentOpsSessionObserver({ emit: event => events.push(event) });
  observer.observe({ type: 'tool.execution_start', data: { toolCallId: 'a', args: { command: 'python3 /private/jobs/check.py --secret value' } } });
  observer.observe({ type: 'tool.execution_start', data: { toolCallId: 'b', args: { command: 'npm run test:unit -- --watch=false' } } });

  assert.equal(events[0].CommandName, 'python3');
  assert.equal(events[0].ScriptName, 'check.py');
  assert.equal(events[1].CommandName, 'npm');
  assert.equal(events[1].ScriptName, 'npm:run:test:unit');
  assert.doesNotMatch(JSON.stringify(events), /private\/jobs|--secret|watch=false/);
});
