const fs = require('node:fs');
const path = require('node:path');

const { optionValue } = require('./args');
const { azureCliGrafanaBrowserAuth } = require('./azure/grafana-browser-auth');
const { writeBrowserNotes } = require('./e2e-browser-notes');
const { browserProfileOptionsFromArgs, grafanaAuthRemediation } = require('./e2e-grafana');
const { playwrightBrowserCheck } = require('./e2e-playwright');
const { checkReportHtml } = require('./e2e-report');
const { latestEvidenceDir } = require('./e2e-runtime');
const { repoRoot } = require('./paths');

function reportPathFromArgs(args = []) {
  return path.resolve(optionValue(args, ['--report', '--in'], path.join(latestEvidenceDir(), 'report.html')));
}

function e2eAuthProfile(args = []) {
  const reportPath = reportPathFromArgs(args);
  const profile = browserProfileOptionsFromArgs(args);
  const grafanaUrl = optionValue(args, '--url', 'https://example.grafana.azure.com/d/agentops-v2-home');
  return {
    ok: true,
    reportPath,
    browserProfile: {
      browserExecutable: profile.browserExecutable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      browserUserDataDir: profile.browserUserDataDir || '$HOME/.agentops/browser/grafana-profile',
      storageState: profile.storageState || '',
      headed: profile.headed
    },
    remediation: grafanaAuthRemediation({
      reportPath,
      browserExecutable: profile.browserExecutable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      browserUserDataDir: profile.browserUserDataDir || '$HOME/.agentops/browser/grafana-profile',
      grafanaUrl
    })
  };
}

function browserEvidenceStatus(staticCheck, playwright, options = {}) {
  const wantsPlaywright = Boolean(options.wantsPlaywright);
  const wantsGrafana = Boolean(options.wantsGrafana);
  const backendEvidenceVerified = Boolean(staticCheck.ok);
  const reportBrowserVerified = wantsPlaywright ? playwright.reportVerified === true : false;
  const authenticatedGrafanaVerified = wantsPlaywright && wantsGrafana
    ? playwright.authenticatedGrafanaVerified === true
    : false;
  return {
    backendEvidenceVerified,
    reportBrowserVerified,
    authenticatedGrafanaVerified,
    ok: backendEvidenceVerified && (!wantsPlaywright || playwright.ok === true)
  };
}

async function e2eBrowserCheck(args = []) {
  const reportPath = reportPathFromArgs(args);
  const out = path.resolve(optionValue(args, '--out', path.join(path.dirname(reportPath), 'browser-notes.md')));
  const screenshotDir = path.resolve(optionValue(args, '--screenshot-dir', path.join(path.dirname(out), 'screenshots')));
  const docsScreenshotDir = args.includes('--v2-docs-screenshots')
    ? path.resolve(optionValue(args, '--v2-docs-screenshot-dir', path.join(repoRoot, 'docs', 'screenshots', 'v2')))
    : null;
  const allowCheckStatus = args.includes('--allow-check-status');
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  const staticCheck = checkReportHtml(fs.readFileSync(reportPath, 'utf8'), { allowCheckStatus });
  const wantsPlaywright = args.includes('--playwright') || process.env.AGENTOPS_E2E_PLAYWRIGHT === '1';
  const wantsGrafana = args.includes('--grafana');
  const grafanaRunId = optionValue(args, '--grafana-run-id', '');
  const profile = browserProfileOptionsFromArgs(args);
  const azureAuth = wantsPlaywright && wantsGrafana && profile.azureCliGrafanaAuth
    ? azureCliGrafanaBrowserAuth()
    : null;
  const playwright = wantsPlaywright
    ? await playwrightBrowserCheck({
        reportPath,
        outDir: screenshotDir,
        grafana: wantsGrafana,
        grafanaV2Only: args.includes('--grafana-v2-only'),
        grafanaRunId,
        docsScreenshotDir,
        requireGrafanaVisible: args.includes('--require-grafana-visible'),
        requireAccessibilitySmoke: args.includes('--require-accessibility-smoke'),
        requirePerformance: args.includes('--require-performance'),
        ...profile,
        grafanaBearerToken: azureAuth?.token,
        grafanaAuthEvidence: azureAuth?.evidence
      })
    : { status: 'skipped', reason: 'Pass --playwright or set AGENTOPS_E2E_PLAYWRIGHT=1 to capture browser screenshots.' };
  const evidence = browserEvidenceStatus(staticCheck, playwright, { wantsPlaywright, wantsGrafana });
  const result = {
    ...evidence,
    reportPath,
    static: staticCheck,
    playwright
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeBrowserNotes(out, result);
  result.notes = out;
  return result;
}

module.exports = {
  browserEvidenceStatus,
  e2eAuthProfile,
  e2eBrowserCheck,
  reportPathFromArgs
};
