const crypto = require('node:crypto');

const secretPatterns = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'",\s]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

function stableHash(value, prefix = 'hash') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function byteSize(value) {
  if (value === undefined || value === null) return 0;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function contentSignal(value, kind) {
  const size = byteSize(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return {
    observed: size > 0,
    kind,
    action: 'dropped',
    droppedCount: size > 0 ? 1 : 0,
    redactedCount: 0,
    secretLike: secretPatterns.some(pattern => pattern.test(text))
  };
}

function safeToolName(input = {}) {
  return String(input.toolName || input.tool_name || input.name || 'unknown');
}

function safePromptMetadata(input = {}) {
  const prompt = input.prompt || input.userPrompt || input.message || input.text || '';
  return {
    promptHash: stableHash(prompt, 'prompt'),
    promptSizeBytes: byteSize(prompt),
    contentSignal: contentSignal(prompt, 'prompt')
  };
}

function safeToolMetadata(input = {}) {
  const args = input.toolArgs || input.arguments || input.args || {};
  const result = input.toolResult || input.result || {};
  return {
    toolName: safeToolName(input),
    argsSchemaHash: stableHash(Object.keys(args || {}).sort().join(','), 'schema'),
    argsSizeBytes: byteSize(args),
    resultSizeBytes: byteSize(result),
    argsSignal: contentSignal(args, 'tool_args'),
    resultSignal: contentSignal(result, 'tool_result')
  };
}

module.exports = {
  byteSize,
  contentSignal,
  safePromptMetadata,
  safeToolMetadata,
  stableHash
};
