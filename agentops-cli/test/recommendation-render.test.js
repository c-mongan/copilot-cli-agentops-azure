const assert = require('node:assert/strict');
const test = require('node:test');

const { renderRecommendationV2 } = require('../src/lib/recommendation-render');

test('renderRecommendationV2 formats recommendation evidence for operators', () => {
  const output = renderRecommendationV2({
    action: 'compare_after_run',
    severity: 'review',
    run_id: 'run-1',
    observed_pattern: 'cost regression',
    next_action: 'run benchmark before merge',
    evidence: {
      eval: { overall: 72, bucket: 'watch', reason: 'cost increased' },
      pattern: { key: 'cost|model|task', runs: 3, dimension: 'cost' },
      benchmark: { run_id: 'bench-1', decision: 'review', average_score: 82, pass_rate_pct: 75 },
      change_annotations: [{ component: 'model', target: 'deployment', change_type: 'updated', version: 'v2' }],
      file_refs: ['infra/model.bicep'],
      dashboards: [{ title: 'Cost', url: 'https://example.test/d/cost' }]
    },
    validation: ['confirm cost trend'],
    rollback_condition: 'cost keeps rising'
  });

  assert.match(output, /Action: compare_after_run/);
  assert.match(output, /Eval: 72 \(watch\) - cost increased/);
  assert.match(output, /Benchmark: bench-1/);
  assert.match(output, /Dashboards:/);
  assert.match(output, /Rollback condition: cost keeps rising/);
});
