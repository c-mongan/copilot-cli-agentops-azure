const { hasFlag, optionValue } = require('./args');
const fs = require('node:fs');
const path = require('node:path');
const { configuredCloudValues, projectAgentOpsConfigPath } = require('./agentops-config');
const { writeJsonOrRender } = require('./command-output');
const { durableDeliveryStatus } = require('./status-summary');
const { createWrapperDelivery } = require('./copilot/wrapper-delivery');
const { drainSessionOutboxes, sessionOutboxPrune, sessionOutboxStatus } = require('./copilot/session-delivery-outbox');
const { createDurableEvidenceSpool, retentionDays } = require('./azure/durable-evidence-spool');
const { configuredDeliveryLimits } = require('./copilot/delivery-limits');
const { agentopsHome } = require('./paths');

function renderDelivery(result) {
  const lines = ['AgentOps delivery', ''];
  if (result.action === 'review') {
    lines.push(`Held lifecycle records: ${result.records.length}`);
    for (const record of result.records) {
      lines.push(`- ${record.event_id || '(unknown ID)'} · ${record.state} · ${record.integrity} · ${record.requeueable ? 'requeueable' : 'not requeueable'} · ${record.run_id || 'unknown run'}`);
    }
    if (!result.records.length) lines.push('No expired or quarantined lifecycle records match.');
    lines.push(`Session batches waiting for delivery: ${result.sessionStreams.length}`);
    for (const stream of result.sessionStreams) {
      lines.push(`- ${stream.runId} · ${stream.kind} · ${stream.status} · ${stream.rows} row(s)`);
    }
    lines.push('Only IDs, row counts, and delivery status are shown; session payloads are never printed.');
  } else if (result.action === 'prune') {
    const held = result.lifecycle.removed.length;
    const runs = result.sessions.removed.length;
    lines.push(`Mode: ${result.executed ? 'apply' : 'preview'}`);
    lines.push(`Held lifecycle segments: ${result.executed ? held : result.lifecycle.candidates.length}`);
    lines.push(`Completed session runs: ${result.executed ? runs : result.sessions.candidates.length}`);
    lines.push(`Protected session runs: ${result.sessions.skipped.length}`);
    if (!result.executed) lines.push('No local files were removed. Use --yes to apply after reviewing this plan.');
    else lines.push(`Local bytes removed: ${result.lifecycle.removed.reduce((total, item) => total + item.bytes, 0) + result.sessions.removed.reduce((total, item) => total + item.bytes, 0)}`);
  } else if (result.action === 'requeue') {
    lines.push(`Event: ${result.event_id}`, `State: ${result.result?.status || 'preview'}`);
    if (!result.executed) {
      lines.push(`Review: ${result.record ? result.record.requeueable ? 'valid and not expired' : 'held; it cannot be requeued' : 'no matching quarantined record'}`);
      lines.push('Mode: preview', 'No local queue state changed.', 'Run with --yes only after reviewing the event and Azure destination.');
    }
    else lines.push(result.result?.ok ? 'The validated record is pending local delivery.' : 'The record remains held.');
  } else if (result.action === 'status') {
    const waiting = Number(result.pending || 0);
    const held = Number(result.quarantined || 0) + Number(result.expired || 0);
    const sessionWaiting = Number(result.sessionPending || 0);
    lines.push(
      `Local queue: ${waiting || sessionWaiting
        ? sessionWaiting
          ? `${waiting} receipt event(s) and ${sessionWaiting} session batch(es) waiting to send`
          : `${waiting} receipt event${waiting === 1 ? '' : 's'} waiting to send`
        : 'nothing waiting'}`,
      `Needs attention: ${held ? `${held} event${held === 1 ? '' : 's'}` : 'none'}`
    );
    if (result.acknowledged_cumulative !== undefined) {
      lines.push(`Accepted by Azure ingestion: ${result.acknowledged_cumulative} total`);
      if (Number(result.acknowledged_cumulative) > 0) lines.push('Azure acceptance does not by itself prove the events are searchable yet.');
    }
    if (result.overflow_cumulative !== undefined && Number(result.overflow_cumulative) > 0) {
      lines.push(`Not saved because the queue was full: ${result.overflow_cumulative} total`);
    }
    if (sessionWaiting > 0) {
      const runs = Number(result.sessionRuns || 0);
      lines.push(`Copilot session batches waiting: ${result.sessionPending} (${runs} run${runs === 1 ? '' : 's'})`);
    }
    if (Number(result.sessionAccepted || 0) > 0) {
      lines.push(`Copilot session batches accepted by Azure: ${result.sessionAccepted} total`);
    }
    lines.push(
      waiting || sessionWaiting ? 'Next: run agentops delivery drain to preview sending the waiting batches.' : 'Next: no delivery action is needed.',
      `Local receipt folder: ${result.directory}`
    );
  } else if (!result.executed) {
    const waiting = Number(result.before?.pending || 0);
    const sessionWaiting = Number(result.before?.sessionPending || 0);
    if (result.runId || result.eventId) {
      lines.push(`Scope: ${result.runId ? `run ${result.runId}` : ''}${result.runId && result.eventId ? ' and ' : ''}${result.eventId ? `event ${result.eventId}` : ''}`);
      lines.push('Queue totals below are local status counts; apply will send only the selected scope.');
    }
    lines.push('Mode: preview', `Waiting: ${waiting} receipt event(s), ${sessionWaiting} session batch(es)`, 'No Azure request was made.');
    if (waiting > 0 || sessionWaiting > 0) lines.push('Run with --yes only after reviewing the exact subscription, endpoint, and DCR.');
    else lines.push('Nothing is waiting, so there is nothing to send.');
  } else {
    lines.push(`State: ${result.state}`, `Accepted this drain: ${result.result?.acknowledged || 0}`, `Still waiting: ${result.result?.status?.pending || 0}`, `Held for review: ${result.result?.status?.quarantined || 0}`);
    if (result.runId || result.eventId) {
      lines.push(`Scope: ${result.runId ? `run ${result.runId}` : ''}${result.runId && result.eventId ? ' and ' : ''}${result.eventId ? `event ${result.eventId}` : ''}`);
      lines.push(`Selected scope accepted: ${(result.result?.acknowledged || 0) + (result.sessions?.acknowledged || 0)}`);
      lines.push(`Selected scope still waiting: ${(result.result?.pending || 0) + (result.sessions?.pending || 0)}`);
    }
    if (result.sessions) {
      lines.push(`Copilot session batches accepted: ${result.sessions.acknowledged || 0}`);
      lines.push(`Copilot session batches still waiting: ${result.sessions.pending || 0}`);
      if (result.sessions.skippedTarget) lines.push(`Copilot session batches for another Azure target: ${result.sessions.skippedTarget}`);
      if (result.sessions.skippedBusy) lines.push(`Copilot session batches skipped because another drain is active: ${result.sessions.skippedBusy}`);
    }
  }
  if (result.error) lines.push(`Error: ${result.error}`);
  return `${lines.join('\n')}\n`;
}

