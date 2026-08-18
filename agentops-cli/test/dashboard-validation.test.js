const assert = require('node:assert/strict');
const test = require('node:test');

const {
  dashboardJsonFiles,
  queryFromPanel,
  validateDashboardFilters,
  validateDashboardLinks,
  validateDashboardUx,
  validateDashboards,
  v2DashboardBodies
} = require('../src/lib/dashboard-validation');

test('dashboard validation helpers inspect V2 dashboard contracts directly', () => {
  const files = dashboardJsonFiles();
  const dashboards = v2DashboardBodies();
  const home = dashboards.find(item => item.body.uid === 'agentops-v2-home');
  const runs = dashboards.find(item => item.body.uid === 'agentops-v2-runs-explorer');
  const replay = dashboards.find(item => item.body.uid === 'agentops-v2-run-replay');
  const sessionHealth = (home.body.panels || []).find(panel => panel.title === 'Session Health');
  const runsTable = (runs.body.panels || []).find(panel => panel.title === 'Runs');
  const orderedTimeline = (replay.body.panels || []).find(panel => panel.title === 'Ordered timeline');
  const lineage = (replay.body.panels || []).find(panel => panel.title === 'Agent, skill, and MCP lineage');
  const primaryTitles = Object.fromEntries(dashboards
    .filter(item => ['agentops-v2-home', 'agentops-v2-runs-explorer', 'agentops-v2-run-replay', 'agentops-v2-safety-privacy-policy'].includes(item.body.uid))
    .map(item => [item.body.uid, item.body.title]));

  assert.ok(files.some(file => file.endsWith('01-agentops-home.json')));
  assert.ok(home);
  assert.deepEqual(primaryTitles, {
    'agentops-v2-home': 'Today',
    'agentops-v2-runs-explorer': 'Runs',
    'agentops-v2-run-replay': 'Run Story',
    'agentops-v2-safety-privacy-policy': 'Privacy'
  });
  assert.match(queryFromPanel(sessionHealth), /AgentOpsRunSummary_CL/);
  assert.match(queryFromPanel(sessionHealth), /Delivery='Visible in Azure'/);
  assert.match(queryFromPanel(sessionHealth), /Coverage='AgentOps managed'/);
  assert.match(queryFromPanel(sessionHealth), /Coverage='Native best effort'/);
  assert.match(queryFromPanel(runsTable), /project TimeGenerated, Delivery, Coverage/);
  const timelineQuery = queryFromPanel(orderedTimeline);
  assert.match(timelineQuery, /Sequence, EventId, ParentEventId, Delivery, Coverage, AttributionConfidence, AttributionGap/);
  assert.match(timelineQuery, /McpToolName, ToolName, CommandName, ScriptName/);
  assert.match(timelineQuery, /InputTokens, OutputTokens, ReasoningTokens, TotalTokens, EstimatedCostUsd/);
  assert.match(timelineQuery, /PermissionKind, PermissionDecision, PrivacyMode, ContentCaptureMode, ContentCaptureSignal, ContentAction, ContentDroppedBytes, SecretLike/);
  assert.match(timelineQuery, /order by TimeGenerated asc, SequenceSort asc, EventId asc/);
  assert.match(queryFromPanel(lineage), /Status in \('failed', 'error', 'denied', 'blocked'\)/);
  assert.match(queryFromPanel(lineage), /MissingAttribution/);
  const homeText = (home.body.panels || [])
    .filter(panel => panel.type === 'text')
    .map(panel => panel.options?.content || '')
    .join('\n');
  assert.match(homeText, /These runs are visible in Azure/);
  assert.match(homeText, /agentops delivery status/);
  assert.match((replay.body.panels || []).find(panel => panel.type === 'text').options.content, /with all three set to All, panels can mix matching runs/);
  assert.equal((runs.body.panels || []).some(panel => panel.title === 'Token use'), true);
  assert.equal((runs.body.panels || []).some(panel => panel.title === 'Cost and tokens'), false);
  for (const dashboard of [home, runs, replay, dashboards.find(item => item.body.uid === 'agentops-v2-safety-privacy-policy')]) {
    for (const panel of dashboard.body.panels.filter(panel => panel.type !== 'text')) {
      assert.ok(String(panel.description || '').trim(), `${dashboard.body.title} panel ${panel.title} should explain its meaning`);
    }
  }
  assert.equal(validateDashboards().ok, true);
  assert.equal(validateDashboardLinks().ok, true);
  assert.equal(validateDashboardFilters().ok, true);
  assert.equal(validateDashboardUx().ok, true);
});
