const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { buildLogsIngestionUploadPlan } = require('../azure/v2-ingest-plan');
const { runLogsIngestionUpload } = require('../azure/logs-ingestion-upload');
const { agentopsHome: defaultAgentopsHome } = require('../paths');

const { configuredDeliveryLimits, deliveryLimits, deliveryTargetHash, maxStateBytes, readPrivateFile } = require('./delivery-limits');

const outboxFileName = 'session-delivery.json';
const claimFileName = '.session-delivery.lock';
const streamFiles = Object.freeze({ events: 'AgentOpsEvents_CL.jsonl', spans: 'AgentOpsSpans_CL.jsonl' });
const minimumRetentionDays = 30;
const maximumRetentionDays = 365;
const sessionFiles = new Set([outboxFileName, ...Object.values(streamFiles), claimFileName]);

function validatedRetentionDays(value) {
  const days = value === undefined || value === null || value === '' ? minimumRetentionDays : Number(value);
  if (!Number.isSafeInteger(days) || days < minimumRetentionDays || days > maximumRetentionDays) {
    throw new Error(`session outbox retention must be an integer from ${minimumRetentionDays} to ${maximumRetentionDays} days`);
  }
  return days;
}

function safeDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('session outbox run path must be a real directory');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('session outbox directory must belong to the current owner');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  return directory;
}

function outboxPath(runDirectory) {
  return path.join(safeDirectory(runDirectory), outboxFileName);
}

function atomicWriteJson(file, value) {
  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o600);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'EINVAL') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function createClaimFile(file, owner) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let linked = false;
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);

    // Publish a complete claim atomically. A direct wx open exposes an empty
    // file briefly, which a competing drain could misread as corrupt.
    fs.linkSync(temporary, file);
    linked = true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!linked) return false;
  if (process.platform !== 'win32') {
    const directoryFd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  }
  return true;
}

