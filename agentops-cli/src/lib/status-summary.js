const legacy = require('../legacy');
const fs = require('node:fs');
const path = require('node:path');
const collector = require('./collector-manager');
const resolver = require('./copilot-resolver');
const { agentopsHome } = require('./paths');
const { createDurableEvidenceSpool } = require('./azure/durable-evidence-spool');
const { summarizeDeliveryStatus } = require('./delivery-state');

function checkByName(checks, name) {
  return checks.find(check => check.name === name);
}

function durableDeliveryStatus(options = {}) {
  const env = options.env || process.env;
  const directory = path.resolve(options.directory || env.AGENTOPS_DURABLE_SPOOL_DIR || path.join(agentopsHome, 'delivery-spool'));
  if (!fs.existsSync(directory)) return { directory, exists: false, ...summarizeDeliveryStatus() };
  try {
    const status = createDurableEvidenceSpool({ directory }).status();
    return { directory, exists: true, raw: status, ...summarizeDeliveryStatus(status) };
  } catch (error) {
    return { directory, exists: true, state: 'quarantined', headline: 'Local delivery queue needs review.', error: error.message };
  }
}

async function statusSummary() {
  const checks = legacy.doctor({ localOnly: true });
  const summary = legacy.agentopsStatusSummary({ checks });
  const collectorStatus = await collector.status();
  const copilot = resolver.resolveCopilotBinary();
  const delivery = durableDeliveryStatus();
  return {
    ...summary,
    collector: collectorStatus,
    delivery,
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
    `Delivery: ${summary.delivery?.headline || summarizeDeliveryStatus().headline}`,
    `Copilot binary: ${summary.copilot.ok ? summary.copilot.path : summary.copilot.error}.`,
    `Shim: agentops is ${summary.shim.agentops_cli}; copilot-agentops is ${summary.shim.agentops_command}; transparent routing is ${summary.shim.shadow}.`,
    'Everyday observed use: agentops copilot ...'
  ].join('\n') + '\n';
}

module.exports = {
  durableDeliveryStatus,
  renderStatus,
  statusSummary
};
