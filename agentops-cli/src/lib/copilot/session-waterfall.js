const fs = require('node:fs');
const path = require('node:path');

const { attachmentReferencePaths, attachmentSkillReferences, operationFields } = require('./session-event-export');

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

function sessionWaterfall(events = [], nativeSpans = [], options = {}) {
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
  let suppressedEvents = 0;
  let unmatchedDeltas = 0;

  const owningSkillLink = (lane, referenceName, time, index) => {
    const declaringSkills = new Set(skillReferences.get(referenceName) || []);
    const candidates = [];
    for (const invocation of invokedSkillsByLane.get(lane) || []) {
      const earlier = invocation.time < time || invocation.time === time && invocation.index < index;
      if (earlier && declaringSkills.has(invocation.name) && !candidates.includes(invocation.name)) {
        candidates.push(invocation.name);
      }
    }
    if (candidates.length === 1) return { evidence: 'inferred', skillName: candidates[0], candidates };
    if (candidates.length > 1) return { evidence: 'ambiguous', skillName: '', candidates };
    return { evidence: 'missing', skillName: '', candidates: [] };
  };

  const addReferenceReadRow = ({ event, index, time, lane, referenceName, toolCallId, parentToolCallId }) => {
    if (!referenceName || !toolCallId) return;
    const countKey = `${lane}\u0000${referenceName}`;
    const readCount = (referenceReadCounts.get(countKey) || 0) + 1;
    referenceReadCounts.set(countKey, readCount);
    rows.push({
      index,
      start: time,
      end: time,
      lane,
      kind: 'reference.read',
      label: `reference: ${referenceName}`,
      status: 'observed',
      source: 'session event',
      details: {
        referenceName,
        readCount,
        toolCallId,
        parentToolCallId: parentToolCallId || '',
        agentId: event.agentId || '',
        toolCallLink: { evidence: 'exact', toolCallId },
        owningSkillLink: owningSkillLink(lane, referenceName, time, index)
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
        invokedSkillsByLane.set(lane, [...(invokedSkillsByLane.get(lane) || []), { name: skillName, time, index }]);
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
      status: span.failed ? 'failed' : 'completed',
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
  const unresolvedRows = rows.filter(row => row.status === 'incomplete' || row.status.includes('not observed')).length;
  const coverageGaps = unresolvedRows + invalidTimestamps + unmatchedDeltas;
  return { rows, first: Number.isFinite(first) ? first : 0, last: Number.isFinite(last) ? last : 0, durationMs: rows.length ? Math.max(1, last - first) : 1, invalidTimestamps, suppressedEvents, unmatchedDeltas, unresolvedRows, coverageGaps, nativeSpans: nativeSpans.filter(span => span.match !== 'run-linked-script').length, scriptSpans: nativeSpans.filter(span => span.match === 'run-linked-script').length, nativeToolJoins: exactToolCallJoins, exactToolCallJoins, inferredScriptToolLinks };
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

function renderSessionWaterfall(events, sessionId, options = {}) {
  const { rows, first, durationMs, invalidTimestamps, suppressedEvents, unmatchedDeltas, unresolvedRows, coverageGaps, nativeSpans, scriptSpans, exactToolCallJoins, inferredScriptToolLinks } = sessionWaterfall(events, options.nativeSpans || [], options);
  rows.forEach((row, index) => { row.displayIndex = index; });
  const sessionFailureToolCalls = new Set(rows
    .filter(row => row.source === 'session event' && row.kind === 'tool.execution_start' && row.status === 'failed')
    .map(failureToolCallId)
    .filter(Boolean));
  const failures = rows.map((row, index) => row.status === 'failed' ? failureEvidence(rows, index) : null)
    .filter(Boolean)
    .filter(({ row }) => !(row.source === 'native OTel' && row.details?.toolCallId && sessionFailureToolCalls.has(row.details.toolCallId)));
  const failureSummary = failures.length
    ? `${failures.length} failure signal${failures.length === 1 ? '' : 's'} observed. Inspect the first failure and its preceding context below.`
    : 'No failure signal was observed in the available evidence.';
  const failureSourceNote = 'Exact tool-call joins combine session failures with their native spans; unjoined signals stay separate.';
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
  const rowHtml = rows.map(row => {
    const left = Math.max(0, Math.min(99, (row.start - first) / durationMs * 100));
    const width = Math.max(0.4, Math.min(100 - left, (row.end - row.start) / durationMs * 100));
    const elapsedMs = row.durationMs ?? row.end - row.start;
    const duration = elapsedMs > 0
      ? `${elapsedMs < 1 ? Number(elapsedMs.toFixed(3)) : Math.round(elapsedMs)} ms`
      : 'point event';
    const statusClass = row.status === 'failed' ? 'failed' : row.status === 'incomplete' ? 'incomplete' : 'normal';
    return `<details class="row" id="event-${row.displayIndex}" data-status="${escapeHtml(row.status)}" data-source="${escapeHtml(row.source)}" data-kind="${escapeHtml(row.kind)}"><summary><span class="lane">${escapeHtml(row.lane)}</span><span class="track"><span class="bar ${statusClass}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></span></span><span class="label">${escapeHtml(row.label)}</span><span class="time">${escapeHtml(duration)}</span></summary><pre>${escapeHtml(JSON.stringify({ timestamp: new Date(row.start).toISOString(), end: new Date(row.end).toISOString(), source: row.source, event: row.kind, status: row.status, sourceIndex: row.index, data: row.details }, null, 2))}</pre></details>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot run ${escapeHtml(sessionId)}</title><style>body{font:14px system-ui,sans-serif;background:#101827;color:#e8eef8;margin:0 auto;padding:2rem;max-width:1400px}h1{font-size:1.65rem;margin:.2rem 0 .45rem}h2{font-size:1.15rem;margin:0 0 .75rem}h3{font-size:1rem;margin:0 0 .2rem}p{color:#b8c5d8;line-height:1.5}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.75rem;color:#91a8c4}.intro{max-width:75ch}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:.75rem;margin:1.5rem 0}.metric{background:#19263a;border:1px solid #354257;border-radius:.5rem;padding:1rem}.metric strong{font-size:1.35rem;display:block;color:#f4f7fc}.metric span{color:#b8c5d8}.metric.alert{border-color:#a84e57}.metric.gap{border-color:#e9b556}.section{margin:1.5rem 0 2rem}.delivery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.7rem}.delivery-card{display:grid;gap:.25rem;background:#19263a;border:1px solid #354257;border-radius:.45rem;padding:.8rem}.delivery-card b{color:#dce8f7}.delivery-card small{color:#a7b8cd}.failure-card{background:#1b283b;border:1px solid #a84e57;border-left:4px solid #f36b6b;border-radius:.5rem;padding:1rem;margin:.7rem 0}.failure-heading{display:flex;align-items:flex-start;gap:.8rem}.failure-heading p{margin:0}.failure-number{background:#6b3139;color:#fff;border-radius:50%;width:1.6rem;height:1.6rem;display:grid;place-items:center;flex:none}.jump{margin-left:auto;white-space:nowrap}.failure-excerpt{background:#101827;border-radius:.3rem;padding:.7rem;white-space:pre-wrap;overflow-wrap:anywhere}.context-grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:.8rem 0}.context-grid>div{background:#142034;border-radius:.3rem;padding:.7rem;min-width:0}.context-grid b{font-size:.8rem;color:#dce8f7}.context-grid p{white-space:pre-wrap;overflow-wrap:anywhere;margin:.3rem 0 0}.muted{color:#91a8c4}.evidence-links{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;color:#9fb1c8;font-size:.85rem}.trace-id{overflow-wrap:anywhere}.empty{border:1px solid #354257;border-radius:.5rem;padding:1rem;background:#172338}.toolbar{display:flex;gap:.4rem;flex-wrap:wrap;margin:.7rem 0 1rem}.toolbar button{font:inherit;background:#19263a;color:#dce8f7;border:1px solid #4a5c75;border-radius:.35rem;padding:.4rem .75rem;cursor:pointer}.toolbar button:hover,.toolbar button[aria-pressed="true"]{background:#294667;border-color:#77b7f8}.toolbar button:focus-visible,a:focus-visible,.row summary:focus-visible{outline:2px solid #8ec9ff;outline-offset:2px}a{color:#8ec9ff}.row{border-bottom:1px solid #354257;scroll-margin-top:1rem}.row:target{background:#294667;outline:1px solid #8ec9ff}.row summary{display:grid;grid-template-columns:14rem minmax(12rem,1fr) 20rem 6rem;gap:.7rem;align-items:center;padding:.55rem;cursor:pointer}.row:hover{background:#1c293d}.lane,.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{height:1.15rem;background:#26344a;position:relative;border-radius:.25rem}.bar{position:absolute;top:0;height:100%;background:#62a9f5;min-width:3px;border-radius:.25rem}.bar.failed{background:#f36b6b}.bar.incomplete{background:#e9b556}.time{color:#a7b8cd;text-align:right}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#1a2639;padding:1rem;border-radius:.35rem}.row[hidden]{display:none}@media(max-width:850px){body{padding:1rem}.row summary{grid-template-columns:7rem 1fr 7rem}.label{grid-column:1/3}.time{grid-column:3}.failure-heading{flex-wrap:wrap}.jump{margin-left:2.4rem}}@media(max-width:480px){.context-grid{grid-template-columns:1fr}.metric{padding:.7rem}}</style></head><body><header><div class="eyebrow">Copilot CLI · local run evidence</div><h1>Run ${escapeHtml(sessionId)}</h1><p class="intro">${escapeHtml(failureSummary)} ${escapeHtml(failureSourceNote)}</p></header><div class="summary-grid" aria-label="Run summary"><div class="metric ${failures.length ? 'alert' : ''}"><strong>${failures.length}</strong><span>Failure signals</span></div><div class="metric"><strong>${(durationMs / 1000).toFixed(2)} s</strong><span>Observed duration</span></div><div class="metric"><strong>${nativeSpans}</strong><span>Exact-session native spans</span></div><div class="metric"><strong>${scriptSpans}</strong><span>Run-linked script spans</span></div><div class="metric"><strong>${exactToolCallJoins}</strong><span>Exact tool-call joins</span></div><div class="metric"><strong>${inferredScriptToolLinks}</strong><span>Inferred script-to-tool links</span></div><div class="metric ${coverageGaps ? 'gap' : ''}"><strong>${coverageGaps}</strong><span>Coverage gaps</span></div></div>${deliveryHtml}<section class="section" aria-labelledby="failures-title"><h2 id="failures-title">Failure detail</h2>${failureHtml || '<div class="empty">No failure signal in the available session events or matching native spans. This does not prove the run succeeded.</div>'}</section><section class="section" aria-labelledby="timeline-title"><h2 id="timeline-title">End-to-end timeline</h2><p>${rows.length} operation rows · ${unresolvedRows} operations with missing or incomplete evidence · ${invalidTimestamps} session events without valid timestamps · ${suppressedEvents} low-level reasoning/background updates grouped out of the timeline · ${unmatchedDeltas} uncorrelated stream deltas not linked. ${nativeSpans ? 'Native spans share the same time axis and may overlap session events.' : 'No exact-session native spans were observed in local receipts.'} ${scriptSpans ? 'Script spans have exact run-ID links; tool-call relationships are separately labelled exact or inferred from unique time-window evidence. No physical parent is claimed.' : ''} Yellow means completion or a matching edge was not observed. Rich details stay in this local file. No cloud export occurs.</p><div class="toolbar" role="group" aria-label="Timeline filters"><button type="button" data-filter="all" aria-pressed="true">All events</button><button type="button" data-filter="failed" aria-pressed="false">Failures</button><button type="button" data-filter="tool" aria-pressed="false">Tools</button><button type="button" data-filter="native" aria-pressed="false">Native OTel</button><button type="button" data-filter="script" aria-pressed="false">Script OTel</button></div><main id="timeline">${rowHtml}</main></section><script>const buttons=[...document.querySelectorAll('[data-filter]')];const rows=[...document.querySelectorAll('.row')];function filter(name){for(const row of rows)row.hidden=!(name==='all'||name==='failed'&&row.dataset.status==='failed'||name==='tool'&&row.dataset.kind.startsWith('tool.')||name==='native'&&row.dataset.source==='native OTel'||name==='script'&&row.dataset.source==='script OTel');for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.filter===name));}for(const button of buttons)button.addEventListener('click',()=>filter(button.dataset.filter));function showTarget(){const target=document.getElementById(location.hash.slice(1));if(target?.classList.contains('row')){filter('all');target.open=true;target.scrollIntoView({block:'center'});}}for(const link of document.querySelectorAll('a[href^="#event-"]'))link.addEventListener('click',()=>setTimeout(showTarget,0));addEventListener('hashchange',showTarget);if(location.hash)showTarget();</script></body></html>`;
}

function writeSessionWaterfall(events, sessionId, outputPath, options = {}) {
  if (!outputPath) throw new Error('copilot-session view requires --output <local.html>');
  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, renderSessionWaterfall(events, sessionId, options), { flag: 'wx', mode: 0o600 });
  return resolved;
}

module.exports = { renderSessionWaterfall, sessionWaterfall, writeSessionWaterfall };
