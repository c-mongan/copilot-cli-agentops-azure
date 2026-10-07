const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const { safeModelIdentity } = require('../copilot/execution-configuration');
const { redactContent } = require('../copilot/session-content');
const { estimateModelCostUsd, estimateRunsCost, estimateUsageCost, formatCostTotal } = require('../cost-estimate');
const { SPAN_COUNT_LABELS, classifyRunStatus, classifyToolCompletionEvent, sessionRunStatus, uniqueNativeSpans } = require('../copilot/run-status');

// Only these event types are parsed. Large content-bearing events (assistant.message,
// system.message, reasoning) are skipped without JSON parsing, which keeps both the
// privacy surface and the cost of scanning multi-megabyte session logs small.
const TRACKED_TYPES = new Set([
  'session.start', 'session.resume', 'session.shutdown', 'session.model_change',
  'session.compaction_start', 'session.compaction_complete',
  'assistant.turn_start', 'assistant.turn_end',
  'tool.execution_start', 'tool.execution_complete',
  'hook.start', 'hook.end',
  'subagent.started', 'subagent.completed', 'subagent.failed',
  'user.message', 'model.model_call_success'
]);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LIVE_WINDOW_MS = 5 * 60 * 1000;
// A Copilot process holding the session's inuse lock keeps an idle session live, but
// only this long after its last write, so a recycled PID cannot keep an old one live.
const LOCK_LIVE_MAX_MS = 24 * 60 * 60 * 1000;
// With a time window the newest-N cap is lifted up to this many sessions.
const WINDOW_SCAN_MAX = 5000;
// Run IDs written by `agentops copilot-session launch`.
const LAUNCH_RUN_ID = /^native_run_/;

function defaultCopilotHome(env = process.env) {
  return env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function defaultAgentOpsHome(env = process.env) {
  return env.AGENTOPS_HOME || path.join(os.homedir(), '.agentops');
}

// Identifiers such as tool names, hook types and error codes; anything with spaces,
// quotes or path separators beyond MCP-style names is dropped rather than echoed.
function safeLabel(value, max = 80) {
  return typeof value === 'string' && value.length <= max && /^[A-Za-z0-9_.:@+\-/]+$/.test(value) ? value : '';
}

function safeModel(value) {
  const model = typeof value === 'string' ? safeModelIdentity(value) : null;
  return model && safeLabel(model, 100) ? model : '';
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function repoIdentity(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath) return { name: '', hash: '' };
  // Split on both separators so a Windows path never leaks whole on a POSIX host.
  const base = rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return {
    name: base.length <= 80 && !/[\u0000-\u001f\u007f]/.test(base) ? base : '',
    hash: crypto.createHash('sha256').update(rootPath).digest('hex').slice(0, 12)
  };
}

function eventTime(raw) {
  const value = Date.parse(raw?.timestamp || '');
  return Number.isFinite(value) ? value : null;
}

// Reduces one raw Copilot event to an allowlisted metadata record.
function minimalEvent(raw) {
  if (!raw || typeof raw !== 'object' || !TRACKED_TYPES.has(raw.type)) return null;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const event = { type: raw.type, time: eventTime(raw), agentId: safeLabel(raw.agentId, 128) };
  switch (raw.type) {
    case 'session.start': {
      const context = data.context || {};
      event.sessionId = safeLabel(data.sessionId, 128);
      event.model = safeModel(data.selectedModel);
      event.copilotVersion = safeLabel(data.copilotVersion, 40);
      event.repo = repoIdentity(context.gitRoot || context.cwd);
      const started = Date.parse(data.startTime || '');
      if (Number.isFinite(started)) {
        // The digest windows sessions by startTime, so the UI does too.
        event.startTime = started;
        if (event.time === null) event.time = started;
      }
      break;
    }
    case 'session.resume':
      event.model = safeModel(data.selectedModel);
      break;
    case 'session.shutdown': {
      const usage = Object.create(null);
      let requests = 0;
      for (const [model, metrics] of Object.entries(data.modelMetrics || {})) {
        const name = safeModel(model);
        if (!name) continue;
        const tokens = metrics?.usage || {};
        usage[name] = {
          input: count(tokens.inputTokens),
          output: count(tokens.outputTokens),
          cacheRead: count(tokens.cacheReadTokens),
          cacheWrite: count(tokens.cacheWriteTokens)
        };
        requests += count(metrics?.requests?.count);
      }
      event.usage = usage;
      event.modelRequests = requests;
      event.premiumRequests = Number.isFinite(Number(data.totalPremiumRequests)) ? Number(data.totalPremiumRequests) : null;
      event.model = safeModel(data.currentModel);
      break;
    }
    case 'session.model_change':
      event.model = safeModel(data.newModel);
      break;
    case 'assistant.turn_start':
    case 'assistant.turn_end':
      event.turnId = safeLabel(String(data.turnId ?? ''), 64);
      break;
    case 'tool.execution_start':
      event.toolCallId = safeLabel(data.toolCallId, 128);
      event.toolName = safeLabel(data.toolName) || 'unknown-tool';
      event.turnId = safeLabel(String(data.turnId ?? ''), 64);
      event.mcpServer = safeLabel(data.mcpServerName);
      break;
    case 'tool.execution_complete': {
      event.toolCallId = safeLabel(data.toolCallId, 128);
      event.success = data.success !== false;
      event.signal = classifyToolCompletionEvent(data);
      event.outcome = data.success === false
        ? (safeLabel(data.error?.code, 40) || safeLabel(data.toolTelemetry?.properties?.shell_error_category, 40) || 'failed')
        : 'ok';
      const exitCode = data.shellExecution?.exitCode;
      if (Number.isSafeInteger(exitCode)) event.exitCode = exitCode;
      break;
    }
    case 'hook.start':
    case 'hook.end':
      event.hookId = safeLabel(data.hookInvocationId, 128);
      event.hookType = safeLabel(data.hookType, 60) || 'hook';
      if (raw.type === 'hook.end') event.success = data.success !== false;
      break;
    case 'model.model_call_success': {
      // Usage fallback for sessions that never shut down, matching the digest.
      const tokens = data.responseChunk?.usage;
      event.callId = safeLabel(data.callId, 128);
      event.callModel = safeModel(data.modelCall?.model);
      event.callUsage = tokens && typeof tokens === 'object' ? {
        input: count(tokens.prompt_tokens),
        output: count(tokens.completion_tokens),
        cacheRead: count(tokens.prompt_tokens_details?.cached_tokens),
        cacheWrite: 0
      } : null;
      break;
    }
    case 'subagent.started':
    case 'subagent.completed':
    case 'subagent.failed':
      event.toolCallId = safeLabel(data.toolCallId, 128);
      event.agentName = safeLabel(data.agentName, 60) || 'subagent';
      event.model = safeModel(data.model);
      break;
    default:
      break;
  }
  return event;
}

const TYPE_PREFIX = /^\{"type":"([^"]+)"/;
const TAIL_TIMESTAMP = /"timestamp":"([^"]+)"/;

