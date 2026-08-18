const { writeJsonOrRender } = require('./command-output');
const { e2eAuthProfile, e2eBrowserCheck } = require('./e2e-browser-check');
const { checkReportHtml, htmlLinks, renderReportHtml } = require('./e2e-report');
const { safeE2eEnv } = require('./e2e-runtime');
const { e2eReport, e2eRun, grafanaLinksFromOpenSummary } = require('./e2e-run');
const {
  browserProfileOptionsFromArgs,
  grafanaAuthRemediation,
  grafanaScreenshotTargets,
  grafanaVisualOk,
  renderAuthProfile
} = require('./e2e-grafana');

async function e2eCommand(args = []) {
  const [subcommand] = args;
  if (subcommand === 'run') {
    const result = await e2eRun(args.slice(1));
    writeJsonOrRender(result, args.includes('--json'), value => `E2E evidence: ${value.evidenceDir}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (subcommand === 'report') {
    const result = e2eReport(args.slice(1));
    writeJsonOrRender(result, args.includes('--json'), value => `E2E report: ${value.out}\n`);
    return;
  }
  if (subcommand === 'browser-check') {
    const result = await e2eBrowserCheck(args.slice(1));
    writeJsonOrRender(result, args.includes('--json'), value => `E2E browser notes: ${value.notes}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (subcommand === 'auth-profile') {
    const result = e2eAuthProfile(args.slice(1));
    writeJsonOrRender(result, args.includes('--json'), renderAuthProfile);
    return;
  }
  throw new Error('e2e requires run, report, browser-check, or auth-profile');
}

module.exports = {
  checkReportHtml,
  browserProfileOptionsFromArgs,
  e2eCommand,
  e2eBrowserCheck,
  e2eAuthProfile,
  e2eReport,
  e2eRun,
  grafanaAuthRemediation,
  grafanaVisualOk,
  grafanaScreenshotTargets,
  grafanaLinksFromOpenSummary,
  htmlLinks,
  renderReportHtml,
  renderAuthProfile,
  safeE2eEnv
};
