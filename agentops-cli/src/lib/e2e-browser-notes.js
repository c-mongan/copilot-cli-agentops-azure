const fs = require('node:fs');

function writeBrowserNotes(filePath, result) {
  const lines = [
    '# Browser Validation Notes',
    '',
    `- Report: ${result.reportPath}`,
    `- Static report check: ${result.static.ok ? 'pass' : 'fail'}`,
    `- Backend evidence verified: ${result.backendEvidenceVerified ? 'yes' : 'no'}`,
    `- Report rendered in browser: ${result.reportBrowserVerified ? 'yes' : 'no'}`,
    `- Authenticated Grafana verified: ${result.authenticatedGrafanaVerified ? 'yes' : 'no'}`,
    `- Accessibility smoke verified: ${result.playwright.accessibilitySmokeVerified ? 'yes' : 'no'} (heuristic only; WCAG verified: no)`,
    `- Dashboard-ready performance verified: ${result.playwright.dashboardReadyPerformanceVerified ? 'yes' : 'no'}`,
    `- PASS visible: ${result.static.passVisible ? 'yes' : 'no'}`,
    `- Secret-looking values: ${result.static.secretLooking ? 'yes' : 'no'}`,
    `- Grafana links: ${result.static.grafanaLinks}`,
    `- Evidence JSON links: ${result.static.evidenceLinks}`,
    `- Playwright: ${result.playwright.status}`
  ];
  if (result.playwright.reason) lines.push(`- Playwright reason: ${result.playwright.reason}`);
  if (result.playwright.reportScreenshot) lines.push(`- Report screenshot: ${result.playwright.reportScreenshot}`);
  if (result.playwright.browserProfile) {
    lines.push(`- Browser profile: ${result.playwright.browserProfile.persistent ? 'persistent profile' : result.playwright.browserProfile.storageState ? 'storage state' : 'fresh context'}`);
  }
  if (result.playwright.grafana?.length) {
    lines.push('', '## Grafana');
    for (const item of result.playwright.grafana) {
      lines.push(`- ${item.label}: ${item.dashboardVisible ? 'visible' : item.authBlocked ? 'auth-blocked' : 'not verified'} (${item.url})`);
    }
    if (result.playwright.requireGrafanaVisible && result.playwright.grafana.some(item => !item.dashboardVisible)) {
      lines.push('- Required visible dashboards: failed. Sign in with an authenticated Grafana browser profile and rerun.');
    }
    if (result.playwright.authRemediation) {
      lines.push('', '## Auth Remediation', '', result.playwright.authRemediation.reason, '');
      lines.push('Sign in once:');
      lines.push('```bash');
      for (const command of result.playwright.authRemediation.sign_in_once) lines.push(command);
      lines.push('```', '', 'Verify after sign-in:');
      lines.push('```bash');
      for (const command of result.playwright.authRemediation.verify_after_sign_in) lines.push(command);
      lines.push('```');
    }
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

module.exports = {
  writeBrowserNotes
};
