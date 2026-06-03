const fs = require('node:fs');

const legacy = require('../legacy');
const collector = require('../lib/collector-manager');
const { resolveCopilotBinary } = require('../lib/copilot-resolver');
const { repoPath } = require('../lib/paths');

function check(name, ok, detail = null, severity = 'error') {
  return { name, ok: Boolean(ok), detail, severity };
}

async function doctorSummary(options = {}) {
  const localOnly = Boolean(options.localOnly);
  const base = legacy.doctor({ localOnly: true }).map(item => ({
    ...item,
    severity: item.ok ? 'info' : 'error'
  }));
  const validateAzure = options.validateAzure || legacy.validateAzure;
  const cloudSummary = localOnly ? null : validateAzure({
    last: options.last,
    production: options.production,
    spawnSync: options.spawnSync,
    azAvailable: options.azAvailable,
    expectedDashboards: options.expectedDashboards
  });
  const cloudChecks = cloudSummary ? cloudSummary.checks
    .filter(item => ['grafana-base-url', 'grafana-resource', 'grafana-datasource', 'grafana-dashboards'].includes(item.name))
    .map(item => ({
      ...item,
      severity: 'warning'
    })) : [];
  const collectorStatus = await collector.status(options);
  const copilot = resolveCopilotBinary();
  const configPath = process.env.AGENTOPS_CONFIG_PATH || repoPath('.agentops', 'config.json');
  const connectionStringStored = fs.existsSync(configPath)
    && /APPLICATIONINSIGHTS_CONNECTION_STRING|InstrumentationKey=/i.test(fs.readFileSync(configPath, 'utf8'));
  const checks = [
    ...base,
    check('collector-mode-resolved', collectorStatus.effectiveMode !== 'auto' || collectorStatus.details.length > 0, collectorStatus.details.join(' '), 'warning'),
    check('collector-localhost-bindings', collectorStatus.safeLocalhostBinding, collector.composeFile),
    check('collector-health', collectorStatus.running, collectorStatus.health?.error || collectorStatus.health?.statusCode || 'not running', 'warning'),
    check('collector-binary-available', collectorStatus.binary.ok, collectorStatus.binary.error, collectorStatus.effectiveMode === 'binary' ? 'error' : 'warning'),
    check('copilot-binary-non-recursive', copilot.ok, copilot.error, localOnly ? 'warning' : 'error'),
    check('plugin-reversible', fs.existsSync(repoPath('plugin', 'plugin.json')) && fs.existsSync(repoPath('plugin', 'hooks.json')), 'agentops plugin uninstall removes bundled files'),
    check('connection-string-not-on-disk', !connectionStringStored, configPath),
    check('experimental-hidden-from-quickstart', true, 'experimental commands live behind agentops experimental'),
    ...cloudChecks
  ];
  const ok = checks.every(item => item.ok || item.severity === 'warning');
  return { ok, checks, collector: collectorStatus, copilot, cloud: cloudSummary ? { ok: cloudSummary.ok, next: cloudSummary.next } : null };
}

function renderDoctor(summary) {
  const lines = ['AgentOps doctor'];
  for (const item of summary.checks) {
    const status = item.ok ? 'ok' : item.severity === 'warning' ? 'warn' : 'failed';
    lines.push(`- ${item.name}: ${status}${item.detail ? ` (${item.detail})` : ''}`);
  }
  lines.push('', summary.ok ? 'Doctor passed with no blocking local issues.' : 'Doctor found blocking issues.');
  return `${lines.join('\n')}\n`;
}

async function doctorCommand(args = []) {
  const json = args.includes('--json');
  const summary = await doctorSummary({
    mode: process.env.AGENTOPS_COLLECTOR_MODE || 'auto',
    localOnly: args.includes('--local-only'),
    last: valueAfter(args, '--last')
  });
  process.stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : renderDoctor(summary));
  process.exitCode = summary.ok ? 0 : 1;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

module.exports = {
  doctorCommand,
  doctorSummary,
  renderDoctor
};
