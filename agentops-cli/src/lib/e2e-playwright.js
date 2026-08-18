const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  grafanaAuthRemediation,
  grafanaScreenshotTargets,
  grafanaVisualOk
} = require('./e2e-grafana');
const { browserProfileRuntimeDefaults } = require('./browser-options');

function defaultLoadPlaywright(env = process.env) {
  try {
    return { playwright: require('playwright'), error: null };
  } catch (error) {
    for (const dir of String(env.AGENTOPS_PLAYWRIGHT_MODULE_DIR || env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
      try {
        return { playwright: require(path.join(dir, 'playwright')), error: null };
      } catch {}
    }
    return { playwright: null, error };
  }
}

function summarizePageAudit(snapshot = {}) {
  const navigation = snapshot.navigation || {};
  const accessibility = snapshot.accessibility || {};
  const unlabeledInteractive = Number(accessibility.unlabeledInteractive || 0);
  const duplicateIds = Number(accessibility.duplicateIds || 0);
  const accessibilityOk = Boolean(
    accessibility.hasTitle
    && accessibility.hasLanguage
    && accessibility.hasMain
    && accessibility.hasNavigation
    && accessibility.hasSkipLink
    && unlabeledInteractive === 0
    && duplicateIds === 0
  );
  const loadMs = Number(navigation.loadEventEnd || navigation.duration || 0);
  const performanceOk = loadMs > 0 && loadMs <= 10000;
  return {
    accessibility: {
      level: 'heuristic-smoke',
      wcagVerified: false,
      ok: accessibilityOk,
      ...accessibility,
      unlabeledInteractive,
      duplicateIds
    },
    performance: {
      level: 'navigation-smoke',
      ok: performanceOk,
      navigationLoadMs: Math.round(loadMs),
      domContentLoadedMs: Math.round(Number(navigation.domContentLoadedEventEnd || 0)),
      firstContentfulPaintMs: Math.round(Number(snapshot.firstContentfulPaint || 0)),
      resources: Number(snapshot.resourceCount || 0),
      transferBytes: Number(snapshot.transferBytes || 0)
    }
  };
}

async function auditPage(page) {
  const snapshot = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0]?.toJSON?.() || {};
    const paints = performance.getEntriesByType('paint');
    const firstContentfulPaint = paints.find(entry => entry.name === 'first-contentful-paint')?.startTime || 0;
    const resources = performance.getEntriesByType('resource');
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id).filter(Boolean);
    const duplicateIds = ids.length - new Set(ids).size;
    const interactive = [...document.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="link"]')];
    const unlabeledElements = interactive.filter(element => {
      if (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title')) return false;
      if ((element.textContent || '').trim()) return false;
      if (element.tagName === 'INPUT' && element.getAttribute('placeholder')) return false;
      const id = element.getAttribute('id');
      return !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
    });
    const unlabeledInteractiveDetails = unlabeledElements.slice(0, 50).map(element => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role') || '',
      type: element.getAttribute('type') || '',
      testIdKind: /Dashboard template variables/i.test(element.getAttribute('data-testid') || '')
        ? 'dashboard-template-variable'
        : (element.hasAttribute('data-testid') ? 'other' : ''),
      inDashboardContent: Boolean(element.closest('[data-testid="dashboard-container"], .dashboard-container, main'))
    }));
    const idCounts = ids.reduce((counts, id) => counts.set(id, (counts.get(id) || 0) + 1), new Map());
    return {
      navigation,
      firstContentfulPaint,
      resourceCount: resources.length,
      transferBytes: resources.reduce((total, entry) => total + Number(entry.transferSize || 0), 0),
      accessibility: {
        hasTitle: Boolean(document.title.trim()),
        hasLanguage: Boolean(document.documentElement.lang),
        hasMain: Boolean(document.querySelector('main, [role="main"], #pageContent')),
        hasNavigation: Boolean(document.querySelector('nav, [role="navigation"]')),
        hasSkipLink: [...document.querySelectorAll('a[href]')].some(link => /skip to main/i.test(link.textContent || '')),
        headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').length,
        unlabeledInteractive: unlabeledElements.length,
        unlabeledInteractiveDetails,
        duplicateIds,
        duplicateIdValues: [...idCounts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }))
      }
    };
  });
  return summarizePageAudit(snapshot);
}

