const { createAgentOpsHooks } = require('./hooks');
const { createTelemetryConfig, createTraceContextCallback } = require('./otel');
const { stableHash } = require('./privacy');

function composeHooks(agentOpsHooks = {}, userHooks = {}) {
  const composed = {};
  const names = new Set([...Object.keys(agentOpsHooks), ...Object.keys(userHooks)]);
  for (const name of names) {
    const agentOpsHook = agentOpsHooks[name];
    const userHook = userHooks[name];
    if (typeof agentOpsHook === 'function' && typeof userHook === 'function') {
      composed[name] = async (...args) => {
        const agentOpsResult = await agentOpsHook(...args);
        const userResult = await userHook(...args);
        return userResult === undefined ? agentOpsResult : userResult;
      };
    } else {
      composed[name] = userHook || agentOpsHook;
    }
  }
  return composed;
}

function createAgentOpsClientOptions(options = {}) {
  const privacyMode = options.privacyMode || 'strict';
  if (privacyMode === 'strict' && options.captureContent === true) {
    throw new Error('strict privacy mode requires captureContent=false');
  }

  const telemetry = {
    ...createTelemetryConfig(options),
    ...(options.telemetry || {})
  };
  telemetry.captureContent = options.captureContent === true;
  telemetry.otlpEndpoint = telemetry.otlpEndpoint || 'http://localhost:4318';
  telemetry.sourceName = telemetry.sourceName || 'agentops-copilot-sdk';

  const runId = options.runId || stableHash(`${Date.now()}:${Math.random()}`, 'run');
  const sessionId = options.sessionId || stableHash(`${runId}:session`, 'session');
  const traceId = options.traceId || stableHash(`${runId}:trace`, 'trace');

  const hooks = createAgentOpsHooks({
    hooks: options.hooks,
    emit: options.emit,
    runId,
    sessionId,
    traceId,
    privacyMode,
    captureContent: telemetry.captureContent
  });

  return {
    telemetry,
    onGetTraceContext: createTraceContextCallback(options.onGetTraceContext),
    agentops: {
      runId,
      sessionId,
      traceId,
      privacyMode,
      contentCaptureMode: telemetry.captureContent ? 'redacted' : 'off'
    },
    hooks,
    createSessionConfig: (sessionConfig = {}) => ({
      ...sessionConfig,
      hooks: composeHooks(hooks, sessionConfig.hooks || {})
    })
  };
}

function createAgentOpsCopilotClient(CopilotClient, options = {}) {
  if (typeof CopilotClient !== 'function') {
    throw new Error('createAgentOpsCopilotClient requires a CopilotClient constructor');
  }
  const clientOptions = createAgentOpsClientOptions(options);
  const client = new CopilotClient({
    telemetry: clientOptions.telemetry,
    onGetTraceContext: clientOptions.onGetTraceContext
  });
  client.agentops = clientOptions.agentops;
  client.agentopsHooks = clientOptions.hooks;
  client.createAgentOpsSessionConfig = clientOptions.createSessionConfig;
  return client;
}

module.exports = {
  composeHooks,
  createAgentOpsClientOptions,
  createAgentOpsCopilotClient
};
