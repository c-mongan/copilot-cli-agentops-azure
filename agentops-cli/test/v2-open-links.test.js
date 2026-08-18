const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { openV2FromFiles, renderOpenV2, v2OpenLinksForRun } = require('../src/lib/v2-open-links');
const { writeJsonlFixture } = require('./support/json-fixtures');

const legacyLinks = {
  application_insights_url: 'https://portal.azure.com/#/resource/app-insights/overview',
  primary_investigation_url: 'https://portal.azure.com/#agents',
  primary_investigation_label: 'Azure Monitor Agents view',
  azure_agents_view_url: 'https://portal.azure.com/#agents',
  v2_home_url: 'https://graf.example/d/agentops-v2-home',
  v2_runs_url: 'https://graf.example/d/agentops-v2-runs-explorer',
  v2_replay_url: 'https://graf.example/d/agentops-v2-run-replay'
};

test('v2OpenLinksForRun builds run scoped dashboard links', () => {
  const result = v2OpenLinksForRun({
    RunId: 'run-open',
    SessionId: 'session-open',
    TraceId: 'trace-open',
    RepoHash: 'repo_hash',
    AgentName: 'agent-main',
    ModelActual: 'gpt-5.5',
    OutcomeStatus: 'success'
  }, legacyLinks);

  assert.equal(result.ok, true);
  assert.match(result.links.replay, /var-run_id=run-open/);
  assert.match(result.links.runs, /var-repo_hash=repo_hash/);
  assert.match(result.links.runs, /var-agent_name=agent-main/);
  assert.match(result.links.content_viewer, /viewPanel=26/);
  assert.match(result.links.models, /var-model=gpt-5\.5/);
  assert.match(renderOpenV2(result), /Prompt\/response viewer \(explicit opt-in\):/);
});

test('v2OpenLinksForRun prefers the configured Azure-native investigation view', () => {
  const result = v2OpenLinksForRun({
    RunId: 'run-native',
    OutcomeStatus: 'success'
  }, legacyLinks);

  assert.equal(result.links.primary, legacyLinks.azure_agents_view_url);
  assert.equal(result.links.primary_label, 'Azure Monitor Agents view');
  assert.equal(result.links.application_insights, legacyLinks.application_insights_url);
  assert.match(renderOpenV2(result), /Azure Monitor Agents view: https:\/\/portal\.azure\.com\/#agents/);
});

test('openV2FromFiles selects the latest run row', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-v2-open-links-'));
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
        TraceId: 'trace-latest'
      }
    ]);

    const result = openV2FromFiles({ runId: 'latest', runsFile, legacyLinks });

    assert.equal(result.ok, true);
    assert.equal(result.run_id, 'run-latest');
    assert.match(result.links.replay, /var-session_id=session-latest/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
