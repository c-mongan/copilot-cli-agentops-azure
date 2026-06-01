const crypto = require('node:crypto');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function createTraceContext() {
  return {
    traceparent: `00-${randomHex(16)}-${randomHex(8)}-01`
  };
}

function createTelemetryConfig(options = {}) {
  return {
    otlpEndpoint: options.otlpEndpoint || 'http://localhost:4318',
    exporterType: options.exporterType || 'otlp-http',
    sourceName: options.sourceName || 'agentops-copilot-sdk',
    captureContent: options.captureContent === true
  };
}

function createTraceContextCallback(existing) {
  return () => {
    const base = typeof existing === 'function' ? existing() : {};
    return {
      ...createTraceContext(),
      ...(base || {})
    };
  };
}

module.exports = {
  createTelemetryConfig,
  createTraceContext,
  createTraceContextCallback
};
