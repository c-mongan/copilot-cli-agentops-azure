const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  exportRecommendationStore,
  recommendationActionPlanForRow,
  recommendationStoreCommand,
  saveRecommendation
} = require('../src/lib/recommendation-store');

function sampleRecommendation() {
  return {
    ok: true,
    action: 'investigate_tool',
    severity: 'high',
    run_id: 'run-store-module',
    session_id: 'session-store-module',
    trace_id: 'trace-store-module',
    observed_pattern: 'A tool failure repeated for this run.',
    next_action: 'Open Tools & MCP Risk and validate the tool policy.',
    evidence: {
      dashboards: [{ title: 'Run Story', url: 'https://graf.example/d/agentops-v2-run-replay?var-run_id=run-store-module' }],
      metric_movement: {
        expected: { status: 'ready', metrics: [] },
        before: {},
        after: {},
        observed: { status: 'awaiting-after-run' }
      },
      file_refs: ['skill:agentops-latest-run']
    },
    validation: ['agentops dashboard kql-check --last 24h --json'],
    rollback_condition: 'Rollback if failures rise.'
  };
}

test('recommendation store module saves, lists, exports, and plans recommendation rows', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-recommendation-store-module-'));
  try {
    const storePath = path.join(tempDir, 'recommendations.json');
    const exportDir = path.join(tempDir, 'export');
    const saved = saveRecommendation(sampleRecommendation(), storePath, '2026-06-03T12:00:01Z');
    const listed = recommendationStoreCommand(['list', '--store', storePath]);
    const exported = exportRecommendationStore({ storePath, outDir: exportDir });
    const approvedRow = {
      ...exported.rows[0],
      OperatorReview: {
        status: 'approved',
        decision: 'approve'
      }
    };
    const plan = recommendationActionPlanForRow(approvedRow, {
      benchmarkSuite: 'starter',
      hypothesis: 'rec-store-module'
    });

    assert.equal(saved.count, 1);
    assert.equal(listed.recommendations[0].RecommendationId, saved.saved.RecommendationId);
    assert.equal(exported.rows_written, 1);
    assert.equal(plan.status, 'ready');
    assert.match(plan.commands.create_branch, /agentops\/rec-store-module/);
    assert.deepEqual(plan.evidence.change_target_refs, ['skill:agentops-latest-run']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
