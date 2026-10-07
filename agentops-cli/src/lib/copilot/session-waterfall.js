const fs = require('node:fs');
const path = require('node:path');

const { attachmentReferencePaths, attachmentSkillReferences, directShellPathRead, operationFields } = require('./session-event-export');
const { redactContent } = require('./session-content');
const { reconcileModelProvenance, safeModelIdentity } = require('./execution-configuration');

const RAW_CONTENT_FIELD_NAMES = new Set([
  'content', 'arguments', 'result', 'output', 'deltaContent', 'inputDelta',
  'argumentsPreview', 'partialContent'
]);
const METADATA_ONLY_PLACEHOLDER = '[content redacted \u2014 metadata-only view; pass --allow-content to render full payload locally]';
const SAFE_METADATA_FIELD_NAMES = new Set([
  'agentId', 'agentName', 'candidates', 'chunks', 'declared', 'durationMs',
  'end', 'evidence', 'exitCode', 'firstAt', 'lastAt', 'linkType', 'match',
  'mcpServerName', 'mcpToolName', 'model', 'modelActual', 'modelRequested',
  'name', 'nativeOtel', 'owningSkillLink', 'parentAgentId', 'parentSpanId',
  'parentToolCallId', 'provider', 'readCount', 'referenceName', 'runtimeName',
  'runtimeVersion', 'scriptLinkEvidence', 'scriptName', 'skillName', 'source',
  'spanId', 'start', 'status', 'success', 'toolCallEvidence',
  'toolCallEvidenceLinks', 'toolCallId', 'toolCallLink', 'toolCallStream',
  'toolName', 'traceId', 'completion', 'shellExecution', 'startAt', 'stepName',
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'
]);

