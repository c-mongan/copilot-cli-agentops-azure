const assert = require('node:assert/strict');
const test = require('node:test');

const { dashboardVerify } = require('../src/lib/dashboard-verify');

test('dashboardVerify combines static dashboard checks without live KQL by default', () => {
  const result = dashboardVerify([]);

  assert.equal(result.ok, true);
  assert.equal(result.live, false);
  assert.ok(result.summary.dashboards > 0);
  assert.ok(result.summary.checked_links > 0);
  assert.equal(result.summary.kql_checks, 0);
  assert.deepEqual(result.errors, []);
});


test('dashboardVerify preserves --kql alias with bounded injected live queries', () => {
  const queries = [];
  const workspaceId = '12345678-1234-1234-1234-123456789abc';
  const result = dashboardVerify(['--kql', '--last', '2h', '--workspace-id', workspaceId], {
    runQuery: (query, options) => {
      queries.push(query);
      assert.equal(options.workspaceId, workspaceId);
      return { ok: true, rows: [{}] };
    }
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.live, true);
  assert.equal(result.checks.kql.mode, 'live');
  assert.equal(result.summary.kql_checks, 35);
  assert.equal(queries.length, 35);
  assert.ok(queries.every(query => query.includes('ago(2h)') && query.endsWith('| take 5')));
});
