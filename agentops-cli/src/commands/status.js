const legacy = require('../legacy');
const collector = require('../lib/collector-manager');
const { resolveCopilotBinary } = require('../lib/copilot-resolver');

function checkByName(checks, name) {
  return checks.find(check => check.name === name);
}

async function statusSummary() {
  const checks = legacy.doctor({ localOnly: true });
  const summary = legacy.agentopsStatusSummary({ checks });
  const collectorStatus = await collector.status();
  const copilot = resolveCopilotBinary();
  return {
    ...summary,
    collector: collectorStatus,
    copilot: {
      ok: copilot.ok,
      path: copilot.path,
      source: copilot.source,
      error: copilot.error,
      candidates: copilot.candidates
    },
    content_capture_off: Boolean(checkByName(checks, 'content-capture-disabled')?.ok)
  };
}

function renderStatus(summary) {
  return [
    'AgentOps status',
    '',
    `Required files: ${summary.required_files.found} of ${summary.required_files.total} found.`,
    `Content capture: ${summary.content_capture_off ? 'off' : 'enabled or unknown'}.`,
    `Collector: ${summary.collector.running ? 'running' : 'not running'} (${summary.collector.effectiveMode || summary.collector.mode}, ${summary.collector.privacyMode}).`,
    `Collector binding: ${summary.collector.safeLocalhostBinding ? 'localhost-only' : 'needs review'}.`,
    `Copilot binary: ${summary.copilot.ok ? summary.copilot.path : summary.copilot.error}.`,
    `Shim: agentops is ${summary.shim.agentops_cli}; copilot-agentops is ${summary.shim.agentops_command}; plain copilot is ${summary.shim.shadow}.`
  ].join('\n') + '\n';
}

async function statusCommand(args = []) {
  const json = args.includes('--json');
  const summary = await statusSummary();
  process.stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : renderStatus(summary));
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  renderStatus,
  statusCommand,
  statusSummary
};