// An allowlist keeps future Copilot payload fields out of default HTML exports.
function redactRawContent(value) {
  if (Array.isArray(value)) return value.map(redactRawContent);
  if (value && typeof value === 'object') {
    const redacted = {};
    for (const [key, nested] of Object.entries(value)) {
      if (RAW_CONTENT_FIELD_NAMES.has(key)) {
        redacted[key] = METADATA_ONLY_PLACEHOLDER;
      } else if (SAFE_METADATA_FIELD_NAMES.has(key)) {
        redacted[key] = redactRawContent(nested);
      }
    }
    return redacted;
  }
  return typeof value === 'string' && value.length > 200 ? '[metadata value omitted: exceeds 200 characters]' : value;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function eventTime(event) {
  const value = Date.parse(event?.timestamp || '');
  return Number.isFinite(value) ? value : null;
}

function normalizedSkillName(value) {
  return typeof value === 'string' && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.replace(/^skill-/, '')
    : '';
}

function safeReferenceToolStart(data, referenceName) {
  const safe = {
    referenceRead: true,
    referenceName,
    toolCallId: data.toolCallId || '',
    toolName: data.toolName || '',
    parentToolCallId: data.parentToolCallId || ''
  };
  if (data.toolCallStream) safe.toolCallStream = data.toolCallStream;
  return safe;
}

function safeReferenceToolCompletion(data) {
  const safe = {
    referenceRead: true,
    toolCallId: data.toolCallId || '',
    success: data.success
  };
  if (Number.isSafeInteger(data.shellExecution?.exitCode)) safe.shellExecution = { exitCode: data.shellExecution.exitCode };
  return safe;
}

function sessionWaterfall(events = [], inputSpans = [], options = {}) {
  const seenSpanIds = new Set();
  const nativeSpans = inputSpans.filter(span => {
    if (!span.traceId || !span.spanId) return true;
    const key = `${span.traceId}:${span.spanId}`;
    if (seenSpanIds.has(key)) return false;
    seenSpanIds.add(key);
    return true;
  });
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const referencePaths = options.referencePaths || attachmentReferencePaths(repoRoot);
  const skillReferences = options.skillReferences || attachmentSkillReferences(repoRoot);
  const ordered = events.map((event, index) => ({ event, index, time: eventTime(event) }))
    .filter(item => item.time !== null)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const pendingTools = new Map();
  const pendingHooks = new Map();
  const pendingTurns = new Map();
  const pendingMessages = new Map();
  const messageStreams = new Map();
  const toolCallStreams = new Map();
  const pendingSubagents = new Map();
  const rows = [];
  const agentNames = new Map();
  for (const { event } of ordered) {
    const data = event.data || {};
    if (event.agentId && (data.agentName || data.agentDisplayName)) {
      agentNames.set(event.agentId, data.agentDisplayName || data.agentName);
    }
  }
  const rootAgent = nativeSpans.find(span => span.match !== 'run-linked-script' && !span.parentSpanId && span.agent)?.agent;
  const parentAgent = rootAgent || 'github-copilot-cli';
  const agentFor = event => agentNames.get(event.agentId) || parentAgent;
  const scopedId = (event, id) => `${event.agentId || 'parent'}:${id || ''}`;
  const invokedSkillsByLane = new Map();
  const referenceReadCounts = new Map();
  const referenceToolCalls = new Set();
  const mcpToolCallIds = new Set();
  let suppressedEvents = 0;
  let unmatchedDeltas = 0;

  // Shared evidence labels: exact / logical / inferred / ambiguous / missing / unsupported / unknown.
  const determineOwningSkillLink = (lane, referenceName, time, index) => {
    const declaringSkills = new Set(skillReferences.get(referenceName) || []);
    const candidates = [];
    // Tracks, per candidate skill name, the distinct agentIds whose invocation of that
    // name tied the read's own timestamp. When a single name has 2+ distinct agentIds
    // at that tie, the only reason it counted as "earlier" was the array-index
    // tiebreak across what are really concurrent, independently-ordered event streams
    // sharing a lane (e.g. two subagents with the same display name) — that index
    // reflects incidental array position, not genuine source order, so the ownership
    // determination must say 'unknown' rather than invent a confident 'inferred' pick.
    const tiedAgentsByName = new Map();
    for (const invocation of invokedSkillsByLane.get(lane) || []) {
      const earlier = invocation.time < time || invocation.time === time && invocation.index < index;
      if (!earlier || !declaringSkills.has(invocation.name)) continue;
      if (!candidates.includes(invocation.name)) candidates.push(invocation.name);
      if (invocation.time === time) {
        const agentIds = tiedAgentsByName.get(invocation.name) || new Set();
        agentIds.add(invocation.agentId || '');
        tiedAgentsByName.set(invocation.name, agentIds);
      }
    }
    if (candidates.length === 1) {
      const tiedAgents = tiedAgentsByName.get(candidates[0]);
      if (tiedAgents && tiedAgents.size > 1) return { evidence: 'unknown', skillName: '', candidates };
      return { evidence: 'inferred', skillName: candidates[0], candidates };
    }
    if (candidates.length > 1) return { evidence: 'ambiguous', skillName: '', candidates };
    return { evidence: 'missing', skillName: '', candidates: [] };
  };

  const addReferenceReadRow = ({ event, index, time, lane, referenceName, toolCallId, parentToolCallId, declared = true }) => {
    if (!referenceName || !toolCallId) return;
    const countKey = `${lane}\u0000${referenceName}`;
    const readCount = (referenceReadCounts.get(countKey) || 0) + 1;
    referenceReadCounts.set(countKey, readCount);
    // Undeclared-but-safe reads never get an ownership guess: there is no declaring
    // skill to attribute them to, so the evidence label is 'unsupported' — distinct
    // from 'missing' (a declared reference manifest entry with zero declaring-skill
    // evidence) because this path was never declared/sanctioned at all.
    const owningSkillLink = declared
      ? determineOwningSkillLink(lane, referenceName, time, index)
      : { evidence: 'unsupported', skillName: '', candidates: [] };
    rows.push({
      index,
      start: time,
      end: time,
      lane,
      kind: 'reference.read',
      label: declared ? `reference: ${referenceName}` : `reference (undeclared): ${referenceName}`,
      status: 'observed',
      source: 'session event',
      details: {
        referenceName,
        readCount,
        toolCallId,
        parentToolCallId: parentToolCallId || '',
        agentId: event.agentId || '',
        declared,
        toolCallLink: { evidence: 'exact', toolCallId },
        owningSkillLink
      }
    });
  };

  for (const { event, index, time } of ordered) {
    const data = event.data || {};
    const type = event.type || 'unknown';
    const row = { index, start: time, end: time, lane: agentFor(event), kind: type, label: type, status: 'observed', source: 'session event', details: data };
    if (type === 'assistant.message_start') {
      if (data.messageId) pendingMessages.set(scopedId(event, data.messageId), { time, event });
      continue;
    }
    if (type === 'assistant.message_delta') {
      if (!data.messageId) {
        unmatchedDeltas += 1;
        continue;
      }
      const key = scopedId(event, data.messageId);
      const stream = messageStreams.get(key) || { count: 0, text: '', first: time, last: time, agentId: event.agentId };
      stream.count += 1;
      stream.text += String(data.deltaContent || '');
      stream.last = time;
      messageStreams.set(key, stream);
      continue;
    }
    if (type === 'assistant.tool_call_delta') {
      if (!data.toolCallId) {
        unmatchedDeltas += 1;
        continue;
      }
      const key = scopedId(event, data.toolCallId);
      const stream = toolCallStreams.get(key) || { count: 0, input: '', first: time, last: time, toolName: data.toolName || '', agentId: event.agentId };
      stream.count += 1;
      stream.input += String(data.inputDelta || '');
      stream.last = time;
      toolCallStreams.set(key, stream);
      continue;
    }
    // Copilot emits token-level private reasoning and background-state churn.
    // Keep them out of the operation timeline while counting omitted records.
    if (type === 'assistant.reasoning' || type === 'assistant.reasoning_delta' || type === 'session.background_tasks_changed') {
      suppressedEvents += 1;
      continue;
    }
    if (type === 'tool.execution_start') {
      row.label = data.toolName || 'unknown tool';
      row.status = 'incomplete';
      const stream = toolCallStreams.get(scopedId(event, data.toolCallId));
      if (stream) row.details = { ...data, toolCallStream: { chunks: stream.count, firstAt: stream.first, lastAt: stream.last } };
      if (data.toolCallId) pendingTools.set(data.toolCallId, row);
      const operation = operationFields(event, repoRoot, referencePaths);
      if (operation.McpServerName && data.toolCallId) mcpToolCallIds.add(data.toolCallId);
      if (operation.ReferenceName && data.toolCallId) {
        referenceToolCalls.add(data.toolCallId);
        row.details = safeReferenceToolStart({ ...data, toolCallStream: row.details.toolCallStream }, operation.ReferenceName);
        addReferenceReadRow({
          event,
          index,
          time,
          lane: row.lane,
          referenceName: operation.ReferenceName,
          toolCallId: data.toolCallId,
          parentToolCallId: data.parentToolCallId || ''
        });
      }
    } else if (type === 'tool.execution_complete') {
      const started = pendingTools.get(data.toolCallId);
      const failed = data.success === false || Number.isSafeInteger(data.shellExecution?.exitCode) && data.shellExecution.exitCode !== 0;
      if (started) {
        const priorDetails = started.details || {};
        const operation = operationFields(event, repoRoot, referencePaths, priorDetails);
        started.end = time;
        started.status = failed ? 'failed' : 'completed';
        started.details = { start: priorDetails, completion: data };
        if (operation.McpServerName && data.toolCallId) mcpToolCallIds.add(data.toolCallId);
        if (operation.ReferenceName && data.toolCallId && !referenceToolCalls.has(data.toolCallId)) {
          referenceToolCalls.add(data.toolCallId);
          addReferenceReadRow({
            event,
            index,
            time,
            lane: started.lane,
            referenceName: operation.ReferenceName,
            toolCallId: data.toolCallId,
            parentToolCallId: priorDetails.parentToolCallId || data.parentToolCallId || ''
          });
        } else if (!operation.ReferenceName && !failed && data.toolCallId && !referenceToolCalls.has(data.toolCallId)) {
          // A safe, repo-relative shell read that is NOT in the declared reference
          // manifest. Stays invisible (as before) for failed/compound/escaping reads —
          // directShellPathRead enforces the exact same safety boundary as the
          // declared-reference check, it just doesn't require manifest membership.
          const undeclaredPath = directShellPathRead(event, repoRoot, priorDetails);
          if (undeclaredPath) {
            referenceToolCalls.add(data.toolCallId);
            addReferenceReadRow({
              event,
              index,
              time,
              lane: started.lane,
              referenceName: undeclaredPath,
              toolCallId: data.toolCallId,
              parentToolCallId: priorDetails.parentToolCallId || data.parentToolCallId || '',
              declared: false
            });
          }
        }
        if (priorDetails.referenceRead || operation.ReferenceName) {
          started.details = { start: priorDetails, completion: safeReferenceToolCompletion(data) };
        }
        pendingTools.delete(data.toolCallId);
        continue;
      }
      row.label = data.toolName || 'unknown tool';
      row.status = failed ? 'failed' : 'completed, start not observed';
      const operation = operationFields(event, repoRoot, referencePaths);
      if (operation.McpServerName && data.toolCallId) mcpToolCallIds.add(data.toolCallId);
      if (operation.ReferenceName && data.toolCallId && !referenceToolCalls.has(data.toolCallId)) {
        referenceToolCalls.add(data.toolCallId);
        row.details = safeReferenceToolCompletion(data);
        addReferenceReadRow({
          event,
          index,
          time,
          lane: row.lane,
          referenceName: operation.ReferenceName,
          toolCallId: data.toolCallId,
          parentToolCallId: data.parentToolCallId || ''
        });
      } else if (!operation.ReferenceName && !failed && data.toolCallId && !referenceToolCalls.has(data.toolCallId)) {
        const undeclaredPath = directShellPathRead(event, repoRoot);
        if (undeclaredPath) {
          referenceToolCalls.add(data.toolCallId);
          row.details = safeReferenceToolCompletion(data);
          addReferenceReadRow({
            event,
            index,
            time,
            lane: row.lane,
            referenceName: undeclaredPath,
            toolCallId: data.toolCallId,
            parentToolCallId: data.parentToolCallId || '',
            declared: false
          });
        }
      }
    } else if (type === 'hook.start') {
      row.label = `hook: ${data.hookType || 'unknown'}`;
      row.status = 'incomplete';
      if (data.hookInvocationId) pendingHooks.set(data.hookInvocationId, row);
    } else if (type === 'hook.end') {
      const started = pendingHooks.get(data.hookInvocationId);
      if (started) {
        started.end = time;
        started.status = data.success === false ? 'failed' : 'completed';
        started.details = { start: started.details, completion: data };
        pendingHooks.delete(data.hookInvocationId);
        continue;
      }
      row.label = `hook: ${data.hookType || 'unknown'}`;
      row.status = 'completed, start not observed';
    } else if (type === 'assistant.turn_start') {
      row.label = 'model turn';
      row.status = 'incomplete';
      if (data.turnId) pendingTurns.set(scopedId(event, data.turnId), row);
    } else if (type === 'assistant.turn_end') {
      const turnKey = scopedId(event, data.turnId);
      const started = pendingTurns.get(turnKey);
      if (started) {
        started.end = time;
        started.status = 'completed';
        pendingTurns.delete(turnKey);
        continue;
      }
      row.label = 'model turn';
      row.status = 'completed, start not observed';
    } else if (type === 'assistant.message') {
      row.label = data.toolRequests?.length ? `assistant: ${data.toolRequests.map(request => request.name).join(', ')}` : 'assistant message';
      const messageKey = scopedId(event, data.messageId);
      const stream = messageStreams.get(messageKey);
      const started = pendingMessages.get(messageKey);
      if (started) row.start = eventTime(started.event) ?? time;
      if (stream || started) {
        row.details = {
          ...data,
          stream: {
            chunks: stream?.count || 0,
            startedAt: started ? eventTime(started.event) : null,
            endedAt: time,
            reconstructedTextMatchesFinal: stream ? stream.text === String(data.content || '') : null
          }
        };
        messageStreams.delete(messageKey);
        pendingMessages.delete(messageKey);
      }
    } else if (type === 'user.message') {
      row.label = 'user message';
    } else if (type === 'session.model_change') {
      row.label = `model: ${data.newModel || 'unknown'}`;
    } else if (type === 'subagent.started') {
      const identity = event.agentId || data.toolCallId;
      row.kind = 'subagent.interval';
      row.label = `subagent: ${data.agentDisplayName || data.agentName || 'unknown'}`;
      row.status = 'incomplete';
      row.details = { ...data, agentId: event.agentId || '', parentToolCallId: data.toolCallId || '' };
      if (identity) pendingSubagents.set(identity, row);
    } else if (type === 'subagent.completed' || type === 'subagent.failed') {
      const identity = event.agentId || data.toolCallId;
      const started = pendingSubagents.get(identity);
      if (started) {
        started.end = time;
        started.status = type === 'subagent.failed' ? 'failed' : 'completed';
        started.details = { start: started.details, completion: data };
        pendingSubagents.delete(identity);
        continue;
      }
      row.label = `subagent completion: ${data.agentDisplayName || data.agentName || 'unknown'}`;
      row.status = type === 'subagent.failed' ? 'failed' : 'completed, start not observed';
    } else if (type === 'subagent.selected' || type === 'subagent.configured') {
      row.label = `${type}: ${data.agentName || data.agentDisplayName || 'unknown'}`;
    } else if (type === 'skill.invoked') {
      row.label = `skill: ${data.name || 'unknown'}`;
      const skillName = normalizedSkillName(data.name || data.skillName || data.skill_name || '');
      if (skillName) {
        const lane = row.lane;
        invokedSkillsByLane.set(lane, [...(invokedSkillsByLane.get(lane) || []), { name: skillName, time, index, agentId: event.agentId || '' }]);
      }
    }
    rows.push(row);
  }
  for (const [key, stream] of messageStreams) {
    const started = pendingMessages.get(key);
    rows.push({
      index: events.length + rows.length,
      start: started ? eventTime(started.event) : stream.first,
      end: stream.last,
      lane: agentNames.get(stream.agentId) || parentAgent,
      kind: 'assistant.message.incomplete',
      label: 'assistant message (completion not observed)',
      status: 'incomplete',
      source: 'session event',
      details: { partialContent: stream.text, streamChunks: stream.count }
    });
  }
  for (const [streamKey, stream] of toolCallStreams) {
    const callId = streamKey.slice(streamKey.indexOf(':') + 1);
    const alreadyObserved = rows.some(row => row.kind === 'tool.execution_start'
      && (row.details?.toolCallId || row.details?.start?.toolCallId) === callId);
    if (!alreadyObserved) {
      rows.push({
        index: events.length + rows.length,
        start: stream.first,
        end: stream.last,
        lane: agentNames.get(stream.agentId) || parentAgent,
        kind: 'tool.request',
        label: `tool requested: ${stream.toolName || 'unknown tool'}`,
        status: 'execution not observed',
        source: 'session event',
        details: { requestStreamChunks: stream.count, argumentsPreview: stream.input }
      });
    }
  }
  for (const row of rows) {
    if (row.kind === 'tool.execution_start') {
      const callId = row.details?.toolCallId || row.details?.start?.toolCallId;
      const stream = [...toolCallStreams.entries()].find(([key]) => key.endsWith(`:${callId}`))?.[1];
      if (stream && !row.details.toolCallStream) row.details.toolCallStream = { chunks: stream.count, firstAt: stream.first, lastAt: stream.last };
    }
  }
  let exactToolCallJoins = 0;
  let inferredScriptToolLinks = 0;
  for (const span of nativeSpans) {
    const isScript = span.match === 'run-linked-script';
    const label = isScript
      ? span.stepName ? `step: ${span.stepName}` : `script: ${span.scriptName || 'unknown'}`
      : span.mcpServerName ? `${span.operation}: ${span.mcpServerName}/${span.mcpToolName || span.toolName || 'unknown'}`
      : span.toolName ? `${span.operation}: ${span.toolName}` : span.model ? `${span.operation}: ${span.model}` : span.operation;
    rows.push({
      index: events.length + rows.length,
      start: span.start,
      end: span.end,
      durationMs: span.durationMs,
      lane: isScript ? `Script · ${span.scriptName || 'owned script'}` : `OTel · ${span.agent}`,
      kind: span.operation,
      label,
      status: span.failed ? 'failed' : span.outcome === 'unknown' ? 'unknown' : 'completed',
      source: isScript ? 'script OTel' : 'native OTel',
      details: isScript ? {
        ...span,
        link: {
          kind: 'logical',
          runEvidence: 'exact agentops.run.id; no shared trace parent observed',
          toolCallEvidence: span.toolCallEvidence || 'not observed'
        }
      } : span
    });
    for (const event of span.events || []) {
      const skill = event.name === 'github.copilot.skill.invoked' ? event.attributes?.['github.copilot.skill.name'] : '';
      rows.push({
        index: events.length + rows.length,
        start: event.time,
        end: event.time,
        lane: `OTel · ${span.agent}`,
        kind: event.name,
        label: skill ? `skill: ${skill}` : event.name,
        status: 'observed',
        source: 'native OTel',
        details: { ...event, traceId: span.traceId, parentSpanId: span.spanId }
      });
    }
    if (span.toolCallId) {
      const tool = rows.find(row => row.source === 'session event'
        && row.kind === 'tool.execution_start'
        && (row.details?.start?.toolCallId || row.details?.toolCallId) === span.toolCallId);
      if (tool) {
        const link = {
          source: isScript ? 'script OTel' : 'Copilot native OTel',
          traceId: span.traceId,
          spanId: span.spanId,
          evidence: isScript ? span.toolCallEvidence || 'run ID only' : 'exact-session-tool-call-id'
        };
        tool.details.toolCallEvidenceLinks = [...(tool.details.toolCallEvidenceLinks || []), link];
        if (isScript && link.evidence === 'inferred-unique-tool-span-window') inferredScriptToolLinks += 1;
        if (!isScript) {
          tool.details.nativeOtel = { traceId: span.traceId, spanId: span.spanId };
          exactToolCallJoins += 1;
        }
      }
    }
  }
  rows.sort((left, right) => left.start - right.start || left.index - right.index);
  const first = rows.reduce((earliest, row) => Math.min(earliest, row.start), Infinity);
  const last = rows.reduce((latest, row) => Math.max(latest, row.end), -Infinity);
  const invalidTimestamps = events.length - ordered.length;
  const unresolvedRows = rows.filter(row => row.status === 'unknown' || row.status === 'incomplete' || row.status.includes('not observed')).length;
  const coverageGaps = unresolvedRows + invalidTimestamps + unmatchedDeltas;
  const scriptSpanCount = nativeSpans.filter(span => span.match === 'run-linked-script').length;
  const coverage = buildCoverageBreakdown({ rows, referencePaths, mcpToolCallIds, scriptSpanCount });
  return { rows, first: Number.isFinite(first) ? first : 0, last: Number.isFinite(last) ? last : 0, durationMs: rows.length ? Math.max(1, last - first) : 1, invalidTimestamps, suppressedEvents, unmatchedDeltas, unresolvedRows, coverageGaps, nativeSpans: nativeSpans.filter(span => span.match !== 'run-linked-script').length, scriptSpans: scriptSpanCount, nativeToolJoins: exactToolCallJoins, exactToolCallJoins, inferredScriptToolLinks, coverage };
}

// Structured per-component-type coverage breakdown, additive to the flat scalar
// coverage fields above (coverageGaps, unresolvedRows, etc., unchanged for
// backward compatibility). Shape: { referenceRead, toolCall, script, mcp }, each
// { observed, missing, unsupported }:
//   - observed: count of distinct, actually-captured occurrences of this component
//     type in this run (what instrumentation evidence exists for).
//   - missing: count of declared-but-never-observed instances, computed only when a
//     declaration source for that component type was supplied this run — otherwise
//     `null`, so a manifest-free run never reports "0 missing" as if it had verified
//     full coverage against a manifest it never saw.
//   - unsupported: count of observed occurrences that have capture evidence but fall
//     outside the declared/sanctioned contract for that component type. Always 0
//     where no such concept is wired up yet (script, mcp) rather than a fabricated
//     non-zero guess.
//
// referenceRead: observed/missing are counted as DISTINCT reference paths (not raw
//   read counts — rereads of the same path are not "more coverage"); observed =
//   distinct declared paths read at least once; missing = declared manifest paths
//   never read this run (null when no manifest was supplied, i.e. referencePaths is
//   empty); unsupported = distinct undeclared-but-safe paths read via direct shell
//   `cat` (see the `unsupported` evidence label on those rows).
// toolCall: observed = rows representing any captured tool-call evidence (a
//   resolved start+completion row, a completion-only orphan row, or a request-only
//   row reconstructed purely from streamed deltas); missing = rows among those
//   whose start or completion evidence was never captured (status 'incomplete' or
//   containing 'not observed'); unsupported = 0 (no undeclared-tool-call concept).
// script: observed = run-linked script spans captured this run; missing = null (no
//   declared-script manifest exists anywhere in this codebase to cross-reference
//   against, so missing is never fabricated as 0); unsupported = 0.
// mcp: observed = distinct tool calls this run that resolved to an MCP server;
//   missing = null (no declared-MCP-server manifest exists anywhere in this
//   codebase to cross-reference against, so missing is never fabricated as 0);
//   unsupported = 0.
function buildCoverageBreakdown({ rows, referencePaths, mcpToolCallIds, scriptSpanCount }) {
  const referenceRows = rows.filter(row => row.kind === 'reference.read');
  const declaredObservedPaths = new Set(referenceRows.filter(row => row.details.declared).map(row => row.details.referenceName));
  const unsupportedObservedPaths = new Set(referenceRows.filter(row => !row.details.declared).map(row => row.details.referenceName));
  const referenceMissing = referencePaths.size > 0
    ? [...referencePaths].filter(referencePath => !declaredObservedPaths.has(referencePath)).length
    : null;
  const toolCallRows = rows.filter(row => row.kind === 'tool.execution_start' || row.kind === 'tool.execution_complete' || row.kind === 'tool.request');
  const toolCallMissing = toolCallRows.filter(row => row.status === 'incomplete' || row.status.includes('not observed')).length;
  return {
    referenceRead: { observed: declaredObservedPaths.size, missing: referenceMissing, unsupported: unsupportedObservedPaths.size },
    toolCall: { observed: toolCallRows.length, missing: toolCallMissing, unsupported: 0 },
    script: { observed: scriptSpanCount, missing: null, unsupported: 0 },
    mcp: { observed: mcpToolCallIds.size, missing: null, unsupported: 0 }
  };
}

function failureEvidence(rows, index) {
  const row = rows[index];
  const preceding = rows.slice(0, index).filter(candidate => candidate.source === 'session event');
  const user = preceding.findLast(candidate => candidate.kind === 'user.message');
  const assistant = preceding.findLast(candidate => candidate.kind === 'assistant.message');
  const toolCallId = failureToolCallId(row);
  const linked = row.source === 'session event' && toolCallId && rows.find(candidate => candidate.source === 'native OTel' && candidate.details?.toolCallId === toolCallId);
  const relatedTool = row.source === 'script OTel' && toolCallId && rows.find(candidate => candidate.source === 'session event'
    && candidate.kind === 'tool.execution_start'
    && (candidate.details?.start?.toolCallId || candidate.details?.toolCallId) === toolCallId);
  return { row, index, user, assistant, linked, relatedTool };
}

function failureToolCallId(row) {
  return row.details?.start?.toolCallId || row.details?.toolCallId || row.details?.completion?.toolCallId || '';
}

function evidenceLink(row, label) {
  return row ? `<a href="#event-${row.displayIndex}">${escapeHtml(label)}</a>` : '<span>Not observed</span>';
}

function preview(value) {
  if (value === undefined || value === null || value === '') return 'Not captured';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return escapeHtml(text.length > 420 ? `${text.slice(0, 420)}…` : text);
}

function sanitizeModelMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeModelMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key,
    ['model', 'modelActual', 'modelRequested', 'requestedModel', 'currentModel', 'newModel', 'provider'].includes(key)
      ? safeModelIdentity(nested) : sanitizeModelMetadata(nested)
  ]));
}

