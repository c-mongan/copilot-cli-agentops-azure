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
