const crypto = require('node:crypto');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function createTraceContext() {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`
  };
}

function injectTraceContext(message, context = createTraceContext()) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { message, context, injected: false };
  const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
    ? { ...message.params }
    : {};
  const meta = params._meta && typeof params._meta === 'object' && !Array.isArray(params._meta)
    ? { ...params._meta }
    : {};

  if (!meta.traceparent) meta.traceparent = context.traceparent;
  return {
    message: {
      ...message,
      params: {
        ...params,
        _meta: meta
      }
    },
    context,
    injected: true
  };
}

module.exports = {
  createTraceContext,
  injectTraceContext
};
