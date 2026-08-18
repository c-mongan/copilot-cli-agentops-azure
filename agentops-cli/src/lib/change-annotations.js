function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function propertyValue(row = {}, key) {
  const props = row.Properties && typeof row.Properties === 'object'
    ? row.Properties
    : {};
  return row[key]
    ?? row[`agentops.custom.${key}`]
    ?? row[`agentops.${key}`]
    ?? props[key]
    ?? props[`agentops.custom.${key}`]
    ?? props[`agentops.${key}`]
    ?? '';
}

function parseDetailsValue(details, key) {
  const text = stringValue(details);
  if (!text) return '';
  const pattern = new RegExp(`${key}[=: ]+([A-Za-z0-9_.@/-]+)`);
  return pattern.exec(text)?.[1] || '';
}

function normalizeConfigChangeAnnotation(row = {}) {
  const props = row.Properties && typeof row.Properties === 'object' ? row.Properties : {};
  const eventName = stringValue(row.EventName || row.Event || row.event || props['agentops.event.name'] || props['event.name']);
  const eventType = stringValue(row.EventType || row.Type || row.type);
  const details = stringValue(row.Details || row.ResultCode || row.details || '');
  const annotationType = stringValue(propertyValue(row, 'annotation_type') || row.AnnotationType || parseDetailsValue(details, 'annotation_type'));
  const isConfigAnnotation = eventName === 'agentops.config.changed'
    || annotationType === 'config_change'
    || eventType === 'annotation'
    || details.includes('config_change');
  if (!isConfigAnnotation) return null;

  return {
    time_generated: stringValue(row.TimeGenerated || row.time || row.timestamp),
    component: stringValue(row.ChangeComponent || propertyValue(row, 'component') || propertyValue(row, 'entity.type') || row.EntityType || parseDetailsValue(details, 'component')),
    target: stringValue(row.ChangeTarget || propertyValue(row, 'target') || propertyValue(row, 'entity.id_hash') || row.EntityIdHash || parseDetailsValue(details, 'target')),
    change_type: stringValue(row.ChangeType || propertyValue(row, 'change_type') || parseDetailsValue(details, 'change_type') || 'updated'),
    change_id: stringValue(row.ChangeId || propertyValue(row, 'change_id') || parseDetailsValue(details, 'change_id')),
    version: stringValue(row.Version || propertyValue(row, 'version') || parseDetailsValue(details, 'version')),
    run_id: stringValue(row.RunId || propertyValue(row, 'run.id')),
    session_id: stringValue(row.SessionId || propertyValue(row, 'session.id') || props['gen_ai.conversation.id']),
    trace_id: stringValue(row.TraceId || propertyValue(row, 'trace.id')),
    event_name: eventName || 'agentops.config.changed'
  };
}

function annotationMatchesRun(annotation, run = {}) {
  if (!annotation) return false;
  if (annotation.run_id && run.RunId && annotation.run_id === run.RunId) return true;
  if (annotation.session_id && run.SessionId && annotation.session_id === run.SessionId) return true;
  if (annotation.trace_id && run.TraceId && annotation.trace_id === run.TraceId) return true;
  return false;
}

function changeAnnotationsForRun(events = [], run = {}) {
  return events
    .map(normalizeConfigChangeAnnotation)
    .filter(annotation => annotationMatchesRun(annotation, run))
    .slice(0, 10);
}

function configChangeAnnotationsForSession(events = [], session) {
  const normalizedSession = String(session || '').trim();
  if (!normalizedSession) return [];
  return events
    .map(normalizeConfigChangeAnnotation)
    .filter(annotation => annotation && annotation.session_id === normalizedSession)
    .slice(0, 10);
}

function changeRef(annotation = {}) {
  return [annotation.component, annotation.target].filter(Boolean).join(':');
}

module.exports = {
  annotationMatchesRun,
  changeAnnotationsForRun,
  changeRef,
  configChangeAnnotationsForSession,
  normalizeChangeAnnotation: normalizeConfigChangeAnnotation,
  normalizeConfigChangeAnnotation,
  parseDetailsValue,
  propertyValue,
  stringValue
};
