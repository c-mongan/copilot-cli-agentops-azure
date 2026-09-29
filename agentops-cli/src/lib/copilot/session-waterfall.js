const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function eventTime(event) {
  const value = Date.parse(event?.timestamp || '');
  return Number.isFinite(value) ? value : null;
}

function sessionWaterfall(events = []) {
  const ordered = events.map((event, index) => ({ event, index, time: eventTime(event) }))
    .filter(item => item.time !== null)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const pendingTools = new Map();
  const pendingHooks = new Map();
  const pendingTurns = new Map();
  const rows = [];
  let agent = 'github-copilot-cli';

  for (const { event, index, time } of ordered) {
    const data = event.data || {};
    const type = event.type || 'unknown';
    if (type === 'subagent.selected') agent = data.agentName || data.agentDisplayName || agent;
    const row = { index, start: time, end: time, lane: agent, kind: type, label: type, status: 'observed', details: data };
    if (type === 'tool.execution_start') {
      row.label = data.toolName || 'unknown tool';
      row.status = 'incomplete';
      if (data.toolCallId) pendingTools.set(data.toolCallId, row);
    } else if (type === 'tool.execution_complete') {
      const started = pendingTools.get(data.toolCallId);
      if (started) {
        started.end = time;
        started.status = data.success === false ? 'failed' : 'completed';
        started.details = { start: started.details, completion: data };
        pendingTools.delete(data.toolCallId);
        continue;
      }
      row.label = data.toolName || 'unknown tool';
      row.status = data.success === false ? 'failed' : 'completed, start not observed';
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
      if (data.turnId) pendingTurns.set(data.turnId, row);
    } else if (type === 'assistant.turn_end') {
      const started = pendingTurns.get(data.turnId);
      if (started) {
        started.end = time;
        started.status = 'completed';
        pendingTurns.delete(data.turnId);
        continue;
      }
      row.label = 'model turn';
      row.status = 'completed, start not observed';
    } else if (type === 'assistant.message') {
      row.label = data.toolRequests?.length ? `assistant: ${data.toolRequests.map(request => request.name).join(', ')}` : 'assistant message';
    } else if (type === 'user.message') {
      row.label = 'user message';
    } else if (type === 'session.model_change') {
      row.label = `model: ${data.newModel || 'unknown'}`;
    } else if (type === 'subagent.selected' || type.startsWith('subagent.')) {
      row.label = `${type}: ${data.agentName || data.agentDisplayName || 'unknown'}`;
    } else if (type === 'skill.invoked') {
      row.label = `skill: ${data.name || 'unknown'}`;
    }
    rows.push(row);
  }
  const first = ordered[0]?.time || 0;
  const last = ordered.at(-1)?.time || first;
  return { rows, first, last, durationMs: Math.max(1, last - first), invalidTimestamps: events.length - ordered.length };
}

function renderSessionWaterfall(events, sessionId) {
  const { rows, first, durationMs, invalidTimestamps } = sessionWaterfall(events);
  const rowHtml = rows.map(row => {
    const left = Math.max(0, Math.min(99, (row.start - first) / durationMs * 100));
    const width = Math.max(0.4, Math.min(100 - left, (row.end - row.start) / durationMs * 100));
    const duration = row.end > row.start ? `${row.end - row.start} ms` : 'point event';
    const statusClass = row.status === 'failed' ? 'failed' : row.status === 'incomplete' ? 'incomplete' : 'normal';
    return `<details class="row"><summary><span class="lane">${escapeHtml(row.lane)}</span><span class="track"><span class="bar ${statusClass}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></span></span><span class="label">${escapeHtml(row.label)}</span><span class="time">${escapeHtml(duration)}</span></summary><pre>${escapeHtml(JSON.stringify({ timestamp: new Date(row.start).toISOString(), end: new Date(row.end).toISOString(), event: row.kind, status: row.status, sourceIndex: row.index, data: row.details }, null, 2))}</pre></details>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot run ${escapeHtml(sessionId)}</title><style>body{font:14px system-ui,sans-serif;background:#101827;color:#e8eef8;margin:2rem;max-width:1400px}h1{font-size:1.5rem}p{color:#b8c5d8}.row{border-bottom:1px solid #354257}.row summary{display:grid;grid-template-columns:14rem minmax(12rem,1fr) 20rem 6rem;gap:.7rem;align-items:center;padding:.55rem;cursor:pointer}.row:hover{background:#1c293d}.lane,.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{height:1.15rem;background:#26344a;position:relative;border-radius:.25rem}.bar{position:absolute;top:0;height:100%;background:#62a9f5;min-width:3px;border-radius:.25rem}.bar.failed{background:#f36b6b}.bar.incomplete{background:#e9b556}.time{color:#a7b8cd;text-align:right}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#1a2639;padding:1rem;border-radius:.35rem}@media(max-width:850px){.row summary{grid-template-columns:7rem 1fr 7rem}.label{grid-column:1/3}.time{grid-column:3}}</style></head><body><h1>Copilot run ${escapeHtml(sessionId)}</h1><p>Local session record · ${rows.length} visible events · ${(durationMs / 1000).toFixed(2)} s · ${invalidTimestamps} events without valid timestamps. Bars share a time axis; overlapping bars ran concurrently. Yellow means completion was not observed. Rich details stay in this local file. No cloud export occurs.</p><main>${rowHtml}</main></body></html>`;
}

function writeSessionWaterfall(events, sessionId, outputPath) {
  if (!outputPath) throw new Error('copilot-session view requires --output <local.html>');
  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, renderSessionWaterfall(events, sessionId), { flag: 'wx', mode: 0o600 });
  return resolved;
}

module.exports = { renderSessionWaterfall, sessionWaterfall, writeSessionWaterfall };
