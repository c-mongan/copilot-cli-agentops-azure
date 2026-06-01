const fs = require('node:fs');
const childProcess = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacy = require('../legacy');
const collector = require('../lib/collector-manager');
const { optionValue } = require('../lib/args');
const { redactedEnvSummary } = require('../lib/privacy');
const { repoRoot } = require('../lib/paths');

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function evidenceDir(name = timestamp()) {
  return path.join(repoRoot, '.agentops', 'e2e', name);
}

function latestEvidenceDir() {
  return path.join(repoRoot, '.agentops', 'e2e', 'latest');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function redactText(text = '') {
  return String(text)
    .replace(/InstrumentationKey=[^;\s"]+/gi, 'InstrumentationKey=[REDACTED]')
    .replace(/(Authorization=Bearer\s+)[^\s"]+/gi, '$1[REDACTED]')
    .replace(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING)[A-Z0-9_]*=)[^\s"]+/gi, '$1[REDACTED]');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runAgentops(args, options = {}) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'agentops-cli', 'src', 'index.js'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 120000
  });
  return {
    command: ['agentops', ...args].join(' '),
    status: result.status,
    stdout: redactText(result.stdout || ''),
    stderr: redactText(result.stderr || ''),
    error: result.error ? result.error.message : null
  };
}

function safeE2eEnv(extra = {}) {
  return {
    AGENTOPS_PRIVACY_MODE: 'strict',
    AGENTOPS_CAPTURE_CONTENT: 'false',
    AGENTOPS_DISABLE_CONTENT_CAPTURE_OVERRIDE: '1',
    COPILOT_OTEL_CAPTURE_CONTENT: 'false',
    ...extra
  };
}

async function waitForLatestE2eSession(e2eId, last, options = {}) {
  const timeoutMs = options.timeoutMs || 180000;
  const intervalMs = options.intervalMs || 10000;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let latest = null;
  let payload = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    latest = runAgentops(['latest', '--last', last, '--json']);
    try {
      payload = JSON.parse(latest.stdout);
    } catch {
      payload = null;
    }

    const ids = payload?.session?.e2e_ids || [];
    if (latest.status === 0 && (payload?.session?.e2e_id === e2eId || ids.includes(e2eId))) {
      return { latest, payload, attempts, matched: true };
    }

    await sleep(intervalMs);
  }

  return { latest, payload, attempts, matched: false };
}

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
    main { max-width: 980px; margin: 0 auto; }
    section { background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 20px; margin: 16px 0; }
    h1, h2 { margin-top: 0; }
    code, pre { background: #eef2f6; border-radius: 6px; padding: 2px 5px; }
    pre { padding: 12px; overflow: auto; }
    .status { display: inline-block; padding: 4px 8px; border-radius: 6px; font-weight: 700; background: ${report.ok ? '#dff6e5' : '#fff3cd'}; }
    a { color: #075ea8; }
  </style>
</head>
<body>
<main>
  <h1>AgentOps E2E Report <span class="status">${status}</span></h1>
  <section>
    <h2>Summary</h2>
    <p>Collector mode: <code>${htmlEscape(report.collector?.effectiveMode || report.collector?.mode || 'unknown')}</code></p>
    <p>Privacy mode: <code>${htmlEscape(report.privacyMode)}</code></p>
    <p>E2E marker: <code>${htmlEscape(report.e2eId || 'not available')}</code></p>
    <p>Latest session: <code>${htmlEscape(report.latestSessionId || 'not available')}</code></p>
    <p>Latest matched marker: <code>${htmlEscape(report.latestE2eMatched ? 'yes' : 'no')}</code></p>
  </section>
  <section>
    <h2>Privacy Poison Test</h2>
    <pre>${htmlEscape(JSON.stringify(report.poison, null, 2))}</pre>
  </section>
  <section>
    <h2>Grafana Links</h2>
    ${(report.grafanaLinks || []).map(link => `<p><a href="${htmlEscape(link.url)}">${htmlEscape(link.label)}</a></p>`).join('\n') || '<p>No Grafana links available.</p>'}
  </section>
  <section>
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

function reportPathFromArgs(args = []) {
  return path.resolve(optionValue(args, ['--report', '--in'], path.join(latestEvidenceDir(), 'report.html')));
}

function screenshotSlug(label = '') {
  return String(label)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'grafana';
}

const V2_SCREENSHOT_NAMES = {
  'AgentOps V2 Home': 'agentops-v2-home-live.png',
  'V2 Runs Explorer': 'agentops-v2-runs-explorer-live.png',
  'V2 Run Replay': 'agentops-v2-run-replay-live.png'
};

function grafanaScreenshotTargets(links = [], options = {}) {
  const v2Only = Boolean(options.v2Only);
  return links
    .filter(link => /grafana\.azure\.com/i.test(link.href || link.url || ''))
    .map(link => ({
      label: link.text || link.label || 'Grafana',
      url: link.href || link.url,
      fileName: V2_SCREENSHOT_NAMES[link.text || link.label] || `${screenshotSlug(link.text || link.label)}.png`,
      v2Tour: Boolean(V2_SCREENSHOT_NAMES[link.text || link.label])
    }))
    .filter(target => !v2Only || target.v2Tour);
}

function grafanaVisualOk(items = [], requireVisible = false) {
  return items.every(item => requireVisible ? item.dashboardVisible : (item.dashboardVisible || item.authBlocked));
}

function browserProfileOptionsFromArgs(args = [], env = process.env) {
  return {
    browserExecutable: optionValue(args, '--browser-executable', env.AGENTOPS_BROWSER_EXECUTABLE || ''),
    browserUserDataDir: optionValue(args, '--browser-user-data-dir', env.AGENTOPS_BROWSER_USER_DATA_DIR || ''),
    storageState: optionValue(args, '--storage-state', env.AGENTOPS_BROWSER_STORAGE_STATE || ''),
    headed: args.includes('--headed') || env.AGENTOPS_BROWSER_HEADED === '1'
  };
}

function grafanaAuthRemediation(options = {}) {
  const reportPath = options.reportPath || '.agentops/e2e/latest/report.html';
  const browserExecutable = options.browserExecutable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browserUserDataDir = options.browserUserDataDir || '$HOME/.agentops/browser/grafana-profile';
  const grafanaUrl = options.grafanaUrl || 'https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/agentops-v2-home';
  return {
    reason: 'Azure Managed Grafana redirected to Microsoft sign-in.',
    sign_in_once: [
      `mkdir -p ${path.dirname(browserUserDataDir)}`,
      `"${browserExecutable}" --user-data-dir="${browserUserDataDir}" "${grafanaUrl}"`
    ],
    verify_after_sign_in: [
      'AGENTOPS_PLAYWRIGHT_MODULE_DIR=/Users/conormongan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
      `agentops e2e browser-check --report ${reportPath} --playwright --grafana --grafana-v2-only --require-grafana-visible --browser-executable "${browserExecutable}" --browser-user-data-dir "${browserUserDataDir}" --json`
    ],
    note: 'The strict visual gate cannot pass until the supplied browser profile can open the V2 dashboards without Microsoft SSO.'
  };
}

function e2eAuthProfile(args = []) {
  const reportPath = reportPathFromArgs(args);
  const profile = browserProfileOptionsFromArgs(args);
  const grafanaUrl = optionValue(args, '--url', 'https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com/d/agentops-v2-home');
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

async function playwrightBrowserCheck({
  reportPath,
  outDir,
  grafana = false,
  grafanaV2Only = false,
  docsScreenshotDir = null,
  requireGrafanaVisible = false,
  browserExecutable = process.env.AGENTOPS_BROWSER_EXECUTABLE || '',
  browserUserDataDir = process.env.AGENTOPS_BROWSER_USER_DATA_DIR || '',
  storageState = process.env.AGENTOPS_BROWSER_STORAGE_STATE || '',
  headed = process.env.AGENTOPS_BROWSER_HEADED === '1'
}) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    for (const dir of String(process.env.AGENTOPS_PLAYWRIGHT_MODULE_DIR || process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
      try {
        playwright = require(path.join(dir, 'playwright'));
        break;
      } catch {}
    }
    if (!playwright) return { status: 'skipped', reason: `Playwright is not available: ${error.message}` };
  }

  const viewport = { width: 1440, height: 1000 };
  const launch = { headless: !headed };
  if (browserExecutable) launch.executablePath = browserExecutable;
  let browser = null;
  let context = null;
  if (browserUserDataDir) {
    context = await playwright.chromium.launchPersistentContext(path.resolve(browserUserDataDir), {
      ...launch,
      viewport
    });
  } else {
    browser = await playwright.chromium.launch(launch);
    context = await browser.newContext({
      viewport,
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
    }
  };

  if (grafana) {
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => ({
      href: node.href,
      text: node.textContent.trim()
    })));
    for (const target of grafanaScreenshotTargets(links, { v2Only: grafanaV2Only })) {
      const dashboard = await context.newPage();
      await dashboard.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await dashboard.waitForTimeout(5000);
      const body = await dashboard.locator('body').innerText({ timeout: 5000 }).catch(() => '');
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
        dashboardVisible: /AgentOps|Copilot|Sessions|Session Detail|No data/i.test(body)
      });
      await dashboard.close();
    }
  }

  await context.close();
  if (browser) await browser.close();
  browserResult.ok = browserResult.passVisible && !browserResult.secretLooking &&
    (!grafana || grafanaVisualOk(browserResult.grafana, requireGrafanaVisible));
  if (grafana) browserResult.requireGrafanaVisible = requireGrafanaVisible;
  if (grafana && requireGrafanaVisible && browserResult.grafana.some(item => item.authBlocked)) {
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

function writeBrowserNotes(filePath, result) {
  const lines = [
    '# Browser Validation Notes',
    '',
    `- Report: ${result.reportPath}`,
    `- Static report check: ${result.static.ok ? 'pass' : 'fail'}`,
    `- PASS visible: ${result.static.passVisible ? 'yes' : 'no'}`,
    `- Secret-looking values: ${result.static.secretLooking ? 'yes' : 'no'}`,
    `- Grafana links: ${result.static.grafanaLinks}`,
    `- Evidence JSON links: ${result.static.evidenceLinks}`,
    `- Playwright: ${result.playwright.status}`
  ];
  if (result.playwright.reason) lines.push(`- Playwright reason: ${result.playwright.reason}`);
  if (result.playwright.reportScreenshot) lines.push(`- Report screenshot: ${result.playwright.reportScreenshot}`);
  if (result.playwright.browserProfile) {
    lines.push(`- Browser profile: ${result.playwright.browserProfile.persistent ? 'persistent profile' : result.playwright.browserProfile.storageState ? 'storage state' : 'fresh context'}`);
  }
  if (result.playwright.grafana?.length) {
    lines.push('', '## Grafana');
    for (const item of result.playwright.grafana) {
      lines.push(`- ${item.label}: ${item.dashboardVisible ? 'visible' : item.authBlocked ? 'auth-blocked' : 'not verified'} (${item.url})`);
    }
    if (result.playwright.requireGrafanaVisible && result.playwright.grafana.some(item => !item.dashboardVisible)) {
      lines.push('- Required visible dashboards: failed. Sign in with an authenticated Grafana browser profile and rerun.');
    }
    if (result.playwright.authRemediation) {
      lines.push('', '## Auth Remediation', '', result.playwright.authRemediation.reason, '');
      lines.push('Sign in once:');
      lines.push('```bash');
      for (const command of result.playwright.authRemediation.sign_in_once) lines.push(command);
      lines.push('```', '', 'Verify after sign-in:');
      lines.push('```bash');
      for (const command of result.playwright.authRemediation.verify_after_sign_in) lines.push(command);
      lines.push('```');
    }
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function grafanaLinksFromOpenSummary(summary = legacy.openLinksSummary()) {
  return [
    { label: 'AgentOps V2 Home', url: summary.v2_home_url },
    { label: 'V2 Runs Explorer', url: summary.v2_runs_url },
    { label: 'V2 Run Replay', url: summary.v2_replay_url },
    { label: 'Overview', url: summary.main_dashboard_url },
    { label: 'Sessions', url: summary.sessions_dashboard_url },
    { label: 'Latest Session', url: summary.latest_session_url }
  ].filter(link => link.url);
}

async function e2eRun(args = []) {
  const live = args.includes('--live');
  const last = optionValue(args, '--last', '2h');
  const dir = evidenceDir();
  const e2eId = `agentops-e2e-${path.basename(dir)}`;
  const latestDir = latestEvidenceDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(latestDir), { recursive: true });
  fs.symlinkSync(dir, latestDir, 'dir');

  const e2eEnv = safeE2eEnv();
  const doctor = runAgentops(['doctor', '--json'], { env: e2eEnv });
  const collectorStart = await collector.start({ mode: 'auto', privacy: 'strict' });
  const collectorStatus = await collector.status({ mode: 'auto', privacy: 'strict' });
  const poison = await collector.smoke({ privacy: 'strict', poison: true });
  const outputs = [];
  writeJson(path.join(dir, 'doctor.json'), doctor);
  writeJson(path.join(dir, 'collector-start.json'), collectorStart);
  writeJson(path.join(dir, 'collector-status.json'), collectorStatus);
  writeJson(path.join(dir, 'poison.json'), poison);

  const copilotArgs = [
    'copilot',
    '--no-ask-user',
    '--no-remote',
    '--add-dir',
    '.',
    "--allow-tool=shell(pwd)",
    "--allow-tool=shell(ls:*)",
    '-p',
    'AgentOps E2E test. Do not edit files. Run pwd and ls docs | head if available, then reply with exactly one short summary sentence containing AGENTOPS_E2E_OK.'
  ];

  let latest = null;
  let replay = null;
  let validateAzure = null;
  let open = null;
  let copilot = null;
  let latestPayload = null;
  let latestSessionId = null;
  let latestE2eMatched = false;
  let latestAttempts = 0;

  if (live) {
    copilot = runAgentops(copilotArgs, {
      timeout: 300000,
      env: safeE2eEnv({ AGENTOPS_E2E_ID: e2eId })
    });
    writeJson(path.join(dir, 'copilot.json'), copilot);
    outputs.push(copilot);

    const latestWait = await waitForLatestE2eSession(e2eId, last);
    latest = latestWait.latest;
    latestPayload = latestWait.payload;
    latestE2eMatched = latestWait.matched;
    latestAttempts = latestWait.attempts;
    writeJson(path.join(dir, 'latest.json'), latest);
    outputs.push(latest);

    latestSessionId = latestPayload?.session?.id || latestPayload?.session_id || null;
    if (latestSessionId) {
      replay = runAgentops(['replay', 'latest', '--last', last], { env: e2eEnv });
      writeJson(path.join(dir, 'replay.json'), replay);
      outputs.push(replay);
    }

    validateAzure = runAgentops(['validate-azure', '--last', last, '--json'], { env: e2eEnv });
    writeJson(path.join(dir, 'validate-azure.json'), validateAzure);
    outputs.push(validateAzure);

    open = runAgentops(['open', '--last', last, '--json'], { env: e2eEnv });
    writeJson(path.join(dir, 'open.json'), open);
    outputs.push(open);
  }

  const summary = {
    ok: poison.ok && (!live || (copilot?.status === 0 && latest?.status === 0 && latestE2eMatched)),
    live,
    e2eId,
    evidenceDir: dir,
    privacyMode: 'strict',
    environment: redactedEnvSummary(safeE2eEnv({ AGENTOPS_E2E_ID: e2eId })),
    doctor,
    collectorStart,
    collector: collectorStatus,
    poison,
    liveCopilot: live ? copilot : { status: 'skipped', reason: 'Pass --live to run Copilot.' },
    latest,
    latestSessionId,
    latestE2eMatched,
    latestAttempts,
    replay,
    validateAzure,
    open,
    copilotCommand: copilotArgs.map(value => /SECRET|TOKEN|KEY|CONNECTION_STRING/i.test(value) ? '[REDACTED]' : value),
    grafanaLinks: open?.stdout ? (() => {
      try {
        return grafanaLinksFromOpenSummary(JSON.parse(open.stdout));
      } catch {
        return grafanaLinksFromOpenSummary();
      }
    })() : grafanaLinksFromOpenSummary(),
    evidenceFiles: fs.readdirSync(dir).map(file => path.join(dir, file))
  };
  writeJson(path.join(dir, 'summary.json'), summary);
  if (args.includes('--browser-report')) {
    fs.writeFileSync(path.join(dir, 'report.html'), renderReportHtml(summary));
  }
  return summary;
}

function e2eReport(args = []) {
  const outIndex = args.indexOf('--out');
  const out = outIndex === -1 ? path.join(latestEvidenceDir(), 'report.html') : path.resolve(args[outIndex + 1]);
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  const summaryPath = path.join(dir, 'summary.json');
  const summary = fs.existsSync(summaryPath)
    ? JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    : {
        ok: false,
        privacyMode: 'strict',
        collector: null,
        poison: null,
        latestSessionId: null,
        grafanaLinks: grafanaLinksFromOpenSummary(),
        evidenceFiles: []
      };
  const report = {
    ...summary,
    grafanaLinks: summary.grafanaLinks || grafanaLinksFromOpenSummary(),
    evidenceFiles: fs.existsSync(dir) ? fs.readdirSync(dir).map(file => path.join(dir, file)) : []
  };
  fs.writeFileSync(out, renderReportHtml(report));
  return { ok: true, out, report };
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
  const playwright = wantsPlaywright
    ? await playwrightBrowserCheck({
        reportPath,
        outDir: screenshotDir,
        grafana: args.includes('--grafana'),
        grafanaV2Only: args.includes('--grafana-v2-only'),
        docsScreenshotDir,
        requireGrafanaVisible: args.includes('--require-grafana-visible'),
        ...browserProfileOptionsFromArgs(args)
      })
    : { status: 'skipped', reason: 'Pass --playwright or set AGENTOPS_E2E_PLAYWRIGHT=1 to capture browser screenshots.' };
  const result = {
    ok: staticCheck.ok && (wantsPlaywright ? playwright.ok === true : playwright.ok !== false),
    reportPath,
    static: staticCheck,
    playwright
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeBrowserNotes(out, result);
  result.notes = out;
  return result;
}

async function e2eCommand(args = []) {
  const [subcommand] = args;
  if (subcommand === 'run') {
    const result = await e2eRun(args.slice(1));
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : `E2E evidence: ${result.evidenceDir}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (subcommand === 'report') {
    const result = e2eReport(args.slice(1));
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : `E2E report: ${result.out}\n`);
    return;
  }
  if (subcommand === 'browser-check') {
    const result = await e2eBrowserCheck(args.slice(1));
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : `E2E browser notes: ${result.notes}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (subcommand === 'auth-profile') {
    const result = e2eAuthProfile(args.slice(1));
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : renderAuthProfile(result));
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
