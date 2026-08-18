const fs = require('node:fs');
const path = require('node:path');

const collector = require('./collector-manager');
const { optionValue } = require('./args');
const { readJson } = require('./json');
const { redactedEnvSummary } = require('./privacy');
const { renderReportHtml } = require('./e2e-report');
const {
  evidenceDir,
  latestEvidenceDir,
  runAgentops,
  safeE2eEnv,
  waitForLatestE2eSession,
  writeJson
} = require('./e2e-runtime');
const legacy = require('../legacy');

function grafanaLinksFromOpenSummary(summary = legacy.openLinksSummary()) {
  return [
    summary.azure_agents_view_url
      ? { label: 'Azure Monitor Agents view', url: summary.azure_agents_view_url }
      : summary.application_insights_url
      ? { label: 'Application Insights (open Agents)', url: summary.application_insights_url }
      : null,
    { label: 'Today', url: summary.v2_home_url },
    { label: 'Runs', url: summary.v2_runs_url },
    { label: 'Run Story', url: summary.v2_replay_url },
    { label: 'Overview', url: summary.main_dashboard_url },
    { label: 'Sessions', url: summary.sessions_dashboard_url },
    { label: 'Latest Session', url: summary.latest_session_url }
  ].filter(link => link?.url);
}

function defaultCopilotArgs() {
  return [
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
}

async function e2eRun(args = [], options = {}) {
  const live = args.includes('--live');
  const last = optionValue(args, '--last', '2h');
  const dir = (options.evidenceDir || evidenceDir)();
  const e2eId = `agentops-e2e-${path.basename(dir)}`;
  const latestDir = (options.latestEvidenceDir || latestEvidenceDir)();
  const runCollector = options.collector || collector;
  const runAgentopsCommand = options.runAgentops || runAgentops;
  const waitForLatest = options.waitForLatestE2eSession || waitForLatestE2eSession;
  const openLinksSummary = options.openLinksSummary || legacy.openLinksSummary;
  const renderReport = options.renderReportHtml || renderReportHtml;
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(latestDir), { recursive: true });
  fs.symlinkSync(dir, latestDir, 'dir');

  const e2eEnv = safeE2eEnv();
  const doctor = runAgentopsCommand(['doctor', '--json'], { env: e2eEnv });
  const collectorStart = await runCollector.start({ mode: 'auto', privacy: 'strict' });
  const collectorStatus = await runCollector.status({ mode: 'auto', privacy: 'strict' });
  const poison = await runCollector.smoke({ privacy: 'strict', poison: true });
  const outputs = [];
  writeJson(path.join(dir, 'doctor.json'), doctor);
  writeJson(path.join(dir, 'collector-start.json'), collectorStart);
  writeJson(path.join(dir, 'collector-status.json'), collectorStatus);
  writeJson(path.join(dir, 'poison.json'), poison);

  const copilotArgs = defaultCopilotArgs();

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
    copilot = runAgentopsCommand(copilotArgs, {
      timeout: 300000,
      env: safeE2eEnv({ AGENTOPS_E2E_ID: e2eId })
    });
    writeJson(path.join(dir, 'copilot.json'), copilot);
    outputs.push(copilot);

    const latestWait = await waitForLatest(e2eId, last);
    latest = latestWait.latest;
    latestPayload = latestWait.payload;
    latestE2eMatched = latestWait.matched;
    latestAttempts = latestWait.attempts;
    writeJson(path.join(dir, 'latest.json'), latest);
    outputs.push(latest);

    latestSessionId = latestPayload?.session?.id || latestPayload?.session_id || null;
    if (latestSessionId) {
      replay = runAgentopsCommand(['replay', 'latest', '--last', last], { env: e2eEnv });
      writeJson(path.join(dir, 'replay.json'), replay);
      outputs.push(replay);
    }

    validateAzure = runAgentopsCommand(['validate-azure', '--last', last, '--json'], { env: e2eEnv });
    writeJson(path.join(dir, 'validate-azure.json'), validateAzure);
    outputs.push(validateAzure);

    open = runAgentopsCommand(['open', '--last', last, '--json'], { env: e2eEnv });
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
        return grafanaLinksFromOpenSummary(openLinksSummary());
      }
    })() : grafanaLinksFromOpenSummary(openLinksSummary()),
    evidenceFiles: fs.readdirSync(dir).map(file => path.join(dir, file))
  };
  writeJson(path.join(dir, 'summary.json'), summary);
  if (args.includes('--browser-report')) {
    fs.writeFileSync(path.join(dir, 'report.html'), renderReport(summary));
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
    ? readJson(summaryPath)
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

module.exports = {
  e2eReport,
  e2eRun,
  grafanaLinksFromOpenSummary
};
