const test = require('node:test');
const assert = require('node:assert/strict');

const { playwrightBrowserCheck, summarizePageAudit } = require('../src/lib/e2e-playwright');

test('e2e Playwright helper reports skipped when Playwright is unavailable', async () => {
  const result = await playwrightBrowserCheck({
    reportPath: '/tmp/agentops-e2e-report.html',
    outDir: '/tmp/agentops-e2e-screenshots',
    loadPlaywright: () => ({ playwright: null, error: new Error('not installed') })
  });

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /Playwright is not available: not installed/);
});

test('page audit summarizes accessibility and performance evidence', () => {
  const result = summarizePageAudit({
    navigation: { loadEventEnd: 1840, domContentLoadedEventEnd: 910 },
    firstContentfulPaint: 640,
    resourceCount: 42,
    transferBytes: 123456,
    accessibility: {
      hasTitle: true,
      hasLanguage: true,
      hasMain: true,
      hasNavigation: true,
      hasSkipLink: true,
      headings: 8,
      unlabeledInteractive: 0,
      unlabeledInteractiveDetails: [],
      duplicateIds: 0
    }
  });

  assert.equal(result.accessibility.ok, true);
  assert.equal(result.performance.ok, true);
  assert.equal(result.performance.navigationLoadMs, 1840);
  assert.equal(result.performance.firstContentfulPaintMs, 640);
  assert.equal(result.performance.transferBytes, 123456);
});

test('page audit fails closed for missing landmarks, labels, and slow navigation', () => {
  const result = summarizePageAudit({
    navigation: { loadEventEnd: 12001 },
    accessibility: {
      hasTitle: true,
      hasLanguage: false,
      hasMain: false,
      hasNavigation: true,
      hasSkipLink: false,
      unlabeledInteractive: 2,
      duplicateIds: 1
    }
  });

  assert.equal(result.accessibility.ok, false);
  assert.equal(result.performance.ok, false);
  assert.equal(result.accessibility.unlabeledInteractive, 2);
});
