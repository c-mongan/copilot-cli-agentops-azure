const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { productAuditWithVisual } = require('../src/lib/product-audit-visual');
const { requiredVisualDashboards } = require('../src/lib/product-visual');

function baseAudit() {
  return {
    ok: true,
    scope: 'local-product-contract',
    live_azure_verified: false,
    live_grafana_verified: false,
    visual_grafana_verified: false,
    summary: {
      checks: 1,
      passed: 1,
      failed: 0,
      v2_dashboards: 10,
      checked_links: 20
    },
    checks: [{ name: 'base-product-check', ok: true, evidence: ['base'], missing: [] }],
    next: ['agentops product audit --live --json']
  };
}

function writeEvidence() {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-product-audit-visual-'));
  const screenshotsDir = path.join(evidenceDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const dashboards = requiredVisualDashboards.map(uid => {
    const screenshot = path.join('screenshots', `${uid}.png`);
    fs.writeFileSync(path.join(evidenceDir, screenshot), Buffer.alloc(2048, 1));
    return {
      uid,
      title: uid,
      url: `https://example.grafana.azure.com/d/${uid}`,
      dashboardVisible: true,
      authBlocked: false,
      errors: [],
      screenshot
    };
  });
  const evidencePath = path.join(evidenceDir, 'visual-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify({ dashboards }, null, 2));
  return evidencePath;
}

test('product audit visual helper accepts authenticated evidence file', async () => {
  const result = await productAuditWithVisual({
    requireVisual: true,
    visualEvidencePath: writeEvidence()
  }, {
    productAudit: baseAudit
  });

  assert.equal(result.ok, true);
  assert.equal(result.scope, 'local-and-visual-product-contract');
  assert.equal(result.visual_grafana_verified, true);
  assert.equal(result.summary.checks, 2);
  assert.equal(result.summary.passed, 2);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.visual_dashboards_visible, requiredVisualDashboards.length);
  assert.deepEqual(result.next, ['agentops product audit --live --json']);
  assert.equal(result.checks.at(-1).name, 'visual-grafana-rendered-dashboards');
});
