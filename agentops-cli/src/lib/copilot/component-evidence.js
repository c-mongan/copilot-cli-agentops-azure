const fs = require('node:fs');
const crypto = require('node:crypto');
const COMPONENTS = ['agents', 'skills', 'references', 'scripts', 'tools', 'models'];

// These counters describe the supplied receipts, never all possible execution.
// Missing instrumentation cannot be inferred without an independent expectation.
function loadComponentExpectations(file) {
  if (!file) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('expectations must be a regular file below 64 KiB');
  const text = fs.readFileSync(file, 'utf8');
  const input = JSON.parse(text);
  if (input.scope !== 'stimulus' || !input.components || typeof input.components !== 'object' || Array.isArray(input.components)) throw new Error('expectations require stimulus scope and components');
  const components = {};
  for (const [name, row] of Object.entries(input.components)) {
    if (!COMPONENTS.includes(name) || !Number.isSafeInteger(row?.expected) || row.expected < 0 || row.expected > 1000000 || typeof row.supported !== 'boolean') throw new Error('invalid component expectation');
    components[name] = { expected: row.expected, supported: row.supported };
  }
  return { scope: 'stimulus', sha256: crypto.createHash('sha256').update(text).digest('hex'), components };
}

function componentEvidence(events = [], spans = [], expectations = null) {
  const output = Object.fromEntries(COMPONENTS.map(name => [name, {
    status: 'unknown', supported: 'unknown', attempted: null, observed: 0,
    completed: null, failed: null, pending: null, expected: null, missing: null
  }]));
  for (const [name, predicate] of [
    ['tools', row => Boolean(row.ToolCallId) && row.EventName?.startsWith('tool.execution_')],
    ['references', row => Boolean(row.ReferenceName)],
    ['agents', row => row.EventName?.startsWith('subagent.')]
  ]) {
    const selected = events.filter(predicate);
    const starts = new Set(), completed = new Set(), failed = new Set();
    for (const row of selected) {
      const id = name === 'agents' ? row.AgentId || row.ParentToolCallId : row.ToolCallId;
      if (!id) continue;
      if (row.Status === 'started') starts.add(id);
      if (row.Status === 'completed') completed.add(id);
      if (row.Status === 'failed') failed.add(id);
    }
    output[name] = { ...output[name], attempted: starts.size,
      observed: new Set([...starts, ...completed, ...failed]).size,
      completed: completed.size, failed: failed.size,
      pending: [...starts].filter(id => !completed.has(id) && !failed.has(id)).length };
  }
  output.skills.observed = new Set(events.filter(row => row.EventName === 'skill.invoked').map(row => row.SkillName).filter(Boolean)).size;
  output.scripts.observed = new Set(spans.filter(span => span.traceId && span.spanId && span.match === 'run-linked-script').map(span => `${span.traceId}:${span.spanId}`)).size;
  output.models.observed = new Set(spans.filter(span => span.traceId && span.spanId && (span.operation === 'chat' || span.modelActual)).map(span => `${span.traceId}:${span.spanId}`)).size;
  for (const [name, expected] of Object.entries(expectations?.components || {})) {
    if (!COMPONENTS.includes(name)) continue;
    output[name].supported = expected.supported;
    output[name].expected = expected.expected;
    output[name].missing = Math.max(0, expected.expected - output[name].observed);
  }
  return output;
}
module.exports = { componentEvidence, loadComponentExpectations };
