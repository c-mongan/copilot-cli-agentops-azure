const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  requiredVisualDashboards,
  validateVisualEvidence,
  visualAuditRecoveryCommands
} = require('../src/lib/product-visual');

function writeEvidence(overridesByUid = {}) {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-product-visual-'));
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
      screenshot,
      ...(overridesByUid[uid] || {})
    };
  });
  const evidencePath = path.join(evidenceDir, 'visual-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify({ dashboards }, null, 2));
  return evidencePath;
}

test('product visual evidence accepts rendered required dashboards', () => {
  const evidence = validateVisualEvidence(writeEvidence());

  assert.equal(evidence.ok, true, evidence.missing.join(', '));
  assert.equal(evidence.dashboards.length, requiredVisualDashboards.length);
  assert.deepEqual(evidence.visible, requiredVisualDashboards);
});

test('product visual evidence reports dashboard and screenshot failures', () => {
  const firstUid = requiredVisualDashboards[0];
  const secondUid = requiredVisualDashboards[1];
  const evidencePath = writeEvidence({
    [firstUid]: {
      authBlocked: true,
      dashboardVisible: false,
      screenshot: '',
      url: 'https://example.grafana.azure.com/d/wrong-dashboard'
    },
    [secondUid]: {
      errors: ['Panel failed to render'],
      sha256: 'incorrect-hash'
    }
  });
  const evidence = validateVisualEvidence(evidencePath);

  assert.equal(evidence.ok, false);
  assert.ok(evidence.missing.includes(`${firstUid}: auth-blocked`));
  assert.ok(evidence.missing.includes(`${firstUid}: not visible`));
  assert.ok(evidence.missing.includes(`${firstUid}: screenshot missing or too small`));
  assert.ok(evidence.missing.includes(`${firstUid}: URL does not match dashboard UID`));
  assert.ok(evidence.missing.includes(`${secondUid}: Panel failed to render`));
  assert.ok(evidence.missing.includes(`${secondUid}: screenshot hash mismatch`));
});

test('product visual evidence reports missing and invalid files', () => {
  const missing = validateVisualEvidence(path.join(os.tmpdir(), 'missing-product-visual-evidence.json'));
  const invalidPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-product-visual-')), 'bad.json');
  fs.writeFileSync(invalidPath, '{');
  const invalid = validateVisualEvidence(invalidPath);

  assert.equal(missing.ok, false);
  assert.match(missing.missing[0], /Visual evidence file not found/);
  assert.equal(invalid.ok, false);
  assert.match(invalid.missing[0], /Visual evidence file is not valid JSON/);
});

test('product visual recovery commands point to report regeneration and audit rerun', () => {
  const commands = visualAuditRecoveryCommands('/tmp/agentops-report.html');

  assert.deepEqual(commands, [
    'agentops e2e run --live --browser-report --last 2h --json',
    'agentops e2e report --last 2h --out /tmp/agentops-report.html',
    'agentops product audit --live --last 2h --require-rows --require-visual --report /tmp/agentops-report.html --json'
  ]);
});
