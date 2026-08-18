const fs = require('node:fs');
const path = require('node:path');

function safeName(value = '') {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_.:/@+-]{1,200}$/.test(text) ? text : '';
}

function sidecarEventsPath() {
  return process.env.AGENTOPS_SIDECAR_EVENTS_PATH ||
    process.env.AGENTOPS_HOOK_EVENTS_PATH ||
    path.join(process.cwd(), '.agentops', 'sidecar-events.jsonl');
}

function recordScriptExecution(input = {}, details = {}) {
  const metadata = input.metadata || input.meta || {};
  const sessionId = safeName(input.sessionId || input.session_id || metadata.sessionId || metadata.session_id || '');
  const scriptName = safeName(details.scriptName);
  const hookType = safeName(details.hookType || input.hookType || input.hook_type || input.type || 'hook');
  const outcome = safeName(details.outcome || 'observed');
  if (!sessionId || !scriptName) return null;
  const event = {
    timestamp: new Date().toISOString(),
    type: 'agentops.script.executed',
    data: {
      sessionId,
      scriptName,
      hookType,
      outcome,
      contentCapture: false
    }
  };
  const file = sidecarEventsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
  return { file, event };
}

module.exports = {
  recordScriptExecution,
  safeName,
  sidecarEventsPath
};
