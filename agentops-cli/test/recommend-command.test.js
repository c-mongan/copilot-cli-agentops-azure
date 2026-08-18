const assert = require('node:assert/strict');
const test = require('node:test');

const {
  firstPositional,
  recommendationRow,
  renderRecommendationV2
} = require('../src/lib/recommend-command');

test('recommend command library preserves command helper exports', () => {
  assert.equal(firstPositional(['--runs', 'runs.jsonl', 'run-1']), 'run-1');
  assert.equal(typeof recommendationRow, 'function');
  assert.match(renderRecommendationV2({
    run_id: 'run-1',
    action: 'compare',
    severity: 'medium',
    next_action: 'Run a comparison.',
    evidence: ['latency regression'],
    linked_dashboards: []
  }), /Run a comparison/);
});