function renderSessionWaterfall(events, sessionId, options = {}) {
  events = sanitizeModelMetadata(events);
  options = { ...options, nativeSpans: sanitizeModelMetadata(options.nativeSpans || []) };
  const { rows, first, durationMs, invalidTimestamps, suppressedEvents, unmatchedDeltas, unresolvedRows, coverageGaps, nativeSpans, scriptSpans, exactToolCallJoins, inferredScriptToolLinks, coverage } = sessionWaterfall(events, options.nativeSpans || [], options);
  if (options.metadataOnly) {
    for (const row of rows) row.details = redactRawContent(row.details);
  } else {
    for (const row of rows) row.details = redactContent(row.details);
  }
  rows.forEach((row, index) => { row.displayIndex = index; });
  const sessionFailureToolCalls = new Set(rows
    .filter(row => row.source === 'session event' && row.kind === 'tool.execution_start' && row.status === 'failed')
    .map(failureToolCallId)
    .filter(Boolean));
  const failures = rows.map((row, index) => row.status === 'failed' ? failureEvidence(rows, index) : null)
    .filter(Boolean)
    .filter(({ row }) => !(row.source === 'native OTel' && row.details?.toolCallId && sessionFailureToolCalls.has(row.details.toolCallId)));
  const runStatus = options.runStatus || null;
  // Evidence rows mark denials and non-zero shell exits as failure signals so
  // they get detail cards; the run status (shared classifier) decides severity.
  const statusBreakdown = runStatus?.signals
    ? ` Run status: ${runStatus.statusLabel} (${runStatus.signals.failures || 0} failed, ${runStatus.signals.denials || 0} denied, ${runStatus.signals.nonZeroExits || 0} shell non-zero exit${runStatus.signals.nonZeroExits === 1 ? '' : 's'}).`
    : '';
  const failureSummary = failures.length
    ? `${failures.length} failure signal${failures.length === 1 ? '' : 's'} observed.${statusBreakdown} Inspect the first signal and its preceding context below.`
    : `No failure signal was observed in the available evidence.${statusBreakdown}`;
  const failureSourceNote = 'Exact tool-call joins combine session failures with their native spans; unjoined signals stay separate.';
  const runStatusMetricHtml = runStatus
    ? `<div class="metric ${runStatus.status === 'failed' ? 'alert' : runStatus.status === 'attention' ? 'gap' : ''}" data-run-status="${escapeHtml(runStatus.status)}"><strong>${escapeHtml(runStatus.statusLabel)}</strong><span>Run status${runStatus.signals?.denials ? ` · ${runStatus.signals.denials} denied` : ''}${runStatus.signals?.nonZeroExits ? ` · ${runStatus.signals.nonZeroExits} shell non-zero exit${runStatus.signals.nonZeroExits === 1 ? '' : 's'}` : ''}</span></div>`
    : '';
  const contentModeNote = options.metadataOnly
    ? 'Metadata only — prompts, tool arguments/results and other raw payload content are redacted from this local timeline. Pass --allow-content to render full captured content (persists raw content in this local HTML file).'
    : 'Restricted local content — captured prompts, tool arguments/results and other payloads are rendered with best-effort secret redaction. Treat this file as sensitive; it has no automatic local expiry and is not uploaded anywhere.';
  const incomplete = rows.filter(row => row.status === 'incomplete').length;
  const delivery = options.deliveryStatus || null;
  const deliveryLabel = status => status === 'azure_accepted'
    ? 'Azure accepted · readback unverified'
    : status === 'pending' ? 'Pending retry'
      : status === 'in_flight' ? 'In flight · recovery may be needed'
        : status === 'not_observed' ? 'Not observed' : 'Unknown';
  const deliveryHtml = delivery
    ? `<section class="section" aria-labelledby="delivery-title"><h2 id="delivery-title">Evidence delivery</h2><p>Local outbox status only. Azure acceptance does not prove that rows are indexed or queryable.</p><div class="delivery-grid">${['events', 'spans'].map(kind => {
      const stream = delivery.streams?.[kind];
      return `<div class="delivery-card"><b>${escapeHtml(kind === 'events' ? 'Session events' : 'OpenTelemetry spans')}</b><span>${escapeHtml(deliveryLabel(stream?.status))}</span><small>${Number.isSafeInteger(stream?.rows) ? stream.rows : 0} rows · ${Number.isSafeInteger(stream?.attempts) ? stream.attempts : 0} attempts</small></div>`;
    }).join('')}</div></section>`
    : '';
  // Model identity/token metrics read span.modelRequested/modelActual/provider and the
  // null-preserving token fields already carried on native (non-script) span rows (see
  // session-otel.js) — this is purely aggregation/rendering, not new plumbing. A run
  // with zero model-bearing spans is treated as "not observed" rather than a fabricated
  // "0 model requests", since an agent session always makes at least one model call; a
  // zero here almost always means missing receipt evidence, not a genuinely model-free run.
  const modelSpanRows = rows.filter(row => row.source === 'native OTel' && (row.details?.modelRequested || row.details?.modelActual));
  // An invoke_agent span can report an aggregate of its chat children. Prefer
  // individual chat requests when present, and never count a delivered span ID
  // twice. If only an agent aggregate exists, label it as span evidence rather
  // than claiming a count of model requests.
  const chatRows = modelSpanRows.filter(row => row.kind === 'chat');
  const selectedModelRows = chatRows.length ? chatRows : modelSpanRows;
  const seenModelSpans = new Set();
  const modelRows = selectedModelRows.filter(row => {
    const traceId = row.details?.traceId;
    const spanId = row.details?.spanId;
    if (!traceId || !spanId) return true;
    const key = `${traceId}:${spanId}`;
    if (seenModelSpans.has(key)) return false;
    seenModelSpans.add(key);
    return true;
  });
  const modelProvenance = reconcileModelProvenance({
    launchExecutionConfiguration: options.launchExecutionConfiguration,
    requestedModel: options.requestedModel,
    events,
    nativeSpans: options.nativeSpans || []
  });
  const modelList = values => values.length ? escapeHtml(values.join(', ')) : 'Unknown';
  const modelProvenanceHtml = `<section class="section" aria-labelledby="model-provenance-title"><h2 id="model-provenance-title">Model provenance</h2><dl><dt>Launcher requested model</dt><dd>${escapeHtml(modelProvenance.launchRequestedModel || 'Unknown')} · ${escapeHtml(modelProvenance.launchRequestSource)}</dd><dt>Producer requested models</dt><dd>${modelList(modelProvenance.producerRequestedModels)}</dd><dt>Actual response models (native usage evidence)</dt><dd>${modelList(modelProvenance.actualModels)}${modelProvenance.mixedActualModels ? ' · Mixed models' : ''}</dd><dt>Actual response providers</dt><dd>${modelList([...new Set(modelProvenance.actualUsageIdentities.map(identity => identity.provider).filter(Boolean))])}</dd><dt>Session reported models (configuration evidence)</dt><dd>${modelList(modelProvenance.sessionReportedModels)}</dd><dt>Producer request/response discrepancies</dt><dd>${modelProvenance.producerResponseConflicts.length ? modelProvenance.producerResponseConflicts.map(conflict => `${escapeHtml(conflict.requested)} → ${escapeHtml(conflict.actual)} (${escapeHtml(conflict.provider || 'Unknown provider')})`).join('; ') : 'None observed'}</dd><dt>Reconciliation</dt><dd>${escapeHtml(modelProvenance.status)}${modelProvenance.conflictingModels.length ? ` · conflicting models: ${modelList(modelProvenance.conflictingModels)}` : ''}</dd></dl><p>${modelProvenance.actualUsageObserved ? 'Native response identity was observed.' : 'Actual model usage was not observed.'} Matching names do not certify that a launcher override took effect. Session model declarations and producer request fields are separate evidence.</p></section>`;
  const modelUnit = chatRows.length ? 'requests' : 'spans';
  const requestedModels = [...new Set(modelRows.map(row => row.details.modelRequested).filter(Boolean))];
  const actualModels = [...new Set(modelRows.map(row => row.details.modelActual).filter(Boolean))];
  const providers = [...new Set(modelRows.map(row => row.details.provider).filter(Boolean))];
  const tokenCoverage = field => modelRows.reduce((totals, row) => {
    const value = row.details?.[field];
    if (Number.isFinite(value)) { totals.sum += value; totals.measured += 1; }
    return totals;
  }, { sum: 0, measured: 0 });
  const inputTokens = tokenCoverage('inputTokens');
  const outputTokens = tokenCoverage('outputTokens');
  const tokenMetricHtml = (label, totals) => modelRows.length === 0
    ? `<div class="metric unknown"><strong>Unknown</strong><span>${escapeHtml(label)} — not observed in available evidence</span></div>`
    : totals.measured === 0
      ? `<div class="metric unknown"><strong>Unknown</strong><span>${escapeHtml(label)} — 0 of ${modelRows.length} ${modelUnit} measured</span></div>`
      : `<div class="metric${totals.measured < modelRows.length ? ' gap' : ''}"><strong>${totals.sum}</strong><span>${escapeHtml(label)} · ${totals.measured}/${modelRows.length} ${modelUnit} measured</span></div>`;
  const modelMetricHtml = modelRows.length === 0
    ? `<div class="metric unknown"><strong>Unknown</strong><span>Model requests/responses — not observed in available evidence</span></div>`
    : `<div class="metric"><strong>${modelRows.length}</strong><span>${chatRows.length ? 'Model requests' : 'Model-bearing spans (request count unavailable)'}${requestedModels.length ? ` · ${escapeHtml(requestedModels.join(', '))}` : ''}${actualModels.length && actualModels.join('|') !== requestedModels.join('|') ? ` → ${escapeHtml(actualModels.join(', '))}` : ''}${providers.length ? ` (${escapeHtml(providers.join(', '))})` : ''}</span></div>`;
  // No retry signal (model-request-level or otherwise) is captured anywhere in the
  // session/OTel event model this renderer receives — this is a genuine instrumentation
  // gap, not a rendering omission, so it is reported as "not tracked" rather than guessed.
  const retryMetricHtml = '<div class="metric unknown"><strong>Not tracked</strong><span>Retries — no retry signal is captured by current instrumentation</span></div>';
  const privacyLabel = options.metadataOnly ? 'Metadata only' : 'Full content';
  const privacyMetricHtml = `<div class="metric"><strong>${escapeHtml(privacyLabel)}</strong><span>Privacy profile — ${options.metadataOnly ? 'raw payload content redacted; expiry not applicable' : 'best-effort redacted payloads retained locally; no automatic expiry'}</span></div>`;
  // Count only expected payload slots in supplied events. These counters do not
  // assert source completeness or turn a missing field into an empty payload.
  const contentSlots = events.flatMap(event => {
    const data = event.data || {};
    if (event.type === 'user.message' || event.type === 'assistant.message') return [data.content];
    if (event.type === 'tool.execution_start') return [data.arguments];
    if (event.type === 'tool.execution_complete') return [data.result ?? data.output];
    return [];
  });
  const presentContent = contentSlots.filter(value => value !== undefined && value !== null && value !== '').length;
  const contentState = options.metadataOnly
    ? 'Payload excluded from this HTML. Source content capture and truncation are unknown.'
    : `${presentContent} payload fields available in supplied events; ${contentSlots.length - presentContent} expected fields missing. Source completeness and truncation are unknown.`;
  const privacyHtml = `<section class="section" aria-labelledby="privacy-title"><h2 id="privacy-title">Privacy and retention</h2><p>Profile: ${escapeHtml(options.metadataOnly ? 'Metadata only' : 'Restricted local content')}. Access scope: local filesystem; this view does not upload content. The HTML writer creates a new file with owner-only permissions (0600).</p><p>Content state: ${escapeHtml(contentState)}</p><p>Retention: no automatic local expiry. Removing this HTML does not remove source receipts or Azure records. Restricted payloads receive best-effort secret redaction; missing content stays unknown.</p></section>`;
  const deliveryStreamList = delivery ? Object.values(delivery.streams || {}) : [];
  const deliveryAccepted = deliveryStreamList.filter(stream => stream?.status === 'azure_accepted').length;
  const deliverySummaryMetricHtml = delivery
    ? `<div class="metric"><strong>${deliveryAccepted}/${deliveryStreamList.length}</strong><span>Delivery streams accepted</span></div>`
    : '<div class="metric unknown"><strong>Not observed</strong><span>Delivery — no outbox status available for this run</span></div>';
  const coverageLabels = { referenceRead: 'Reference reads', toolCall: 'Tool calls', script: 'Script spans', mcp: 'MCP calls' };
  const coverageMissingText = value => value === null ? 'Not tracked' : String(value);
  const coverageMissingClass = value => value === null ? 'muted' : value > 0 ? 'gap-value' : '';
  const coverageHtml = coverage
    ? `<section class="section" aria-labelledby="coverage-title"><h2 id="coverage-title">Coverage by component</h2><p>Observed counts reflect captured evidence only. "Not tracked" means no manifest exists to compare against for this component — it is not the same as a verified zero gap.</p><div class="coverage-grid">${Object.entries(coverage).map(([key, stats]) => `<div class="coverage-card"><b>${escapeHtml(coverageLabels[key] || key)}</b><dl><div><dt>Observed</dt><dd>${stats.observed}</dd></div><div><dt>Missing</dt><dd class="${coverageMissingClass(stats.missing)}">${coverageMissingText(stats.missing)}</dd></div><div><dt>Unsupported</dt><dd>${stats.unsupported}</dd></div></dl></div>`).join('')}</div></section>`
    : '';
  const failureHtml = failures.map(({ row, user, assistant, linked, relatedTool }, number) => {
    const detail = row.details?.completion || row.details;
    const message = detail?.error?.message || detail?.error || detail?.message || detail?.result || detail?.output || '';
    const excerpt = message ? preview(message) : '';
    const traceId = row.details?.traceId || row.details?.nativeOtel?.traceId || '';
    const argumentsValue = row.details?.start?.arguments || row.details?.arguments;
    const relatedToolEvidence = row.details?.toolCallEvidence === 'inferred-unique-session-tool-event-window'
      ? 'inferred from a unique session tool event window'
      : row.details?.toolCallEvidence === 'inferred-unique-tool-span-window'
        ? 'inferred from a unique tool span window'
        : row.details?.toolCallEvidence === 'exact-session-tool-call-id'
          ? 'exact tool-call ID'
          : 'tool-call relationship not classified';
    const relatedToolLink = relatedTool ? evidenceLink(relatedTool, `Related tool call · ${relatedToolEvidence}`) : '';
    return `<article class="failure-card"><div class="failure-heading"><span class="failure-number">${number + 1}</span><div><h3>${escapeHtml(row.label)}</h3><p>${escapeHtml(row.source)} · ${escapeHtml(row.lane)} · ${escapeHtml(new Date(row.start).toISOString())}</p></div><a class="jump" href="#event-${row.displayIndex}">Open event →</a></div><div class="failure-excerpt">${excerpt || '<span class="muted">No error message was captured for this failure signal.</span>'}</div><div class="context-grid"><div><b>Previous user message</b><p>${preview(user?.details?.content)}</p></div><div><b>Tool arguments</b><p>${preview(argumentsValue)}</p></div></div><div class="evidence-links"><span>Preceding context</span>${evidenceLink(user, 'User message')}${evidenceLink(assistant, 'Assistant message')}${relatedToolLink}${evidenceLink(linked, 'Matching native span')}${traceId ? `<span class="trace-id">Trace ${escapeHtml(traceId)}</span>` : ''}</div></article>`;
  }).join('');
  // Distinct, text-first badges for the 'unsupported' (undeclared-but-safe read) and
  // 'unknown' (genuinely ambiguous concurrent ownership) evidence labels Task 2 added,
  // so a reviewer never mistakes either for a declared, confidently-attributed read.
  const referenceBadge = row => {
    if (row.kind !== 'reference.read') return '';
    if (row.details?.declared === false) {
      return '<span class="evidence-badge evidence-unsupported" title="Undeclared read: not in any skill\u2019s reference manifest">Undeclared</span>';
    }
    if (row.details?.owningSkillLink?.evidence === 'unknown') {
      return '<span class="evidence-badge evidence-unknown" title="Ownership could not be attributed: concurrent same-lane candidates tied">Ownership unknown</span>';
    }
    return '';
  };
  const rowHtml = rows.map(row => {
    const left = Math.max(0, Math.min(99, (row.start - first) / durationMs * 100));
    const width = Math.max(0.4, Math.min(100 - left, (row.end - row.start) / durationMs * 100));
    const elapsedMs = row.durationMs ?? row.end - row.start;
    const duration = elapsedMs > 0
      ? `${elapsedMs < 1 ? Number(elapsedMs.toFixed(3)) : Math.round(elapsedMs)} ms`
      : 'point event';
    const statusClass = row.status === 'failed' ? 'failed' : row.status === 'incomplete' ? 'incomplete' : 'normal';
    return `<details class="row" id="event-${row.displayIndex}" data-status="${escapeHtml(row.status)}" data-source="${escapeHtml(row.source)}" data-kind="${escapeHtml(row.kind)}"><summary><span class="lane">${escapeHtml(row.lane)}</span><span class="track"><span class="bar ${statusClass}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></span></span><span class="label">${escapeHtml(row.label)}${referenceBadge(row)}</span><span class="time">${escapeHtml(duration)}</span></summary><pre>${escapeHtml(JSON.stringify({ timestamp: new Date(row.start).toISOString(), end: new Date(row.end).toISOString(), source: row.source, event: row.kind, status: row.status, sourceIndex: row.index, data: row.details }, null, 2))}</pre></details>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot run ${escapeHtml(sessionId)}</title><style>body{font:14px system-ui,sans-serif;background:#101827;color:#e8eef8;margin:0 auto;padding:2rem;max-width:1400px}h1{font-size:1.65rem;margin:.2rem 0 .45rem}h2{font-size:1.15rem;margin:0 0 .75rem}h3{font-size:1rem;margin:0 0 .2rem}p{color:#b8c5d8;line-height:1.5}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.75rem;color:#91a8c4}.intro{max-width:75ch}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.75rem;margin:1.5rem 0}.metric{background:#19263a;border:1px solid #354257;border-radius:.5rem;padding:1rem}.metric strong{font-size:1.35rem;display:block;color:#f4f7fc}.metric span{color:#b8c5d8}.metric.alert{border-color:#a84e57}.metric.gap{border-color:#e9b556}.metric.unknown{border-color:#6b7c93}.metric.unknown strong{color:#c7d4e4}.section{margin:1.5rem 0 2rem}.evidence-badge{display:inline-block;margin-left:.45rem;padding:.05rem .4rem;border-radius:.25rem;font-size:.7rem;font-weight:600;vertical-align:middle;white-space:nowrap}.evidence-unsupported{background:#3a2e14;color:#e9b556;border:1px solid #e9b556}.evidence-unknown{background:#3a1f26;color:#f36b6b;border:1px solid #f36b6b}.coverage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.7rem}.coverage-card{background:#19263a;border:1px solid #354257;border-radius:.45rem;padding:.8rem}.coverage-card b{color:#dce8f7;display:block;margin-bottom:.4rem}.coverage-card dl{display:grid;grid-template-columns:1fr auto;gap:.2rem .6rem;margin:0}.coverage-card dt{color:#9fb1c8}.coverage-card dd{margin:0;text-align:right;color:#dce8f7}.gap-value{color:#e9b556;font-weight:600}.row-search{font:inherit;background:#19263a;color:#dce8f7;border:1px solid #4a5c75;border-radius:.35rem;padding:.4rem .75rem;min-width:12rem}.row-search:focus-visible{outline:2px solid #8ec9ff;outline-offset:2px}.nav-placeholder{border:1px dashed #4a5c75;border-radius:.4rem;padding:.6rem .8rem;color:#9fb1c8;font-size:.85rem}.delivery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.7rem}.delivery-card{display:grid;gap:.25rem;background:#19263a;border:1px solid #354257;border-radius:.45rem;padding:.8rem}.delivery-card b{color:#dce8f7}.delivery-card small{color:#a7b8cd}.failure-card{background:#1b283b;border:1px solid #a84e57;border-left:4px solid #f36b6b;border-radius:.5rem;padding:1rem;margin:.7rem 0}.failure-heading{display:flex;align-items:flex-start;gap:.8rem}.failure-heading p{margin:0}.failure-number{background:#6b3139;color:#fff;border-radius:50%;width:1.6rem;height:1.6rem;display:grid;place-items:center;flex:none}.jump{margin-left:auto;white-space:nowrap}.failure-excerpt{background:#101827;border-radius:.3rem;padding:.7rem;white-space:pre-wrap;overflow-wrap:anywhere}.context-grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:.8rem 0}.context-grid>div{background:#142034;border-radius:.3rem;padding:.7rem;min-width:0}.context-grid b{font-size:.8rem;color:#dce8f7}.context-grid p{white-space:pre-wrap;overflow-wrap:anywhere;margin:.3rem 0 0}.muted{color:#91a8c4}.evidence-links{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;color:#9fb1c8;font-size:.85rem}.trace-id{overflow-wrap:anywhere}.empty{border:1px solid #354257;border-radius:.5rem;padding:1rem;background:#172338}.toolbar{display:flex;gap:.4rem;flex-wrap:wrap;margin:.7rem 0 1rem}.toolbar button{font:inherit;background:#19263a;color:#dce8f7;border:1px solid #4a5c75;border-radius:.35rem;padding:.4rem .75rem;cursor:pointer}.toolbar button:hover,.toolbar button[aria-pressed="true"]{background:#294667;border-color:#77b7f8}.toolbar button:focus-visible,a:focus-visible,.row summary:focus-visible{outline:2px solid #8ec9ff;outline-offset:2px}a{color:#8ec9ff}.row{border-bottom:1px solid #354257;scroll-margin-top:1rem}.row:target{background:#294667;outline:1px solid #8ec9ff}.row summary{display:grid;grid-template-columns:14rem minmax(12rem,1fr) 20rem 6rem;gap:.7rem;align-items:center;padding:.55rem;cursor:pointer}.row:hover{background:#1c293d}.lane,.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{height:1.15rem;background:#26344a;position:relative;border-radius:.25rem}.bar{position:absolute;top:0;height:100%;background:#62a9f5;min-width:3px;border-radius:.25rem}.bar.failed{background:#f36b6b}.bar.incomplete{background:#e9b556}.time{color:#a7b8cd;text-align:right}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#1a2639;padding:1rem;border-radius:.35rem}.row[hidden]{display:none}@media(max-width:850px){body{padding:1rem}.row summary{grid-template-columns:7rem 1fr 7rem}.label{grid-column:1/3}.time{grid-column:3}.failure-heading{flex-wrap:wrap}.jump{margin-left:2.4rem}}@media(max-width:480px){.context-grid{grid-template-columns:1fr}.metric{padding:.7rem}}</style></head><body><header><div class="eyebrow">Copilot CLI · local run evidence</div><h1>Run ${escapeHtml(sessionId)}</h1><p class="intro">${escapeHtml(failureSummary)} ${escapeHtml(failureSourceNote)}</p><p class="intro content-mode">${escapeHtml(contentModeNote)}</p>${options.productNavigation ? '<nav aria-label="Product"><a href="runs.html">Runs</a> · <a href="architecture.html">Architecture</a> · <a href="compare.html">Compare</a></nav><p>Session replay uses current native events. Stored span receipts retain their original capture window; later session events may have no matching span.</p>' : '<p class="nav-placeholder">For an interactive trace, run list and tool latency table, run <code>agentops ui</code>.</p>'}</header><main id="run-evidence"><div class="summary-grid" role="group" aria-label="Run summary">${runStatusMetricHtml}<div class="metric ${failures.length ? (runStatus && runStatus.status !== 'failed' ? 'gap' : 'alert') : ''}"><strong>${failures.length}</strong><span>Failure signals${runStatus ? ' (incl. denials and non-zero exits)' : ''}</span></div><div class="metric"><strong>${(durationMs / 1000).toFixed(2)} s</strong><span>Observed duration</span></div>${modelMetricHtml}${tokenMetricHtml('Input tokens', inputTokens)}${tokenMetricHtml('Output tokens', outputTokens)}${retryMetricHtml}${privacyMetricHtml}${deliverySummaryMetricHtml}<div class="metric"><strong>${nativeSpans}</strong><span>Exact-session native spans</span></div><div class="metric"><strong>${scriptSpans}</strong><span>Run-linked script spans</span></div><div class="metric"><strong>${exactToolCallJoins}</strong><span>Exact tool-call joins</span></div><div class="metric"><strong>${inferredScriptToolLinks}</strong><span>Inferred script-to-tool links</span></div><div class="metric ${coverageGaps ? 'gap' : ''}"><strong>${coverageGaps}</strong><span>Coverage gaps</span></div></div>${modelProvenanceHtml}${privacyHtml}${deliveryHtml}${coverageHtml}<section class="section" aria-labelledby="failures-title"><h2 id="failures-title">Failure detail</h2>${failureHtml || '<div class="empty">No failure signal in the available session events or matching native spans. This does not prove the run succeeded.</div>'}</section><section class="section" aria-labelledby="timeline-title"><h2 id="timeline-title">End-to-end timeline</h2><p>${rows.length} operation rows · ${unresolvedRows} operations with missing or incomplete evidence · ${invalidTimestamps} session events without valid timestamps · ${suppressedEvents} low-level reasoning/background updates grouped out of the timeline · ${unmatchedDeltas} uncorrelated stream deltas not linked. ${nativeSpans ? 'Native spans share the same time axis and may overlap session events.' : 'No exact-session native spans were observed in local receipts.'} ${scriptSpans ? 'Script spans have exact run-ID links; tool-call relationships are separately labelled exact or inferred from unique time-window evidence. No physical parent is claimed.' : ''} Yellow means completion or a matching edge was not observed. Rich details stay in this local file. No cloud export occurs.</p><div class="toolbar" role="group" aria-label="Timeline filters"><button type="button" data-filter="all" aria-pressed="true">All events</button><button type="button" data-filter="failed" aria-pressed="false">Failures</button><button type="button" data-filter="tool" aria-pressed="false">Tools</button><button type="button" data-filter="native" aria-pressed="false">Native OTel</button><button type="button" data-filter="script" aria-pressed="false">Script OTel</button><input type="search" id="row-search" class="row-search" placeholder="Search label, lane, or kind" aria-label="Search timeline rows by label, lane, or kind"></div><div id="timeline">${rowHtml}</div></section></main><script>const buttons=[...document.querySelectorAll('[data-filter]')];const rows=[...document.querySelectorAll('.row')];const searchInput=document.getElementById('row-search');let activeFilter='all';function matchesFilter(row,name){return name==='all'||name==='failed'&&row.dataset.status==='failed'||name==='tool'&&row.dataset.kind.startsWith('tool.')||name==='native'&&row.dataset.source==='native OTel'||name==='script'&&row.dataset.source==='script OTel';}function matchesSearch(row,term){if(!term)return true;const lane=row.querySelector('.lane')?.textContent||'';const label=row.querySelector('.label')?.textContent||'';const haystack=(row.dataset.kind+' '+lane+' '+label).toLowerCase();return haystack.includes(term);}function applyVisibility(){const term=(searchInput?.value||'').trim().toLowerCase();for(const row of rows)row.hidden=!(matchesFilter(row,activeFilter)&&matchesSearch(row,term));}function filter(name){activeFilter=name;for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.filter===name));applyVisibility();}for(const button of buttons)button.addEventListener('click',()=>filter(button.dataset.filter));if(searchInput)searchInput.addEventListener('input',applyVisibility);function showTarget(){const target=document.getElementById(location.hash.slice(1));if(target?.classList.contains('row')){filter('all');if(searchInput)searchInput.value='';applyVisibility();target.open=true;target.scrollIntoView({block:'center'});}}for(const link of document.querySelectorAll('a[href^="#event-"]'))link.addEventListener('click',()=>setTimeout(showTarget,0));addEventListener('hashchange',showTarget);if(location.hash)showTarget();</script></body></html>`;
}

function writeSessionWaterfall(events, sessionId, outputPath, options = {}) {
  if (!outputPath) throw new Error('copilot-session view requires --output <local.html>');
  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, renderSessionWaterfall(events, sessionId, options), { flag: 'wx', mode: 0o600 });
  return resolved;
}

module.exports = { renderSessionWaterfall, sessionWaterfall, writeSessionWaterfall };
