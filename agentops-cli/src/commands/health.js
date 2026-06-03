const path = require('node:path');
const fs = require('node:fs');

const { hasFlag, optionValue } = require('../lib/args');
const { latestByTime } = require('../lib/explain/v2-explain');
const { doctorSummary } = require('./doctor');
const { statusSummary } = require('./status');

function readJsonl(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function summarizeChecks(checks = []) {
  const blocking = checks.filter(check => !check.ok && check.severity !== 'warning').length;
  const warnings = checks.filter(check => !check.ok && check.severity === 'warning').length;
  return {
    total: checks.length,
    passed: checks.filter(check => check.ok).length,
    warnings,
    blocking
  };
}

function runHealthFromRows(runs = []) {
  const run = latestByTime(runs);
  if (!run) return null;
  const failed = run.OutcomeStatus && run.OutcomeStatus !== 'success';
  const needsValidation = Number(run.FilesEditedCount || 0) > 0 && !run.TestsRan;
  const privacyDrop = Number(run.PrivacyDropCount || 0) > 0 || run.PrivacyMode === 'none';
  return {
    run_id: run.RunId || '',
    session_id: run.SessionId || '',
    status: failed || needsValidation || privacyDrop ? 'needs-attention' : 'healthy',
    outcome: run.OutcomeStatus || 'unknown',
    reason: run.OutcomeReason || '',
    tests_ran: Boolean(run.TestsRan),
    privacy_mode: run.PrivacyMode || '',
    next_action: failed
      ? 'Open Run Replay and inspect the failed span, blocked tool, eval score, and GitHub outcome.'
      : needsValidation
        ? 'Run validation for the edited files before promoting this result.'
        : privacyDrop
          ? 'Review privacy drops and keep strict mode enabled for shared environments.'
          : 'Keep strict privacy mode enabled and compare the next similar run for drift.'
  };
}

async function healthSummary(options = {}) {
  const [status, doctor] = await Promise.all([
    statusSummary(),
    doctorSummary({ localOnly: true, mode: options.mode || 'auto' })
  ]);
  const checkSummary = summarizeChecks(doctor.checks);
  const runs = options.runsFile ? readJsonl(path.resolve(options.runsFile)) : [];
  const latestRun = runHealthFromRows(runs);
  const blocking = checkSummary.blocking > 0;
  const warning = checkSummary.warnings > 0 || !status.collector.running || latestRun?.status === 'needs-attention';
  return {
    ok: !blocking,
    status: blocking ? 'blocking' : warning ? 'needs-attention' : 'healthy',
    checks: checkSummary,
    local: {
      content_capture_off: status.content_capture_off,
      collector_running: Boolean(status.collector.running),
      collector_mode: status.collector.effectiveMode || status.collector.mode || '',
      collector_privacy_mode: status.collector.privacyMode || '',
      collector_localhost_only: Boolean(status.collector.safeLocalhostBinding),
      copilot_ok: Boolean(status.copilot.ok),
      copilot_source: status.copilot.source || ''
    },
    latest_run: latestRun,
    next_action: blocking
      ? 'Run `agentops doctor` and fix blocking local readiness issues.'
      : warning
        ? 'Review warnings, then run `agentops smoke --real-copilot --wait 2m --poll 10s`.'
        : 'Run `agentops smoke --real-copilot --wait 2m --poll 10s` and open the printed Run Replay link.'
  };
}

function renderHealth(summary) {
  const lines = [
    'AgentOps health',
    '',
    `Status: ${summary.status}`,
    `Checks: ${summary.checks.passed}/${summary.checks.total} passed, ${summary.checks.warnings} warning(s), ${summary.checks.blocking} blocking.`,
    `Collector: ${summary.local.collector_running ? 'running' : 'not running'} (${summary.local.collector_mode || 'unknown'}, ${summary.local.collector_privacy_mode || 'unknown'}).`,
    `Content capture: ${summary.local.content_capture_off ? 'off' : 'enabled or unknown'}.`
  ];
  if (summary.latest_run) lines.push(`Latest run: ${summary.latest_run.run_id || 'unknown'} (${summary.latest_run.status}).`);
  lines.push(`Next: ${summary.next_action}`);
  return `${lines.join('\n')}\n`;
}

async function healthCommand(args = []) {
  const summary = await healthSummary({
    runsFile: optionValue(args, '--runs'),
    mode: process.env.AGENTOPS_COLLECTOR_MODE || 'auto'
  });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(summary, null, 2)}\n` : renderHealth(summary));
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  healthCommand,
  healthSummary,
  renderHealth,
  runHealthFromRows,
  summarizeChecks
};
