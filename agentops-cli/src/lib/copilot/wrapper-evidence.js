const crypto = require('node:crypto');

const allowedWrapperEvents = new Set([
  'agentops.run.start',
  'agentops.run.end',
  'agentops.collector.start_failed',
  'agentops.wrapper.fallback_unobserved'
]);

function stableEventId(runId, sequence, eventName) {
  return `event_${crypto.createHash('sha256').update(`${runId}:${sequence}:${eventName}`).digest('hex').slice(0, 24)}`;
}

function wrapperStatus(eventName, exitCode) {
  if (eventName === 'agentops.run.start') return 'started';
  if (eventName === 'agentops.wrapper.fallback_unobserved') return 'unobserved';
  if (eventName === 'agentops.collector.start_failed') return 'failed';
  return Number(exitCode) === 0 ? 'success' : 'failed';
}

function canonicalWrapperEvidence(event = {}, options = {}) {
  const eventName = String(event.EventName || '');
  const runId = String(event.RunId || '');
  const sessionId = String(event.SessionId || '');
  const sequence = Number(options.sequence ?? event.Sequence);
  if (!allowedWrapperEvents.has(eventName)) throw new Error('Unsupported AgentOps wrapper lifecycle event');
  if (!/^[A-Za-z0-9_.:@+-]{1,200}$/.test(runId)) throw new Error('Wrapper lifecycle evidence requires a safe RunId');
  if (!/^[A-Za-z0-9_.:@+-]{1,200}$/.test(sessionId)) throw new Error('Wrapper lifecycle evidence requires a safe SessionId');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Wrapper lifecycle evidence requires a positive sequence');
  return {
    TimeGenerated: options.timeGenerated || new Date().toISOString(),
    Sequence: sequence,
    EventId: stableEventId(runId, sequence, eventName),
    RunId: runId,
    SessionId: sessionId,
    EventName: eventName,
    SpanName: eventName,
    Status: wrapperStatus(eventName, event.ExitCode),
    ContentCaptureSignal: false,
    ContentCaptureMode: 'off',
    PrivacyMode: 'strict',
    Surface: 'cli',
    SchemaVersion: '2'
  };
}

module.exports = {
  allowedWrapperEvents,
  canonicalWrapperEvidence,
  stableEventId,
  wrapperStatus
};