function claimSessionOutbox(runDirectory) {
  safeDirectory(runDirectory);
  const file = path.join(runDirectory, claimFileName);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner = { version: 1, pid: process.pid, nonce: crypto.randomUUID(), createdAt: new Date().toISOString() };
    let acquired;
    try {
      acquired = createClaimFile(file, owner);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (acquired) return { acquired: true, file, ownerPid: process.pid, ownerNonce: owner.nonce };

    let existing;
    let stat;
    try {
      stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('session outbox claim must be a regular file');
      existing = JSON.parse(readPrivateFile(file, maxStateBytes));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (/session outbox claim must be a regular file/.test(error.message)) throw error;
      throw new Error('session outbox claim is unreadable; inspect it before retrying');
    }
    if (!Number.isSafeInteger(existing?.pid) || existing.pid < 1) {
      throw new Error('session outbox claim has an invalid owner; inspect it before retrying');
    }
    if (processIsAlive(existing.pid)) return { acquired: false, ownerPid: existing.pid };

    // Recheck identity before removing a stale claim. This avoids unlinking a
    // replacement claim observed after another process already recovered it.
    let currentStat;
    let currentOwner;
    try {
      currentStat = fs.lstatSync(file);
      currentOwner = JSON.parse(readPrivateFile(file, maxStateBytes));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error('session outbox claim changed during stale-owner recovery');
    }
    if (currentStat.isSymbolicLink() || !currentStat.isFile()
      || currentStat.dev !== stat.dev || currentStat.ino !== stat.ino
      || currentOwner.pid !== existing.pid || currentOwner.nonce !== existing.nonce) continue;
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { acquired: false, ownerPid: null };
}

function releaseSessionOutboxClaim(claim) {
  if (!claim?.acquired) return;
  const stat = fs.lstatSync(claim.file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('session outbox claim changed while held');
  let owner;
  try { owner = JSON.parse(readPrivateFile(claim.file, maxStateBytes)); } catch {
    throw new Error('session outbox claim changed while held');
  }
  if (owner.pid !== process.pid || (claim.ownerNonce && owner.nonce !== claim.ownerNonce)) {
    throw new Error('session outbox claim owner changed while held');
  }
  fs.unlinkSync(claim.file);
}

function initializeSessionOutbox(runDirectory, input) {
  safeDirectory(runDirectory);
  if (!input || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(String(input.runId || ''))
    || path.basename(runDirectory) !== input.runId || !/^[A-Za-z0-9-]{1,100}$/.test(String(input.sessionId || ''))) throw new Error('invalid session outbox identity');
  const streams = {};
  for (const [name, fileName] of Object.entries(streamFiles)) {
    const file = path.join(runDirectory, fileName);
    const present = fs.existsSync(file);
    let rows = 0;
    if (present) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('session export must be an owner-owned regular file without links');
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
      if (stat.size > deliveryLimits(input.deliveryLimits).maxQueueBytes) {
        streams[name] = { file: fileName, rows: 0, status: 'overflow', attempts: 0 };
        holdStream(streams[name], 'overflow', new Date(input.now ?? Date.now()).toISOString());
        streams[name].lossReceipt.bytes = stat.size;
        streams[name].lossReceipt.rowsKnown = false;
        continue;
      }
      rows = readPrivateFile(file, deliveryLimits(input.deliveryLimits).maxQueueBytes).split(/\r?\n/).filter(line => line.trim()).length;
    }
    streams[name] = { file: fileName, rows, status: present && rows ? 'pending' : 'not_observed', attempts: 0 };
  }
  const target = input.cloud?.subscriptionId && input.cloud?.logsIngestionEndpoint && input.cloud?.dcrImmutableId
    ? {
      subscriptionId: input.cloud.subscriptionId,
      logsIngestionEndpoint: input.cloud.logsIngestionEndpoint,
      dcrImmutableId: input.cloud.dcrImmutableId
    }
    : { subscriptionId: '', logsIngestionEndpoint: '', dcrImmutableId: '' };
  if (target.subscriptionId) deliveryTargetHash(target);
  const state = {
    version: 1,
    runId: input.runId,
    sessionId: input.sessionId,
    target,
    streams,
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
    updatedAt: new Date(input.now ?? Date.now()).toISOString()
  };
  const sharedClaim = claimSessionOutbox(path.dirname(runDirectory));
  if (!sharedClaim.acquired) throw new Error('shared delivery queue is busy; local exports are retained');
  try {
    const limits = deliveryLimits(input.deliveryLimits);
    let bytes = 0;
    for (const name of fs.readdirSync(path.dirname(runDirectory))) {
      const directory = path.join(path.dirname(runDirectory), name);
      if (name === path.basename(runDirectory)) continue;
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const existing = readSessionOutbox(directory);
      for (const stream of Object.values(existing?.streams || {})) {
        if (['pending', 'in_flight'].includes(stream.status)) {
          const stat = fs.lstatSync(path.join(directory, stream.file));
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe queued session export');
          bytes += stat.size;
        }
      }
    }
    for (const stream of Object.values(streams)) {
      if (stream.status === 'pending') bytes += Buffer.byteLength(readPrivateFile(path.join(runDirectory, stream.file), limits.maxQueueBytes));
    }
    if (bytes > limits.maxQueueBytes) {
      for (const stream of Object.values(streams)) if (stream.status === 'pending') holdStream(stream, 'overflow', state.createdAt);
    }
    atomicWriteJson(outboxPath(runDirectory), state);
  } finally { releaseSessionOutboxClaim(sharedClaim); }
  return state;
}

function readSessionOutbox(runDirectory) {
  const file = outboxPath(runDirectory);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('session outbox state must be a regular file');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let state;
  try { state = JSON.parse(readPrivateFile(file, maxStateBytes)); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`session outbox is unreadable: ${error.message}`);
  }
  if (state?.version !== 1 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(String(state.runId || ''))
    || path.basename(runDirectory) !== state.runId
    || !state.target || ['subscriptionId', 'logsIngestionEndpoint', 'dcrImmutableId'].some(key => typeof state.target[key] !== 'string')
    || !state.streams || typeof state.streams !== 'object' || Array.isArray(state.streams)
    || Object.keys(state.streams).some(key => !(key in streamFiles))
    || !Number.isFinite(Date.parse(state.updatedAt))
    || (state.createdAt !== undefined && !Number.isFinite(Date.parse(state.createdAt)))) {
    throw new Error('session outbox has an unsupported or invalid schema');
  }
  for (const [name, fileName] of Object.entries(streamFiles)) {
    const stream = state.streams[name];
    if (!stream || stream.file !== fileName || !['pending', 'in_flight', 'azure_accepted', 'not_observed', 'expired', 'overflow'].includes(stream.status)
      || !Number.isSafeInteger(stream.rows) || stream.rows < 0 || !Number.isSafeInteger(stream.attempts) || stream.attempts < 0) {
      throw new Error(`session outbox ${name} stream is invalid`);
    }
    if (['expired', 'overflow'].includes(stream.status) && (stream.lossReceipt?.version !== 1
      || stream.lossReceipt.reason !== stream.status || stream.lossReceipt.localExportRetained !== true
      || !Number.isFinite(Date.parse(stream.lossReceipt.at)))) throw new Error('invalid retained delivery loss receipt');
  }
  return state;
}

