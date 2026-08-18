const test = require('node:test');
const assert = require('node:assert/strict');

const { productAudit } = require('../src/lib/product-audit');

test('product audit core module supports injected live gates', () => {
  const result = productAudit({
    live: true,
    last: '2h',
    requireRows: true,
    dashboardVerify: args => ({
      ok: args.includes('--live') && args.includes('--require-rows') && args.includes('2h'),
      errors: [],
      summary: {
        kql_checks: 19,
        checked_links: 709
      }
    }),
    validateAzure: options => ({
      ok: options.last === '2h',
      checks: [
        { name: 'resource-group', ok: true },
        { name: 'grafana-dashboards', ok: true }
      ]
    })
  });

  assert.equal(result.ok, true, result.checks.filter(check => check.name).join(', '));
  assert.equal(result.scope, 'local-and-live-product-contract');
  assert.equal(result.live_azure_verified, true);
  assert.equal(result.live_grafana_verified, true);
  assert.equal(result.summary.live_kql_checks, 19);
  assert.equal(result.checks.some(check => check.name === 'live-grafana-dashboard-queries'), true);
  assert.equal(result.checks.some(check => check.name === 'live-azure-resources'), true);
});
