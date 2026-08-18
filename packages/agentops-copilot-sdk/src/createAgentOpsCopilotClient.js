const { createAgentOpsHooks } = require('./hooks');
const { createTelemetryConfig, createTraceContextCallback } = require('./otel');
const { stableHash } = require('./privacy');
const { createAgentOpsSessionObserver } = require('./session-events');
const { createOtlpJsonExporter } = require('./otlp-exporter');
const { createSafeEventNormalizer } = require('./event-envelope');

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

function composeEventHandlers(agentOpsHandler, userHandler, onInstrumentationError) {
  return event => {
    try {
      agentOpsHandler(event);
    } catch (error) {
      if (typeof onInstrumentationError === 'function') onInstrumentationError(error);
    }
    return typeof userHandler === 'function' ? userHandler(event) : undefined;
  };
}

function denyPermissionsByDefault() {
  return {
    kind: 'reject',
    feedback: 'AgentOps secure default: provide an explicit onPermissionRequest handler to approve this operation.'
  };
}

function emptyDeliveryStatus() {
  return {
    queuedInMemory: 0,
    collectorAccepted: 0,
    retryAttempts: 0,
    terminalFailures: 0,
    pendingInMemory: 0,
    queueOverflowed: 0,
    lastCollectorAcceptedAt: null,
    maxPendingEvents: 0
  };
}

