const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sessionStateDir(copilotHome = process.env.COPILOT_HOME) {
  return copilotHome
    ? path.join(copilotHome, 'session-state')
    : path.join(os.homedir(), '.copilot', 'session-state');
}

function snapshotCopilotSessions(root = sessionStateDir()) {
  const snapshot = new Map();
  if (!fs.existsSync(root)) return snapshot;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9-]{1,100}$/.test(entry.name)) continue;
    const file = path.join(root, entry.name, 'events.jsonl');
    try {
      snapshot.set(file, fs.statSync(file).mtimeMs);
    } catch {}
  }
  return snapshot;
}

function safeName(value = '') {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_.:/@+-]{1,200}$/.test(text) ? text : '';
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeSessionEvents(events = [], sessionId = '') {
  let model = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let aiCredits = 0;
  let apiDurationMs = 0;
  let filesModified = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  const tools = new Set();
  for (const event of events) {
    const type = event?.type || '';
    const data = event?.data && typeof event.data === 'object' ? event.data : {};
    if (type === 'session.start') sessionId = safeName(data.sessionId) || sessionId;
    if (type === 'session.model_change') model = safeName(data.newModel) || model;
    if (type === 'assistant.message') {
      model = safeName(data.model) || model;
      for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
        const tool = safeName(request?.name);
        if (tool) tools.add(tool);
      }
    }
    if (type === 'tool.execution_start' || type === 'tool.execution_complete') {
      const tool = safeName(data.toolName);
      if (tool) tools.add(tool);
    }
    if (type === 'session.shutdown') {
      model = safeName(data.currentModel) || model;
      const tokenDetails = data.tokenDetails && typeof data.tokenDetails === 'object' ? data.tokenDetails : {};
      inputTokens = numeric(tokenDetails.input?.tokenCount)
        + numeric(tokenDetails.cache_read?.tokenCount)
        + numeric(tokenDetails.cache_write?.tokenCount);
      outputTokens = numeric(tokenDetails.output?.tokenCount);
      aiCredits = numeric(data.totalNanoAiu) / 1_000_000_000;
      apiDurationMs = numeric(data.totalApiDurationMs);
      const codeChanges = data.codeChanges && typeof data.codeChanges === 'object' ? data.codeChanges : {};
      filesModified = Array.isArray(codeChanges.filesModified)
        ? codeChanges.filesModified.length
        : numeric(codeChanges.filesModified);
      linesAdded = numeric(codeChanges.linesAdded);
      linesRemoved = numeric(codeChanges.linesRemoved);
    }
  }
  return {
    sessionId,
    model,
    inputTokens,
    outputTokens,
    aiCredits,
    apiDurationMs,
    // Set preserves the first observed call order. The receipt is a run story,
    // so alphabetic sorting would make an accurate sequence look incorrect.
    tools: [...tools],
    filesModified,
    linesAdded,
    linesRemoved
  };
}

function readSessionSummary(file) {
  const events = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return summarizeSessionEvents(events, path.basename(path.dirname(file)));
}

function changedCopilotSession(before = new Map(), root = sessionStateDir()) {
  const after = snapshotCopilotSessions(root);
  const changed = [...after.entries()]
    .filter(([file, mtime]) => !before.has(file) || mtime > before.get(file))
    .sort((left, right) => right[1] - left[1]);
  if (!changed.length) return null;
  try {
    return readSessionSummary(changed[0][0]);
  } catch {
    return null;
  }
}

module.exports = {
  changedCopilotSession,
  readSessionSummary,
  sessionStateDir,
  snapshotCopilotSessions,
  summarizeSessionEvents
};