function sessionOutboxStatus(options = {}) {
  const home = path.resolve(options.agentopsHome || defaultAgentopsHome);
  const runs = path.join(home, 'runs');
  if (!fs.existsSync(runs)) return { runs: 0, pending: 0, accepted: 0, streams: [] };
  safeDirectory(runs);
  const streams = [];
  let accepted = 0;
  let expired = 0;
  let overflow = 0;
  const pendingRuns = new Set();
  for (const name of fs.readdirSync(runs)) {
    if (options.runId && name !== options.runId) continue;
    const directory = path.join(runs, name);
    let stat;
    try { stat = fs.lstatSync(directory); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const state = readSessionOutbox(directory);
    if (!state) continue;
    for (const [kind, stream] of Object.entries(state.streams)) {
      if (stream.status === 'pending' || stream.status === 'in_flight') {
        pendingRuns.add(state.runId);
        streams.push({ runId: state.runId, kind, rows: stream.rows, status: stream.status });
      } else if (stream.status === 'azure_accepted') accepted += 1;
      else if (['expired', 'overflow'].includes(stream.status)) {
        if (stream.status === 'expired') expired += 1; else overflow += 1;
        streams.push({ runId: state.runId, kind, rows: stream.rows, status: stream.status, lossReceipt: stream.lossReceipt });
      }
    }
  }
  return { runs: pendingRuns.size, pending: streams.filter(stream => ['pending', 'in_flight'].includes(stream.status)).length, accepted, expired, overflow, streams };
}

function sessionOutboxPrune(options = {}) {
  const home = path.resolve(options.agentopsHome || defaultAgentopsHome);
  const runs = path.join(home, 'runs');
  const olderThanDays = validatedRetentionDays(options.olderThanDays);
  const cutoff = Number(options.now ?? Date.now()) - olderThanDays * 24 * 60 * 60 * 1000;
  const apply = options.apply === true;
  const candidates = [];
  const removed = [];
  const skipped = [];
  if (!fs.existsSync(runs)) return { older_than_days: olderThanDays, applied: apply, candidates, removed, skipped };
  safeDirectory(runs);

  function assess(directory, ownClaim = null) {
    let state;
    try { state = readSessionOutbox(directory); } catch (error) {
      return { ok: false, reason: 'invalid_state', detail: error.message };
    }
    if (!state) return { ok: false, reason: 'no_outbox' };
    const claimFile = path.join(directory, claimFileName);
    if (fs.existsSync(claimFile)) {
      try {
        const claimStat = fs.lstatSync(claimFile);
        if (claimStat.isSymbolicLink() || !claimStat.isFile()) return { ok: false, reason: 'unsafe_claim' };
        const owner = JSON.parse(readPrivateFile(claimFile, maxStateBytes));
        const isOwnClaim = ownClaim && owner.pid === process.pid && owner.nonce === ownClaim.ownerNonce;
        if (!isOwnClaim && Number.isSafeInteger(owner?.pid) && processIsAlive(owner.pid)) return { ok: false, reason: 'active_drain' };
      } catch (error) {
        return { ok: false, reason: 'invalid_claim', detail: error.message };
      }
    }
    const updatedAt = Date.parse(state.updatedAt);
    if (!Number.isFinite(updatedAt)) return { ok: false, reason: 'invalid_timestamp' };
    if (updatedAt > cutoff) return { ok: false, reason: 'retention_period_not_elapsed' };
    if (Object.values(state.streams).some(stream => !['azure_accepted', 'not_observed'].includes(stream.status))) {
      return { ok: false, reason: 'delivery_not_complete' };
    }
    const names = fs.readdirSync(directory);
    const unknown = names.filter(name => !sessionFiles.has(name));
    if (unknown.length) return { ok: false, reason: 'unrecognized_files_present', unrecognized_file_count: unknown.length };
    let bytes = 0;
    for (const name of names.filter(item => item !== claimFileName)) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, reason: 'unsafe_file_type' };
      bytes += stat.size;
    }
    return {
      ok: true,
      runId: state.runId,
      updatedAt: new Date(updatedAt).toISOString(),
      bytes,
      files: names.filter(item => item !== claimFileName).length
    };
  }

  for (const name of fs.readdirSync(runs)) {
    const directory = path.join(runs, name);
    let stat;
    try { stat = fs.lstatSync(directory); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const result = assess(directory);
    if (!result.ok) {
      if (result.reason !== 'no_outbox' && result.reason !== 'retention_period_not_elapsed') skipped.push({ run_id: name, ...result });
      continue;
    }
    const summary = { run_id: result.runId, updated_at: result.updatedAt, bytes: result.bytes, files: result.files };
    if (!apply) {
      candidates.push(summary);
      continue;
    }

    let claim;
    try { claim = claimSessionOutbox(directory); } catch (error) {
      skipped.push({ run_id: result.runId, reason: 'claim_error', detail: error.message });
      continue;
    }
    if (!claim.acquired) {
      skipped.push({ run_id: result.runId, reason: 'active_drain' });
      continue;
    }
    try {
      const current = assess(directory, claim);
      if (!current.ok || current.runId !== result.runId) {
        skipped.push({ run_id: result.runId, reason: current.reason || 'state_changed' });
        continue;
      }
      for (const fileName of [...Object.values(streamFiles), outboxFileName]) {
        const file = path.join(directory, fileName);
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      removed.push(summary);
    } finally {
      releaseSessionOutboxClaim(claim);
    }
    try { fs.rmdirSync(directory); } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
  return { older_than_days: olderThanDays, applied: apply, candidates, removed, skipped };
}

function holdStream(stream, reason, at) {
  stream.status = reason;
  stream.lossReceipt = { version: 1, reason, at, rows: stream.rows, attempts: stream.attempts, localExportRetained: true, remoteAcceptance: stream.attempts ? 'unknown' : 'not_attempted' };
}

function targetMatches(bound, cloud) {
  return (!bound.subscriptionId || bound.subscriptionId === cloud.subscriptionId)
    && (!bound.logsIngestionEndpoint || bound.logsIngestionEndpoint === cloud.logsIngestionEndpoint)
    && (!bound.dcrImmutableId || bound.dcrImmutableId === cloud.dcrImmutableId);
}

function drainSessionOutboxes(options = {}) {
  const home = path.resolve(options.agentopsHome || defaultAgentopsHome);
  const runs = path.join(home, 'runs');
  const limits = configuredDeliveryLimits(options);
  const now = Number(options.now ?? Date.now());
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid delivery clock');
  const runId = options.runId || null;
  if (!fs.existsSync(runs)) return { acknowledged: 0, pending: 0, skippedTarget: 0, skippedBusy: 0, ...(runId ? { runId } : {}), streams: [] };
  safeDirectory(runs);
  const cloud = options.cloud || {};
  const output = { acknowledged: 0, pending: 0, skippedTarget: 0, skippedBusy: 0, ...(runId ? { runId } : {}), streams: [] };
  for (const name of fs.readdirSync(runs)) {
    if (runId && name !== runId) continue;
    const directory = path.join(runs, name);
    let stat;
    try { stat = fs.lstatSync(directory); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const file = path.join(directory, outboxFileName);
    if (!fs.existsSync(file)) continue;
    const claim = claimSessionOutbox(directory);
    if (!claim.acquired) {
      const busyState = readSessionOutbox(directory);
      const skipped = Object.values(busyState?.streams || {}).filter(stream => stream.status === 'pending' || stream.status === 'in_flight').length;
      output.skippedBusy += skipped;
      output.pending += skipped;
      continue;
    }
    try {
      const state = readSessionOutbox(directory);
      if (!state) continue;
      state.createdAt = state.createdAt || state.updatedAt;
      if (runId && state.runId !== runId) {
        continue;
      }
      if (!targetMatches(state.target, cloud)) {
        const skipped = Object.values(state.streams).filter(stream => stream.status === 'pending' || stream.status === 'in_flight').length;
        output.skippedTarget += skipped;
        output.pending += skipped;
        continue;
      }
      if (!state.target.subscriptionId && cloud.subscriptionId) {
        state.target = {
          subscriptionId: cloud.subscriptionId,
          logsIngestionEndpoint: cloud.logsIngestionEndpoint,
          dcrImmutableId: cloud.dcrImmutableId
        };
      }
      for (const [kind, stream] of Object.entries(state.streams)) {
        if (stream.status !== 'pending' && stream.status !== 'in_flight') continue;
        const createdAt = Date.parse(state.createdAt || state.updatedAt);
        if (!Number.isFinite(createdAt) || createdAt > now) throw new Error('invalid session outbox creation timestamp');
        if (now - createdAt >= limits.ttlMs) {
          holdStream(stream, 'expired', new Date(now).toISOString());
          atomicWriteJson(file, state);
          output.streams.push({ runId: state.runId, kind, rows: stream.rows, status: 'expired', lossReceipt: stream.lossReceipt });
          continue;
        }
        const jsonl = path.join(directory, streamFiles[kind]);
        if (!fs.existsSync(jsonl)) {
          output.pending += 1;
          stream.status = 'pending';
          state.updatedAt = new Date().toISOString();
          atomicWriteJson(file, state);
          output.streams.push({ runId: state.runId, kind, status: 'local_pending', error: 'local export file is missing' });
          continue;
        }
        const text = readPrivateFile(jsonl, limits.maxQueueBytes);
        const rows = text.split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
        if (rows.length !== stream.rows) throw new Error('session outbox row count changed');
        stream.status = 'in_flight';
        stream.attempts += 1;
        state.updatedAt = new Date().toISOString();
        atomicWriteJson(file, state);
        const plan = buildLogsIngestionUploadPlan({
          dir: directory,
          endpoint: cloud.logsIngestionEndpoint,
          dcrImmutableId: cloud.dcrImmutableId,
          eventsOnly: kind === 'events',
          spansOnly: kind === 'spans'
        });
        const result = runLogsIngestionUpload(plan, {
          env: options.env,
          expectedSubscriptionId: cloud.subscriptionId,
          spawnSync: options.spawnSync,
          agentopsHome: home,
          deliveryLimits: limits,
          now: options.now
        });
        if (result.ok && result.executed) {
          stream.status = 'azure_accepted';
          output.acknowledged += 1;
        } else {
          // A failed local command can follow remote acceptance. Resetting to pending
          // enables recovery but deliberately retains at-least-once duplicate risk.
          stream.status = 'pending';
          output.pending += 1;
        }
        state.updatedAt = new Date().toISOString();
        atomicWriteJson(file, state);
        output.streams.push({ runId: state.runId, kind, rows: stream.rows, status: stream.status, result });
      }
    } finally {
      releaseSessionOutboxClaim(claim);
    }
  }
  return output;
}

module.exports = {
  drainSessionOutboxes,
  claimSessionOutbox,
  initializeSessionOutbox,
  readSessionOutbox,
  releaseSessionOutboxClaim,
  sessionOutboxPrune,
  sessionOutboxStatus,
  targetMatches
};
