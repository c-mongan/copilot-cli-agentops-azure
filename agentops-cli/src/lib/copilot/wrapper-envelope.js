const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

function appendWrapperEvent(event, options = {}) {
  const file = options.file || wrapperEventsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({
    TimeGenerated: new Date().toISOString(),
    EventName: event.EventName || 'agentops.wrapper.event',
    ...event
  })}\n`);
  return file;
}

module.exports = {
  appendWrapperEvent,
  createWrapperEnvelope,
  wrapperEventsPath
};
