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
    assert.doesNotMatch(result.kql_query, /\| project[^\n]*\bProperties\b/);
    assert.match(result.prompt, /metadata in this bundle/);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_FAKE_TEST_VALUE|gen_ai\.input\.messages/);
    assert.match(renderV2AskContext(result), /AgentOps ask context/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ask context drops payload fields and preserves unknown usage as null', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-safe-ask-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    runsFile: writeJsonlFixture(path.join(root, 'runs.jsonl'), [{
      TimeGenerated: '2026-06-03T12:00:00Z', RunId: 'run-safe', SessionId: 'session-safe',
      TraceId: 'trace-safe', InputTokens: null, CacheReadTokens: null, ContextWindowPct: null,
      PromptText: 'RUN_CANARY'
    }]),
    eventsFile: writeJsonlFixture(path.join(root, 'events.jsonl'), [{ RunId: 'run-safe', EventName: 'tool.execution_complete', ToolName: 'password=TIMELINE_CANARY', PromptText: 'EVENT_CANARY' }]),
    toolsFile: writeJsonlFixture(path.join(root, 'tools.jsonl'), [{ RunId: 'run-safe', ToolCallId: 'call-safe', ToolName: 'bash', Status: 'error', Arguments: 'TOOL_CANARY' }]),
    insightsFile: writeJsonlFixture(path.join(root, 'insights.jsonl'), [{ RunId: 'run-safe', Rule: 'TOOL_THRASH', Status: 'open', Evidence: { prompt: 'INSIGHT_CANARY' } }]),
    recommendationsFile: writeJsonlFixture(path.join(root, 'recommendations.jsonl'), [{ RunId: 'run-safe', Action: 'review', Severity: 'medium', NextAction: 'RECOMMENDATION_CANARY' }])
  };
  const result = buildV2AskContext({ ...files, runId: 'run-safe' });
  assert.equal(result.ok, true);
  assert.equal(result.run.InputTokens, null);
  assert.equal(result.run.CacheReadTokens, null);
  assert.equal(result.run.ContextWindowPct, null);
  assert.equal(result.evidence.failed_tools[0].ToolCallId, 'call-safe');
  assert.equal(result.evidence.insights[0].Rule, 'TOOL_THRASH');
  assert.doesNotMatch(JSON.stringify(result), /RUN_CANARY|EVENT_CANARY|TOOL_CANARY|INSIGHT_CANARY|RECOMMENDATION_CANARY|TIMELINE_CANARY/);
});

test('ask context prompt explicitly surfaces open architecture hypothesis cards when insights rows are present', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-arch-insights-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runsFile = writeJsonlFixture(path.join(root, 'runs.jsonl'), [{
    TimeGenerated: '2026-06-03T12:00:00Z', RunId: 'run-arch', SessionId: 'session-arch', TraceId: 'trace-arch'
  }]);
  // Shape matches `agentops architecture --out <dir>/AgentOpsInsights_CL.jsonl`
  // (toInsightsRow in architecture/report.js) exactly.
  const insightsFile = writeJsonlFixture(path.join(root, 'insights.jsonl'), [
    { TimeGenerated: '2026-06-03T11:00:00Z', RunId: 'run-arch', InsightId: 'insight-1', Rule: 'TOOL_THRASH', ArchitectureVersion: 'abc123', Numerator: 4, Denominator: 10, CoverageRuns: 12, Status: 'open' },
    { TimeGenerated: '2026-06-03T11:05:00Z', RunId: 'run-arch', InsightId: 'insight-2', Rule: 'SKILL_PAIR_COACTIVATED', ArchitectureVersion: 'abc123', Numerator: 9, Denominator: 12, CoverageRuns: 12, Status: 'open' }
  ]);

  const result = buildV2AskContext({ runId: 'run-arch', runsFile, insightsFile });

  assert.equal(result.ok, true);
  assert.equal(result.evidence.insights.length, 2);
  assert.equal(result.evidence.insights[0].ArchitectureVersion, 'abc123');
  assert.equal(result.evidence.insights[0].CoverageRuns, 12);
  assert.ok(result.evidence.insights[0].TimeGenerated);
  assert.match(result.prompt, /2 architecture hypothesis card\(s\) are open/);
  assert.match(result.prompt, /TOOL_THRASH/);
  assert.match(result.prompt, /SKILL_PAIR_COACTIVATED/);
  assert.match(result.prompt, /Not a verdict/);
});

test('ask context prompt states no architecture hypotheses are open when the insights bundle is empty', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-no-arch-insights-'));
  try {
    const runsFile = writeJsonlFixture(path.join(tempDir, 'runs.jsonl'), [{
      TimeGenerated: '2026-06-03T12:00:00Z', RunId: 'run-no-insights', SessionId: 'session-x', TraceId: 'trace-x'
    }]);
    const result = buildV2AskContext({ runId: 'run-no-insights', runsFile });
    assert.equal(result.ok, true);
    assert.equal(result.evidence.insights.length, 0);
    assert.match(result.prompt, /Architecture hypotheses: none open for this run in this bundle\./);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
