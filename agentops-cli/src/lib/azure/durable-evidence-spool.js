const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const spoolVersion = 1;
const defaultMaxBytes = 64 * 1024 * 1024;
const defaultTtlMs = 7 * 24 * 60 * 60 * 1000;
const maximumMaxBytes = 1024 * 1024 * 1024;
const maximumTtlMs = 30 * 24 * 60 * 60 * 1000;
const maximumRetryDelayMs = 60 * 1000;
const maximumDrainAttempts = 10;
const defaultClaimLeaseMs = 30 * 1000;
const maximumClaimLeaseMs = 5 * 60 * 1000;
const minimumHeldRetentionDays = 30;
const maximumHeldRetentionDays = 365;
const admissionLockLeaseMs = 10 * 1000;
const admissionLockTimeoutMs = 2 * 1000;

const allowedEvidenceTables = new Set([
  'AgentOpsEvents_CL'
]);

// Canonical metadata fields only. Values are scalar so nested content cannot be
// smuggled into an otherwise safe-looking envelope.
const allowedEvidenceFields = new Set([
  'TimeGenerated', 'Sequence', 'EventId', 'ParentEventId', 'AgentId', 'ParentAgentId', 'ParentToolCallId', 'ExitCode', 'RunId', 'SessionId',
  'TraceId', 'Surface', 'EventName', 'SpanName', 'Status', 'DurationMs',
  'AgentName', 'ParentAgentName', 'SubAgentName', 'SkillName', 'CommandName', 'ScriptName',
  'ToolName', 'McpServerName', 'McpToolName', 'ModelActual', 'InputTokens', 'OutputTokens',
  'ReasoningTokens', 'CacheReadTokens', 'CacheWriteTokens', 'TotalTokens',
  'EstimatedCostUsd', 'EstimatedCostUsdReal', 'CopilotCost', 'PremiumRequests', 'TotalNanoAiu', 'ApiDurationMs',
  'PermissionDecision', 'PermissionKind', 'ErrorType', 'TotalToolCalls', 'LinesAdded',
  'LinesRemoved', 'FilesModified', 'PrivacyMode',
  'ContentCaptureMode', 'ContentCaptureSignal', 'ContentAction',
  'ContentDroppedBytes', 'SecretLike', 'RepoHash', 'BranchHash', 'WorkingDirectoryHash',
  'SchemaVersion'
]);
const eventLongFields = new Set([
  'Sequence', 'ExitCode', 'InputTokens', 'OutputTokens', 'ReasoningTokens', 'CacheReadTokens',
  'CacheWriteTokens', 'TotalTokens', 'TotalToolCalls', 'DurationMs', 'PremiumRequests',
  'TotalNanoAiu', 'ApiDurationMs', 'LinesAdded', 'LinesRemoved', 'FilesModified',
  'ContentDroppedBytes', 'EstimatedCostUsd'
]);
const eventRealFields = new Set(['CopilotCost', 'EstimatedCostUsdReal']);
const eventBooleanFields = new Set(['ContentCaptureSignal', 'SecretLike']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEvidenceRow(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AgentOps durable evidence must be an object');
  const unknown = Object.keys(input).filter(key => !allowedEvidenceFields.has(key));
  if (unknown.length) throw new Error(`AgentOps durable evidence rejected non-allowlisted field(s): ${unknown.join(', ')}`);
  const row = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`AgentOps durable evidence field ${key} must be scalar metadata`);
    row[key] = typeof value === 'string' ? value.slice(0, 2048) : value;
  }
  if (!row.RunId) throw new Error('AgentOps durable evidence requires RunId');
  if (!Number.isInteger(Number(row.Sequence)) || Number(row.Sequence) < 1) throw new Error('AgentOps durable evidence requires a positive integer Sequence');
  row.Sequence = Number(row.Sequence);
  row.EventId = row.EventId || `event_${sha256(`${row.RunId}:${row.Sequence}:${row.EventName || ''}`).slice(0, 24)}`;
  row.PrivacyMode = 'strict';
  row.ContentCaptureMode = 'off';
  // The V2 table originally shipped EstimatedCostUsd as a long. Azure does not
  // permit changing an existing column's type, so preserve precise values in
  // the additive real column and only retain the legacy field when it is truly
  // an integer. Never round a cost and silently change its meaning.
  if (Object.hasOwn(row, 'EstimatedCostUsd')) {
    if (typeof row.EstimatedCostUsd !== 'number' || !Number.isFinite(row.EstimatedCostUsd)) {
      throw new Error('AgentOps durable evidence field EstimatedCostUsd must be a finite number');
    }
    row.EstimatedCostUsdReal = row.EstimatedCostUsd;
    if (!Number.isSafeInteger(row.EstimatedCostUsd) || row.EstimatedCostUsd < 0) delete row.EstimatedCostUsd;
  }
  for (const [key, value] of Object.entries(row)) {
    if (eventLongFields.has(key) && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`AgentOps durable evidence field ${key} must be a non-negative integer`);
    }
    if (eventRealFields.has(key) && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`AgentOps durable evidence field ${key} must be a finite number`);
    }
    if (eventBooleanFields.has(key) && typeof value !== 'boolean') {
      throw new Error(`AgentOps durable evidence field ${key} must be boolean`);
    }
    if (!eventLongFields.has(key) && !eventRealFields.has(key) && !eventBooleanFields.has(key)
      && typeof value !== 'string') {
      throw new Error(`AgentOps durable evidence field ${key} must be a string`);
    }
  }
  if (row.TimeGenerated && !Number.isFinite(Date.parse(row.TimeGenerated))) {
    throw new Error('AgentOps durable evidence field TimeGenerated must be a valid datetime');
  }
  return row;
}

