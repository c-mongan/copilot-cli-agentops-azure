const crypto = require('node:crypto');
const path = require('node:path');

const { appendJsonlFile } = require('../command-output');
const { agentopsHome } = require('../paths');

function wrapperId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createWrapperEnvelope() {
  return {
    runId: process.env.AGENTOPS_WRAPPER_RUN_ID || wrapperId('wrapper_run'),
    sessionId: process.env.AGENTOPS_WRAPPER_SESSION_ID || wrapperId('wrapper_session')
  };
}

function wrapperEventsPath() {
  return process.env.AGENTOPS_WRAPPER_EVENTS_PATH || path.join(agentopsHome, 'wrapper-events.jsonl');
}

function safeWrapperEvent(event = {}) {
  const row = {
    TimeGenerated: new Date().toISOString(),
    EventName: String(event.EventName || 'agentops.wrapper.event').slice(0, 120),
    RunId: String(event.RunId || '').slice(0, 200),
    SessionId: String(event.SessionId || '').slice(0, 200),
    Surface: String(event.Surface || 'cli').slice(0, 40),
    PrivacyMode: String(event.PrivacyMode || 'strict').slice(0, 20)
  };
  if (event.CollectorMode) row.CollectorMode = String(event.CollectorMode).slice(0, 20);
  if (Number.isInteger(event.ExitCode)) row.ExitCode = event.ExitCode;
  if (event.Signal) row.Signal = String(event.Signal).slice(0, 20);
  if (event.FallbackUnobserved !== undefined) row.FallbackUnobserved = Boolean(event.FallbackUnobserved);
  if (event.Reason || event.Error) row.ReasonCategory = event.EventName === 'agentops.collector.start_failed'
    || event.EventName === 'agentops.wrapper.fallback_unobserved'
    ? 'collector_start_failed'
    : 'runtime_error';
  return row;
}

function appendWrapperEvent(event, options = {}) {
  const file = options.file || wrapperEventsPath();
  appendJsonlFile(file, safeWrapperEvent(event));
  return file;
}

module.exports = {
  appendWrapperEvent,
  createWrapperEnvelope,
  safeWrapperEvent,
  wrapperEventsPath
};
