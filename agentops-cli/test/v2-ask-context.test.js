const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildV2AskContext, renderV2AskContext } = require('../src/lib/v2-ask-context');
const { writeJsonlFixture } = require('./support/json-fixtures');

test('buildV2AskContext creates a metadata-only bundle for the latest run', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-v2-ask-context-'));
  try {
    const runsFile = writeJsonlFixture(path.join(tempDir, 'runs.jsonl'), [
      {
        TimeGenerated: '2026-06-03T09:00:00Z',
        RunId: 'run-old',
        SessionId: 'session-old',
        TraceId: 'trace-old'
      },
      {
        TimeGenerated: '2026-06-03T12:00:00Z',
        RunId: 'run-latest',
        SessionId: 'session-latest',
        TraceId: 'trace-latest',
        OutcomeStatus: 'failure',
        OutcomeReason: 'tool_failed',
        PrivacyMode: 'strict',
        ContentCaptureMode: 'off'
      }
    ]);
    const eventsFile = writeJsonlFixture(path.join(tempDir, 'events.jsonl'), [
      {
        TimeGenerated: '2026-06-03T12:01:00Z',
        RunId: 'run-latest',
        EventName: 'agent.tool',
        Status: 'error',
        ToolName: 'shell'
      }
    ]);
    const toolsFile = writeJsonlFixture(path.join(tempDir, 'tools.jsonl'), [
      {
        TimeGenerated: '2026-06-03T12:02:00Z',
        RunId: 'run-latest',
        ToolName: 'shell',
        Status: 'error',
        Allowed: true
      }
    ]);
    const recommendationsFile = writeJsonlFixture(path.join(tempDir, 'recommendations.jsonl'), [
      {
        TimeGenerated: '2026-06-03T12:03:00Z',
        SessionId: 'session-latest',
        Action: 'run_validation',
        Severity: 'medium',
        NextAction: 'Run the benchmark gate.',
        BenchmarkRunId: 'bench-latest'
      }
    ]);

    const result = buildV2AskContext({
      runId: 'latest',
      runsFile,
      eventsFile,
      toolsFile,
      recommendationsFile,
      last: '2h'
    });

    assert.equal(result.ok, true);
    assert.equal(result.run_id, 'run-latest');
    assert.equal(result.counts.events, 1);
    assert.equal(result.counts.failed_tools, 1);
    assert.equal(result.last_recommendation.benchmark_run_id, 'bench-latest');
    assert.match(result.replay_url, /var-run_id=run-latest/);
    assert.match(result.kql_query, /union isfuzzy=true AppDependencies/);
    assert.match(result.prompt, /metadata in this bundle/);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_FAKE_TEST_VALUE|gen_ai\.input\.messages/);
    assert.match(renderV2AskContext(result), /AgentOps ask context/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
