const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeInsightsArgs,
  patternRows,
  renderPatterns
} = require('../src/lib/insights-command');

test('insights command library normalizes args and renders recurring patterns', () => {
  assert.deepEqual(normalizeInsightsArgs(['--runs', 'AgentOpsRunSummary_CL.jsonl']), [
    'generate',
    '--runs',
    'AgentOpsRunSummary_CL.jsonl'
  ]);
  assert.deepEqual(normalizeInsightsArgs([]), ['patterns']);

  const rows = patternRows([
    { InsightType: 'other', PatternRuns: 99 },
    { InsightType: 'recurring-cost', PatternRuns: 2, PatternKey: 'low' },
    { InsightType: 'recurring-tool', PatternRuns: 5, PatternKey: 'high', Summary: 'Tool drift' }
  ]);
  assert.deepEqual(rows.map(row => row.PatternKey), ['high', 'low']);
  assert.match(renderPatterns(rows), /Tool drift/);
});
