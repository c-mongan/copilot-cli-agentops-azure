const path = require('node:path');

const { repoRoot } = require('./paths');
const {
  validateVisualEvidence,
  visualAuditRecoveryCommands
} = require('./product-visual');

function check(name, ok, evidence = [], missing = []) {
  return {
    name,
    ok: Boolean(ok),
    evidence,
    missing
  };
}

async function productAuditWithVisual(options = {}, {
  productAudit,
  browserCheck,
  validateEvidence = validateVisualEvidence,
  recoveryCommands = visualAuditRecoveryCommands
} = {}) {
  const result = productAudit(options);
  if (!options.requireVisual) return result;

  const defaultReportPath = path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html');
  if (options.visualEvidencePath) {
    const evidence = validateEvidence(options.visualEvidencePath);
    const visualCheck = check(
      'visual-grafana-rendered-dashboards',
      evidence.ok,
      evidence.visible,
      evidence.missing
    );
    const checks = [...result.checks, visualCheck];
    const failed = checks.filter(item => !item.ok);
    return {
      ...result,
      ok: failed.length === 0,
      scope: options.live ? 'local-live-and-visual-product-contract' : 'local-and-visual-product-contract',
      visual_grafana_verified: evidence.ok,
      summary: {
        ...result.summary,
        checks: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        visual_dashboards: evidence.dashboards.length,
        visual_dashboards_visible: evidence.visible.length
      },
      checks,
      visual: {
        ok: evidence.ok,
        evidencePath: evidence.evidencePath,
        status: 'evidence-file',
        dashboards: evidence.dashboards
      },
      next: evidence.ok
        ? result.next
        : [
            'Regenerate authenticated Grafana visual evidence from a signed-in browser.',
            ...recoveryCommands(options.reportPath || defaultReportPath)
          ]
    };
  }

  const reportPath = options.reportPath || defaultReportPath;
  const browserArgs = [
    '--report',
    reportPath,
    '--playwright',
    '--grafana',
    '--grafana-v2-only',
    '--require-grafana-visible'
  ];
  for (const [flag, value] of [
    ['--browser-executable', options.browserExecutable],
    ['--browser-user-data-dir', options.browserUserDataDir],
    ['--storage-state', options.storageState]
  ]) {
    if (value) browserArgs.push(flag, value);
  }
  if (options.headed) browserArgs.push('--headed');

  let visual;
  try {
    visual = await browserCheck(browserArgs);
  } catch (error) {
    visual = { ok: false, error: error.message };
  }
  const grafanaItems = visual.playwright?.grafana || [];
  const authBlocked = grafanaItems.filter(item => item.authBlocked).map(item => item.label);
  const visible = grafanaItems.filter(item => item.dashboardVisible).map(item => item.label);
  const visualVerified = Boolean(visual.ok) && grafanaItems.length > 0 && visible.length === grafanaItems.length;
  const visualCheck = check(
    'visual-grafana-rendered-dashboards',
    visualVerified,
    visible,
    visualVerified ? [] : [
      visual.error || visual.playwright?.authRemediation?.reason || 'Grafana dashboards did not render in the browser profile',
      grafanaItems.length === 0 ? 'No Grafana dashboards were rendered by the visual browser check.' : '',
      ...authBlocked.map(label => `${label}: auth-blocked`)
    ].filter(Boolean)
  );

  const checks = [...result.checks, visualCheck];
  const failed = checks.filter(item => !item.ok);
  const recovery = visual.playwright?.authRemediation
    ? [
        ...(visual.playwright.authRemediation.sign_in_once || []),
        ...(visual.playwright.authRemediation.verify_after_sign_in || [])
      ]
    : recoveryCommands(reportPath);

  return {
    ...result,
    ok: failed.length === 0,
    scope: options.live ? 'local-live-and-visual-product-contract' : 'local-and-visual-product-contract',
    visual_grafana_verified: visualVerified,
    summary: {
      ...result.summary,
      checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      visual_dashboards: grafanaItems.length,
      visual_dashboards_visible: visible.length
    },
    checks,
    visual,
    next: visualVerified
      ? result.next
      : [
          ...recovery,
          'agentops product audit --live --last 2h --require-rows --require-visual --json'
        ]
  };
}

module.exports = {
  productAuditWithVisual
};