// Streams an events.jsonl file and returns metadata-only events plus the last
// observed timestamp (taken from every line, including skipped content events).
async function readSessionEvents(file) {
  const events = [];
  let lastTime = null;
  let firstTime = null;
  let malformed = 0;
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const prefix = TYPE_PREFIX.exec(line);
    if (prefix && !TRACKED_TYPES.has(prefix[1])) {
      const stamp = TAIL_TIMESTAMP.exec(line.slice(-220));
      const time = stamp ? Date.parse(stamp[1]) : NaN;
      if (Number.isFinite(time)) {
        lastTime = lastTime === null ? time : Math.max(lastTime, time);
        firstTime = firstTime === null ? time : Math.min(firstTime, time);
      }
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    const time = eventTime(raw);
    if (time !== null) {
      lastTime = lastTime === null ? time : Math.max(lastTime, time);
      firstTime = firstTime === null ? time : Math.min(firstTime, time);
    }
    const event = minimalEvent(raw);
    if (event) events.push(event);
  }
  return { events, firstTime, lastTime, malformed };
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

// Native span receipts can contain the same span more than once (same TraceId/SpanId),
// and per-event rows reuse the span ID; keep the first real span row only.
function dedupeSpans(rows = []) {
  return uniqueNativeSpans(rows);
}

function normalizeLedgerSpan(row) {
  const start = Date.parse(row.TimeGenerated || '');
  if (!Number.isFinite(start)) return null;
  const durationMs = Math.max(0, Number(row.DurationMs) || 0);
  const nullableCount = value => (value === null || value === undefined || value === '' ? null : count(value));
  return {
    spanId: safeLabel(row.SpanId, 64),
    parentSpanId: safeLabel(row.ParentSpanId, 64),
    op: safeLabel(row.OperationName, 40),
    toolName: safeLabel(row.ToolName),
    toolCallId: safeLabel(row.ToolCallId, 128),
    model: safeModel(row.ModelActual || row.Model || row.ModelRequested),
    input: nullableCount(row.InputTokens),
    output: nullableCount(row.OutputTokens),
    cacheRead: nullableCount(row.CacheReadTokens),
    cacheWrite: nullableCount(row.CacheWriteTokens),
    start,
    end: start + durationMs,
    failed: row.Outcome === 'failed' || Boolean(row.ErrorType) && row.ErrorType !== 'shell_nonzero_exit',
    outcome: row.Outcome !== 'failed' && row.ErrorType === 'shell_nonzero_exit' ? 'nonzero_exit'
      : row.Outcome === 'failed' || row.ErrorType ? (safeLabel(row.ErrorType, 40) || 'failed') : 'ok'
  };
}

function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip malformed receipt rows */ }
  }
  return rows;
}

function readLedgerSpans(runDir) {
  return dedupeSpans(readJsonLines(path.join(runDir, 'AgentOpsSpans_CL.jsonl')))
    .map(normalizeLedgerSpan)
    .filter(Boolean);
}

// Maps sessionId -> AgentOps ledger runs (newest first) from ~/.agentops/runs/*/run-context.json.
function readLedgerIndex(agentOpsHome) {
  const index = new Map();
  const runsDir = path.join(agentOpsHome, 'runs');
  let entries = [];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
    const dir = path.join(runsDir, entry.name);
    let context;
    try {
      context = JSON.parse(fs.readFileSync(path.join(dir, 'run-context.json'), 'utf8'));
    } catch {
      continue;
    }
    const sessionId = safeLabel(context.sessionId, 128);
    if (!sessionId || !SESSION_ID.test(sessionId)) continue;
    const runs = index.get(sessionId) || [];
    runs.push({
      runId: safeLabel(context.runId, 128) || entry.name,
      dir,
      createdAt: Date.parse(context.createdAt || '') || 0,
      repoHash: safeLabel(context.repositoryRootHash, 64)
    });
    runs.sort((a, b) => b.createdAt - a.createdAt);
    index.set(sessionId, runs);
  }
  return index;
}