function createAgentOpsClientOptions(options = {}) {
  const privacyMode = options.privacyMode || 'strict';
  if (options.captureContent === true || options.telemetry?.captureContent === true) {
    throw new Error('AgentOps does not support SDK content capture; captureContent must remain false');
  }

  const telemetry = {
    ...createTelemetryConfig(options),
    ...(options.telemetry || {})
  };
  telemetry.captureContent = false;
  telemetry.otlpEndpoint = telemetry.otlpEndpoint || 'http://localhost:4318';
  telemetry.sourceName = telemetry.sourceName || 'agentops-copilot-sdk';

  const runId = options.runId || stableHash(`${Date.now()}:${Math.random()}`, 'run');
  const sessionId = options.sessionId || stableHash(`${runId}:session`, 'session');
  const traceId = options.traceId || stableHash(`${runId}:trace`, 'trace');
  const orderedExportEnabled = options.exportOrderedEvents !== false
    && process.env.AGENTOPS_DISABLE_ORDERED_EXPORT !== '1';
  const exporter = orderedExportEnabled ? createOtlpJsonExporter({
    otlpEndpoint: telemetry.otlpEndpoint,
    sourceName: telemetry.sourceName,
    timeoutMs: options.exportTimeoutMs,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
    maxPendingEvents: options.maxPendingEvents,
    onError: options.onExportError
  }) : null;
  const normalizeEvent = createSafeEventNormalizer({ context: {
    RunId: runId,
    SessionId: sessionId,
    TraceId: traceId,
    Surface: 'sdk',
    PrivacyMode: privacyMode,
    ContentCaptureMode: 'off'
  } });
  const emit = event => {
    try {
      if (typeof options.emit === 'function') options.emit(event);
      if (exporter) exporter.emit(event);
    } catch (error) {
      if (typeof options.onInstrumentationError === 'function') options.onInstrumentationError(error);
    }
  };

  const hooks = createAgentOpsHooks({
    hooks: options.hooks,
    emit,
    runId,
    sessionId,
    traceId,
    privacyMode,
    captureContent: telemetry.captureContent,
    onInstrumentationError: options.onInstrumentationError,
    normalizeEvent
  });
  const observer = createAgentOpsSessionObserver({
    emit,
    runId,
    sessionId,
    traceId,
    privacyMode,
    captureContent: telemetry.captureContent,
    usdPerCostUnit: options.usdPerCostUnit,
    normalizeEvent
  });

  let isolatedSessionCount = 0;
  function createIsolatedSessionConfig(sessionConfig = {}, resumeIdentity = '') {
    isolatedSessionCount += 1;
    const first = isolatedSessionCount === 1;
    const isolatedSessionId = first && options.sessionId
      ? sessionId
      : stableHash(resumeIdentity || `${runId}:session:${isolatedSessionCount}`, 'session');
    const isolatedTraceId = first && options.traceId
      ? traceId
      : stableHash(`${runId}:${isolatedSessionId}:trace`, 'trace');
    const isolatedNormalizer = createSafeEventNormalizer({ context: {
      RunId: runId,
      SessionId: isolatedSessionId,
      TraceId: isolatedTraceId,
      Surface: 'sdk',
      PrivacyMode: privacyMode,
      ContentCaptureMode: 'off'
    } });
    const isolatedHooks = createAgentOpsHooks({
      emit,
      runId,
      sessionId: isolatedSessionId,
      traceId: isolatedTraceId,
      privacyMode,
      captureContent: telemetry.captureContent,
      onInstrumentationError: options.onInstrumentationError,
      normalizeEvent: isolatedNormalizer
    });
    const isolatedObserver = createAgentOpsSessionObserver({
      emit,
      runId,
      sessionId: isolatedSessionId,
      traceId: isolatedTraceId,
      privacyMode,
      captureContent: telemetry.captureContent,
      usdPerCostUnit: options.usdPerCostUnit,
      normalizeEvent: isolatedNormalizer
    });
    return {
      ...sessionConfig,
      streaming: sessionConfig.streaming !== false,
      onEvent: composeEventHandlers(isolatedObserver.observe, sessionConfig.onEvent, options.onInstrumentationError),
      hooks: composeHooks(isolatedHooks, sessionConfig.hooks || {})
    };
  }

  return {
    telemetry,
    onGetTraceContext: createTraceContextCallback(options.onGetTraceContext, traceId),
    agentops: {
      runId,
      sessionId,
      traceId,
      privacyMode,
    contentCaptureMode: 'off'
    },
    hooks,
    observer,
    exporter,
    deliveryStatus: () => exporter ? exporter.deliveryStatus() : emptyDeliveryStatus(),
    flush: () => exporter ? exporter.flush() : Promise.resolve(emptyDeliveryStatus()),
    createIsolatedSessionConfig,
    createSessionConfig: (sessionConfig = {}) => ({
      ...sessionConfig,
      streaming: sessionConfig.streaming !== false,
      onEvent: composeEventHandlers(observer.observe, sessionConfig.onEvent, options.onInstrumentationError),
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
  client.agentopsObserver = clientOptions.observer;
  client.agentopsDeliveryStatus = clientOptions.deliveryStatus;
  client.flushAgentOpsTelemetry = clientOptions.flush;
  client.createAgentOpsSessionConfig = clientOptions.createSessionConfig;
  client.observeAgentOpsSession = session => clientOptions.observer.attach(session);
  client.createAgentOpsSession = async sessionConfig => {
    if (typeof client.createSession !== 'function') throw new Error('CopilotClient does not expose createSession()');
    return client.createSession(clientOptions.createIsolatedSessionConfig(sessionConfig));
  };
  client.resumeAgentOpsSession = async (sessionId, sessionConfig) => {
    if (typeof client.resumeSession !== 'function') throw new Error('CopilotClient does not expose resumeSession()');
    return client.resumeSession(sessionId, clientOptions.createIsolatedSessionConfig(sessionConfig, sessionId));
  };
  if (typeof client.stop === 'function') {
    const stop = client.stop.bind(client);
    client.stop = async (...args) => {
      let result;
      let stopError;
      let flushError;
      try {
        result = await stop(...args);
      } catch (error) {
        stopError = error;
      }
      try {
        await clientOptions.flush();
      } catch (error) {
        flushError = error;
      }
      if (stopError && flushError) throw new AggregateError([stopError, flushError], 'Copilot stop and AgentOps telemetry flush both failed');
      if (stopError) throw stopError;
      if (flushError) throw flushError;
      return result;
    };
  }
  return client;
}

module.exports = {
  composeHooks,
  composeEventHandlers,
  denyPermissionsByDefault,
  createAgentOpsClientOptions,
  createAgentOpsCopilotClient
};
