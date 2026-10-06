const { validPreRunSnapshot, attachmentProvenance, sessionSourceIntegrity } = require('./run-evidence-contract');
const { componentEvidence } = require('./component-evidence');
const { normalizeExecutionConfiguration, reconcileModelProvenance } = require('./execution-configuration');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const { configuredCloudValues, projectAgentOpsConfigPath } = require('../agentops-config');
const { gitRoot } = require('../attach-command');
const { agentopsHome } = require('../paths');
const { defaultReceiptFiles, readSessionOtelSpans } = require('./session-otel');
const { readCopilotSessionEvents } = require('./session-enricher');
const { writeSessionEvents } = require('./session-event-export');
const { enrichSpansWithSessionToolContext, writeSessionSpans } = require('./session-span-export');
const { drainSessionOutboxes, initializeSessionOutbox, readSessionOutbox } = require('./session-delivery-outbox');

function safeRunId(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) throw new Error('session delivery requires a safe AgentOps run ID');
  return text;
}

function ensurePrivateDirectory(directory, options = {}) {
  try {
    fs.mkdirSync(directory, { recursive: Boolean(options.recursive), mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('session export directory must be a real directory, not a symlink or file');
  }
  fs.chmodSync(directory, 0o700);
}

function eventExportRows(outputDir) {
  return fs.readFileSync(path.join(outputDir, 'AgentOpsEvents_CL.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function deliverCopilotSession(options = {}) {
  const summary = options.summary;
  if (!summary?.sessionId) return { state: 'native_best_effort', reason: 'no changed Copilot session was detected' };
  const selectedSessionId = String(summary.sessionId);
  if (!/^[A-Za-z0-9-]{1,100}$/.test(selectedSessionId)) {
    throw new Error('session delivery requires a safe Copilot session ID');
  }

  const runId = safeRunId(options.runId);
  const copilotHome = options.copilotHome || process.env.COPILOT_HOME || path.join(require('node:os').homedir(), '.copilot');
  const eventsFile = path.join(copilotHome, 'session-state', selectedSessionId, 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return { state: 'native_best_effort', reason: 'Copilot session event file was not found' };

  const sourceBefore = sessionSourceIntegrity(eventsFile, selectedSessionId);
  const sessionEvents = readCopilotSessionEvents(eventsFile);
  const eventSessionId = sessionEvents.find(event => event.type === 'session.start')?.data?.sessionId;
  if (eventSessionId && eventSessionId !== selectedSessionId) {
    throw new Error('session start ID does not match selected session directory');
  }
  const sessionId = selectedSessionId;
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const home = path.resolve(options.agentopsHome || agentopsHome);
  const runsDir = path.join(home, 'runs');
  ensurePrivateDirectory(runsDir, { recursive: true });
  const outputDir = path.join(runsDir, runId);
  ensurePrivateDirectory(outputDir);

  let repoRoot;
  try {
    repoRoot = gitRoot(cwd);
  } catch {
    repoRoot = fs.realpathSync.native(cwd);
  }
  const eventExport = writeSessionEvents(sessionEvents, sessionId, runId, outputDir, { repoRoot });
  const native = readSessionOtelSpans(
    sessionId,
    options.otelFiles || defaultReceiptFiles(),
    { runId }
  );
  const spans = enrichSpansWithSessionToolContext(native.spans, sessionEvents);
  const spanExport = spans.length
    ? writeSessionSpans(spans, sessionId, runId, path.join(outputDir, 'AgentOpsSpans_CL.jsonl'))
    : null;

  const projectConfigPath = options.projectConfigPath || projectAgentOpsConfigPath({ cwd });
  const cloud = configuredCloudValues({ env, projectConfigPath });
  initializeSessionOutbox(outputDir, { runId, sessionId, cloud, deliveryLimits: options.deliveryLimits, now: options.now });
  const uploadRequested = options.upload !== false;
  const delivery = uploadRequested && cloud.subscriptionId && cloud.logsIngestionEndpoint && cloud.dcrImmutableId
    ? drainSessionOutboxes({
      agentopsHome: home,
      cloud,
      env,
      runId,
      spawnSync: options.spawnSync,
      deliveryLimits: options.deliveryLimits,
      now: options.now
    })
    : { acknowledged: 0, pending: 0, skippedTarget: 0, streams: [] };
  const outbox = readSessionOutbox(outputDir);
  const streams = outbox.streams;
  const results = delivery.streams.filter(item => item.runId === runId);
  const uploaded = Object.values(streams).every(stream => stream.status === 'azure_accepted');
  const runContextPath = path.join(outputDir, 'run-context.json');
  const snapshot = validPreRunSnapshot(options.preRunSnapshot)
    && options.preRunSnapshot.repositoryRootHash === crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16)
    ? options.preRunSnapshot : null;
  const provenance = attachmentProvenance(snapshot, repoRoot);
  const sourceIntegrity = sessionSourceIntegrity(eventsFile, sessionId);
  if (sourceBefore.sha256 !== sourceIntegrity.sha256 || sourceIntegrity.rowCount !== sessionEvents.length) {
    sourceIntegrity.status = 'invalid'; sourceIntegrity.reason = 'source changed during export or parser omitted rows';
  }
  sourceIntegrity.freshSession = options.sourceWindow?.freshSession === true && options.sourceWindow.sessionId === sessionId;
  sourceIntegrity.windowStartedAt = options.sourceWindow?.startedAt || null;
  const executionConfiguration = normalizeExecutionConfiguration(options.executionConfiguration);
  const runContext = {
    managedBy: 'copilot-agentops',
    schemaVersion: 1,
    runId,
    sessionId,
    repositoryRootHash: crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16),
    attachmentManifestSha256: snapshot?.attachmentManifestSha256 || '',
    architectureVersion: snapshot?.architectureVersion || null,
    preRunSnapshot: snapshot,
    attachmentProvenance: provenance,
    sourceIntegrity,
    taskId: snapshot?.taskId || null,
    configurationVersion: executionConfiguration.configurationVersion,
    executionConfigurationHash: executionConfiguration.executionConfigurationHash,
    executionConfiguration,
    launchExecutionConfiguration: executionConfiguration,
    modelProvenance: reconcileModelProvenance({ launchExecutionConfiguration: executionConfiguration, events: sessionEvents, nativeSpans: spans }),
    lifecycle: options.lifecycle || { collector: 'unknown', process: 'unknown' },
    // Native event presence proves observation, not completeness of each surface.
    coverage: Object.fromEntries(['agents', 'skills', 'references', 'scripts', 'tools', 'models'].map(kind => [kind, 'unknown'])),
    evidenceComplete: false,
    coverageEvidence: componentEvidence(eventExportRows(outputDir), spans, options.expectations),
    expectationManifest: options.expectations ? { scope: options.expectations.scope, sha256: options.expectations.sha256 } : null,
    nativeEventCount: sessionEvents.length,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(runContextPath, `${JSON.stringify(runContext, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return {
    state: Object.values(streams).some(stream => stream.status === 'overflow') ? 'overflow'
      : Object.values(streams).some(stream => stream.status === 'expired') ? 'expired'
      : uploaded ? 'azure_acknowledged' : 'local_pending',
    sessionId,
    runId,
    outputDir,
    events: eventExport.rows,
    spans: spanExport?.rows || 0,
    invalidNativeRecords: native.invalid,
    nativeReceiptFiles: native.files,
    uploads: results,
    streams: Object.fromEntries(Object.entries(streams).map(([kind, stream]) => [kind, {
      status: stream.status === 'in_flight' || stream.status === 'pending' ? 'local_pending' : stream.status,
      rows: stream.rows,
      attempts: stream.attempts
    }])),
    reason: uploaded ? '' : !uploadRequested
      ? 'Azure upload was not requested; evidence remains local and pending'
      : !cloud.subscriptionId || !cloud.logsIngestionEndpoint || !cloud.dcrImmutableId
      ? 'Azure target is not fully configured'
      : Object.values(streams).some(stream => stream.status === 'in_flight' || stream.status === 'pending')
        ? `Azure has ${delivery.pending} session stream batch(es) pending recovery`
        : 'one or more evidence streams were not observed'
  };
}

module.exports = { deliverCopilotSession, ensurePrivateDirectory, safeRunId };
