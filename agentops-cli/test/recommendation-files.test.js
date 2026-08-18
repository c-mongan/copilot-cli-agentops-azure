const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { recommendFromFiles } = require('../src/lib/recommendation-files');
const { writeJsonlFixture } = require('./support/json-fixtures');

test('recommendFromFiles selects the latest run and its strongest insight', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-recommendation-files-'));
  try {
    const runsFile = writeJsonlFixture(path.join(tempDir, 'runs.jsonl'), [
      {
        TimeGenerated: '2026-06-03T09:00:00Z',
        RunId: 'run-old',
        OutcomeStatus: 'success'
      },
      {
        TimeGenerated: '2026-06-03T12:00:00Z',
        RunId: 'run-latest',
        SessionId: 'session-latest',
        TraceId: 'trace-latest',
        OutcomeStatus: 'failed',
        ToolFailureCount: 1,
        ModelActual: 'gpt-5.5'
      }
    ]);
    const evalsFile = writeJsonlFixture(path.join(tempDir, 'evals.jsonl'), [{
      RunId: 'run-latest',
      EvalOverall: 42,
      EvalBucket: 'poor',
      EvalReason: 'tool_failures'
    }]);
    const insightsFile = writeJsonlFixture(path.join(tempDir, 'insights.jsonl'), [{
      TimeGenerated: '2026-06-03T12:01:00Z',
      RunId: 'run-latest',
      Severity: 'high',
      InsightType: 'tool-regression',
      ToolName: 'shell',
      Summary: 'The shell tool failure rate regressed.',
      SuggestedNextStep: 'Open Tools & MCP Risk filtered to shell.'
    }]);

    const recommendation = recommendFromFiles({
      runId: 'latest',
      runsFile,
      evalsFile,
      insightsFile,
      links: {
        v2_home_url: 'https://graf.example/d/agentops-v2-home'
      }
    });

    assert.equal(recommendation.ok, true);
    assert.equal(recommendation.run_id, 'run-latest');
    assert.equal(recommendation.action, 'investigate_tool');
    assert.equal(recommendation.evidence.eval.overall, 42);
    assert.ok(recommendation.evidence.dashboards.some(dashboard => dashboard.url.includes('var-tool_name=shell')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
