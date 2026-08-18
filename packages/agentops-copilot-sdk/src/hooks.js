const { byteSize, contentSignal, safePromptMetadata, safeToolMetadata, stableHash } = require('./privacy');
const { createSafeEventNormalizer } = require('./event-envelope');

function emitTelemetry(emit, normalizeEvent, event, onInstrumentationError) {
  if (typeof emit !== 'function') return;
  try {
    emit(normalizeEvent(event));
  } catch (error) {
    if (typeof onInstrumentationError === 'function') onInstrumentationError(error);
  }
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
  const normalizeEvent = options.normalizeEvent || createSafeEventNormalizer({ context });
  const userHooks = options.hooks || {};
  const emitSafe = event => emitTelemetry(emit, normalizeEvent, event, options.onInstrumentationError);

  return {
    onUserPromptSubmitted: async (input, invocation) => {
      const metadata = safePromptMetadata(input);
      emitSafe(baseEvent('agentops.prompt.submitted', context, {
        PromptHash: metadata.promptHash,
        PromptSizeBytes: metadata.promptSizeBytes,
        ContentCaptureSignal: metadata.contentSignal.observed,
        ContentKind: metadata.contentSignal.kind,
        ContentAction: metadata.contentSignal.action,
        SecretLike: metadata.contentSignal.secretLike
      }));
      return userHooks.onUserPromptSubmitted ? userHooks.onUserPromptSubmitted(input, invocation) : undefined;
    },
    onPreToolUse: async (input, invocation) => {
      const metadata = safeToolMetadata(input);
      emitSafe(baseEvent('agentops.policy.decision', context, {
        ToolName: metadata.toolName,
        ArgsSchemaHash: metadata.argsSchemaHash,
        ArgsSizeBytes: metadata.argsSizeBytes,
        ContentCaptureSignal: metadata.argsSignal.observed,
        ContentKind: metadata.argsSignal.kind,
        ContentAction: metadata.argsSignal.action,
        SecretLike: metadata.argsSignal.secretLike
      }));
      if (userHooks.onPreToolUse) return userHooks.onPreToolUse(input, invocation);
      return undefined;
    },
    onPostToolUse: async (input, invocation) => {
      const metadata = safeToolMetadata(input);
      emitSafe(baseEvent('agentops.tool.result', context, {
        ToolName: metadata.toolName,
        ResultSizeBytes: metadata.resultSizeBytes,
        ContentCaptureSignal: metadata.resultSignal.observed,
        ContentKind: metadata.resultSignal.kind,
        ContentAction: metadata.resultSignal.action,
        SecretLike: metadata.resultSignal.secretLike
      }));
      return userHooks.onPostToolUse ? userHooks.onPostToolUse(input, invocation) : undefined;
    },
    onPostToolUseFailure: async (input, invocation) => {
      const metadata = safeToolMetadata(input);
      const error = input?.error || input?.failure || input?.toolError || '';
      const errorText = error instanceof Error ? `${error.name}:${error.message}` : error;
      const errorSignal = contentSignal(errorText, 'error');
      emitSafe(baseEvent('agentops.tool.result', context, {
        ToolName: metadata.toolName,
        Status: 'failed',
        ErrorType: String(input?.error?.name || input?.error?.code || input?.errorType || 'tool_error'),
        ErrorSizeBytes: byteSize(errorText),
        ContentCaptureSignal: errorSignal.observed,
        ContentKind: errorSignal.kind,
        ContentAction: errorSignal.action,
        SecretLike: errorSignal.secretLike
      }));
      return userHooks.onPostToolUseFailure ? userHooks.onPostToolUseFailure(input, invocation) : undefined;
    },
    onSessionStart: async (input, invocation) => {
      emitSafe(baseEvent('agentops.session.start', context));
      return userHooks.onSessionStart ? userHooks.onSessionStart(input, invocation) : undefined;
    },
    onSessionEnd: async (input, invocation) => {
      emitSafe(baseEvent('agentops.session.end', context));
      return userHooks.onSessionEnd ? userHooks.onSessionEnd(input, invocation) : undefined;
    },
    onErrorOccurred: async (input, invocation) => {
      emitSafe(baseEvent('agentops.error', context, {
        ErrorType: String(input?.error?.name || input?.errorType || 'error')
      }));
      return userHooks.onErrorOccurred ? userHooks.onErrorOccurred(input, invocation) : undefined;
    }
  };
}

module.exports = {
  createAgentOpsHooks
};