function ensurePrivateDirectory(directory) {
  if (fs.existsSync(directory)) {
    const existing = fs.lstatSync(directory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error('AgentOps durable spool directory must be a real directory, not a symlink');
    }
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function atomicWrite(file, body) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function stateFile(directory) {
  return path.join(directory, 'spool-state.json');
}

function updateCountersUnlocked(directory, changes = {}) {
  const file = stateFile(directory);
  const state = readJson(file, { acknowledged: 0, overflow: 0 });
  for (const [key, value] of Object.entries(changes)) state[key] = Number(state[key] || 0) + value;
  atomicWrite(file, `${canonicalJson(state)}\n`);
  return state;
}

function pauseSync(ms) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

function lockPath(directory) {
  return path.join(directory, '.admission.lock');
}

function acquireAdmissionLock(directory) {
  const lock = lockPath(directory);
  const deadline = Date.now() + admissionLockTimeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(lock, 0o700);
      return lock;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const entry = fs.lstatSync(lock);
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new Error('AgentOps durable spool lock must be a real directory, not a symlink');
        }
        stale = Date.now() - entry.mtimeMs >= admissionLockLeaseMs;
      } catch (inspectError) {
        if (inspectError.code === 'ENOENT') continue;
        throw inspectError;
      }
      if (stale) {
        const staleLock = `${lock}.stale-${process.pid}-${crypto.randomUUID()}`;
        try {
          fs.renameSync(lock, staleLock);
          fs.rmSync(staleLock, { recursive: true, force: true });
          fsyncDirectory(directory);
          continue;
        } catch (claimError) {
          if (claimError.code === 'ENOENT') continue;
          throw claimError;
        }
      }
      if (Date.now() >= deadline) throw new Error('AgentOps durable spool admission lock timed out');
      pauseSync(10);
    }
  }
}

function withAdmissionLock(directory, action) {
  const lock = acquireAdmissionLock(directory);
  try {
    return action();
  } finally {
    try { fs.rmdirSync(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fsyncDirectory(directory);
  }
}

function updateCounters(directory, changes = {}) {
  return withAdmissionLock(directory, () => updateCountersUnlocked(directory, changes));
}

function segmentFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => /\.(pending|uploading|expired|quarantined|acknowledged)\.json$/.test(name))
    .sort()
    .map(name => path.join(directory, name))
    .filter(file => {
      let entry;
      try { entry = fs.lstatSync(file); } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error('AgentOps durable spool segment must be a regular file, not a symlink');
      }
      return true;
    });
}

function spoolBytes(directory) {
  return segmentFiles(directory).reduce((total, file) => {
    try { return total + fs.statSync(file).size; } catch (error) {
      if (error.code === 'ENOENT') return total;
      throw error;
    }
  }, 0);
}

