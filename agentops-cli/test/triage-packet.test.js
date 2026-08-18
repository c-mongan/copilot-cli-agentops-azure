const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildTriage, renderTriage, writeTriage } = require('../src/lib/triage-packet');
const { writeJsonlFixture } = require('./support/json-fixtures');

test('buildTriage creates a metadata-only packet with links prompt and recommendation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-triage-packet-'));
  try {
    const runsFile = writeJsonlFixture(path.join(tempDir, 'runs.jsonl'), [{
      TimeGenerated: '2026-06-03T12:00:00Z',
      RunId: 'run-triage',
      SessionId: 'session-triage',
      TraceId: 'trace-triage',
      OutcomeStatus: 'failed',
      ToolFailureCount: 1,
      PrivacyMode: 'strict',
      ContentCaptureMode: 'off'
    }]);
    const eventsFile = writeJsonlFixture(path.join(tempDir, 'events.jsonl'), [{
      TimeGenerated: '2026-06-03T12:01:00Z',
      RunId: 'run-triage',
      EventName: 'agent.tool',
      Status: 'error',
      ToolName: 'shell'
    }]);
    const toolsFile = writeJsonlFixture(path.join(tempDir, 'tools.jsonl'), [{
      TimeGenerated: '2026-06-03T12:02:00Z',
      RunId: 'run-triage',
      ToolName: 'shell',
      Status: 'error'
    }]);
    const evalsFile = writeJsonlFixture(path.join(tempDir, 'evals.jsonl'), [{
      RunId: 'run-triage',
      EvalOverall: 40,
      EvalBucket: 'poor'
    }]);
    const insightsFile = writeJsonlFixture(path.join(tempDir, 'insights.jsonl'), [{
      TimeGenerated: '2026-06-03T12:03:00Z',
      RunId: 'run-triage',
      Severity: 'high',
      InsightType: 'tool-regression',
      ToolName: 'shell',
      Summary: 'The shell tool failure rate regressed.',
      SuggestedNextStep: 'Open Tools & MCP Risk filtered to shell.'
    }]);

    const result = buildTriage({
      runId: 'latest',
      runsFile,
      eventsFile,
      toolsFile,
      evalsFile,
      insightsFile
    });

    assert.equal(result.ok, true);
    assert.equal(result.run_id, 'run-triage');
    assert.equal(result.evidence_counts.events, 1);
    assert.equal(result.recommendation.action, 'investigate_tool');
    assert.match(result.ask_agentops.prompt, /Investigate AgentOps run run-triage/);
    assert.match(renderTriage(result), /AgentOps triage/);

    const artifact = writeTriage(result, tempDir);
    assert.equal(path.basename(artifact.file), 'agentops-triage.json');
    assert.equal(JSON.parse(fs.readFileSync(artifact.file, 'utf8')).run_id, 'run-triage');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
