const path = require('node:path');

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderReportHtml(report) {
  const status = report.ok ? 'PASS' : 'CHECK';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentOps E2E Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #17202a; background: #f7f9fb; }
    main, nav { max-width: 980px; margin: 0 auto; }
    nav { padding: 8px 0; }
    nav a { margin-right: 16px; }
    .skip-link { position: absolute; left: -9999px; top: 8px; padding: 10px 14px; background: #fff; border: 2px solid #075ea8; border-radius: 6px; z-index: 10; }
    .skip-link:focus { left: 8px; }
    section { background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 20px; margin: 16px 0; }
    h1, h2 { margin-top: 0; }
    code, pre { background: #eef2f6; border-radius: 6px; padding: 2px 5px; }
    pre { padding: 12px; overflow: auto; }
    .status { display: inline-block; padding: 4px 8px; border-radius: 6px; font-weight: 700; background: ${report.ok ? '#dff6e5' : '#fff3cd'}; }
    a { color: #075ea8; }
  </style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<nav aria-label="Report sections">
  <a href="#summary">Summary</a>
  <a href="#privacy">Privacy</a>
  <a href="#dashboards">Dashboards</a>
  <a href="#evidence">Evidence</a>
</nav>
<main id="main-content" tabindex="-1">
  <h1>AgentOps E2E Report <span class="status">${status}</span></h1>
  <section id="summary">
    <h2>Summary</h2>
    <p>Collector mode: <code>${htmlEscape(report.collector?.effectiveMode || report.collector?.mode || 'unknown')}</code></p>
    <p>Privacy mode: <code>${htmlEscape(report.privacyMode)}</code></p>
    <p>E2E marker: <code>${htmlEscape(report.e2eId || 'not available')}</code></p>
    <p>Latest session: <code>${htmlEscape(report.latestSessionId || 'not available')}</code></p>
    <p>Latest matched marker: <code>${htmlEscape(report.latestE2eMatched ? 'yes' : 'no')}</code></p>
    <p>Backend live run: <code>${htmlEscape(report.live ? (report.ok && report.latestE2eMatched ? 'verified' : 'failed') : 'not requested')}</code></p>
    <p>Authenticated Grafana visual verification: <code>not part of this report</code>; run <code>agentops e2e browser-check --playwright --grafana</code>.</p>
  </section>
  <section id="privacy">
    <h2>Privacy Poison Test</h2>
    <pre>${htmlEscape(JSON.stringify(report.poison, null, 2))}</pre>
  </section>
  <section id="dashboards">
    <h2>Grafana Links</h2>
    ${(report.grafanaLinks || []).map(link => `<p><a href="${htmlEscape(link.url)}">${htmlEscape(link.label)}</a></p>`).join('\n') || '<p>No Grafana links available.</p>'}
  </section>
  <section id="evidence">
    <h2>Evidence Files</h2>
    ${(report.evidenceFiles || []).map(file => `<p><a href="${htmlEscape(path.basename(file))}">${htmlEscape(path.basename(file))}</a></p>`).join('\n')}
  </section>
</main>
</body>
</html>
`;
}

function htmlLinks(html) {
  const links = [];
  const pattern = /<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    links.push({
      href: match[1].replace(/&amp;/g, '&'),
      text: match[2].replace(/<[^>]+>/g, '').trim()
    });
  }
  return links;
}

function checkReportHtml(html, options = {}) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ');
  const links = htmlLinks(html);
  const grafanaLinks = links.filter(link => /grafana\.azure\.com/i.test(link.href));
  const evidenceLinks = links.filter(link => /\.json($|[?#])/i.test(link.href));
  const secretPattern = /(SECRET_[A-Z_]+|InstrumentationKey=|CONNECTION_STRING=|PASSWORD=|TOKEN=|KEY=)/i;
  const passVisible = /\bPASS\b/.test(text);
  const allowCheckStatus = Boolean(options.allowCheckStatus);
  return {
    ok: (passVisible || allowCheckStatus) && !secretPattern.test(text) && grafanaLinks.length > 0 && evidenceLinks.length > 0,
    passVisible,
    secretLooking: secretPattern.test(text),
    grafanaLinks: grafanaLinks.length,
    evidenceLinks: evidenceLinks.length,
    links
  };
}

module.exports = {
  checkReportHtml,
  htmlLinks,
  renderReportHtml
};
