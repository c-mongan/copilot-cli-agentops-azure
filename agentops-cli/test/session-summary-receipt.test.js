const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionSummary } = require('../src/lib/session-summary');

function receipt() {
  return createSessionSummary({
    appInsightsResourceUrl: 'https://portal.azure.com/#/resource/app-insights/overview',
    buildLink: (_kind, id) => ({ grafana_url: `https://grafana.test/session/${id}` }),
    mainGrafanaDashboardUrl: 'https://grafana.test',
    optionValue: () => null,
    parseLastArg: () => '7d'
  });
}

for (const [durationMs, expected] of [
  [250, '250ms'],
  [999.4, '999ms'],
  [999.6, '1.0s'],
  [1250, '1.3s'],
  [9949, '9.9s'],
  [9950, '10s'],
  [9960, '10s'],
  [59499, '59s'],
  [59500, '1m 0s'],
  [59950, '1m 0s'],
  [60000, '1m 0s'],
  [60499, '1m 0s'],
  [60500, '1m 1s'],
  [3599499, '59m 59s'],
  [3599500, '60m 0s'],
  [3600000, '60m 0s'],
  [3629500, '60m 30s'],
  [3629999, '60m 30s'],
  [3630000, '60m 30s'],
  [7199500, '120m 0s'],
  [NaN, 'not in this data']
]) {
  test(`receipt duration carries rounded seconds: ${durationMs}ms`, () => {
    const api = receipt();
    const summary = api.latestSessionSummary({
      source: 'local',
      rows: [{ TimeGenerated: '2026-08-03T12:00:00.000Z', SessionId: 'duration-session' }]
    });
    summary.session.duration_ms = durationMs;
    assert.equal(api.renderLatest(summary).split('\n').find(line => line.startsWith('Time: ')), `Time: ${expected}`);
  });
}

test('open links prefer the native Application Insights resource before Grafana', () => {
  const api = receipt();
  const links = api.openLinksSummary({ session: null });

  assert.equal(links.primary_investigation_url, 'https://portal.azure.com/#/resource/app-insights/overview');
  assert.equal(links.primary_investigation_label, 'Application Insights (open Agents)');
  assert.equal(links.application_insights_url, 'https://portal.azure.com/#/resource/app-insights/overview');
  assert.equal(links.azure_agents_view_url, null);
});

test('receipt summarizes existing V2 delivery and safety metadata without content fields', () => {
  const api = receipt();
  const result = api.latestSessionSummary({
    source: 'local',
    rows: [
      {
        TimeGenerated: '2026-08-03T12:00:00.000Z',
        RunId: 'run-receipt',
        SessionId: 'session-receipt',
        AgentName: 'builder',
        SkillName: 'agentops-setup',
        SubAgentName: 'reviewer',
        OutcomeStatus: 'success',
        TestsRan: true,
        TestsPassed: true,
        PrOpened: true,
        CiStatus: 'success',
        ToolDeniedCount: 2,
        Credits: 3,
        Properties: {
          'gen_ai.operation.name': 'chat',
          'github.copilot.cost': 3,
          'agentops.cli.name': 'gh',
          'agentops.script.name': 'release-check'
        }
      },
      {
        TimeGenerated: '2026-08-03T12:00:01.000Z',
        SessionId: 'session-receipt',
        McpServerName: 'github',
        ToolName: 'search_issues',
        Allowed: false,
        DroppedCount: 4,
        Properties: { 'gen_ai.operation.name': 'execute_tool' }
      }
    ]
  });

  assert.deepEqual(result.session.skills, ['agentops-setup']);
  assert.deepEqual(result.session.subagents, ['reviewer']);
  assert.deepEqual(result.session.mcp_servers, ['github']);
  assert.deepEqual(result.session.cli_tools, ['gh']);
  assert.deepEqual(result.session.scripts, ['release-check']);
  assert.equal(result.session.denied_tool_calls, 2);
  assert.equal(result.session.privacy_blocked_count, 4);
  assert.equal(result.session.tests_passed, true);
  assert.equal(result.session.pr_opened, true);
  assert.equal(result.session.credits, 3);

  const output = api.renderLatest(result);
  assert.match(output, /skills agentops-setup; subagents reviewer; MCP github/);
  assert.match(output, /CLI gh; scripts release-check/);
  assert.match(output, /tests passed; PR opened; CI success/);
  assert.match(output, /2 denied tool calls; 4 privacy fields blocked/);
  assert.match(output, /Copilot credits: 3/);
  assert.match(output, /Delivery: Local evidence only · Azure not confirmed/);
  assert.doesNotMatch(output, /Visible in Azure/);
  assert.doesNotMatch(output, /SECRET_|raw transcript|file content/i);
});

test('Azure receipt distinguishes query visibility from native coverage', () => {
  const api = receipt();
  const result = api.latestSessionSummary({
    source: 'azure',
    rows: [{
      TimeGenerated: '2026-08-03T12:00:00.000Z',
      SessionId: 'native-session',
      Properties: { 'gen_ai.operation.name': 'chat' }
    }]
  });
  const output = api.renderLatest(result);
  assert.match(output, /Delivery: Visible in Azure/);
  assert.match(output, /Coverage: Native best effort/);
  assert.doesNotMatch(output, /AgentOps managed/);
});
