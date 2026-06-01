const { safePromptMetadata, safeToolMetadata, stableHash } = require('./privacy');

function emitTelemetry(emit, event) {
  if (typeof emit === 'function') emit(event);
}

function baseEvent(type, context = {}, extra = {}) {
  return {
    TimeGenerated: new Date().toISOString(),
    EventName: type,
    RunId: context.runId,
    SessionId: context.sessionId,
    TraceId: context.traceId,
    Surface: 'sdk',
    PrivacyMode: context.privacyMode || 'strict',
    ContentCaptureMode: context.contentCaptureMode || 'off',
    ...extra
  };
}

function createAgentOpsHooks(options = {}) {
  const context = {
    runId: options.runId || stableHash(`${Date.now()}:${Math.random()}`, 'run'),
    sessionId: options.sessionId || stableHash(`${Date.now()}`, 'session'),
    traceId: options.traceId || stableHash(`${Date.now()}:trace`, 'trace'),
    privacyMode: options.privacyMode || 'strict',
    contentCaptureMode: options.captureContent ? 'redacted' : 'off'
  };
  const emit = options.emit;
  const userHooks = options.hooks || {};

  return {
    onUserPromptSubmitted: async (input, invocation) => {
      const metadata = safePromptMetadata(input);
      emitTelemetry(emit, baseEvent('agentops.prompt.submitted', context, {
        PromptHash: metadata.promptHash,
        PromptSizeBytes: metadata.promptSizeBytes,
        ContentCaptureSignal: metadata.contentSignal.observed,
        ContentKind: metadata.contentSignal.kind,
        ContentAction: metadata.contentSignal.action,
        SecretLike: metadata.contentSignal.secretLike
      }));
      return userHooks.onUserPromptSubmitted ? userHooks.onUserPromptSubmitted(input, invocation) : null;
    },
    onPreToolUse: async (input, invocation) => {
      const metadata = safeToolMetadata(input);
      emitTelemetry(emit, baseEvent('agentops.policy.decision', context, {
        ToolName: metadata.toolName,
        ArgsSchemaHash: metadata.argsSchemaHash,
        ArgsSizeBytes: metadata.argsSizeBytes,
        ContentCaptureSignal: metadata.argsSignal.observed,
        ContentKind: metadata.argsSignal.kind,
        ContentAction: metadata.argsSignal.action,
        SecretLike: metadata.argsSignal.secretLike
      }));
      if (userHooks.onPreToolUse) return userHooks.onPreToolUse(input, invocation);
      return { permissionDecision: 'allow' };
    },
    onPostToolUse: async (input, invocation) => {
      const metadata = safeToolMetadata(input);
      emitTelemetry(emit, baseEvent('agentops.tool.result', context, {
        ToolName: metadata.toolName,
        ResultSizeBytes: metadata.resultSizeBytes,
        ContentCaptureSignal: metadata.resultSignal.observed,
        ContentKind: metadata.resultSignal.kind,
        ContentAction: metadata.resultSignal.action,
        SecretLike: metadata.resultSignal.secretLike
      }));
      return userHooks.onPostToolUse ? userHooks.onPostToolUse(input, invocation) : null;
    },
    onSessionStart: async (input, invocation) => {
      emitTelemetry(emit, baseEvent('agentops.session.start', context));
      return userHooks.onSessionStart ? userHooks.onSessionStart(input, invocation) : null;
    },
    onSessionEnd: async (input, invocation) => {
      emitTelemetry(emit, baseEvent('agentops.session.end', context));
      return userHooks.onSessionEnd ? userHooks.onSessionEnd(input, invocation) : null;
    },
    onError: async (input, invocation) => {
      emitTelemetry(emit, baseEvent('agentops.error', context, {
        ErrorType: String(input?.error?.name || input?.errorType || 'error')
      }));
      return userHooks.onError ? userHooks.onError(input, invocation) : null;
    }
  };
}

module.exports = {
  createAgentOpsHooks
};
