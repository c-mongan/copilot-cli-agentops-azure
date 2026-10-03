'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function runtime(name) {
  const bundled = fs.existsSync(path.join(__dirname, '../runtime/package.json'));
  const modules = bundled ? {
    'azure/logs-ingestion-upload': () => require('../runtime/src/lib/azure/logs-ingestion-upload'),
    'azure/durable-evidence-spool': () => require('../runtime/src/lib/azure/durable-evidence-spool'),
    'copilot/delivery-limits': () => require('../runtime/src/lib/copilot/delivery-limits'),
    'copilot/session-otel': () => require('../runtime/src/lib/copilot/session-otel'),
    'copilot/session-delivery-outbox': () => require('../runtime/src/lib/copilot/session-delivery-outbox')
  } : {
    'azure/logs-ingestion-upload': () => require('../../../agentops-cli/src/lib/azure/logs-ingestion-upload'),
    'azure/durable-evidence-spool': () => require('../../../agentops-cli/src/lib/azure/durable-evidence-spool'),
    'copilot/delivery-limits': () => require('../../../agentops-cli/src/lib/copilot/delivery-limits'),
    'copilot/session-otel': () => require('../../../agentops-cli/src/lib/copilot/session-otel'),
    'copilot/session-delivery-outbox': () => require('../../../agentops-cli/src/lib/copilot/session-delivery-outbox')
  };
  return modules[name]();
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const mode = 'native-metadata-events-only';
const maximumIds = 10000;
const operations = new Set(['invoke_agent', 'chat', 'generate_content', 'execute_tool']);

// Project onto the existing event-table contract. This is deliberately not a
// full span-table export. Arbitrary tool/model/span names cannot carry content.
function nativeMetadataEvents(spans) {
  const rows = [];
  let rejected = 0;
  for (const span of spans) {
    if (!/^[a-f0-9]{32}$/i.test(span.traceId || '') || !/^[a-f0-9]{16}$/i.test(span.spanId || '')
      || !span.sessionId || !Number.isFinite(span.start) || !Number.isFinite(span.end)
      || !Number.isFinite(new Date(span.start).getTime()) || span.end < span.start) { rejected++; continue; }
    const traceId = span.traceId.toLowerCase();
    const identity = `${traceId}:${span.spanId.toLowerCase()}`;
    const operation = operations.has(span.operation) ? span.operation : 'unknown';
    const row = {
      TimeGenerated: new Date(span.start).toISOString(),
      RunId: `native_${hash(`${span.sessionId}:${traceId}`).slice(0, 32)}`,
      SessionId: `session_${hash(span.sessionId).slice(0, 32)}`,
      TraceId: traceId,
      Sequence: parseInt(hash(identity).slice(0, 12), 16) + 1,
      EventId: `native_${hash(identity).slice(0, 32)}`,
      EventName: 'native.span.observed', SpanName: operation,
      Surface: 'native-otel', Status: span.failed ? 'failed' : 'unknown',
      PrivacyMode: 'strict', ContentCaptureMode: 'off', SchemaVersion: '2'
    };
    const duration = Math.round(span.end - span.start);
    if (Number.isSafeInteger(duration) && duration >= 0) row.DurationMs = duration;
    // Native root spans can repeat aggregate counts. Only observed LLM spans
    // contribute token measures. Absent or invalid values remain absent.
    if (['chat', 'generate_content'].includes(operation)) {
      for (const [field, key] of Object.entries({ InputTokens: 'inputTokens', OutputTokens: 'outputTokens',
        CacheReadTokens: 'cacheReadTokens', CacheWriteTokens: 'cacheWriteTokens' })) {
        if (Number.isSafeInteger(span[key]) && span[key] >= 0) row[field] = span[key];
      }
    }
    rows.push(row);
  }
  return { rows: [...new Map(rows.map(row => [row.EventId, row])).values()], rejected };
}

