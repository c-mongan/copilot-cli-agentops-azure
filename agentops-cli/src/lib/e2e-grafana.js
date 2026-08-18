const path = require('node:path');

const { browserProfileOptionsFromArgs } = require('./browser-options');

const V2_SCREENSHOT_NAMES = {
  'Today': 'agentops-v2-home-live.png',
  'Runs': 'agentops-v2-runs-explorer-live.png',
  'Run Story': 'agentops-v2-run-replay-live.png',
  'Models, Cost & Tokens': 'agentops-v2-models-cost-tokens-live.png',
  'Tools & MCP Risk': 'agentops-v2-tools-mcp-risk-live.png',
  'Privacy': 'agentops-v2-safety-privacy-policy-live.png',
  'Code Outcomes': 'agentops-v2-code-outcomes-live.png',
  'Evals & Quality': 'agentops-v2-evals-quality-live.png',
  'Insights & Regressions': 'agentops-v2-insights-regressions-live.png',
  'Collector Health': 'agentops-v2-collector-health-live.png'
};

const V2_DASHBOARDS = [
  ['Today', 'agentops-v2-home'],
  ['Runs', 'agentops-v2-runs-explorer'],
  ['Run Story', 'agentops-v2-run-replay'],
  ['Models, Cost & Tokens', 'agentops-v2-models-cost-tokens'],
  ['Tools & MCP Risk', 'agentops-v2-tools-mcp-risk'],
  ['Privacy', 'agentops-v2-safety-privacy-policy'],
  ['Code Outcomes', 'agentops-v2-code-outcomes'],
  ['Evals & Quality', 'agentops-v2-evals-quality'],
  ['Insights & Regressions', 'agentops-v2-insights-regressions'],
  ['Collector Health', 'agentops-v2-collector-health']
];

function screenshotSlug(label = '') {
  return String(label)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'grafana';
}

function grafanaScreenshotTargets(links = [], options = {}) {
  const v2Only = Boolean(options.v2Only);
  const withRun = value => {
    const url = new URL(value);
    if (options.runId) url.searchParams.set('var-run_id', String(options.runId));
    return url.toString();
  };
  if (v2Only) {
    const firstGrafana = links.find(link => /grafana\.azure\.com/i.test(link.href || link.url || ''));
    if (!firstGrafana) return [];
    const base = new URL(firstGrafana.href || firstGrafana.url).origin;
    return V2_DASHBOARDS.map(([label, uid]) => ({
      label,
      url: withRun(`${base}/d/${uid}`),
      fileName: V2_SCREENSHOT_NAMES[label],
      v2Tour: true,
      uid
    }));
  }
  return links
    .filter(link => /grafana\.azure\.com/i.test(link.href || link.url || ''))
    .map(link => ({
      label: link.text || link.label || 'Grafana',
      url: withRun(link.href || link.url),
      fileName: V2_SCREENSHOT_NAMES[link.text || link.label] || `${screenshotSlug(link.text || link.label)}.png`,
      v2Tour: Boolean(V2_SCREENSHOT_NAMES[link.text || link.label])
    }))
    .filter(target => !v2Only || target.v2Tour);
}

function grafanaVisualOk(items = []) {
  return items.length > 0 && items.every(item => item.dashboardVisible && !item.authBlocked);
}

function grafanaAuthRemediation(options = {}) {
  const reportPath = options.reportPath || '.agentops/e2e/latest/report.html';
  const browserExecutable = options.browserExecutable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browserUserDataDir = options.browserUserDataDir || '$HOME/.agentops/browser/grafana-profile';
  const grafanaUrl = options.grafanaUrl || 'https://example.grafana.azure.com/d/agentops-v2-home';
  return {
    reason: 'Azure Managed Grafana redirected to Microsoft sign-in.',
    sign_in_once: [
      `mkdir -p ${path.dirname(browserUserDataDir)}`,
      `"${browserExecutable}" --user-data-dir="${browserUserDataDir}" "${grafanaUrl}"`
    ],
    verify_after_sign_in: [
      'AGENTOPS_PLAYWRIGHT_MODULE_DIR=/path/to/node_modules',
      `agentops e2e browser-check --report ${reportPath} --playwright --grafana --grafana-v2-only --require-grafana-visible --browser-executable "${browserExecutable}" --browser-user-data-dir "${browserUserDataDir}" --json`
    ],
    note: 'The strict visual gate cannot pass until the supplied browser profile can open the V2 dashboards without Microsoft SSO.'
  };
}

function renderAuthProfile(result) {
  return [
    'Grafana browser profile setup',
    '',
    'Sign in once:',
    ...result.remediation.sign_in_once.map(command => `- ${command}`),
    '',
    'Verify after sign-in:',
    ...result.remediation.verify_after_sign_in.map(command => `- ${command}`)
  ].join('\n') + '\n';
}

module.exports = {
  browserProfileOptionsFromArgs,
  grafanaAuthRemediation,
  grafanaScreenshotTargets,
  grafanaVisualOk,
  renderAuthProfile
};
