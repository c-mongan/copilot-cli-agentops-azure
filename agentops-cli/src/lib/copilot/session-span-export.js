const fs = require('node:fs');
const path = require('node:path');
const { AGENTOPS_SCHEMA_VERSION } = require('../schema/agentops-attributes');
const { dedupeNativeSpans } = require('./native-span-identity');

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_SPAN_MAX_BYTES = 20 * 1024 * 1024;

// Mirrors the DurationNs null-preserving pattern: absent/unparseable stays
// null so "never measured" cannot be confused with a measured zero, on
// either the write (span.* -> Row) or read-back (Row -> span.*) side.
function nullableTokenCount(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sessionToolContext(events = []) {
  let mainAgent = '';
  const agentById = new Map();
  const toolsByCallId = new Map();
  for (const event of events) {
    const data = event?.data || {};
    const agentName = data.agentDisplayName || data.agentName || data.agentId || '';
    if (event?.type === 'subagent.selected' && agentName) {
      if (event.agentId) agentById.set(event.agentId, agentName);
      else if (!mainAgent) mainAgent = agentName;
    }
    if (event?.type === 'subagent.started' && event.agentId && agentName) {
      agentById.set(event.agentId, agentName);
    }
    if (event?.type !== 'tool.execution_start' || !data.toolCallId) continue;
    const agent = (event.agentId && agentById.get(event.agentId)) || mainAgent;
    toolsByCallId.set(data.toolCallId, {
      agentName: typeof agent === 'string' ? agent : '',
      parentToolCallId: typeof data.parentToolCallId === 'string' ? data.parentToolCallId : '',
      mcpServerName: typeof data.mcpServerName === 'string' ? data.mcpServerName : '',
      mcpToolName: typeof data.mcpToolName === 'string' ? data.mcpToolName : ''
    });
  }
  return toolsByCallId;
}

function enrichSpansWithSessionToolContext(spans = [], events = []) {
  const contexts = sessionToolContext(events);
  const toolSpansByCallId = new Map();
  for (const span of spans) {
    if (!span.toolCallId || !span.spanName?.startsWith('execute_tool ')) continue;
    const values = toolSpansByCallId.get(span.toolCallId) || [];
    values.push(span);
    toolSpansByCallId.set(span.toolCallId, values);
  }
  const shellCalls = events.filter(event => event?.type === 'tool.execution_start'
    && ['bash', 'shell', 'run_in_terminal'].includes(event?.data?.toolName)
    && typeof event?.data?.toolCallId === 'string'
    && event.data.toolCallId);
  const eventTime = event => {
    const value = Date.parse(event?.timestamp || '');
    return Number.isFinite(value) ? value : null;
  };
  return spans.map(span => {
    const context = span.toolCallId ? contexts.get(span.toolCallId) : undefined;
    if (context) {
      span = {
        ...span,
        agent: span.agent && span.agent !== 'native OTel' ? span.agent : context.agentName || span.agent,
        parentToolCallId: context.parentToolCallId,
        mcpServerName: context.mcpServerName,
        mcpToolName: context.mcpToolName,
        toolCallEvidence: 'exact-session-tool-call-id'
      };
    }
    if (span.match !== 'run-linked-script' || !span.scriptName) return span;

    const candidates = shellCalls.filter(event => {
      const args = event.data.arguments;
      const command = typeof args === 'string' ? args : JSON.stringify(args ?? '');
      return command.includes(span.scriptName);
    });
    const containedCandidates = new Map();
    for (const event of candidates) {
      const callId = event.data.toolCallId;
      const nativeWindow = (toolSpansByCallId.get(callId) || [])
        .some(toolSpan => span.start >= toolSpan.start && span.end <= toolSpan.end);
      const start = eventTime(event);
      const completion = events.find(item => item?.type === 'tool.execution_complete'
        && item?.data?.toolCallId === callId
        && (item.agentId || '') === (event.agentId || ''));
      const end = eventTime(completion);
      const sessionWindow = start !== null && end !== null && span.start >= start && span.end <= end;
      if (nativeWindow || sessionWindow) {
        containedCandidates.set(callId, {
          event,
          evidence: nativeWindow ? 'inferred-unique-tool-span-window' : 'inferred-unique-session-tool-event-window'
        });
      }
    }
    if (containedCandidates.size !== 1) return span;

    const { event, evidence } = [...containedCandidates.values()][0];
    const scriptContext = contexts.get(event.data.toolCallId);
    return {
      ...span,
      toolCallId: event.data.toolCallId,
      agent: span.agent && span.agent !== 'native OTel' ? span.agent : scriptContext?.agentName || span.agent,
      toolCallEvidence: evidence,
      scriptLinkEvidence: evidence === 'inferred-unique-tool-span-window'
        ? 'unique-script-path-contained-by-tool-span'
        : 'unique-script-path-contained-by-session-tool-event'
    };
  });
}

function spanRowsFromOtelSpans(spans, sessionId, runId) {
  if (!ID_PATTERN.test(sessionId || '') || !ID_PATTERN.test(runId || '')) {
    throw new Error('span export requires valid session and run IDs');
  }
  const rows = [];
  for (const span of spans || []) {
    let durationNs = null;
    if (span.durationNs !== null) {
      try {
        durationNs = span.durationNs !== undefined
          ? BigInt(span.durationNs)
          : BigInt(Math.max(0, Math.round((span.end - span.start) * 1000000)));
        if (durationNs < 0n) durationNs = null;
      } catch {
        durationNs = null;
      }
    }
    const common = {
      RunId: runId,
      SessionId: sessionId,
      TraceId: span.traceId || '',
      SpanId: span.spanId || '',
      ParentSpanId: span.parentSpanId || '',
      ParentToolCallId: span.parentToolCallId || '',
      AgentName: span.agent === 'native OTel' ? '' : span.agent || '',
      ToolName: span.toolName || '',
      ToolCallId: span.toolCallId || '',
      ToolCallEvidence: span.toolCallEvidence || '',
      McpServerName: span.mcpServerName || '',
      McpToolName: span.mcpToolName || '',
      ScriptName: span.scriptName || '',
      ScriptRuntimeName: span.scriptRuntimeName || '',
      ScriptRuntimeVersion: span.scriptRuntimeVersion || '',
      ScriptRuntimeImplementation: span.scriptRuntimeImplementation || '',
      ScriptLoaderName: span.scriptLoaderName || '',
      // Legacy/display-only: response model falling back to the requested model. Do not
      // use this to assert actual identity; ModelRequested/ModelActual below do that.
      Model: span.model || '',
      // Native producer request identity, never overwritten by launcher intent.
      ModelRequested: span.modelRequested || '',
      ModelActual: span.modelActual || '',
      Provider: span.provider || '',
      InputTokens: nullableTokenCount(span.inputTokens),
      OutputTokens: nullableTokenCount(span.outputTokens),
      CacheReadTokens: nullableTokenCount(span.cacheReadTokens),
      CacheWriteTokens: nullableTokenCount(span.cacheWriteTokens),
      ErrorType: span.errorType || '',
      DurationMs: durationNs === null
        ? Math.max(0, Math.round(span.end - span.start))
        : Math.round(Number(durationNs) / 1000000),
      DurationNs: durationNs === null ? null : Number(durationNs),
      Outcome: span.failed ? 'failed' : span.outcome === 'unknown' ? 'unknown' : 'ok',
      LinkType: span.match === 'run-linked-script' ? 'run-id-logical-link' : 'native-session',
      SchemaVersion: AGENTOPS_SCHEMA_VERSION
    };
    rows.push({
      TimeGenerated: new Date(span.start).toISOString(),
      ...common,
      SpanName: span.spanName || span.operation || 'unknown',
      OperationName: span.operation || '',
      StepName: span.stepName || '',
      EventName: '',
      SkillName: ''
    });
    for (const event of span.events || []) {
      const attributes = event.attributes || {};
      rows.push({
        TimeGenerated: new Date(event.time).toISOString(),
        ...common,
        SpanName: event.name,
        OperationName: event.name,
        ParentSpanId: span.spanId,
        StepName: '',
        EventName: event.name,
        SkillName: String(attributes['github.copilot.skill.name'] || attributes['agentops.skill.name'] || ''),
        LinkType: 'span-event'
      });
    }
  }
  return rows;
}

function writeSessionSpans(spans, sessionId, runId, outputPath) {
  if (!outputPath || path.basename(outputPath) !== 'AgentOpsSpans_CL.jsonl') {
    throw new Error('copilot-session export-spans requires --output <dir>/AgentOpsSpans_CL.jsonl');
  }
  const rows = spanRowsFromOtelSpans(spans, sessionId, runId);
  if (!rows.length) throw new Error('session has no matching native or run-linked spans');
  const output = path.resolve(outputPath);
  fs.writeFileSync(output, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return { output, rows: rows.length };
}

function readSessionSpanRows(runDirectory, runId, sessionId) {
  if (!ID_PATTERN.test(runId || '') || !ID_PATTERN.test(sessionId || '')) {
    throw new Error('local span read requires valid run and session IDs');
  }
  const file = path.join(runDirectory, 'AgentOpsSpans_CL.jsonl');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return { spans: [], invalid: 0 };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('local session span ledger must be a regular file');
  if (stat.size > SESSION_SPAN_MAX_BYTES) throw new Error(`local session span ledger exceeds ${SESSION_SPAN_MAX_BYTES} bytes`);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fs.chmodSync(file, 0o600);

  const canonical = new Map();
  const spanEvents = [];
  let invalid = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { invalid += 1; continue; }
    if (row?.RunId !== runId || row?.SessionId !== sessionId) { invalid += 1; continue; }
    const linkType = String(row.LinkType || '');
    if (linkType === 'span-event') {
      spanEvents.push(row);
      continue;
    }
    if (!['native-session', 'run-id-logical-link'].includes(linkType)) continue;
    const start = Date.parse(row.TimeGenerated || '');
    const rawDurationNs = row.DurationNs;
    const durationNsText = typeof rawDurationNs === 'string' && /^\d+$/.test(rawDurationNs)
      ? rawDurationNs
      : Number.isSafeInteger(rawDurationNs) && rawDurationNs >= 0 ? String(rawDurationNs) : null;
    const durationMs = durationNsText !== null
      ? Number(BigInt(durationNsText)) / 1000000
      : Number(row.DurationMs);
    if (!Number.isFinite(start) || !Number.isFinite(durationMs) || durationMs < 0
      || typeof row.TraceId !== 'string' || !row.TraceId
      || typeof row.SpanId !== 'string' || !row.SpanId) {
      invalid += 1;
      continue;
    }
    const identity = `${row.TraceId}:${row.SpanId}`;
    if (canonical.has(identity)) continue;
    const script = linkType === 'run-id-logical-link';
    const toolName = String(row.ToolName || '');
    const operation = String(row.OperationName || row.SpanName || 'unknown');
    canonical.set(identity, {
      start,
      end: start + durationMs,
      durationMs,
      durationNs: durationNsText,
      traceId: row.TraceId,
      spanId: row.SpanId,
      parentSpanId: String(row.ParentSpanId || ''),
      spanName: script ? String(row.SpanName || operation) : operation === 'execute_tool' && toolName ? `execute_tool ${toolName}` : String(row.SpanName || operation),
      operation,
      toolName,
      toolCallId: String(row.ToolCallId || ''),
      toolCallEvidence: String(row.ToolCallEvidence || ''),
      parentToolCallId: String(row.ParentToolCallId || ''),
      mcpServerName: String(row.McpServerName || ''),
      mcpToolName: String(row.McpToolName || ''),
      agent: String(row.AgentName || 'native OTel'),
      scriptName: String(row.ScriptName || ''),
      scriptRuntimeName: String(row.ScriptRuntimeName || ''),
      scriptRuntimeVersion: String(row.ScriptRuntimeVersion || ''),
      scriptRuntimeImplementation: String(row.ScriptRuntimeImplementation || ''),
      scriptLoaderName: String(row.ScriptLoaderName || ''),
      stepName: String(row.StepName || ''),
      model: String(row.Model || ''),
      modelRequested: String(row.ModelRequested || ''),
      modelActual: String(row.ModelActual || ''),
      provider: String(row.Provider || ''),
      inputTokens: nullableTokenCount(row.InputTokens),
      outputTokens: nullableTokenCount(row.OutputTokens),
      cacheReadTokens: nullableTokenCount(row.CacheReadTokens),
      cacheWriteTokens: nullableTokenCount(row.CacheWriteTokens),
      failed: String(row.Outcome || '').toLowerCase() === 'failed',
      outcome: String(row.Outcome || '').toLowerCase(),
      errorType: String(row.ErrorType || ''),
      match: script ? 'run-linked-script' : 'exact-session',
      runId,
      sessionId,
      events: []
    });
  }
  const seenEvents = new Set();
  for (const row of spanEvents) {
    const identity = `${row.TraceId || ''}:${row.ParentSpanId || row.SpanId || ''}`;
    const parent = canonical.get(identity);
    const time = Date.parse(row.TimeGenerated || '');
    const name = String(row.EventName || row.SpanName || row.OperationName || '');
    if (!parent || !Number.isFinite(time) || !name) continue;
    const eventIdentity = `${identity}\u0000${time}\u0000${name}\u0000${row.SkillName || ''}`;
    if (seenEvents.has(eventIdentity)) continue;
    seenEvents.add(eventIdentity);
    parent.events.push({
      time,
      name,
      attributes: row.SkillName ? { 'github.copilot.skill.name': String(row.SkillName) } : {}
    });
  }
  return { spans: dedupeNativeSpans([...canonical.values()]), invalid };
}

module.exports = { enrichSpansWithSessionToolContext, readSessionSpanRows, sessionToolContext, spanRowsFromOtelSpans, writeSessionSpans };