async function playwrightBrowserCheck(options = {}) {
  const browserDefaults = browserProfileRuntimeDefaults();
  const {
    reportPath,
    outDir,
    grafana = false,
    grafanaV2Only = false,
    grafanaRunId = '',
    docsScreenshotDir = null,
    requireGrafanaVisible = false,
    requireAccessibilitySmoke = false,
    requirePerformance = false,
    browserExecutable = browserDefaults.browserExecutable,
    browserUserDataDir = browserDefaults.browserUserDataDir,
    storageState = browserDefaults.storageState,
    grafanaBearerToken = '',
    grafanaAuthEvidence = null,
    headed = browserDefaults.headed,
    loadPlaywright = defaultLoadPlaywright
  } = options;
  const loaded = loadPlaywright(process.env);
  if (!loaded.playwright) {
    return { status: 'skipped', reason: `Playwright is not available: ${loaded.error.message}` };
  }
  const playwright = loaded.playwright;

  const viewport = { width: 1440, height: 1000 };
  const contextOptions = {
    viewport,
    ...(grafanaBearerToken ? { extraHTTPHeaders: { Authorization: `Bearer ${grafanaBearerToken}` } } : {})
  };
  const launch = { headless: !headed };
  if (browserExecutable) launch.executablePath = browserExecutable;
  let browser = null;
  let context = null;
  if (browserUserDataDir) {
    context = await playwright.chromium.launchPersistentContext(path.resolve(browserUserDataDir), {
      ...launch,
      ...contextOptions
    });
  } else {
    browser = await playwright.chromium.launch(launch);
    context = await browser.newContext({
      ...contextOptions,
      ...(storageState ? { storageState: path.resolve(storageState) } : {})
    });
  }
  const page = context.pages()[0] || await context.newPage();
  const url = pathToFileURL(reportPath).toString();
  await page.goto(url, { waitUntil: 'networkidle' });
  fs.mkdirSync(outDir, { recursive: true });
  const reportScreenshot = path.join(outDir, 'report.png');
  await page.screenshot({ path: reportScreenshot, fullPage: true });
  const text = await page.locator('body').innerText();
  const browserResult = {
    status: 'checked',
    reportScreenshot,
    passVisible: /\bPASS\b/.test(text),
    secretLooking: /(SECRET_[A-Z_]+|InstrumentationKey=|CONNECTION_STRING=|PASSWORD=|TOKEN=|KEY=)/i.test(text),
    grafana: [],
    browserProfile: {
      persistent: Boolean(browserUserDataDir),
      storageState: Boolean(storageState),
      headed: Boolean(headed)
    },
    ...(grafanaAuthEvidence ? { grafanaAuth: grafanaAuthEvidence } : {})
  };

  if (grafana) {
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => ({
      href: node.href,
      text: node.textContent.trim()
    })));
    for (const target of grafanaScreenshotTargets(links, { v2Only: grafanaV2Only, runId: grafanaRunId })) {
      const dashboard = await context.newPage();
      const dashboardStartedAt = Date.now();
      await dashboard.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await dashboard.waitForTimeout(5000);
      const body = await dashboard.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const pageAudit = await auditPage(dashboard).catch(error => ({ error: error.message }));
      if (pageAudit.performance) {
        pageAudit.performance.dashboardObservedReadyMs = Date.now() - dashboardStartedAt;
        pageAudit.performance.dashboardReadyOk = pageAudit.performance.dashboardObservedReadyMs <= 10000;
      }
      const screenshot = path.join(outDir, target.fileName);
      await dashboard.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      let docsScreenshot = null;
      if (docsScreenshotDir && target.v2Tour && fs.existsSync(screenshot) && !/Sign in|Can.t access your account|login.microsoftonline.com/i.test(body + dashboard.url())) {
        fs.mkdirSync(docsScreenshotDir, { recursive: true });
        docsScreenshot = path.join(docsScreenshotDir, target.fileName);
        fs.copyFileSync(screenshot, docsScreenshot);
      }
      browserResult.grafana.push({
        label: target.label,
        url: target.url,
        screenshot,
        docsScreenshot,
        v2Tour: target.v2Tour,
        authBlocked: /Sign in|Can.t access your account|login.microsoftonline.com/i.test(body + dashboard.url()),
        dashboardVisible: /AgentOps|Copilot|Sessions|Session Detail|No data/i.test(body),
        pageAudit
      });
      await dashboard.close();
    }
  }

  await context.close();
  if (browser) await browser.close();
  browserResult.reportVerified = browserResult.passVisible && !browserResult.secretLooking;
  browserResult.authenticatedGrafanaVerified = grafana && grafanaVisualOk(browserResult.grafana);
  browserResult.accessibilitySmokeVerified = grafana && browserResult.grafana.length > 0
    && browserResult.grafana.every(item => item.pageAudit?.accessibility?.ok === true);
  browserResult.wcagVerified = false;
  browserResult.dashboardReadyPerformanceVerified = grafana && browserResult.grafana.length > 0
    && browserResult.grafana.every(item => item.pageAudit?.performance?.ok === true && item.pageAudit?.performance?.dashboardReadyOk === true);
  browserResult.ok = browserResult.reportVerified
    && (!grafana || browserResult.authenticatedGrafanaVerified)
    && (!requireAccessibilitySmoke || browserResult.accessibilitySmokeVerified)
    && (!requirePerformance || browserResult.dashboardReadyPerformanceVerified);
  if (grafana) browserResult.requireGrafanaVisible = requireGrafanaVisible;
  if (grafana) browserResult.requireAccessibilitySmoke = requireAccessibilitySmoke;
  if (grafana) browserResult.requirePerformance = requirePerformance;
  if (grafana && browserResult.grafana.some(item => item.authBlocked)) {
    const firstBlocked = browserResult.grafana.find(item => item.authBlocked);
    browserResult.authRemediation = grafanaAuthRemediation({
      reportPath,
      browserExecutable,
      browserUserDataDir,
      grafanaUrl: firstBlocked?.url
    });
  }
  return browserResult;
}

module.exports = {
  auditPage,
  defaultLoadPlaywright,
  playwrightBrowserCheck,
  summarizePageAudit
};
