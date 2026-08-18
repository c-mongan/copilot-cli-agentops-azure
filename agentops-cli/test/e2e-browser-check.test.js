const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { browserEvidenceStatus, e2eAuthProfile, e2eBrowserCheck } = require('../src/lib/e2e-browser-check');
const { renderReportHtml } = require('../src/lib/e2e-report');

test('e2e browser check validates a report and writes browser notes without Playwright', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-e2e-browser-lib-'));
  try {
    const reportPath = path.join(tempDir, 'report.html');
    const notesPath = path.join(tempDir, 'notes.md');
    fs.writeFileSync(reportPath, renderReportHtml({
      ok: true,
      privacyMode: 'strict',
      e2eId: 'agentops-e2e-test',
      latestSessionId: 'session-test',
      collector: { effectiveMode: 'binary' },
      poison: { ok: true },
      grafanaLinks: [{ label: 'Overview', url: 'https://grafana.example.grafana.azure.com/d/overview' }],
      evidenceFiles: ['/tmp/summary.json']
    }));

    const result = await e2eBrowserCheck(['--report', reportPath, '--out', notesPath]);

    assert.equal(result.ok, true);
    assert.equal(result.static.ok, true);
    assert.equal(result.playwright.status, 'skipped');
    assert.equal(result.notes, notesPath);
    assert.match(fs.readFileSync(notesPath, 'utf8'), /Browser Validation Notes/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('e2e evidence keeps backend-live success separate from authenticated Grafana proof', () => {
  const result = browserEvidenceStatus(
    { ok: true },
    { ok: false, reportVerified: true, authenticatedGrafanaVerified: false },
    { wantsPlaywright: true, wantsGrafana: true }
  );

  assert.equal(result.backendEvidenceVerified, true);
  assert.equal(result.reportBrowserVerified, true);
  assert.equal(result.authenticatedGrafanaVerified, false);
  assert.equal(result.ok, false);
});

test('e2e auth profile builds reusable Grafana profile guidance', () => {
  const result = e2eAuthProfile([
    '--report',
    '.agentops/e2e/latest/report.html',
    '--browser-user-data-dir',
    '/tmp/agentops-grafana-profile',
    '--url',
    'https://grafana.example.grafana.azure.com/d/agentops-v2-home'
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.browserProfile.browserUserDataDir, '/tmp/agentops-grafana-profile');
  assert.ok(result.remediation.verify_after_sign_in.some(command => command.includes('--require-grafana-visible')));
});