function createNativeAzureDelivery(options = {}) {
  if (options.publishingApproved !== true) throw new Error('Azure publishing requires explicit destination approval.');
  if (typeof options.tokenProvider !== 'function') throw new Error('Azure publishing requires an identity provider.');
  const { createDurableLogsIngestionUploader, validatedPublicLogsEndpoint } = runtime('azure/logs-ingestion-upload');
  const { configuredDeliveryLimits, readPrivateFile } = runtime('copilot/delivery-limits');
  const { createDurableEvidenceSpool } = runtime('azure/durable-evidence-spool');
  const { readOtelSpansFromText } = runtime('copilot/session-otel');
  const { claimSessionOutbox, releaseSessionOutboxClaim } = runtime('copilot/session-delivery-outbox');
  if (typeof options.storage !== 'string' || !path.isAbsolute(options.storage)) throw new Error('Azure publishing requires absolute private storage.');
  const storage = fs.lstatSync(options.storage);
  if (!storage.isDirectory() || storage.isSymbolicLink()
    || (typeof process.getuid === 'function' && storage.uid !== process.getuid())) throw new Error('Azure publishing requires owner-owned private storage.');
  const deliveryOptions = { ...options, authenticationMode: 'embedded', agentopsHome: options.storage, env: {} };
  // Validate consent, destination and byte budget before reading a receipt.
  const uploader = createDurableLogsIngestionUploader(deliveryOptions);
  const endpoint = validatedPublicLogsEndpoint(options.endpoint);
  const targetId = hash(JSON.stringify([options.expectedSubscriptionId.toLowerCase(), endpoint, options.dcrImmutableId]));
  const directory = path.join(options.storage, 'azure-outbox', targetId);
  const limits = configuredDeliveryLimits(deliveryOptions);
  const spool = createDurableEvidenceSpool({ directory, maxBytes: limits.maxQueueBytes, ttlMs: limits.ttlMs, sleep: options.sleep });
  const journalFile = path.join(directory, 'native-admissions.json');
  let busy = false;

  function journal() {
    if (!fs.existsSync(journalFile)) return new Set();
    const saved = JSON.parse(readPrivateFile(journalFile, 1024 * 1024));
    if (!Array.isArray(saved) || saved.length > maximumIds || saved.some(id => !/^native_[a-f0-9]{32}$/.test(id))) {
      throw new Error('Native publishing admission journal is invalid.');
    }
    return new Set(saved);
  }
  function saveJournal(ids) {
    const temp = path.join(directory, `native-admissions-${crypto.randomUUID()}.tmp`);
    try {
      const descriptor = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify([...ids])); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temp, journalFile);
      if (process.platform !== 'win32') {
        const descriptor = fs.openSync(directory, 'r');
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      }
    } finally { fs.rmSync(temp, { force: true }); }
  }

  return {
    status() { return { mode, ...spool.status(), admissionLimit: maximumIds }; },
    async publishReceipt(file) {
      if (busy) throw new Error('Native Azure publishing is already in progress.');
      busy = true;
      let claim;
      try {
        claim = claimSessionOutbox(directory);
        if (!claim.acquired) throw new Error('Native Azure publishing is already in progress.');
        const parsed = readOtelSpansFromText(readPrivateFile(file, 16 * 1024 * 1024));
        if (parsed.spans.length > maximumIds) throw new Error('Native receipt exceeds the span admission limit.');
        const projected = nativeMetadataEvents(parsed.spans);
        const ids = journal();
        let admitted = 0, duplicate = 0, refused = 0;
        for (const row of projected.rows) {
          if (ids.has(row.EventId)) { duplicate++; continue; }
          if (ids.size >= maximumIds) { refused++; continue; }
          const result = spool.enqueue(row);
          if (!result.ok) { refused++; continue; }
          ids.add(row.EventId); admitted++;
        }
        // Durable admission markers precede drain, so refreshing a receipt
        // cannot replay already acknowledged rows. Admission limits fail
        // closed; they never evict markers and silently replay old data.
        saveJournal(ids);
        const delivery = await spool.drain(uploader, { maxAttempts: 1 });
        return { mode, admitted, duplicate, refused, rejected: projected.rejected,
          invalid: parsed.invalid, acknowledged: delivery.acknowledged,
          status: spool.status(), coverage: 'unknown', outcome: 'unknown' };
      } finally {
        if (claim?.acquired) releaseSessionOutboxClaim(claim);
        busy = false;
      }
    }
  };
}

module.exports = { createNativeAzureDelivery, nativeMetadataEvents };
