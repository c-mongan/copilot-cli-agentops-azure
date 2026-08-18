const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { e2eRun, grafanaLinksFromOpenSummary } = require('../src/lib/e2e-run');

test('e2e run helper supports injected dry-run dependencies', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-e2e-run-'));
  const runDir = path.join(tempRoot, 'run');
  const latestDir = path.join(tempRoot, 'latest');

  const result = await e2eRun(['--browser-report'], {
    evidenceDir: () => runDir,
    latestEvidenceDir: () => latestDir,
    runAgentops: args => ({
      command: ['agentops', ...args].join(' '),
      status: 0,
      stdout: '{}',
      stderr: '',
      error: null
    }),
    collector: {
      start: async () => ({ ok: true, effectiveMode: 'binary' }),
      status: async () => ({ ok: true, effectiveMode: 'binary' }),
      smoke: async () => ({ ok: true })
    },
    openLinksSummary: () => ({
      v2_home_url: 'https://grafana.example/d/home',
      v2_runs_url: '',
      v2_replay_url: '',
      main_dashboard_url: '',
      sessions_dashboard_url: '',
      latest_session_url: ''
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.live, false);
  assert.equal(result.evidenceDir, runDir);
  assert.equal(result.liveCopilot.status, 'skipped');
  assert.deepEqual(result.grafanaLinks, [
    { label: 'Today', url: 'https://grafana.example/d/home' }
  ]);
  assert.ok(fs.existsSync(path.join(runDir, 'summary.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'report.html')));
  assert.equal(fs.lstatSync(latestDir).isSymbolicLink(), true);
});

test('e2e run helper maps Grafana summary links in dashboard order', () => {
  assert.deepEqual(grafanaLinksFromOpenSummary({
    v2_home_url: 'https://grafana.example/d/home',
    v2_runs_url: 'https://grafana.example/d/runs',
    v2_replay_url: '',
    main_dashboard_url: 'https://grafana.example/d/main',
    sessions_dashboard_url: '',
    latest_session_url: 'https://grafana.example/d/latest'
  }), [
    { label: 'Today', url: 'https://grafana.example/d/home' },
    { label: 'Runs', url: 'https://grafana.example/d/runs' },
    { label: 'Overview', url: 'https://grafana.example/d/main' },
    { label: 'Latest Session', url: 'https://grafana.example/d/latest' }
  ]);
});

test('e2e run helper carries the Azure-native investigation link when configured', () => {
  const links = grafanaLinksFromOpenSummary({
    azure_agents_view_url: 'https://portal.azure.com/#agents',
    v2_home_url: 'https://grafana.example/d/home'
  });

  assert.deepEqual(links, [
    { label: 'Azure Monitor Agents view', url: 'https://portal.azure.com/#agents' },
    { label: 'Today', url: 'https://grafana.example/d/home' }
  ]);
});

test('e2e run helper carries the Application Insights fallback link', () => {
  const links = grafanaLinksFromOpenSummary({
    application_insights_url: 'https://portal.azure.com/#/resource/app-insights/overview',
    v2_home_url: 'https://grafana.example/d/home'
  });

  assert.deepEqual(links, [
    { label: 'Application Insights (open Agents)', url: 'https://portal.azure.com/#/resource/app-insights/overview' },
    { label: 'Today', url: 'https://grafana.example/d/home' }
  ]);
});
