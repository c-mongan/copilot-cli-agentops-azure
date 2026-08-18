const assert = require('node:assert/strict');
const test = require('node:test');

const {
  browserProfileOptionsFromArgs,
  grafanaAuthRemediation,
  grafanaScreenshotTargets,
  grafanaVisualOk,
  renderAuthProfile
} = require('../src/lib/e2e-grafana');

test('e2e grafana screenshot targets keep stable V2 file names', () => {
  const targets = grafanaScreenshotTargets([
    { label: 'Today', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-home' },
    { label: 'Runs', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-runs-explorer' },
    { label: 'Run Story', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-run-replay' },
    { label: 'Overview & Detail', url: 'https://grafana.example.grafana.azure.com/d/overview' },
    { label: 'External', url: 'https://example.test/d/external' }
  ], { v2Only: false });

  assert.deepEqual(targets.map(target => target.fileName), [
    'agentops-v2-home-live.png',
    'agentops-v2-runs-explorer-live.png',
    'agentops-v2-run-replay-live.png',
    'overview-and-detail.png'
  ]);
  assert.deepEqual(grafanaScreenshotTargets(targets, { v2Only: true }).map(target => target.label), [
    'Today',
    'Runs',
    'Run Story',
    'Models, Cost & Tokens',
    'Tools & MCP Risk',
    'Privacy',
    'Code Outcomes',
    'Evals & Quality',
    'Insights & Regressions',
    'Collector Health'
  ]);
});

test('e2e grafana visual gate never treats an authentication redirect as visual proof', () => {
  const authBlocked = [
    { label: 'Today', authBlocked: true, dashboardVisible: false },
    { label: 'Runs', authBlocked: true, dashboardVisible: false }
  ];
  const visible = [
    { label: 'Today', authBlocked: false, dashboardVisible: true },
    { label: 'Runs', authBlocked: false, dashboardVisible: true }
  ];

  assert.equal(grafanaVisualOk(authBlocked), false);
  assert.equal(grafanaVisualOk(visible), true);
  assert.equal(grafanaVisualOk([]), false);
});

test('e2e grafana targets can pin every dashboard to one observed run', () => {
  const [target] = grafanaScreenshotTargets([
    { label: 'Today', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-home' }
  ], { v2Only: true, runId: 'sdk live/02' });

  const url = new URL(target.url);
  assert.equal(url.searchParams.get('var-run_id'), 'sdk live/02');
});

test('e2e browser profile options prefer args over env defaults', () => {
  const options = browserProfileOptionsFromArgs([
    '--browser-executable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '--browser-user-data-dir',
    '/tmp/agentops-grafana-profile',
    '--storage-state',
    '/tmp/storage-state.json',
    '--headed'
  ], {
    AGENTOPS_BROWSER_EXECUTABLE: '/env/chrome',
    AGENTOPS_BROWSER_USER_DATA_DIR: '/env/profile',
    AGENTOPS_BROWSER_STORAGE_STATE: '/env/storage.json',
    AGENTOPS_BROWSER_HEADED: '0'
  });

  assert.equal(options.browserExecutable, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(options.browserUserDataDir, '/tmp/agentops-grafana-profile');
  assert.equal(options.storageState, '/tmp/storage-state.json');
  assert.equal(options.headed, true);
});

test('e2e grafana auth remediation renders sign-in and verification commands', () => {
  const remediation = grafanaAuthRemediation({
    reportPath: '.agentops/e2e/latest/report.html',
    browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    browserUserDataDir: '$HOME/.agentops/browser/grafana-profile',
    grafanaUrl: 'https://grafana.example.grafana.azure.com/d/agentops-v2-home'
  });
  const text = renderAuthProfile({ remediation });

  assert.match(remediation.reason, /Microsoft sign-in/);
  assert.ok(remediation.sign_in_once.some(command => command.includes('--user-data-dir="$HOME/.agentops/browser/grafana-profile"')));
  assert.ok(remediation.verify_after_sign_in.some(command => command.includes('--require-grafana-visible')));
  assert.match(text, /Sign in once/);
  assert.match(text, /Verify after sign-in/);
});
