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

async function playwrightBrowserCheck({ reportPath, outDir, grafana = false }) {
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

  const launch = { headless: true };
  if (process.env.AGENTOPS_BROWSER_EXECUTABLE) launch.executablePath = process.env.AGENTOPS_BROWSER_EXECUTABLE;
  const browser = await playwright.chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    grafana: []
  };

  if (grafana) {
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => ({
      href: node.href,
      text: node.textContent.trim()
    })).filter(link => /grafana\.azure\.com/i.test(link.href)));
    for (const link of links) {
      const dashboard = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await dashboard.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await dashboard.waitForTimeout(5000);
      const body = await dashboard.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const label = link.text.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'grafana';
      const screenshot = path.join(outDir, `${label}.png`);
      await dashboard.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      browserResult.grafana.push({
        label: link.text,
        url: link.href,
        screenshot,
        authBlocked: /Sign in|Can.t access your account|login.microsoftonline.com/i.test(body + dashboard.url()),
        dashboardVisible: /AgentOps|Copilot|Sessions|Session Detail|No data/i.test(body)
      });
      await dashboard.close();
    }
  }

  await browser.close();
  browserResult.ok = browserResult.passVisible && !browserResult.secretLooking &&
    (!grafana || browserResult.grafana.every(item => item.dashboardVisible || item.authBlocked));
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
  if (result.playwright.grafana?.length) {
    lines.push('', '## Grafana');
    for (const item of result.playwright.grafana) {
      lines.push(`- ${item.label}: ${item.dashboardVisible ? 'visible' : item.authBlocked ? 'auth-blocked' : 'not verified'} (${item.url})`);
    }
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function grafanaLinksFromOpenSummary(summary = legacy.openLinksSummary()) {
  return [
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

  const doctor = runAgentops(['doctor', '--json']);
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
      env: { AGENTOPS_E2E_ID: e2eId }
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
      replay = runAgentops(['replay', 'latest', '--last', last]);
      writeJson(path.join(dir, 'replay.json'), replay);
      outputs.push(replay);
    }

    validateAzure = runAgentops(['validate-azure', '--last', last, '--json']);
    writeJson(path.join(dir, 'validate-azure.json'), validateAzure);
    outputs.push(validateAzure);

    open = runAgentops(['open', '--last', last, '--json']);
    writeJson(path.join(dir, 'open.json'), open);
    outputs.push(open);
  }

  const summary = {
    ok: poison.ok && (!live || (copilot?.status === 0 && latest?.status === 0 && latestE2eMatched)),
    live,
    e2eId,
    evidenceDir: dir,
    privacyMode: 'strict',
    environment: redactedEnvSummary(),
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
  const allowCheckStatus = args.includes('--allow-check-status');
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  const staticCheck = checkReportHtml(fs.readFileSync(reportPath, 'utf8'), { allowCheckStatus });
  const wantsPlaywright = args.includes('--playwright') || process.env.AGENTOPS_E2E_PLAYWRIGHT === '1';
  const playwright = wantsPlaywright
    ? await playwrightBrowserCheck({ reportPath, outDir: screenshotDir, grafana: args.includes('--grafana') })
    : { status: 'skipped', reason: 'Pass --playwright or set AGENTOPS_E2E_PLAYWRIGHT=1 to capture browser screenshots.' };
  const result = {
    ok: staticCheck.ok && (playwright.ok !== false),
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
  throw new Error('e2e requires run, report, or browser-check');
}

module.exports = {
  checkReportHtml,
  e2eCommand,
  e2eBrowserCheck,
  e2eReport,
  e2eRun,
  grafanaLinksFromOpenSummary,
  htmlLinks,
  renderReportHtml
};
