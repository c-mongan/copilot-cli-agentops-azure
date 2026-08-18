const crypto = require('node:crypto');
const { createSafeEventNormalizer, otelAttributeMap } = require('./event-envelope');

function hexId(value, bytes) {
  return crypto.createHash('sha256').update(String(value || crypto.randomUUID())).digest('hex').slice(0, bytes * 2);
}

function attribute(value) {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
  return { stringValue: String(value) };
}

function safeEndpoint(value) {
  const endpoint = new URL(value || 'http://localhost:4318');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    throw new Error('AgentOps ordered-event OTLP requires HTTPS or a loopback HTTP endpoint');
  }
  const path = endpoint.pathname.replace(/\/$/, '');
  return `${endpoint.origin}${path.endsWith('/v1/traces') ? path : `${path}/v1/traces`}`;
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createOtlpJsonExporter(options = {}) {
  const endpoint = safeEndpoint(options.otlpEndpoint);
  const sourceName = String(options.sourceName || 'agentops-copilot-sdk').slice(0, 200);
  const pending = new Set();
  const deliveryFailures = [];
  const normalizeEvent = createSafeEventNormalizer();
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts) || 3));
  const retryDelayMs = Math.max(0, Math.min(5000, Number(options.retryDelayMs ?? 100)));
  const maxPendingEvents = Math.max(1, Math.min(10000, Number(options.maxPendingEvents) || 1000));
  const delivery = {
    queuedInMemory: 0,
    collectorAccepted: 0,
    retryAttempts: 0,
    terminalFailures: 0,
    queueOverflowed: 0,
    lastCollectorAcceptedAt: null
  };
  let activeFlush = null;

  async function send(payload) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(options.timeoutMs || 5000)
        });
        if (response.ok) return;
        const error = new Error(`AgentOps OTLP export failed with HTTP ${response.status}`);
        error.retryable = retryableStatus(response.status);
        if (!error.retryable || attempt === maxAttempts) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
        if (error.retryable === false || attempt === maxAttempts) throw error;
      }
      delivery.retryAttempts += 1;
      await wait(retryDelayMs * attempt);
    }
    throw lastError;
  }

  function emit(row = {}) {
    row = normalizeEvent(row);
    if (pending.size >= maxPendingEvents) {
      const error = new Error(`AgentOps telemetry queue is full (${maxPendingEvents} pending events)`);
      delivery.queueOverflowed += 1;
      delivery.terminalFailures += 1;
      deliveryFailures.push(error);
      if (typeof options.onError === 'function') options.onError(error);
      return row;
    }
    const time = new Date(row.TimeGenerated || Date.now());
    const startMs = Number.isNaN(time.getTime()) ? Date.now() : time.getTime();
    const durationMs = Math.max(0, Number(row.DurationMs) || 0);
    const traceId = hexId(row.TraceId || row.RunId, 16);
    const spanId = hexId(row.EventId, 8);
    const attributes = [];
    for (const [field, key] of Object.entries(otelAttributeMap)) {
      const value = row[field];
      if (value === undefined || value === null || value === '') continue;
      attributes.push({ key, value: attribute(value) });
    }
    attributes.push({ key: 'gen_ai.operation.name', value: { stringValue: String(row.EventName || 'agentops.event').slice(0, 200) } });
    if (row.SessionId) attributes.push({ key: 'gen_ai.conversation.id', value: { stringValue: String(row.SessionId).slice(0, 200) } });

    const payload = {
      resourceSpans: [{
        resource: { attributes: [
          { key: 'service.name', value: { stringValue: sourceName } },
          { key: 'agent.framework', value: { stringValue: 'github-copilot-sdk' } },
          { key: 'agent.runtime', value: { stringValue: 'nodejs' } }
        ] },
        scopeSpans: [{
          scope: { name: '@agentops/copilot-sdk', version: '0.1.0' },
          spans: [{
            traceId,
            spanId,
            ...(row.ParentEventId ? { parentSpanId: hexId(row.ParentEventId, 8) } : {}),
            name: String(row.SpanName || row.EventName || 'agentops.event').slice(0, 200),
            kind: 1,
            startTimeUnixNano: String(BigInt(startMs) * 1000000n),
            endTimeUnixNano: String(BigInt(startMs + durationMs) * 1000000n),
            attributes,
            status: { code: row.Status === 'failed' ? 2 : 1 }
          }]
        }]
      }]
    };

    const request = send(payload).then(
      () => {
        // This proves only that the configured OTLP HTTP endpoint returned a
        // successful response. It does not prove downstream or Azure ingestion.
        delivery.collectorAccepted += 1;
        delivery.lastCollectorAcceptedAt = new Date().toISOString();
        return { ok: true };
      },
      error => {
        if (typeof options.onError === 'function') options.onError(error);
        delivery.terminalFailures += 1;
        deliveryFailures.push(error);
        return { ok: false, error };
      }
    ).finally(() => pending.delete(request));
    pending.add(request);
    delivery.queuedInMemory += 1;
    return row;
  }

  async function drain() {
    while (pending.size) await Promise.all([...pending]);
    const failures = deliveryFailures.splice(0);
    if (failures.length) {
      throw new AggregateError(failures, `AgentOps failed to export ${failures.length} telemetry request(s)`);
    }
    return deliveryStatus();
  }

  function flush() {
    if (!activeFlush) activeFlush = drain().finally(() => { activeFlush = null; });
    return activeFlush;
  }

  function deliveryStatus() {
    return { ...delivery, pendingInMemory: pending.size, maxPendingEvents };
  }

  return { emit, flush, deliveryStatus, endpoint };
}

module.exports = { createOtlpJsonExporter, retryableStatus, safeEndpoint };
