const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const { otelAttributeMap } = require(path.join(repoRoot, 'packages', 'agentops-copilot-sdk', 'src', 'event-envelope'));

const canonicalSdkAttributes = Object.freeze([...new Set(Object.values(otelAttributeMap))].sort());
const forbiddenContentAttributes = Object.freeze([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'http.request.body.content',
  'http.response.body.content',
  'url.full',
  'code.filepath'
]);

function attributesForContext(text, context) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const match = normalized.match(new RegExp(`- context: ${context}\\n[\\s\\S]*?- keep_keys\\(attributes, (\\[[^\\n]+\\])\\)`));
  return match ? JSON.parse(match[1]) : [];
}

function syncContext(text, context) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const expression = new RegExp(`(- context: ${context}\\n[\\s\\S]*?- keep_keys\\(attributes, )(\\[[^\\n]+\\])(\\))`);
  if (!expression.test(normalized)) throw new Error(`Missing ${context} keep_keys allowlist`);
  return normalized.replace(expression, (whole, prefix, raw, suffix) => {
    const existing = JSON.parse(raw);
    const merged = [...existing, ...canonicalSdkAttributes.filter(attribute => !existing.includes(attribute))];
    return `${prefix}${JSON.stringify(merged)}${suffix}`;
  });
}

function strictCollectorFiles() {
  return [
    'collector/processors/strict-allowlist.yaml',
    'collector/otelcol.local.strict.yaml',
    'collector/otelcol.binary.strict.yaml',
    'collector/otelcol.azuremonitor.strict.yaml'
  ].map(file => path.join(repoRoot, file));
}

function syncStrictCollectorFiles(options = {}) {
  const write = options.write !== false;
  const changed = [];
  for (const file of strictCollectorFiles()) {
    const original = fs.readFileSync(file, 'utf8');
    const normalized = original.replace(/\r\n/g, '\n');
    let rendered = syncContext(normalized, 'span');
    if (/- context: log\n/.test(rendered)) rendered = syncContext(rendered, 'log');
    if (rendered !== normalized) {
      changed.push(path.relative(repoRoot, file));
      if (write) fs.writeFileSync(file, original.includes('\r\n') ? rendered.replace(/\n/g, '\r\n') : rendered);
    }
  }
  return { ok: true, changed, attributes: canonicalSdkAttributes.length };
}

module.exports = {
  attributesForContext,
  canonicalSdkAttributes,
  forbiddenContentAttributes,
  repoRoot,
  strictCollectorFiles,
  syncContext,
  syncStrictCollectorFiles
};
