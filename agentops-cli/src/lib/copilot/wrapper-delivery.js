const path = require('node:path');

const { configuredCloudValues } = require('../agentops-config');
const { createDurableEvidenceSpool } = require('../azure/durable-evidence-spool');
const { drainDurableLogsIngestion } = require('../azure/logs-ingestion-upload');
const { deliveryStateFromEnqueue } = require('../delivery-state');
const { agentopsHome } = require('../paths');
const { configuredDeliveryLimits } = require('./delivery-limits');
const { canonicalWrapperEvidence } = require('./wrapper-evidence');

function wrapperDeliveryDirectory(env = process.env) {
  return path.resolve(env.AGENTOPS_DURABLE_SPOOL_DIR || path.join(agentopsHome, 'delivery-spool'));
}

function createWrapperDelivery(options = {}) {
  const env = options.env || process.env;
  const directory = options.directory || wrapperDeliveryDirectory(env);
  let spool = options.spool || null;
  let initializationError = '';
  if (!spool) {
    try { spool = createDurableEvidenceSpool({ directory, ttlMs: configuredDeliveryLimits(options).ttlMs, maxBytes: configuredDeliveryLimits(options).maxQueueBytes }); } catch (error) { initializationError = error.message; }
  }

  function record(event, recordOptions = {}) {
    if (!spool) return { ok: false, state: 'native_best_effort', error: initializationError || 'durable spool unavailable' };
    try {
      const evidence = canonicalWrapperEvidence(event, recordOptions);
      const queued = spool.enqueue(evidence, { table: 'AgentOpsEvents_CL' });
      return { ok: queued.ok, state: deliveryStateFromEnqueue(queued), evidence, queued };
    } catch (error) {
      return { ok: false, state: 'native_best_effort', error: error.message };
    }
  }

  async function drain(eventIds = [], drainOptions = {}) {
    if (!spool) return { ok: false, configured: false, state: 'native_best_effort', error: initializationError };
    const cloud = drainOptions.cloud || (drainOptions.config
      ? configuredCloudValues({ env, config: drainOptions.config })
      : configuredCloudValues({ env, projectConfigPath: options.projectConfigPath }));
    if (!cloud.logsIngestionEndpoint || !cloud.dcrImmutableId || !cloud.subscriptionId) {
      return { ok: true, configured: false, state: spool.status().pending > 0 ? 'local_pending' : 'native_best_effort' };
    }
    try {
      const result = await drainDurableLogsIngestion({
        directory,
        agentopsHome: drainOptions.agentopsHome || options.agentopsHome,
        deliveryLimits: drainOptions.deliveryLimits || options.deliveryLimits,
        now: drainOptions.now,
        endpoint: cloud.logsIngestionEndpoint,
        dcrImmutableId: cloud.dcrImmutableId,
        expectedSubscriptionId: cloud.subscriptionId,
        env,
        spawnSync: drainOptions.spawnSync,
        fetchImpl: drainOptions.fetchImpl,
        tokenProvider: drainOptions.tokenProvider,
        sleep: drainOptions.sleep,
        maxAttempts: drainOptions.maxAttempts || 1,
        runId: drainOptions.runId,
        eventIds
      });
      const wanted = new Set(eventIds.filter(Boolean));
      const acknowledged = new Set(result.acknowledged_event_ids || []);
      const scoped = Boolean(drainOptions.runId || wanted.size > 0);
      const scopedPending = Number(result.pending || 0) + Number(result.expired || 0) + Number(result.quarantined || 0);
      const allAcknowledged = wanted.size > 0 && [...wanted].every(id => acknowledged.has(id));
      const queueEmptyAfterAcceptance = Number(result.acknowledged || 0) > 0
        && Number(result.status?.pending || 0) === 0
        && Number(result.status?.uploading || 0) === 0;
      const state = scoped
        ? Number(result.scope_matched || 0) === 0
          ? 'no_matching_batches'
          : scopedPending > 0 ? 'local_pending' : 'azure_acknowledged'
        : allAcknowledged || queueEmptyAfterAcceptance ? 'azure_acknowledged' : 'local_pending';
      return {
        ok: true,
        configured: true,
        state,
        result
      };
    } catch (error) {
      return { ok: false, configured: true, state: 'local_pending', error: error.message };
    }
  }

  return { directory, drain, record, status: () => spool?.status() || null };
}

module.exports = {
  createWrapperDelivery,
  wrapperDeliveryDirectory
};
