const { hasFlag, optionValue } = require('./args');
const { configuredCloudValues } = require('./agentops-config');
const { writeJsonOrRender } = require('./command-output');
const { durableDeliveryStatus } = require('./status-summary');
const { createWrapperDelivery } = require('./copilot/wrapper-delivery');

function renderDelivery(result) {
  const lines = ['AgentOps delivery', ''];
  if (result.action === 'status') {
    const waiting = Number(result.pending || 0);
    const held = Number(result.quarantined || 0) + Number(result.expired || 0);
    lines.push(
      `Local queue: ${waiting ? `${waiting} receipt event${waiting === 1 ? '' : 's'} waiting to send` : 'nothing waiting'}`,
      `Needs attention: ${held ? `${held} event${held === 1 ? '' : 's'}` : 'none'}`
    );
    if (result.acknowledged_cumulative !== undefined) {
      lines.push(`Accepted by Azure ingestion: ${result.acknowledged_cumulative} total`);
      if (Number(result.acknowledged_cumulative) > 0) lines.push('Azure acceptance does not by itself prove the events are searchable yet.');
    }
    if (result.overflow_cumulative !== undefined && Number(result.overflow_cumulative) > 0) {
      lines.push(`Not saved because the queue was full: ${result.overflow_cumulative} total`);
    }
    lines.push(
      waiting ? 'Next: run agentops delivery drain to preview sending the waiting events.' : 'Next: no delivery action is needed.',
      `Local receipt folder: ${result.directory}`
    );
  } else if (!result.executed) {
    const waiting = Number(result.before?.pending || 0);
    lines.push('Mode: preview', `Waiting: ${waiting}`, 'No Azure request was made.');
    if (waiting > 0) lines.push('Run with --yes only after reviewing the exact subscription, endpoint, and DCR.');
    else lines.push('Nothing is waiting, so there is nothing to send.');
  } else {
    lines.push(`State: ${result.state}`, `Accepted this drain: ${result.result?.acknowledged || 0}`, `Still waiting: ${result.result?.status?.pending || 0}`, `Held for review: ${result.result?.status?.quarantined || 0}`);
  }
  if (result.error) lines.push(`Error: ${result.error}`);
  return `${lines.join('\n')}\n`;
}

async function runDeliveryCommand(args = [], options = {}) {
  const [subcommand = 'status'] = args;
  const directory = optionValue(args, '--dir', options.directory || process.env.AGENTOPS_DURABLE_SPOOL_DIR || '');
  if (subcommand === 'status') return { action: 'status', ...durableDeliveryStatus(directory ? { directory } : {}) };
  if (subcommand !== 'drain') throw new Error('delivery supports: status, drain');
  const delivery = (options.createDelivery || createWrapperDelivery)({ ...(directory ? { directory } : {}), env: options.env });
  const before = delivery.status();
  if (!hasFlag(args, '--yes')) return { action: 'drain', executed: false, before };
  const configured = configuredCloudValues({ env: options.env, config: options.config });
  const cloud = {
    ...configured,
    logsIngestionEndpoint: optionValue(args, '--endpoint', configured.logsIngestionEndpoint),
    dcrImmutableId: optionValue(args, '--dcr-immutable-id', configured.dcrImmutableId)
  };
  const missing = [
    ['subscription', cloud.subscriptionId],
    ['logs ingestion endpoint', cloud.logsIngestionEndpoint],
    ['DCR immutable ID', cloud.dcrImmutableId]
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) {
    return { action: 'drain', executed: false, before, error: `Delivery drain is not configured: missing ${missing.join(', ')}` };
  }
  const drained = await delivery.drain([], {
    cloud,
    maxAttempts: Number(optionValue(args, '--max-attempts', '3')),
    spawnSync: options.spawnSync,
    fetchImpl: options.fetchImpl,
    tokenProvider: options.tokenProvider,
    sleep: options.sleep
  });
  return { action: 'drain', executed: true, before, ...drained };
}

async function deliveryCommand(args = []) {
  const result = await runDeliveryCommand(args);
  writeJsonOrRender(result, hasFlag(args, '--json'), renderDelivery);
  if (result.error) process.exitCode = 1;
}

module.exports = {
  deliveryCommand,
  renderDelivery,
  runDeliveryCommand
};
