const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const { otelAttributeMap } = require(path.join(repoRoot, 'packages', 'agentops-copilot-sdk', 'src', 'event-envelope'));

const canonicalSdkAttributes = Object.freeze([...new Set(Object.values(otelAttributeMap))].sort());
const resourceCorrelationAttributes = Object.freeze(['agentops.run.id', 'agentops.session.id']);
const scriptRuntimeAttributes = Object.freeze([
  'agentops.script.runtime.name',
  'agentops.script.runtime.version',
  'agentops.script.runtime.implementation',
  'agentops.script.loader.name'
]);
const scriptOutcomeAttributes = Object.freeze([
  'agentops.outcome.source',
  'agentops.script.observer.role',
  'agentops.script.observer.pid',
  'agentops.script.child.pid',
  'process.exit.code',
  'process.signal.number'
]);
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
    const required = context === 'span'
      ? [...canonicalSdkAttributes, ...scriptRuntimeAttributes, ...scriptOutcomeAttributes]
      : canonicalSdkAttributes;
    const merged = [...existing, ...required.filter(attribute => !existing.includes(attribute))];
    return `${prefix}${JSON.stringify(merged)}${suffix}`;
  });
}

function syncResourceContext(text) {
  const expression = /(- context: resource\n[\s\S]*?- keep_keys\(attributes, )(\[[^\n]+\])(\))/g;
  let matches = 0;
  const synchronized = String(text).replace(expression, (whole, prefix, raw, suffix) => {
    matches += 1;
    const existing = JSON.parse(raw);
    const required = [...resourceCorrelationAttributes, ...scriptRuntimeAttributes];
    const merged = [...existing, ...required.filter(attribute => !existing.includes(attribute))];
    return `${prefix}${JSON.stringify(merged)}${suffix}`;
  });
  if (!matches) throw new Error('Missing resource keep_keys allowlist');
  return synchronized;
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
    let rendered = syncResourceContext(normalized);
    rendered = syncContext(rendered, 'span');
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
  resourceCorrelationAttributes,
  scriptOutcomeAttributes,
  strictCollectorFiles,
  syncContext,
  syncResourceContext,
  syncStrictCollectorFiles
};
