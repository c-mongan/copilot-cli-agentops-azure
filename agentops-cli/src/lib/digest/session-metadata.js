const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hashText } = require('../hash');
const { classifyToolFailure, completionOutcome, safeLabel } = require('./failure-clusters');

// Reads Copilot CLI session events and keeps an allowlist of metadata only:
// timestamps, tool names, success flags, exit codes, models and token counts.
// Prompt text, tool arguments, results and error messages never leave here.

function eventTime(event) {
  const value = Date.parse(event?.timestamp || '');
  return Number.isFinite(value) ? value : null;
}

function repoLabel(gitRoot, options = {}) {
  if (!gitRoot) return '';
  const resolved = String(gitRoot);
  if (options.repoNames) return safeLabel(path.basename(resolved), `repo:${hashText(resolved).slice(0, 8)}`);
  return `repo:${hashText(resolved).slice(0, 8)}`;
}

function addUsage(target, model, usage) {
  const key = safeLabel(model, 'unknown-model');
  const entry = target[key] || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  entry.inputTokens += Number(usage.inputTokens || 0);
  entry.outputTokens += Number(usage.outputTokens || 0);
  entry.cacheReadTokens += Number(usage.cacheReadTokens || 0);
  entry.cacheWriteTokens += Number(usage.cacheWriteTokens || 0);
  target[key] = entry;
}

function summarizeSessionEvents(events = [], options = {}) {
  const ordered = events
    .map((event, index) => ({ event, index, time: eventTime(event) }))
    .filter(item => item.time !== null)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const summary = {
    sessionId: safeLabel(options.sessionId, ''),
    runId: '',
    repo: '',
    startedAt: '',
    endedAt: '',
    selectedModel: '',
    toolCalls: 0,
    // Shared run-status rules: only an errored tool call is a failure; a
    // denial or a shell non-zero exit needs attention.
    failedToolCalls: 0,
    deniedToolCalls: 0,
    nonZeroExitToolCalls: 0,
    hookFailures: 0,
    subagentFailures: 0,
    aborted: false,
    shutdownObserved: false,
    premiumRequests: null,
    tokenSource: 'unavailable',
    tokensByModel: Object.create(null),
    toolDurations: [],
    failures: []
  };
  const pendingTools = new Map();
  const seenCompletions = new Set();
  const seenModelCalls = new Set();
  const callUsage = Object.create(null);
  let lastShutdown = null;
  for (const { event, time } of ordered) {
    const data = event.data || {};
    const at = new Date(time).toISOString();
    if (!summary.startedAt) summary.startedAt = at;
    summary.endedAt = at;
    if (event.type === 'session.start') {
      if (!summary.sessionId) summary.sessionId = safeLabel(data.sessionId, '');
      if (data.startTime && Number.isFinite(Date.parse(data.startTime))) summary.startedAt = new Date(Date.parse(data.startTime)).toISOString();
      summary.selectedModel = safeLabel(data.selectedModel, '');
      summary.repo = repoLabel(data.context?.gitRoot || data.context?.cwd, options);
    } else if (event.type === 'tool.execution_start') {
      if (data.toolCallId) pendingTools.set(data.toolCallId, { toolName: data.toolName, model: data.model, time });
    } else if (event.type === 'tool.execution_complete') {
      if (data.toolCallId && seenCompletions.has(data.toolCallId)) continue;
      if (data.toolCallId) seenCompletions.add(data.toolCallId);
      const start = pendingTools.get(data.toolCallId) || {};
      pendingTools.delete(data.toolCallId);
      summary.toolCalls += 1;
      const tool = safeLabel(start.toolName || data.toolName, 'unknown-tool');
      if (start.time !== undefined) summary.toolDurations.push({ tool, ms: Math.max(0, time - start.time) });
      const outcome = completionOutcome(data);
      if (outcome === 'failed') summary.failedToolCalls += 1;
      else if (outcome === 'denied') summary.deniedToolCalls += 1;
      else if (outcome === 'nonzero_exit') summary.nonZeroExitToolCalls += 1;
      if (outcome !== 'ok') summary.failures.push({ ...classifyToolFailure(start, data), at });
    } else if (event.type === 'hook.end' && data.success === false) {
      summary.hookFailures += 1;
    } else if (event.type === 'subagent.failed') {
      summary.subagentFailures += 1;
    } else if (event.type === 'abort') {
      summary.aborted = true;
    } else if (event.type === 'session.shutdown') {
      lastShutdown = data;
    } else if (event.type === 'model.model_call_success') {
      // Fallback when a session never shut down: per-call usage, deduped by call ID.
      const callId = data.callId || '';
      if (callId && seenModelCalls.has(callId)) continue;
      if (callId) seenModelCalls.add(callId);
      const usage = data.responseChunk?.usage;
      if (!usage) continue;
      const cached = Number(usage.prompt_tokens_details?.cached_tokens || 0);
      addUsage(callUsage, data.modelCall?.model, {
        inputTokens: Number(usage.prompt_tokens || 0),
        outputTokens: Number(usage.completion_tokens || 0),
        cacheReadTokens: cached
      });
    }
  }
  // Copilot reports cumulative totals on every shutdown (including resumed
  // sessions), so the last one is authoritative; summing would double count.
  if (lastShutdown) {
    summary.shutdownObserved = true;
    if (Number.isFinite(Number(lastShutdown.totalPremiumRequests))) summary.premiumRequests = Number(lastShutdown.totalPremiumRequests);
    for (const [model, metrics] of Object.entries(lastShutdown.modelMetrics || {})) addUsage(summary.tokensByModel, model, metrics.usage || {});
    summary.tokenSource = Object.keys(summary.tokensByModel).length ? 'session.shutdown' : 'unavailable';
  }
  if (summary.tokenSource === 'unavailable' && Object.keys(callUsage).length) {
    summary.tokensByModel = callUsage;
    summary.tokenSource = 'model.call';
  }
  for (const failure of summary.failures) {
    failure.sessionId = summary.sessionId;
    failure.runId = summary.sessionId;
    failure.repo = summary.repo;
  }
  return summary;
}