// True when a running process holds this session's Copilot CLI inuse lock
// (session-state/<id>/inuse.<pid>.lock).
function sessionLockAlive(sessionDir) {
  let names;
  try {
    names = fs.readdirSync(sessionDir);
  } catch {
    return false;
  }
  for (const name of names) {
    const match = /^inuse\.(\d{1,10})\.lock$/.exec(name);
    const pid = match ? Number(match[1]) : 0;
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'EPERM') return true;
    }
  }
  return false;
}

// A session has ended when its last lifecycle event is a shutdown; a resume after a
// shutdown means it is running again.
function sessionEnded(events) {
  let ended = false;
  for (const event of events) {
    if (event.type === 'session.shutdown') ended = true;
    else if (event.type === 'session.start' || event.type === 'session.resume') ended = false;
  }
  return ended;
}

function discoverSessions({ copilotHome, agentOpsHome } = {}) {
  const sessions = [];
  const ledger = readLedgerIndex(agentOpsHome || defaultAgentOpsHome());
  const stateDir = path.join(copilotHome || defaultCopilotHome(), 'session-state');
  let entries = [];
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
    const eventsFile = path.join(stateDir, entry.name, 'events.jsonl');
    let stat;
    try {
      stat = fs.statSync(eventsFile);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    seen.add(entry.name);
    sessions.push({ id: entry.name, eventsFile, mtimeMs: stat.mtimeMs, size: stat.size, ledgerRuns: ledger.get(entry.name) || [] });
  }
  for (const [sessionId, runs] of ledger) {
    if (seen.has(sessionId)) continue;
    sessions.push({ id: sessionId, eventsFile: null, mtimeMs: runs[0].createdAt, size: 0, ledgerRuns: runs });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  return { sessions, stateDir, ledgerRuns: [...ledger.values()].reduce((total, runs) => total + runs.length, 0) };
}

function addUsage(target, model, usage) {
  const current = target[model] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) current[key] += count(usage[key]);
  target[model] = current;
}

function usageFromLedger(spans) {
  const chats = spans.filter(span => span.op === 'chat' && span.model);
  const usage = Object.create(null);
  if (chats.length) {
    for (const span of chats) addUsage(usage, span.model, span);
    return usage;
  }
  const agent = spans.find(span => span.op === 'invoke_agent' && span.input !== null);
  if (agent) addUsage(usage, agent.model || 'unknown', agent);
  return usage;
}

function usageFromCalls(events) {
  const usage = Object.create(null);
  const seen = new Set();
  for (const event of events) {
    if (event.type !== 'model.model_call_success' || !event.callUsage || !event.callModel) continue;
    if (event.callId && seen.has(event.callId)) continue;
    if (event.callId) seen.add(event.callId);
    addUsage(usage, event.callModel, event.callUsage);
  }
  return usage;
}

function totals(usageByModel) {
  const result = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const usage of Object.values(usageByModel)) {
    for (const key of Object.keys(result)) result[key] += count(usage[key]);
  }
  return result;
}

// Sums active segments (start/resume -> next shutdown) so a session resumed a day
// later does not report the idle gap as run time.
function activeDuration(events, firstTime, lastTime) {
  let total = 0;
  let segmentStart = null;
  for (const event of events) {
    if (event.time === null) continue;
    if ((event.type === 'session.start' || event.type === 'session.resume') && segmentStart === null) segmentStart = event.time;
    if (event.type === 'session.shutdown' && segmentStart !== null) {
      total += Math.max(0, event.time - segmentStart);
      segmentStart = null;
    }
  }
  if (segmentStart !== null && lastTime !== null) total += Math.max(0, lastTime - segmentStart);
  if (!total && firstTime !== null && lastTime !== null) total = Math.max(0, lastTime - firstTime);
  return total;
}

function failureGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.name}\u0000${item.outcome}`;
    const group = groups.get(key) || { kind: item.kind, name: item.name, outcome: item.outcome, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function failureSentence(group) {
  if (group.outcome === 'nonzero_exit') {
    return `${group.count} shell command${group.count === 1 ? '' : 's'} exited non-zero: ${group.name}. Copilot reported the tool call as successful, so it is not counted as a failure.`;
  }
  const noun = group.kind === 'tool' ? 'tool call' : group.kind;
  const plural = group.count === 1 ? noun : `${noun}s`;
  const verb = group.outcome === 'failed' ? 'failed' : group.outcome;
  return `${group.count} ${plural} ${verb}: ${group.name}`;
}

function nonZeroExitSpans(toolSpans) {
  return toolSpans.filter(span => span.status === 'ok'
    && (Number.isSafeInteger(span.attrs.exitCode) && span.attrs.exitCode !== 0 || span.attrs.outcome === 'nonzero_exit'));
}

// Builds a deduplicated span tree (session -> subagents/turns -> tools/hooks/chat)
// from metadata-only events and, when present, AgentOps ledger spans.
function buildSpans(events = [], ledgerSpans = [], { lastTime = null, firstTime = null } = {}) {
  const spans = [];
  const byId = new Map();
  let nextId = 0;
  const add = span => {
    const id = span.id || `s${nextId += 1}`;
    const full = { id, parentId: null, status: 'ok', attrs: {}, ...span, id };
    spans.push(full);
    byId.set(id, full);
    return full;
  };
  const times = [...events.map(event => event.time), ...ledgerSpans.flatMap(span => [span.start, span.end]), firstTime, lastTime]
    .filter(Number.isFinite);
  const t0 = times.length ? Math.min(...times) : 0;
  const tEnd = times.length ? Math.max(...times) : 0;
  const root = add({ id: 'session', kind: 'session', name: 'session', start: t0, end: tEnd });

  const openTurns = new Map();
  const lastTurnByAgent = new Map();
  const tools = new Map();
  const hooks = new Map();
  const agents = new Map();
  const turnsByAgent = new Map();
  const parentFor = agentId => (agentId && agents.get(agentId)?.id) || root.id;
  const turnFor = (agentId, turnId) => openTurns.get(`${agentId}|${turnId}`) || lastTurnByAgent.get(agentId || '');

  for (const event of events) {
    const time = event.time ?? t0;
    if (event.type === 'subagent.started') {
      const parentTool = event.toolCallId ? tools.get(event.toolCallId) : null;
      const span = add({ kind: 'agent', name: event.agentName, start: time, end: null, parentId: parentTool?.id || root.id, status: 'incomplete', attrs: { model: event.model || '' } });
      agents.set(event.agentId || event.toolCallId, span);
    } else if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
      const span = agents.get(event.agentId || event.toolCallId);
      if (span) {
        span.end = time;
        span.status = event.type === 'subagent.failed' ? 'failed' : 'ok';
        if (span.status === 'failed') span.attrs.outcome = 'failed';
      }
    } else if (event.type === 'assistant.turn_start') {
      const agentKey = event.agentId || '';
      const ordinal = (turnsByAgent.get(agentKey) || 0) + 1;
      turnsByAgent.set(agentKey, ordinal);
      const span = add({ kind: 'turn', name: `turn ${ordinal}`, start: time, end: null, parentId: parentFor(event.agentId), status: 'incomplete' });
      openTurns.set(`${agentKey}|${event.turnId}`, span);
      lastTurnByAgent.set(agentKey, span);
    } else if (event.type === 'assistant.turn_end') {
      const key = `${event.agentId || ''}|${event.turnId}`;
      const span = openTurns.get(key);
      if (span) {
        span.end = time;
        if (span.status === 'incomplete') span.status = 'ok';
        openTurns.delete(key);
      }
    } else if (event.type === 'tool.execution_start') {
      const turn = turnFor(event.agentId || '', event.turnId);
      const span = add({ kind: 'tool', name: event.toolName, start: time, end: null, parentId: turn?.id || parentFor(event.agentId), status: 'incomplete', attrs: { toolCallId: event.toolCallId, mcpServer: event.mcpServer || '' } });
      if (event.toolCallId) tools.set(event.toolCallId, span);
    } else if (event.type === 'tool.execution_complete') {
      let span = event.toolCallId ? tools.get(event.toolCallId) : null;
      if (!span || span.end !== null) {
        span = add({ kind: 'tool', name: 'unknown-tool', start: time, end: time, parentId: parentFor(event.agentId), attrs: { toolCallId: event.toolCallId, startObserved: false } });
      }
      span.end = time;
      // A permission denial is its own span status, not a tool failure.
      span.status = event.signal === 'denied' ? 'denied' : (event.success ? 'ok' : 'failed');
      span.attrs.outcome = event.outcome;
      if (event.exitCode !== undefined) span.attrs.exitCode = event.exitCode;
    } else if (event.type === 'hook.start') {
      const turn = lastTurnByAgent.get(event.agentId || '');
      const parentId = turn && turn.end === null ? turn.id : parentFor(event.agentId);
      const span = add({ kind: 'hook', name: event.hookType, start: time, end: null, parentId, status: 'incomplete' });
      if (event.hookId) hooks.set(event.hookId, span);
    } else if (event.type === 'hook.end') {
      const span = hooks.get(event.hookId);
      if (span) {
        span.end = time;
        span.status = event.success ? 'ok' : 'failed';
        if (!event.success) span.attrs.outcome = 'failed';
      }
    } else if (event.type === 'session.compaction_start') {
      add({ id: `compaction-${spans.length}`, kind: 'compaction', name: 'context compaction', start: time, end: null, status: 'incomplete' }).parentId = root.id;
    } else if (event.type === 'session.compaction_complete') {
      const open = [...spans].reverse().find(span => span.kind === 'compaction' && span.end === null);
      if (open) {
        open.end = time;
        open.status = 'ok';
      }
    }
  }

  // Ledger spans: attach exact tool-call joins, add chat (model call) spans, and only
  // add ledger tools that have no matching session event (e.g. ledger-only runs).
  const turnSpans = spans.filter(span => span.kind === 'turn');
  for (const ledger of ledgerSpans) {
    if (ledger.op === 'execute_tool') {
      const match = ledger.toolCallId ? tools.get(ledger.toolCallId) : null;
      if (match) {
        match.attrs.spanId = ledger.spanId;
        continue;
      }
      add({ kind: 'tool', name: ledger.toolName || 'unknown-tool', start: ledger.start, end: ledger.end, parentId: root.id, status: ledger.failed ? 'failed' : 'ok', attrs: { spanId: ledger.spanId, toolCallId: ledger.toolCallId, outcome: ledger.outcome } });
    } else if (ledger.op === 'chat') {
      // Ledger chat spans carry no turn ID, so join by time, preferring main-agent turns.
      const contains = span => span.start <= ledger.start && (span.end ?? tEnd) >= ledger.start;
      const turn = turnSpans.find(span => span.parentId === root.id && contains(span)) || turnSpans.find(contains);
      add({
        kind: 'chat',
        name: ledger.model || 'model call',
        start: ledger.start,
        end: ledger.end,
        parentId: turn?.id || root.id,
        status: ledger.failed ? 'failed' : 'ok',
        attrs: { spanId: ledger.spanId, model: ledger.model, inputTokens: ledger.input, outputTokens: ledger.output, cacheReadTokens: ledger.cacheRead, cacheWriteTokens: ledger.cacheWrite, outcome: ledger.outcome }
      });
    } else if (ledger.op === 'invoke_agent' && !events.length) {
      root.attrs.spanId = ledger.spanId;
    }
  }

  for (const span of spans) {
    if (span.end === null) span.end = tEnd;
    if (span.end < span.start) span.end = span.start;
  }
  root.start = Math.min(...spans.map(span => span.start));
  root.end = Math.max(...spans.map(span => span.end));

  const children = new Map();
  for (const span of spans) {
    if (span === root) continue;
    const parentId = byId.has(span.parentId) ? span.parentId : root.id;
    span.parentId = parentId;
    const list = children.get(parentId) || [];
    list.push(span);
    children.set(parentId, list);
  }
  const ordered = [];
  const visit = (span, depth) => {
    const kids = (children.get(span.id) || []).sort((a, b) => a.start - b.start || a.end - b.end);
    ordered.push({
      id: span.id,
      parentId: span === root ? null : span.parentId,
      depth,
      kind: span.kind,
      name: span.name,
      status: span.status,
      startMs: span.start - root.start,
      durationMs: span.end - span.start,
      childCount: kids.length,
      attrs: Object.fromEntries(Object.entries(span.attrs).filter(([, value]) => value !== '' && value !== null && value !== undefined))
    });
    for (const kid of kids) visit(kid, depth + 1);
  };
  visit(root, 0);
  return { spans: ordered, startedAt: root.start, endedAt: root.end };
}

function toolStats(spans) {
  const groups = new Map();
  for (const span of spans) {
    if (span.kind !== 'tool') continue;
    const group = groups.get(span.name) || { tool: span.name, durations: [], failures: 0, denied: 0 };
    group.durations.push(span.durationMs);
    if (span.status === 'failed') group.failures += 1;
    if (span.status === 'denied') group.denied += 1;
    groups.set(span.name, group);
  }
  return [...groups.values()].map(group => ({
    tool: group.tool,
    count: group.durations.length,
    p50Ms: percentile(group.durations, 50),
    p95Ms: percentile(group.durations, 95),
    maxMs: Math.max(...group.durations),
    totalMs: group.durations.reduce((sum, value) => sum + value, 0),
    failures: group.failures,
    denied: group.denied
  })).sort((a, b) => b.totalMs - a.totalMs || a.tool.localeCompare(b.tool));
}

// Cumulative token/cost series. Per-call granularity needs AgentOps ledger chat spans;
// otherwise the session shutdown totals give one honest end-of-session point.
function tokenSeries(spans, sessionUsage, sessionEndMs) {
  const chats = spans.filter(span => span.kind === 'chat' && (span.attrs.inputTokens !== undefined || span.attrs.outputTokens !== undefined))
    .sort((a, b) => (a.startMs + a.durationMs) - (b.startMs + b.durationMs));
  if (chats.length) {
    let input = 0;
    let output = 0;
    let cost = 0;
    let priced = true;
    const points = chats.map(span => {
      input += count(span.attrs.inputTokens);
      output += count(span.attrs.outputTokens);
      const callCost = estimateModelCostUsd(span.attrs.model, { input: span.attrs.inputTokens, output: span.attrs.outputTokens, cacheRead: span.attrs.cacheReadTokens, cacheWrite: span.attrs.cacheWriteTokens });
      if (callCost === null) priced = false;
      else cost += callCost;
      return { tMs: span.startMs + span.durationMs, input, output, costUsd: priced ? cost : null };
    });
    // Ledger chat spans omit cache-write tokens, so per-call prices run low. When the
    // session shutdown totals are priced, allocate that authoritative estimate by
    // cumulative token share so the meter ends at the same figure as the run KPI.
    const sessionEstimate = estimateUsageCost(sessionUsage || {});
    const sessionCost = sessionEstimate.unpricedModels.length ? null : sessionEstimate.costUsd;
    const finalTokens = input + output;
    if (sessionCost !== null && finalTokens > 0) {
      for (const point of points) point.costUsd = sessionCost * ((point.input + point.output) / finalTokens);
      return { granularity: 'call', costBasis: 'session-allocated', points };
    }
    return { granularity: 'call', costBasis: 'per-call', points };
  }
  const total = totals(sessionUsage);
  if (total.input || total.output) {
    const estimate = estimateUsageCost(sessionUsage);
    const costUsd = estimate.unpricedModels.length ? null : estimate.costUsd;
    return { granularity: 'session', points: [{ tMs: sessionEndMs, input: total.input, output: total.output, costUsd }] };
  }
  return { granularity: 'none', points: [] };
}

function summarize(entry, parsed, ledgerSpans, now = Date.now(), { lockAlive = false } = {}) {
  const { events, firstTime, lastTime } = parsed;
  const start = events.find(event => event.type === 'session.start');
  const shutdowns = events.filter(event => event.type === 'session.shutdown');
  const lastShutdown = shutdowns[shutdowns.length - 1];
  const models = new Set();
  for (const event of events) if (event.model) models.add(event.model);
  for (const span of ledgerSpans) if (span.model) models.add(span.model);
  let usage = lastShutdown && Object.keys(lastShutdown.usage).length ? lastShutdown.usage : usageFromLedger(ledgerSpans);
  if (!Object.keys(usage).length) {
    usage = usageFromCalls(events);
    for (const name of Object.keys(usage)) models.add(name);
  }
  usage = Object.fromEntries(Object.entries(usage).filter(([model]) => model));
  const tokenTotals = totals(usage);
  const tokensKnown = Object.keys(usage).length > 0;
  const cost = tokensKnown ? estimateUsageCost(usage) : { costUsd: null, unpricedModels: [] };
  const lastModelEvent = [...events].reverse().find(event => event.model && event.type !== 'subagent.started');
  const model = lastShutdown?.model || lastModelEvent?.model || start?.model || [...models][0] || '';

  const { spans } = buildSpans(events, ledgerSpans, { firstTime, lastTime });
  const toolSpans = spans.filter(span => span.kind === 'tool');
  let failedItems = spans.filter(span => span.status === 'failed' && span.kind !== 'session')
    .map(span => ({ kind: span.kind, name: span.name, outcome: span.attrs.outcome || 'failed' }));
  let toolFailures = toolSpans.filter(span => span.status === 'failed').length;
  let deniedItems = spans.filter(span => span.status === 'denied')
    .map(span => ({ kind: span.kind, name: span.name, outcome: 'denied' }));
  let nonZeroItems = nonZeroExitSpans(toolSpans)
    .map(span => ({ kind: span.kind, name: span.name, outcome: 'nonzero_exit' }));
  const startedAt = start?.startTime ?? start?.time ?? firstTime ?? (ledgerSpans.length ? Math.min(...ledgerSpans.map(span => span.start)) : null);
  const endedAt = lastTime ?? (ledgerSpans.length ? Math.max(...ledgerSpans.map(span => span.end)) : startedAt);
  const durationMs = events.length ? activeDuration(events, firstTime, lastTime) : Math.max(0, (endedAt || 0) - (startedAt || 0));
  const ended = events.length ? sessionEnded(events) : ledgerSpans.length > 0;
  const idleMs = entry.mtimeMs ? now - entry.mtimeMs : Infinity;
  const live = !ended && (idleMs < LIVE_WINDOW_MS || (lockAlive && idleMs < LOCK_LIVE_MAX_MS));
  // A running session is shown as live even if a tool already failed; the failure count still shows.
  if (events.length) {
    const starts = new Map(events.filter(e => e.type === 'tool.execution_start').map(e => [e.toolCallId, e.toolName]));
    const items = events.map(e => {
      if (e.type === 'tool.execution_complete') return { kind: 'tool', name: starts.get(e.toolCallId) || 'unknown-tool', outcome: e.signal || classifyToolCompletionEvent({ success: e.success, error: { code: e.outcome }, shellExecution: { exitCode: e.exitCode } }) };
      if (e.type === 'hook.end' && e.success === false) return { kind: 'hook', name: e.hookType || 'hook', outcome: 'failed' };
      if (e.type === 'subagent.failed') return { kind: 'agent', name: e.agentName || 'subagent', outcome: 'failed' };
      return null;
    }).filter(Boolean);
    failedItems = items.filter(item => item.outcome === 'failed');
    deniedItems = items.filter(item => item.outcome === 'denied');
    nonZeroItems = items.filter(item => item.outcome === 'nonzero_exit');
    toolFailures = failedItems.filter(item => item.kind === 'tool').length;
  }
  const { status, statusLabel, statusReasons } = events.length
    ? sessionRunStatus(events, { live: Boolean(live), ended })
    : classifyRunStatus({ failures: failedItems.length, denials: deniedItems.length, nonZeroExits: nonZeroItems.length, live: Boolean(live), ended });
  const repo = start?.repo?.name ? start.repo : { name: '', hash: entry.ledgerRuns[0]?.repoHash || '' };

  return {
    id: entry.id,
    runId: entry.ledgerRuns[0]?.runId || null,
    source: entry.eventsFile ? (entry.ledgerRuns.length ? 'copilot+ledger' : 'copilot') : 'ledger',
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    endedAt: endedAt ? new Date(endedAt).toISOString() : null,
    durationMs,
    repo,
    model,
    models: [...models].sort(),
    copilotVersion: start?.copilotVersion || '',
    tokens: { ...tokenTotals, known: tokensKnown },
    usageByModel: usage,
    premiumRequests: lastShutdown?.premiumRequests ?? null,
    costUsd: cost.costUsd,
    unpricedModels: cost.unpricedModels,
    costLabel: formatCostTotal(cost),
    turns: spans.filter(span => span.kind === 'turn').length,
    subagents: spans.filter(span => span.kind === 'agent').length,
    toolCalls: toolSpans.length,
    toolFailures,
    failures: failedItems.length,
    failureGroups: failureGroups(failedItems),
    denials: deniedItems.length,
    nonZeroExits: nonZeroItems.length,
    attentionGroups: failureGroups([...deniedItems, ...nonZeroItems]),
    traceSpans: spans.length,
    nativeSpans: ledgerSpans.length,
    spanCountLabels: { traceSpans: SPAN_COUNT_LABELS.traceSpans, nativeSpans: SPAN_COUNT_LABELS.nativeSpans },
    p95ToolMs: percentile(toolSpans.map(span => span.durationMs), 95),
    toolNames: [...new Set(toolSpans.map(span => span.name))].sort(),
    status,
    statusLabel,
    statusReasons,
    _ended: ended,
    _toolDurations: toolSpans.map(span => span.durationMs)
  };
}

function publicRow(row) {
  const { _toolDurations, _ended, usageByModel, ...rest } = row;
  return rest;
}

function matchesFilters(row, filters = {}) {
  if (filters.model && !row.models.includes(filters.model) && row.model !== filters.model) return false;
  if (filters.repo && row.repo.name !== filters.repo && row.repo.hash !== filters.repo) return false;
  if (filters.status && row.status !== filters.status) return false;
  // `copilot` keeps runs backed by a Copilot session (the set `agentops digest` reads).
  if (filters.source && !(filters.source === 'copilot' ? row.source !== 'ledger' : row.source === filters.source)) return false;
  if (Number.isFinite(filters.sinceMs) && !(Date.parse(row.startedAt || '') >= filters.sinceMs)) return false;
  const query = String(filters.q || '').trim().toLowerCase();
  if (query) {
    const haystack = [row.id, row.runId, row.repo.name, row.model, ...row.models, ...row.toolNames, row.status].join(' ').toLowerCase();
    if (!query.split(/\s+/).every(term => haystack.includes(term))) return false;
  }
  return true;
}

function aggregateKpis(rows) {
  const durations = rows.flatMap(row => row._toolDurations || []);
  const tokenRows = rows.filter(row => row.tokens.known);
  // Priced per model across the whole run set with the estimator `agentops digest` uses.
  const cost = estimateRunsCost(tokenRows.map(row => row.usageByModel));
  return {
    runs: rows.length,
    failedRuns: rows.filter(row => row.status === 'failed').length,
    attentionRuns: rows.filter(row => row.status === 'attention').length,
    failures: rows.reduce((sum, row) => sum + row.failures, 0),
    toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0),
    p95ToolMs: percentile(durations, 95),
    tokens: {
      input: tokenRows.reduce((sum, row) => sum + row.tokens.input, 0),
      output: tokenRows.reduce((sum, row) => sum + row.tokens.output, 0),
      runsWithTokens: tokenRows.length
    },
    premiumRequests: rows.reduce((sum, row) => sum + (row.premiumRequests || 0), 0),
    costUsd: cost.costUsd,
    costLabel: formatCostTotal(cost),
    unpricedModels: cost.unpricedModels,
    costRuns: tokenRows.filter(row => row.costUsd !== null && !row.unpricedModels.length).length,
    unpricedRuns: tokenRows.filter(row => row.unpricedModels.length).length
  };
}

function facets(rows) {
  const tally = values => {
    const counts = new Map();
    for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].map(([value, total]) => ({ value, count: total })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return {
    models: tally(rows.map(row => row.model)),
    repos: tally(rows.map(row => row.repo.name)),
    statuses: tally(rows.map(row => row.status))
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Content is read in a separate pass and only when the server was started with
// --allow-content. Values are secret-redacted and truncated.
const CONTENT_MAX = 4000;
function contentText(value) {
  if (value === undefined || value === null || value === '') return '';
  const redacted = redactContent(value);
  const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);
  return text.length > CONTENT_MAX ? `${text.slice(0, CONTENT_MAX)}\u2026 [truncated]` : text;
}

async function readSessionContent(file) {
  const prompts = [];
  const tools = {};
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const prefix = TYPE_PREFIX.exec(line);
    if (prefix && !['user.message', 'tool.execution_start', 'tool.execution_complete'].includes(prefix[1])) continue;
    let raw;
    try { raw = JSON.parse(line); } catch { continue; }
    const data = raw.data || {};
    if (raw.type === 'user.message') prompts.push({ at: raw.timestamp || null, text: contentText(data.content) });
    if (raw.type === 'tool.execution_start' && data.toolCallId) {
      tools[data.toolCallId] = { ...(tools[data.toolCallId] || {}), arguments: contentText(data.arguments) };
    }
    if (raw.type === 'tool.execution_complete' && data.toolCallId) {
      tools[data.toolCallId] = { ...(tools[data.toolCallId] || {}), result: contentText(data.result?.content ?? data.result), error: contentText(data.error?.message) };
    }
  }
  return { prompts, tools };
}

class RunStore {
  constructor(options = {}) {
    this.copilotHome = options.copilotHome || defaultCopilotHome();
    this.agentOpsHome = options.agentOpsHome || defaultAgentOpsHome();
    this.limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 100;
    this.allowContent = Boolean(options.allowContent);
    this.now = options.now || (() => Date.now());
    this.cache = new Map();
    this.discovery = null;
    this.discoveredAt = 0;
  }

  discover() {
    if (!this.discovery || this.now() - this.discoveredAt > 5000) {
      this.discovery = discoverSessions({ copilotHome: this.copilotHome, agentOpsHome: this.agentOpsHome });
      this.discoveredAt = this.now();
    }
    return this.discovery;
  }

  async load(entry) {
    const baseKey = `${entry.id}:${entry.mtimeMs}:${entry.size}:${entry.ledgerRuns.map(run => run.runId).join(',')}`;
    const cached = this.cache.get(entry.id);
    // Only a session that has not shut down can be held open by a running Copilot process.
    const lockAlive = entry.eventsFile && !(cached?.baseKey === baseKey && cached.value.row._ended)
      ? sessionLockAlive(path.dirname(entry.eventsFile))
      : false;
    const key = `${baseKey}:${lockAlive ? 'locked' : ''}`;
    // "live" depends on the clock, so a quiet live session is re-summarised once it goes stale.
    const idleMs = this.now() - entry.mtimeMs;
    const stale = cached?.value.row.status === 'live' && idleMs >= LIVE_WINDOW_MS && !(lockAlive && idleMs < LOCK_LIVE_MAX_MS);
    if (cached && cached.key === key && !stale) return cached.value;
    const parsed = entry.eventsFile
      ? await readSessionEvents(entry.eventsFile).catch(() => ({ events: [], firstTime: null, lastTime: null, malformed: 0 }))
      : { events: [], firstTime: null, lastTime: null, malformed: 0 };
    const ledgerSpans = entry.ledgerRuns[0] ? readLedgerSpans(entry.ledgerRuns[0].dir) : [];
    const value = { parsed, ledgerSpans, row: summarize(entry, parsed, ledgerSpans, this.now(), { lockAlive }) };
    this.cache.set(entry.id, { key, baseKey, value });
    return value;
  }

  async list(filters = {}) {
    const { sessions } = this.discover();
    // With a time window, analyse every session written inside it (the set `agentops
    // digest --since` reads) instead of only the newest N, up to WINDOW_SCAN_MAX.
    const windowed = Number.isFinite(filters.sinceMs);
    const candidates = windowed ? sessions.filter(entry => entry.mtimeMs >= filters.sinceMs) : sessions;
    const cap = windowed ? Math.max(this.limit, WINDOW_SCAN_MAX) : this.limit;
    const scanned = candidates.slice(0, cap);
    const loaded = await mapLimit(scanned, 6, entry => this.load(entry));
    const all = loaded.map(item => item.row).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    const rows = all.filter(row => matchesFilters(row, filters));
    return {
      generatedAt: new Date(this.now()).toISOString(),
      scanned: scanned.length,
      totalSessions: sessions.length,
      limit: this.limit,
      window: windowed
        ? { since: filters.since || null, start: new Date(filters.sinceMs).toISOString(), sessions: candidates.length, cap, capped: candidates.length > scanned.length }
        : null,
      allowContent: this.allowContent,
      kpis: aggregateKpis(rows),
      facets: facets(all),
      runs: rows.map(publicRow)
    };
  }

  findEntry(id) {
    if (typeof id !== 'string' || !SESSION_ID.test(id) || id === 'latest') return null;
    const { sessions } = this.discover();
    return sessions.find(entry => entry.id === id || entry.ledgerRuns.some(run => run.runId === id)) || null;
  }

  // "latest" = the session of the newest `agentops copilot-session launch` run
  // (native_run_* by createdAt). Without one, the most recently written session that
  // has finished; an in-progress session is only chosen when nothing has finished.
  async latestEntry() {
    const { sessions } = this.discover();
    let launched = null;
    let launchedAt = -Infinity;
    for (const entry of sessions) {
      for (const run of entry.ledgerRuns) {
        if (LAUNCH_RUN_ID.test(run.runId) && run.createdAt > launchedAt) {
          launched = entry;
          launchedAt = run.createdAt;
        }
      }
    }
    if (launched) return launched;
    const ordered = [...sessions].sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0) || a.id.localeCompare(b.id));
    for (const entry of ordered) {
      const { row } = await this.load(entry);
      if (row._ended && row.status !== 'live') return entry;
    }
    return ordered[0] || null;
  }

  async resolveEntry(id) {
    if (id === 'latest') return this.latestEntry();
    return this.findEntry(id);
  }

  async detail(id) {
    const entry = await this.resolveEntry(id);
    if (!entry) return null;
    const { parsed, ledgerSpans, row } = await this.load(entry);
    const { spans } = buildSpans(parsed.events, ledgerSpans, parsed);
    const root = spans[0];
    return {
      run: publicRow(row),
      allowContent: this.allowContent && Boolean(entry.eventsFile),
      failures: row.failureGroups.map(group => ({ ...group, message: failureSentence(group) })),
      attention: row.attentionGroups.map(group => ({ ...group, message: failureSentence(group) })),
      warnings: row.attentionGroups.map(failureSentence),
      spans,
      tokenSeries: tokenSeries(spans, row.usageByModel, root ? root.durationMs : 0),
      toolStats: toolStats(spans),
      usageByModel: Object.entries(row.usageByModel).map(([model, usage]) => ({ model, ...usage, costUsd: estimateModelCostUsd(model, usage) }))
    };
  }

  async content(id) {
    if (!this.allowContent) return null;
    const entry = await this.resolveEntry(id);
    if (!entry || !entry.eventsFile) return null;
    return readSessionContent(entry.eventsFile);
  }
}

module.exports = {
  RunStore,
  TRACKED_TYPES,
  aggregateKpis,
  buildSpans,
  dedupeSpans,
  defaultAgentOpsHome,
  defaultCopilotHome,
  discoverSessions,
  failureSentence,
  matchesFilters,
  minimalEvent,
  normalizeLedgerSpan,
  percentile,
  publicRow,
  readLedgerIndex,
  readLedgerSpans,
  readSessionContent,
  readSessionEvents,
  repoIdentity,
  safeLabel,
  sessionEnded,
  sessionLockAlive,
  summarize,
  tokenSeries,
  toolStats
};