async function runDeliveryCommand(args = [], options = {}) {
  const [subcommand = 'status'] = args;
  const allowance = optionValue(args, '--max-publish-bytes-per-day');
  const deliveryLimits = configuredDeliveryLimits({ ...options, deliveryLimits: allowance === null ? options.deliveryLimits : { ...(options.deliveryLimits || {}), maxPublishBytesPerDay: /^\d+$/.test(String(allowance)) ? Number(allowance) : NaN } });
  const directory = optionValue(args, '--dir', options.directory || process.env.AGENTOPS_DURABLE_SPOOL_DIR || '');
  const agentopsRoot = options.agentopsHome || agentopsHome;
  if (subcommand === 'review') {
    const spool = options.createSpool ? options.createSpool({ directory: directory || undefined, env: options.env })
      : createDurableEvidenceSpool({ directory: directory || path.join(agentopsRoot, 'delivery-spool') });
    const runId = optionValue(args, '--run-id');
    const records = spool.inspectHeld({ eventId: optionValue(args, '--event-id') })
      .filter(record => !runId || record.run_id === runId);
    const sessionStatus = sessionOutboxStatus({ agentopsHome: agentopsRoot });
    const sessionStreams = sessionStatus.streams.filter(stream => !runId || stream.runId === runId);
    return { action: 'review', records, sessionStreams, directory: spool.directory };
  }
  if (subcommand === 'prune') {
    const olderThanDays = optionValue(args, '--older-than', '30');
    const apply = hasFlag(args, '--yes');
    const spoolDirectory = directory || path.join(agentopsRoot, 'delivery-spool');
    const spool = options.createSpool
      ? options.createSpool({ directory: directory || undefined, env: options.env })
      : fs.existsSync(spoolDirectory) || apply
        ? createDurableEvidenceSpool({ directory: spoolDirectory })
        : null;
    const lifecyclePreview = spool
      ? spool.pruneHeld({ olderThanDays })
      : { older_than_days: retentionDays(olderThanDays), applied: false, candidates: [], removed: [] };
    const sessionPreview = sessionOutboxPrune({ agentopsHome: agentopsRoot, olderThanDays });
    const lifecycle = apply && spool ? spool.pruneHeld({ olderThanDays, apply: true }) : lifecyclePreview;
    const sessions = apply
      ? sessionOutboxPrune({ agentopsHome: agentopsRoot, olderThanDays, apply: true })
      : sessionPreview;
    return { action: 'prune', executed: apply, older_than_days: lifecycle.older_than_days, lifecycle, sessions };
  }
  if (subcommand === 'requeue') {
    const eventId = optionValue(args, '--event-id');
    if (!eventId) throw new Error('delivery requeue requires --event-id <id>');
    const spool = options.createSpool ? options.createSpool({ directory: directory || undefined, env: options.env })
      : createDurableEvidenceSpool({ directory: directory || path.join(agentopsRoot, 'delivery-spool') });
    const preview = spool.inspectHeld({ eventId });
    if (!hasFlag(args, '--yes')) return { action: 'requeue', event_id: eventId, executed: false, record: preview[0] || null };
    const result = spool.requeueHeld(eventId);
    return {
      action: 'requeue', event_id: eventId, executed: true, result,
      ...(!result.ok ? { error: `Delivery requeue refused: ${result.status}` } : {})
    };
  }
  if (subcommand === 'status') {
    const lifecycle = durableDeliveryStatus(directory ? { directory, env: options.env } : { env: options.env });
    const sessions = sessionOutboxStatus({ agentopsHome: agentopsRoot });
    return { action: 'status', ...lifecycle, sessionPending: sessions.pending, sessionAccepted: sessions.accepted, sessionRuns: sessions.runs };
  }
  if (subcommand !== 'drain') throw new Error('delivery supports: status, review, requeue, prune, drain');
  const runId = optionValue(args, '--run-id');
  const eventId = optionValue(args, '--event-id');
  const delivery = (options.createDelivery || createWrapperDelivery)({ ...(directory ? { directory } : {}), env: options.env });
  const before = {
    ...delivery.status(),
    sessionPending: (eventId && !runId)
      ? 0
      : sessionOutboxStatus({ agentopsHome: agentopsRoot, runId }).pending
  };
  if (!hasFlag(args, '--yes')) return { action: 'drain', executed: false, before, ...(runId ? { runId } : {}), ...(eventId ? { eventId } : {}) };
  const configured = configuredCloudValues({
    env: options.env,
    config: options.config,
    projectConfigPath: options.projectConfigPath || projectAgentOpsConfigPath({ cwd: options.cwd || process.cwd() })
  });
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
    return { action: 'drain', executed: false, before, error: `Delivery drain is not configured: missing ${missing.join(', ')}`, ...(runId ? { runId } : {}), ...(eventId ? { eventId } : {}) };
  }
  const drained = await delivery.drain(eventId ? [eventId] : [], {
    cloud,
    runId,
    eventIds: eventId ? [eventId] : undefined,
    agentopsHome: agentopsRoot, deliveryLimits,
    maxAttempts: Number(optionValue(args, '--max-attempts', '3')),
    spawnSync: options.spawnSync,
    fetchImpl: options.fetchImpl,
    tokenProvider: options.tokenProvider,
    sleep: options.sleep
  });
  const sessions = eventId && !runId
    ? { acknowledged: 0, pending: 0, skippedTarget: 0, skippedBusy: 0, streams: [] }
    : (options.drainSessions || drainSessionOutboxes)({
      agentopsHome: agentopsRoot,
      cloud,
      deliveryLimits,
      runId,
      env: options.env,
      spawnSync: options.spawnSync
    });
  const afterLifecycle = delivery.status();
  const afterSessions = eventId && !runId
    ? { accepted: 0, pending: 0 }
    : sessionOutboxStatus({ agentopsHome: agentopsRoot, runId });
  const pendingLifecycle = Number(afterLifecycle.pending || 0) + Number(afterLifecycle.uploading || 0);
  const scoped = Boolean(runId || eventId);
  const selectedPending = Number(drained.result?.pending || 0)
    + Number(drained.result?.expired || 0)
    + Number(drained.result?.quarantined || 0)
    + Number(sessions.pending || 0);
  const selectedAccepted = Number(drained.result?.acknowledged || 0)
    + Number(sessions.acknowledged || 0)
    + Number(afterSessions.accepted || 0);
  const state = scoped
    ? selectedPending > 0 ? 'local_pending'
      : selectedAccepted > 0 ? 'azure_acknowledged'
        : drained.state
    : sessions.pending > 0 || pendingLifecycle > 0
      ? 'local_pending'
      : sessions.acknowledged > 0 || afterSessions.accepted > 0 || Number(afterLifecycle.acknowledged || 0) > 0
        || drained.state === 'azure_acknowledged'
        ? 'azure_acknowledged'
        : drained.state;
  return { action: 'drain', executed: true, before, ...drained, state, sessions, ...(runId ? { runId } : {}), ...(eventId ? { eventId } : {}) };
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