function parseJsonLines(text) {
  const rows = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

// Maps Copilot session IDs to AgentOps run IDs from the local ledger
// (~/.agentops/runs/<run>/run-context.json) without reading span content.
function readLedgerIndex(agentopsHome) {
  const index = new Map();
  const runsDir = path.join(agentopsHome, 'runs');
  let entries = [];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const context = JSON.parse(fs.readFileSync(path.join(runsDir, entry.name, 'run-context.json'), 'utf8'));
      const runId = safeLabel(context.runId, '');
      const sessionId = safeLabel(context.sessionId, '');
      if (!runId || !sessionId) continue;
      const existing = index.get(sessionId);
      if (!existing || String(context.createdAt || '') > existing.createdAt) {
        index.set(sessionId, { runId, createdAt: String(context.createdAt || '') });
      }
    } catch {
      // Runs without a readable run context are not linked.
    }
  }
  return index;
}

function readLocalSessions(options = {}) {
  const copilotHome = options.copilotHome || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  const agentopsHome = options.agentopsHome || process.env.AGENTOPS_HOME || path.join(os.homedir(), '.agentops');
  const sinceMs = Number(options.sinceMs || 0);
  const sessionRoot = path.join(copilotHome, 'session-state');
  const ledger = readLedgerIndex(agentopsHome);
  const sessions = [];
  const stats = { scanned: 0, skippedOld: 0, malformedRows: 0, linkedRuns: 0 };
  let entries = [];
  try {
    entries = fs.readdirSync(sessionRoot, { withFileTypes: true });
  } catch {
    return { sessions, stats, sessionRoot, ledgerRuns: ledger.size };
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(sessionRoot, entry.name, 'events.jsonl');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    // A session last written before the window cannot have started inside it.
    if (stat.mtimeMs < sinceMs) {
      stats.skippedOld += 1;
      continue;
    }
    stats.scanned += 1;
    const { rows, malformed } = parseJsonLines(fs.readFileSync(file, 'utf8'));
    stats.malformedRows += malformed;
    const summary = summarizeSessionEvents(rows, { sessionId: entry.name, repoNames: options.repoNames });
    const linked = ledger.get(summary.sessionId);
    if (linked) {
      summary.runId = linked.runId;
      stats.linkedRuns += 1;
    }
    for (const failure of summary.failures) failure.runId = summary.runId || summary.sessionId;
    sessions.push(summary);
  }
  return { sessions, stats, sessionRoot, ledgerRuns: ledger.size };
}

module.exports = {
  readLedgerIndex,
  readLocalSessions,
  repoLabel,
  summarizeSessionEvents
};
