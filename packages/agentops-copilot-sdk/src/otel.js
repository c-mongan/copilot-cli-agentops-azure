const crypto = require('node:crypto');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function traceIdHex(seed) {
  if (!seed) return randomHex(16);
  if (/^[a-f0-9]{32}$/i.test(String(seed))) return String(seed).toLowerCase();
  return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 32);
}

function createTraceContext(traceId = randomHex(16)) {
  return {
    traceparent: `00-${traceId}-${randomHex(8)}-01`
  };
}

function createTelemetryConfig(options = {}) {
  if (options.captureContent === true) {
    throw new Error('AgentOps does not support SDK content capture; captureContent must remain false');
  }
  const config = {
    otlpEndpoint: options.otlpEndpoint || 'http://localhost:4318',
    exporterType: options.exporterType || 'otlp-http',
    sourceName: options.sourceName || options.serviceName || 'agentops-copilot-sdk',
    captureContent: false
  };
  if (options.otlpProtocol) config.otlpProtocol = options.otlpProtocol;
  if (options.filePath) config.filePath = options.filePath;
  return config;
}

function createTraceContextCallback(existing, traceSeed) {
  const traceId = traceIdHex(traceSeed);
  return () => {
    const base = typeof existing === 'function' ? existing() : {};
    return {
      ...createTraceContext(traceId),
      ...(base || {})
    };
  };
}

module.exports = {
  createTelemetryConfig,
  createTraceContext,
  createTraceContextCallback,
  traceIdHex
};
