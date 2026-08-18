const assert = require('node:assert/strict');
const test = require('node:test');

const { buildRecommendation } = require('../src/lib/recommendation-builder');

test('recommendation builder maps eval regression into compare action and metric movement', () => {
  const recommendation = buildRecommendation({
    run: {
      RunId: 'run-1',
      SessionId: 'session-1',
      TraceId: 'trace-1',
      OutcomeStatus: 'success',
      ModelActual: 'gpt-5.1'
    },
    insight: {
      InsightType: 'eval-regression',
      Severity: 'high',
      Summary: 'Eval dropped after an instruction change.',
      SuggestedNextStep: 'Compare the instruction config against the baseline.',
      BaselineValue: 0.91,
      CurrentValue: 0.62
    },
    evaluation: {
      RunId: 'run-1',
      EvalOverall: 0.62,
      EvalBucket: 'needs-work',
      EvalReason: 'Regression in tool-use quality'
    },
    links: {
      v2_home_url: 'https://grafana.example/d/agentops-v2-home'
    }
  });

  assert.equal(recommendation.action, 'compare_regression');
  assert.equal(recommendation.severity, 'high');
  assert.equal(recommendation.evidence.metric_movement.expected.status, 'ready');
  assert.deepEqual(recommendation.evidence.metric_movement.expected.metrics[0], {
    metric: 'eval-regression',
    baseline_value: 0.91,
    current_value: 0.62,
    expected_direction: 'increase',
    source: 'insight'
  });
  assert.ok(recommendation.evidence.file_refs.includes('agent_instruction_config'));
  assert.ok(recommendation.evidence.file_refs.includes('skill_definition'));
});
