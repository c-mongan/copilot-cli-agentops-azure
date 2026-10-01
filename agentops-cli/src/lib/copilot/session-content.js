const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Per-value cap on persisted restricted content. One field (a prompt, a tool
// argument blob, a tool result) is capped well below whole-file ledger limits
// elsewhere in this codebase (MAX_HASHED_FILE_BYTES = 2 MiB in
// attach-command.js, SESSION_SPAN_MAX_BYTES = 20 MiB in session-span-export.js)
// because this is a single-field cap, not a whole-file cap: a session can
// contain many rows, and a single oversized prompt/tool payload (e.g. a
// multi-MB log dump pasted into chat) must never grow one JSONL row without
// bound. 256 KiB keeps forensic context useful while bounding row size.
const CONTENT_VALUE_MAX_BYTES = 256 * 1024;

function truncateToByteLimit(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let size = maxBytes; size >= Math.max(0, maxBytes - 3); size -= 1) {
    try { return decoder.decode(buffer.subarray(0, size)); } catch {}
  }
  throw new Error('could not truncate restricted content at a UTF-8 boundary');
}

function redactContent(value) {
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') return JSON.stringify(redactContent(parsed));
      } catch {}
    }
    return value
      .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]')
      .replace(/(\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|CONNECTION_STRING)[A-Z0-9_]*\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redactContent);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:password|secret|token|api[_-]?key|authorization|connection[_-]?string)/i.test(key)
        ? '[REDACTED]' : redactContent(item)
    ]));
  }
  return value;
}

function contentText(value) {
  if (value === undefined || value === null) return { text: '', truncated: false };
  const safeValue = redactContent(value);
  const text = typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue);
  if (Buffer.byteLength(text, 'utf8') <= CONTENT_VALUE_MAX_BYTES) return { text, truncated: false };
  return { text: truncateToByteLimit(text, CONTENT_VALUE_MAX_BYTES), truncated: true };
}

function contentRowsFromSession(events, sessionId, runId = sessionId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) throw new Error('content export requires a valid run ID');
  const rows = [];
  let turnIndex = 0;
  let model = '';
  const toolNames = new Map();
  const add = (event, role, kind, value, toolName = '', toolCallId = '') => {
    const { text: content, truncated } = contentText(value);
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
      RedactionStatus: 'best_effort_redacted',
      Truncated: truncated,
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

function readContentRows(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// Verifies a restricted content file exclusively belongs to the selected
// session/run before it is ever considered for deletion. This is the
// no-unrelated-deletion guard: a file with even one row for a different
// session or run is refused rather than guessed at.
function contentDeletionPreview(filePath, sessionId, runId) {
  if (!filePath || path.basename(filePath) !== 'AgentOpsContent_CL.jsonl') {
    throw new Error('copilot-session delete-content requires --file <dir>/AgentOpsContent_CL.jsonl');
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { exists: false, file: resolved, rows: 0, bytes: 0 };
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('copilot-session delete-content requires a real file, not a symlink or directory');
  }
  const rows = readContentRows(resolved);
  const unrelated = rows.some(row => row.SessionId !== sessionId || row.RunId !== runId);
  if (unrelated) {
    throw new Error(`restricted content file is not exclusive to session ${sessionId} / run ${runId}; refusing to select it for deletion`);
  }
  return { exists: true, file: resolved, rows: rows.length, bytes: stat.size };
}

// Preview-first, selected-file-only deletion. Deleting always requires an
// explicit `confirm: true`; without it this only reports what would be
// removed. Deletion never touches a directory and never claims anything
// about Azure-side copies — this is local-only retention.
function deleteSessionContent(filePath, sessionId, runId, { confirm = false } = {}) {
  const preview = contentDeletionPreview(filePath, sessionId, runId);
  if (!confirm) {
    return { ...preview, mode: 'preview', deleted: false };
  }
  if (!preview.exists) throw new Error(`restricted content file not found: ${preview.file}`);
  fs.unlinkSync(preview.file);
  return { ...preview, mode: 'confirmed', deleted: true };
}

module.exports = {
  CONTENT_VALUE_MAX_BYTES,
  contentDeletionPreview,
  contentRowsFromSession,
  deleteSessionContent,
  writeSessionContent
};
