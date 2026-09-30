const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function contentText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function contentRowsFromSession(events, sessionId, runId = sessionId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) throw new Error('content export requires a valid run ID');
  const rows = [];
  let turnIndex = 0;
  let model = '';
  const toolNames = new Map();
  const add = (event, role, kind, value, toolName = '', toolCallId = '') => {
    const content = contentText(value);
    if (!content) return;
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) return;
    rows.push({
      TimeGenerated: timestamp.toISOString(),
      RunId: runId,
      SessionId: sessionId,
      TraceId: '',
      SpanId: '',
      TurnIndex: turnIndex,
      Role: role,
      ContentKind: kind,
      CaptureMode: 'full',
      PromptText: kind === 'prompt' || kind === 'tool_arguments' ? content : '',
      ResponseText: kind === 'response' || kind === 'tool_result' ? content : '',
      ToolName: toolName,
      ToolCallId: toolCallId,
      ModelActual: model,
      RedactionStatus: 'synthetic_unredacted',
      ContentHash: crypto.createHash('sha256').update(content).digest('hex'),
      ContentLength: Buffer.byteLength(content),
      SchemaVersion: '2'
    });
  };
  for (const event of events) {
    const data = event.data || {};
    if (event.type === 'session.model_change') model = data.newModel || model;
    if (event.type === 'assistant.turn_start') turnIndex += 1;
    if (event.type === 'user.message') add(event, 'user', 'prompt', data.content);
    if (event.type === 'assistant.message') {
      model = data.model || model;
      add(event, 'assistant', 'response', data.content);
    }
    if (event.type === 'tool.execution_start') {
      if (data.toolCallId && data.toolName) toolNames.set(data.toolCallId, data.toolName);
      add(event, 'tool', 'tool_arguments', data.arguments, data.toolName || '', data.toolCallId || '');
    }
    if (event.type === 'tool.execution_complete') {
      add(event, 'tool', 'tool_result', data.result, data.toolName || toolNames.get(data.toolCallId) || '', data.toolCallId || '');
      if (data.toolCallId) toolNames.delete(data.toolCallId);
    }
  }
  return rows;
}

function writeSessionContent(events, sessionId, outputPath, runId = sessionId) {
  if (!outputPath || path.basename(outputPath) !== 'AgentOpsContent_CL.jsonl') {
    throw new Error('copilot-session export-content requires --output <dir>/AgentOpsContent_CL.jsonl');
  }
  const rows = contentRowsFromSession(events, sessionId, runId);
  if (!rows.length) throw new Error('session has no content rows with valid timestamps');
  const output = path.resolve(outputPath);
  fs.writeFileSync(output, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return { output, rows: rows.length };
}

module.exports = { contentRowsFromSession, writeSessionContent };