function transition(file, state) {
  const next = file.replace(/\.(pending|uploading|expired|quarantined|acknowledged)\.json$/, `.${state}.json`);
  fs.renameSync(file, next);
  if (state === 'expired' || state === 'quarantined') {
    const heldAt = new Date();
    fs.utimesSync(next, heldAt, heldAt);
  }
  fsyncDirectory(path.dirname(file));
  return next;
}

function retentionDays(value) {
  const days = value === undefined || value === null || value === '' ? minimumHeldRetentionDays : Number(value);
  if (!Number.isSafeInteger(days) || days < minimumHeldRetentionDays || days > maximumHeldRetentionDays) {
    throw new Error(`AgentOps delivery retention must be an integer from ${minimumHeldRetentionDays} to ${maximumHeldRetentionDays} days`);
  }
  return days;
}

function retryableStatus(status) {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function responseStatus(response) {
  return Number(response?.status ?? response?.statusCode ?? 0);
}

function header(response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  const match = Object.entries(response?.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] ?? null;
}

function retryDelayMs(response, attempt, nowMs) {
  const retryAfter = header(response, 'retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maximumRetryDelayMs, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(maximumRetryDelayMs, Math.max(0, date - nowMs));
  }
  return Math.min(30000, 250 * (2 ** Math.max(0, attempt - 1)));
}

function boundedOption(value, fallback, maximum, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`AgentOps durable spool ${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function requireAllowedTable(table) {
  if (!allowedEvidenceTables.has(table)) throw new Error('AgentOps durable evidence table is not allowlisted');
  return table;
}

function immutableEnvelopeHash(segment) {
  return sha256(canonicalJson({
    version: segment.version,
    table: segment.table,
    created_at: segment.created_at,
    expires_at: segment.expires_at,
    row_hash: segment.row_hash
  }));
}

function createDurableEvidenceSpool(options = {}) {
  const directory = path.resolve(options.directory);
  const maxBytes = boundedOption(options.maxBytes, defaultMaxBytes, maximumMaxBytes, 'maxBytes');
  const ttlMs = boundedOption(options.ttlMs, defaultTtlMs, maximumTtlMs, 'ttlMs');
  const claimLeaseMs = boundedOption(options.claimLeaseMs, defaultClaimLeaseMs, maximumClaimLeaseMs, 'claimLeaseMs');
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  ensurePrivateDirectory(directory);

  function enqueue(input, enqueueOptions = {}) {
    const row = safeEvidenceRow(input);
    const table = requireAllowedTable(enqueueOptions.table || 'AgentOpsEvents_CL');
    const createdAt = now();
    const segment = {
      version: spoolVersion,
      state: 'pending',
      table,
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(createdAt + ttlMs).toISOString(),
      attempts: 0,
      row_hash: sha256(canonicalJson(row)),
      row
    };
    segment.envelope_hash = immutableEnvelopeHash(segment);
    const body = `${canonicalJson(segment)}\n`;
    return withAdmissionLock(directory, () => {
      for (const existingFile of segmentFiles(directory).filter(file => /\.(pending|uploading)\.json$/.test(file))) {
        const existing = readJson(existingFile);
        if (existing?.table === table && existing?.row?.EventId === row.EventId
          && existing?.row_hash === segment.row_hash) {
          return {
            ok: true,
            status: 'deduplicated',
            pending: true,
            deduplicated: true,
            file: existingFile,
            event_id: row.EventId,
            row_hash: segment.row_hash
          };
        }
      }
      const projected = spoolBytes(directory) + Buffer.byteLength(body);
      if (projected > maxBytes) {
        updateCountersUnlocked(directory, { overflow: 1 });
        return { ok: false, status: 'overflow', pending: false, bytes: projected, max_bytes: maxBytes };
      }
      const name = `${String(createdAt).padStart(16, '0')}-${crypto.randomUUID()}.pending.json`;
      const file = path.join(directory, name);
      atomicWrite(file, body);
      return { ok: true, status: 'pending', pending: true, deduplicated: false, file, event_id: row.EventId, row_hash: segment.row_hash };
    });
  }

  function status() {
    const counts = { pending: 0, uploading: 0, expired: 0, quarantined: 0, acknowledged_segments: 0 };
    for (const file of segmentFiles(directory)) {
      const state = path.basename(file).match(/\.(pending|uploading|expired|quarantined|acknowledged)\.json$/)[1];
      if (state === 'acknowledged') counts.acknowledged_segments += 1;
      else counts[state] += 1;
    }
    const counters = readJson(stateFile(directory), { acknowledged: 0, overflow: 0 });
    return {
      ...counts,
      acknowledged: Number(counters.acknowledged || 0),
      overflow: Number(counters.overflow || 0),
      bytes: spoolBytes(directory),
      max_bytes: maxBytes,
      ttl_ms: ttlMs
    };
  }

  function inspectHeld(options = {}) {
    const eventId = options.eventId ? String(options.eventId) : null;
    return segmentFiles(directory)
      .filter(file => /\.(expired|quarantined)\.json$/.test(file))
      .map(file => {
        const state = path.basename(file).match(/\.(expired|quarantined)\.json$/)?.[1];
        const segment = readJson(file);
        const row = segment?.row;
        const createdAt = Date.parse(segment?.created_at);
        const expiresAt = Date.parse(segment?.expires_at);
        let integrity = 'invalid';
        try {
          const validated = safeEvidenceRow(row);
          if (segment?.version === spoolVersion && allowedEvidenceTables.has(segment?.table)
            && canonicalJson(validated) === canonicalJson(row)
            && sha256(canonicalJson(validated)) === segment?.row_hash
            && segment?.envelope_hash === immutableEnvelopeHash(segment)
            && Number.isFinite(createdAt) && Number.isFinite(expiresAt)
            && expiresAt > createdAt && expiresAt - createdAt <= maximumTtlMs) integrity = 'valid';
        } catch { /* Held-record inspection is read-only; malformed data stays held. */ }
        return {
          event_id: typeof row?.EventId === 'string' ? row.EventId : null,
          state,
          table: typeof segment?.table === 'string' ? segment.table : null,
          run_id: typeof row?.RunId === 'string' ? row.RunId : null,
          sequence: Number.isSafeInteger(row?.Sequence) ? row.Sequence : null,
          attempts: Number.isSafeInteger(segment?.attempts) ? segment.attempts : null,
          last_status: ['string', 'number'].includes(typeof segment?.last_status) ? segment.last_status : null,
          created_at: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : null,
          expires_at: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null,
          integrity,
          requeueable: state === 'quarantined' && integrity === 'valid' && expiresAt > now(),
          file: path.basename(file)
        };
      })
      .filter(item => !eventId || item.event_id === eventId);
  }

  function requeueHeld(eventId) {
    if (!eventId || typeof eventId !== 'string') throw new Error('AgentOps delivery requeue requires --event-id');
    return withAdmissionLock(directory, () => {
      const matches = segmentFiles(directory).filter(file => file.endsWith('.quarantined.json'))
        .filter(file => readJson(file)?.row?.EventId === eventId);
      if (matches.length !== 1) {
        return { ok: false, status: matches.length ? 'ambiguous' : 'not_found', event_id: eventId };
      }
      const file = matches[0];
      const segment = readJson(file);
      const createdAt = Date.parse(segment?.created_at);
      const expiresAt = Date.parse(segment?.expires_at);
      let validated;
      try { validated = safeEvidenceRow(segment?.row); } catch { validated = null; }
      const valid = segment?.version === spoolVersion && allowedEvidenceTables.has(segment?.table)
        && validated && canonicalJson(validated) === canonicalJson(segment.row)
        && sha256(canonicalJson(validated)) === segment.row_hash
        && segment.envelope_hash === immutableEnvelopeHash(segment)
        && Number.isFinite(createdAt) && Number.isFinite(expiresAt)
        && expiresAt > createdAt && expiresAt - createdAt <= maximumTtlMs;
      if (!valid) return { ok: false, status: 'invalid', event_id: eventId };
      if (expiresAt <= now()) return { ok: false, status: 'expired', event_id: eventId };

      for (const existingFile of segmentFiles(directory).filter(item => /\.(pending|uploading)\.json$/.test(item))) {
        const existing = readJson(existingFile);
        if (existing?.table === segment.table && existing?.row?.EventId === eventId) {
          if (existing.row_hash === segment.row_hash) {
            return { ok: true, status: 'already_pending', event_id: eventId };
          }
          return { ok: false, status: 'conflict', event_id: eventId };
        }
      }

      segment.state = 'pending';
      delete segment.last_status;
      const pendingFile = file.replace(/\.quarantined\.json$/, '.pending.json');
      atomicWrite(pendingFile, `${canonicalJson(segment)}\n`);
      fs.unlinkSync(file);
      fsyncDirectory(directory);
      return { ok: true, status: 'pending', event_id: eventId, run_id: validated.RunId, file: path.basename(pendingFile) };
    });
  }

  function pruneHeld(pruneOptions = {}) {
    const olderThanDays = retentionDays(pruneOptions.olderThanDays);
    const cutoff = Number(pruneOptions.now ?? now()) - olderThanDays * 24 * 60 * 60 * 1000;
    const removed = [];
    const candidates = [];
    withAdmissionLock(directory, () => {
      for (const file of segmentFiles(directory).filter(item => /\.(expired|quarantined)\.json$/.test(item))) {
        const stat = fs.lstatSync(file);
        if (stat.mtimeMs > cutoff) continue;
        const state = path.basename(file).match(/\.(expired|quarantined)\.json$/)?.[1];
        const segment = readJson(file);
        const item = {
          state,
          event_id: typeof segment?.row?.EventId === 'string' ? segment.row.EventId : null,
          held_since: new Date(stat.mtimeMs).toISOString(),
          bytes: stat.size,
          file: path.basename(file)
        };
        candidates.push(item);
        if (pruneOptions.apply) {
          fs.unlinkSync(file);
          removed.push(item);
        }
      }
      if (removed.length) fsyncDirectory(directory);
    });
    return { older_than_days: olderThanDays, applied: Boolean(pruneOptions.apply), candidates, removed };
  }

  function recoverStaleClaims(scope = {}) {
    let recovered = 0;
    for (const file of segmentFiles(directory).filter(name => name.endsWith('.uploading.json'))) {
      const segment = (scope.runId || scope.eventIds) ? readJson(file) : null;
      if ((scope.runId || scope.eventIds) && (!segment?.row
        || (scope.runId && segment.row.RunId !== scope.runId)
        || (scope.eventIds && !scope.eventIds.has(segment.row.EventId)))) continue;
      let stale = false;
      try { stale = Date.now() - fs.statSync(file).mtimeMs >= claimLeaseMs; } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!stale) continue;
      try {
        transition(file, 'pending');
        recovered += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return recovered;
  }

  function claim(file) {
    try {
      const claimed = transition(file, 'uploading');
      const time = new Date();
      fs.utimesSync(claimed, time, time);
      return claimed;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function drain(uploader, drainOptions = {}) {
    if (typeof uploader !== 'function') throw new Error('AgentOps durable spool drain requires an uploader');
    const maxAttempts = boundedOption(drainOptions.maxAttempts, 3, maximumDrainAttempts, 'maxAttempts');
    const runId = drainOptions.runId || null;
    const eventIds = Array.isArray(drainOptions.eventIds) && drainOptions.eventIds.length > 0
      ? new Set(drainOptions.eventIds)
      : null;
    const scoped = Boolean(runId || eventIds);
    const result = { acknowledged: 0, acknowledged_event_ids: [], pending: 0, expired: 0, quarantined: 0, attempts: 0, claimed: 0, scope_matched: 0, skipped_scope: 0, recovered: recoverStaleClaims({ runId, eventIds }) };
    for (const acknowledged of segmentFiles(directory).filter(name => name.endsWith('.acknowledged.json'))) {
      if (scoped) {
        const segment = readJson(acknowledged);
        if (!segment?.row || (runId && segment.row.RunId !== runId) || (eventIds && !eventIds.has(segment.row.EventId))) continue;
      }
      fs.unlinkSync(acknowledged);
    }
    for (const pendingFile of segmentFiles(directory).filter(name => name.endsWith('.pending.json'))) {
      if (scoped) {
        const candidate = readJson(pendingFile);
        const candidateRow = candidate?.row;
        if (!candidateRow
          || (runId && candidateRow.RunId !== runId)
          || (eventIds && !eventIds.has(candidateRow.EventId))) {
          result.skipped_scope += 1;
          continue;
        }
        result.scope_matched += 1;
      }
      const file = claim(pendingFile);
      if (!file) continue;
      result.claimed += 1;
      const segment = readJson(file);
      const createdAt = Date.parse(segment?.created_at);
      const expiresAt = Date.parse(segment?.expires_at);
      if (!segment || segment.version !== spoolVersion || !segment.row_hash || !segment.envelope_hash || !segment.row
        || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)
        || expiresAt <= createdAt || expiresAt - createdAt > maximumTtlMs
        || segment.envelope_hash !== immutableEnvelopeHash(segment)
        || !allowedEvidenceTables.has(segment.table)) {
        transition(file, 'quarantined');
        result.quarantined += 1;
        continue;
      }
      let validatedRow;
      try { validatedRow = safeEvidenceRow(segment.row); } catch { validatedRow = null; }
      if (!validatedRow
        || canonicalJson(validatedRow) !== canonicalJson(segment.row)
        || sha256(canonicalJson(validatedRow)) !== segment.row_hash) {
        transition(file, 'quarantined');
        result.quarantined += 1;
        continue;
      }
      if ((runId && validatedRow.RunId !== runId) || (eventIds && !eventIds.has(validatedRow.EventId))) {
        transition(file, 'pending');
        result.scope_matched -= 1;
        result.skipped_scope += 1;
        continue;
      }
      if (expiresAt <= now()) {
        transition(file, 'expired');
        result.expired += 1;
        continue;
      }
      let terminal = false;
      let heartbeatFailure = null;
      const heartbeat = setInterval(() => {
        try {
          const time = new Date();
          fs.utimesSync(file, time, time);
        } catch (error) {
          if (error.code !== 'ENOENT') heartbeatFailure = error;
        }
      }, Math.max(10, Math.floor(claimLeaseMs / 3)));
      heartbeat.unref();
      try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        result.attempts += 1;
        let response;
        try {
          response = await uploader(validatedRow, {
            table: segment.table,
            eventId: segment.row.EventId,
            rowHash: segment.row_hash,
            attempt: segment.attempts + attempt
          });
        } catch (error) {
          response = { status: 0, networkError: error.message };
        }
        const code = responseStatus(response);
        if (code >= 200 && code < 300) {
          if (typeof drainOptions.afterUploadBeforeAck === 'function') await drainOptions.afterUploadBeforeAck(segment, response);
          const acknowledged = transition(file, 'acknowledged');
          updateCounters(directory, { acknowledged: 1 });
          fs.unlinkSync(acknowledged);
          result.acknowledged += 1;
          result.acknowledged_event_ids.push(validatedRow.EventId);
          terminal = true;
          break;
        }
        if (code >= 400 && code < 500 && !retryableStatus(code)) {
          segment.state = 'quarantined';
          segment.last_status = code;
          segment.attempts += attempt;
          atomicWrite(file, `${canonicalJson(segment)}\n`);
          transition(file, 'quarantined');
          result.quarantined += 1;
          terminal = true;
          break;
        }
        if (attempt < maxAttempts) await sleep(retryDelayMs(response, attempt, now()));
        else {
          segment.attempts += attempt;
          segment.last_status = code || 'network';
          atomicWrite(file, `${canonicalJson(segment)}\n`);
        }
      }
      } finally {
        clearInterval(heartbeat);
      }
      if (heartbeatFailure && !terminal) {
        try { transition(file, 'pending'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        throw heartbeatFailure;
      }
      if (!terminal) {
        try { transition(file, 'pending'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        result.pending += 1;
      }
    }
    return { ...result, status: status() };
  }

  return { directory, drain, enqueue, inspectHeld, pruneHeld, requeueHeld, status };
}

module.exports = {
  allowedEvidenceTables,
  allowedEvidenceFields,
  boundedOption,
  canonicalJson,
  createDurableEvidenceSpool,
  retryDelayMs,
  retryableStatus,
  retentionDays,
  safeEvidenceRow
};
