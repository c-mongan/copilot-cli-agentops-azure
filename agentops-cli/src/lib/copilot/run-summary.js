function summarizeCopilotRun(metadata = {}, session = {}, result = {}) {
  const exitCode = result.exitCode ?? result.status ?? 0;
  const failed = exitCode !== 0 || Number(session.failures || 0) > 0;
  return {
    RunId: metadata.runId || session.runIds?.[0] || '',
    SessionId: metadata.sessionId || session.sessionId || '',
    Surface: 'cli',
    PrivacyMode: metadata.privacyMode || 'strict',
    ContentCaptureMode: metadata.contentCaptureMode || 'off',
    OutcomeStatus: failed ? 'failed' : 'success',
    OutcomeReason: failed ? (result.errorType || 'copilot_exit_or_span_failure') : 'completed',
    DurationMs: Number(result.durationMs || 0),
    InputTokens: Number(session.inputTokens || 0),
    OutputTokens: Number(session.outputTokens || 0),
    ToolCount: Number(session.toolCalls || metadata.allowToolCount || 0),
    ToolFailureCount: Number(session.failures || 0),
    TestsRan: Boolean(metadata.testsRequested),
    RepoHash: metadata.repoHash || '',
    CommandHash: metadata.commandHash || '',
    PromptHash: metadata.promptHash || '',
    ModelRequested: metadata.modelRequested || '',
    StartedAt: metadata.startedAt || session.startedAt || '',
    EndedAt: result.endedAt || session.endedAt || ''
  };
}

module.exports = {
  summarizeCopilotRun
};
