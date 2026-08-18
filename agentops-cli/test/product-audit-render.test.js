const assert = require('node:assert/strict');
const test = require('node:test');

const { renderProductAudit } = require('../src/lib/product-audit-render');

test('product audit renderer summarizes checks and next commands', () => {
  const output = renderProductAudit({
    ok: false,
    live_azure_verified: false,
    live_grafana_verified: true,
    visual_grafana_verified: false,
    summary: {
      passed: 1,
      checks: 2,
      v2_dashboards: 10,
      checked_links: 20,
      visual_dashboards: 1
    },
    checks: [
      { name: 'base-check', ok: true, missing: [] },
      { name: 'missing-check', ok: false, missing: ['first', 'second'] }
    ],
    next: ['agentops product audit --json']
  });

  assert.match(output, /AgentOps product audit/);
  assert.match(output, /Result: needs work\./);
  assert.match(output, /Local checks: 1\/2 passed\./);
  assert.match(output, /Live Grafana verified: yes\./);
  assert.match(output, /Visual Grafana verified: no\./);
  assert.match(output, /- FAIL missing-check/);
  assert.match(output, /Missing: first, second/);
  assert.match(output, /- agentops product audit --json/);
});
