function rowAttributes(row) {
  const attrs = row.attributes || row.Properties || row.properties || {};
  if (typeof attrs !== 'string') return attrs;

  try {
    return JSON.parse(attrs);
  } catch {
    return {};
  }
}

function attributeValue(attrs, keys) {
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== '') return attrs[key];
  }
  return null;
}

function numberAttribute(attrs, keys) {
  const value = attributeValue(attrs, keys);
  if (value === null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function booleanAttribute(attrs, keys) {
  const value = attributeValue(attrs, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function operationFromRow(row, attrs) {
  return row.operation
    || row.EventName
    || row.SpanName
    || attributeValue(attrs, ['gen_ai.operation.name', 'operation'])
    || row.name
    || 'unknown';
}

function telemetryTime(value) {
  if (Array.isArray(value) && value.length >= 1) {
    const seconds = Number(value[0]);
    const nanos = Number(value[1] || 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) {
      return new Date((seconds * 1000) + (nanos / 1e6)).toISOString();
    }
  }
  return value || null;
}

function isSpanTelemetryRow(row) {
  return !row.type || row.type === 'span';
}

function sessionFromRow(row, attrs) {
  return row.session
    || row.SessionId
    || row.session_id
    || row.Session
    || row.conversation
    || attributeValue(attrs, ['gen_ai.conversation.id', 'github.copilot.interaction_id', 'conversation'])
    || 'unknown-session';
}

function isFailedRow(row, attrs) {
  const success = row.Success ?? row.success;
  const status = row.Status ?? row.status ?? row.OutcomeStatus;
  const statusCode = row.status?.code || row.statusCode || row.ResultCode || row.resultCode;
  const error = attributeValue(attrs, ['error.type', 'exception.type', 'error']);

  if (success === false || (typeof success === 'string' && success.toLowerCase() === 'false')) return true;
  if (['failed', 'failure', 'error', 'blocked', 'degraded'].includes(String(status || '').toLowerCase())) return true;
  if (String(statusCode || '').toUpperCase() === 'ERROR') return true;
  return Boolean(error);
}

module.exports = {
  attributeValue,
  booleanAttribute,
  isFailedRow,
  isSpanTelemetryRow,
  numberAttribute,
  operationFromRow,
  rowAttributes,
  sessionFromRow,
  telemetryTime
};
