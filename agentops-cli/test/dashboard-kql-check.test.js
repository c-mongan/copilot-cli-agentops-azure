const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dashboardKqlCheck,
  substituteGrafanaMacros
} = require('../src/lib/dashboard-kql-check');

test('dashboard KQL helpers substitute Grafana macros and variables', () => {
  const query = substituteGrafanaMacros(
    'AgentOpsRunSummary_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo()) | where RunId == "$run_id" and Model == "${model}" | summarize count() by $__interval',
    { last: '2h' }
  );

  assert.match(query, /ago\(2h\)/);
  assert.match(query, /now\(\)/);
  assert.match(query, /RunId == "__all"/);
  assert.match(query, /Model == "__all"/);
  assert.match(query, /summarize count\(\) by 1h/);
  assert.match(query, /\| take 5$/);
});

test('dashboard KQL check supports injected dashboard bodies and query runner', () => {
  const result = dashboardKqlCheck(['--require-rows', '--workspace-id', 'workspace-123'], {
    dashboardBodies: () => [{
      body: {
        uid: 'agentops-v2-home',
        panels: [{
          title: 'Session Health',
          targets: [{ query: 'AgentOpsRunSummary_CL | where RunId == "$run_id"' }]
        }]
      }
    }],
    smokePanels: [{ uid: 'agentops-v2-home', panel: 'Session Health', requireRows: true }],
    runQuery: (query, options) => ({
      ok: query.includes('__all') && options.workspaceId === 'workspace-123',
      rows: [{ ok: true }]
    })
  });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.checks.length, 1);
  assert.deepEqual(result.checks[0], {
    uid: 'agentops-v2-home',
    panel: 'Session Health',
    ok: true,
    rows: 1,
    require_rows: true,
    error: ''
  });
});
