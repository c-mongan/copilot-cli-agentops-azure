const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkReportHtml,
  htmlLinks,
  renderReportHtml
} = require('../src/lib/e2e-report');

test('e2e report html renders escaped summary links and evidence files', () => {
  const html = renderReportHtml({
    ok: true,
    live: true,
    privacyMode: 'strict',
    e2eId: 'agentops-e2e-<unsafe>',
    latestSessionId: 'session-test',
    latestE2eMatched: true,
    collector: { effectiveMode: 'binary' },
    poison: { ok: true },
    grafanaLinks: [{
      label: 'Overview <script>',
      url: 'https://grafana.example.grafana.azure.com/d/overview?x=1&y=2'
    }],
    evidenceFiles: ['/tmp/summary.json']
  });

  assert.match(html, /AgentOps E2E Report/);
  assert.match(html, /agentops-e2e-&lt;unsafe&gt;/);
  assert.match(html, /Overview &lt;script&gt;/);
  assert.match(html, /x=1&amp;y=2/);
  assert.match(html, /summary\.json/);
  assert.match(html, /Backend live run: <code>verified<\/code>/);
  assert.match(html, /Authenticated Grafana visual verification/);
  assert.match(html, /href="#main-content">Skip to main content/);
  assert.match(html, /<nav aria-label="Report sections">/);
  assert.match(html, /<main id="main-content" tabindex="-1">/);
});

test('e2e report check requires pass status, Grafana link, JSON evidence, and no secrets', () => {
  const html = renderReportHtml({
    ok: true,
    privacyMode: 'strict',
    e2eId: 'agentops-e2e-test',
    latestSessionId: 'session-test',
    collector: { effectiveMode: 'binary' },
    poison: { ok: true },
    grafanaLinks: [{ label: 'Overview', url: 'https://grafana.example.grafana.azure.com/d/overview' }],
    evidenceFiles: ['/tmp/summary.json']
  });

  const clean = checkReportHtml(html);
  const leaked = checkReportHtml(html.replace('</main>', '<p>SECRET_SHOULD_NOT_LEAVE</p></main>'));
  const checkStatus = checkReportHtml(html.replace(/\bPASS\b/, 'CHECK'));

  assert.equal(clean.ok, true);
  assert.equal(clean.passVisible, true);
  assert.equal(clean.grafanaLinks, 1);
  assert.equal(clean.evidenceLinks, 1);
  assert.equal(leaked.ok, false);
  assert.equal(leaked.secretLooking, true);
  assert.equal(checkStatus.ok, false);
  assert.equal(checkReportHtml(html.replace(/\bPASS\b/, 'CHECK'), { allowCheckStatus: true }).ok, true);
});

test('e2e report link parser decodes hrefs and strips inner markup', () => {
  const links = htmlLinks('<a href="https://example.test/a?x=1&amp;y=2"><strong>Example</strong> Link</a>');

  assert.deepEqual(links, [{
    href: 'https://example.test/a?x=1&y=2',
    text: 'Example Link'
  }]);
});
