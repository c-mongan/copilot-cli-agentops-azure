const crypto = require('node:crypto');
const fs = require('node:fs');
const { otlpHttpEndpoint } = require('./collector-endpoints');
const { durationToMs, optionValue, optionValues, parseLastArg } = require('./cli-options');
const { escapeKqlString, validateKqlDuration } = require('./kql');
const { readJsonlRows } = require('./json');
const { postJson } = require('./smoke');

const customAttributePrefixes = ['agentops.', 'gen_ai.', 'github.copilot.', 'content.capture.', 'event.', 'error.'];

function otlpAttr(key, value) {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function parseKeyValues(values, prefix) {
  const attrs = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error(`Expected ${prefix} value as key=value`);
    const key = value.slice(0, separator).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(`Invalid ${prefix} key: ${key}`);
    attrs[`${prefix}.${key}`] = value.slice(separator + 1);
  }
  return attrs;
}

function parseTelemetryAttributes(values) {
  const attrs = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0) throw new Error('Expected attribute value as key=value');
    const key = value.slice(0, separator).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error(`Invalid attribute key: ${key}`);
    if (!customAttributePrefixes.some(prefix => key.startsWith(prefix))) {
      throw new Error(`Unsupported attribute key: ${key}`);
    }
    attrs[key] = value.slice(separator + 1);
  }
  return attrs;
}

function customAttributeKey(key) {
  return key.startsWith('agentops.custom.') ? key : `agentops.custom.${key}`;
}

function parseCustomArgs(args) {
  const [subcommand, ...rest] = args;
  const scoreText = optionValue(rest, ['--score']);
  const score = scoreText === null ? null : Number(scoreText);
  if (scoreText !== null && !Number.isFinite(score)) throw new Error('--score must be a number');

  return {
    subcommand,
    file: subcommand === 'import' ? rest[0] : null,
    event: optionValue(rest, ['--event', '--name']),
    agent: optionValue(rest, ['--agent']),
    parentAgent: optionValue(rest, ['--parent-agent']),
    delegationId: optionValue(rest, ['--delegation-id']),
    workflow: optionValue(rest, ['--workflow']),
    step: optionValue(rest, ['--step']),
    outcome: optionValue(rest, ['--outcome']),
    risk: optionValue(rest, ['--risk']),
    score,
    entityType: optionValue(rest, ['--entity-type']),
    entityIdHash: optionValue(rest, ['--entity-id-hash']),
    session: optionValue(rest, ['--session']),
    endpoint: optionValue(rest, ['--endpoint']),
    runtime: optionValue(rest, ['--runtime']) || process.env.AGENTOPS_RUNTIME || 'github-copilot-cli',
    framework: optionValue(rest, ['--framework']) || process.env.AGENTOPS_FRAMEWORK || 'github-copilot',
    tags: optionValues(rest, '--tag'),
    custom: parseKeyValues(optionValues(rest, '--custom'), 'agentops.custom'),
    attributes: parseTelemetryAttributes([
      ...optionValues(rest, '--attribute'),
      ...optionValues(rest, '--attr')
    ]),
    dryRun: rest.includes('--dry-run'),
    verify: !rest.includes('--no-verify'),
    last: parseLastArg(rest, '2h'),
    waitMs: durationToMs(optionValue(rest, ['--wait']), 60000),
    pollMs: durationToMs(optionValue(rest, ['--poll']), 10000),
    json: rest.includes('--json')
  };
}

function parseAnnotationArgs(args) {
  const [subcommand, ...rest] = args;
  return {
    subcommand,
    component: optionValue(rest, ['--component']),
    target: optionValue(rest, ['--target', '--name']),
    changeType: optionValue(rest, ['--change-type', '--type']) || 'updated',
    changeId: optionValue(rest, ['--change-id']),
    version: optionValue(rest, ['--version']),
    runId: optionValue(rest, ['--run-id']),
    session: optionValue(rest, ['--session', '--session-id']),
    traceId: optionValue(rest, ['--trace-id']),
    agent: optionValue(rest, ['--agent']) || 'agentops',
    risk: optionValue(rest, ['--risk']),
    endpoint: optionValue(rest, ['--endpoint']),
    runtime: optionValue(rest, ['--runtime']) || process.env.AGENTOPS_RUNTIME || 'github-copilot-cli',
    framework: optionValue(rest, ['--framework']) || process.env.AGENTOPS_FRAMEWORK || 'github-copilot',
    dryRun: rest.includes('--dry-run'),
    verify: !rest.includes('--no-verify'),
    last: parseLastArg(rest, '2h'),
    waitMs: durationToMs(optionValue(rest, ['--wait']), 60000),
    pollMs: durationToMs(optionValue(rest, ['--poll']), 10000),
    json: rest.includes('--json')
  };
}

function customEventId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-custom-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function rowAttributes(row) {
  const attrs = row.attributes || row.Properties || row.properties || {};
  if (typeof attrs !== 'string') return attrs;

  try {
    return JSON.parse(attrs);
  } catch {
    return {};
  }
}

function normalizeCustomEvent(row = {}, defaults = {}, index = 0) {
  const attrs = rowAttributes(row);
  const custom = {
    ...(row.custom || {}),
    ...(row.metrics || {})
  };
  const attributes = {
    ...(row.attributes || {}),
    ...(row.attrs || {})
  };
  const event = row.event || row.event_name || row.name || attrs['agentops.event.name'] || attrs['event.name'] || defaults.event || 'agent.event';
  const agent = row.agent || row.agent_name || attrs['agentops.agent.name'] || attrs['gen_ai.agent.name'] || defaults.agent || 'custom-agent';
  const parentAgent = row.parentAgent || row.parent_agent || attrs['agentops.parent_agent.name'] || defaults.parentAgent || null;
  const delegationId = row.delegationId || row.delegation_id || attrs['agentops.delegation.id'] || defaults.delegationId || null;
  const workflow = row.workflow || row.workflow_name || attrs['agentops.workflow.name'] || defaults.workflow || null;
  const step = row.step || row.step_name || attrs['agentops.step.name'] || null;
  const session = row.session || row.session_id || row.conversation_id || attrs['gen_ai.conversation.id'] || defaults.session || null;

  return {
    event,
    agent,
    parentAgent,
    delegationId,
    workflow,
    step,
    session,
    outcome: row.outcome || attrs['agentops.outcome'] || null,
    risk: row.risk || attrs['agentops.risk'] || null,
    score: row.score === undefined || row.score === null ? null : Number(row.score),
    entityType: row.entityType || row.entity_type || attrs['agentops.entity.type'] || null,
    entityIdHash: row.entityIdHash || row.entity_id_hash || attrs['agentops.entity.id_hash'] || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom: {
      ...Object.fromEntries(Object.entries(custom).map(([key, value]) => [customAttributeKey(key), value])),
      'agentops.custom.row_index': index
    },
    attributes: parseTelemetryAttributes(
      Object.entries(attributes).map(([key, value]) => `${key}=${value}`)
    )
  };
}

function customEventAttributes(event, defaults = {}) {
  if (!event.event) throw new Error('custom event requires --event');
  if (!event.agent) throw new Error('custom event requires --agent');

  const attrs = {
    'agentops.custom_event_id': defaults.id,
    'agentops.schema.version': '1',
    'agentops.event.kind': 'agent.event',
    'agentops.event.name': event.event,
    'gen_ai.operation.name': event.event,
    'gen_ai.agent.name': event.agent,
    'agentops.agent.name': event.agent,
    'gen_ai.conversation.id': event.session || defaults.session || defaults.id,
    'content.capture.enabled': false,
    ...event.custom,
    ...event.attributes
  };
  if (event.workflow) attrs['agentops.workflow.name'] = event.workflow;
  if (event.parentAgent) attrs['agentops.parent_agent.name'] = event.parentAgent;
  if (event.delegationId) attrs['agentops.delegation.id'] = event.delegationId;
  if (event.step) attrs['agentops.step.name'] = event.step;
  if (event.outcome) attrs['agentops.outcome'] = event.outcome;
  if (event.risk) attrs['agentops.risk'] = event.risk;
  if (event.score !== null && event.score !== undefined && Number.isFinite(event.score)) attrs['agentops.score'] = event.score;
  if (event.entityType) attrs['agentops.entity.type'] = event.entityType;
  if (event.entityIdHash) attrs['agentops.entity.id_hash'] = event.entityIdHash;
  if (event.tags?.length) attrs['agentops.tags'] = event.tags.join(',');
  return Object.entries(attrs).map(([key, value]) => otlpAttr(key, value));
}

function otlpCustomEventPayload(events, options = {}) {
  const id = options.id || customEventId(options.now);
  const traceId = crypto.randomBytes(16).toString('hex');
  const start = BigInt(options.nowMs || Date.now()) * 1000000n;
  const normalized = events.map((event, index) => normalizeCustomEvent(event, { ...options, id }, index));
  const spans = normalized.map((event, index) => {
    const spanStart = start + BigInt(index * 10) * 1000000n;
    return {
      traceId,
      spanId: crypto.randomBytes(8).toString('hex'),
      name: `agentops.custom.${event.event}`,
      kind: 1,
      startTimeUnixNano: spanStart.toString(),
      endTimeUnixNano: (spanStart + 10000000n).toString(),
      attributes: customEventAttributes(event, { ...options, id }),
      status: { code: event.outcome === 'failed' ? 2 : 1 }
    };
  });

  return {
    id,
    normalized,
    payload: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              otlpAttr('service.name', options.serviceName || 'github-copilot-cli'),
              otlpAttr('service.namespace', 'copilot-agentops'),
              otlpAttr('agent.framework', options.framework || 'github-copilot'),
              otlpAttr('agent.runtime', options.runtime || 'github-copilot-cli'),
              otlpAttr('agentops.profile', 'custom-event'),
              otlpAttr('agentops.custom_event_id', id)
            ]
          },
          scopeSpans: [
            {
              scope: { name: 'agentops.custom-event', version: '0.1.0' },
              spans
            }
          ]
        }
      ]
    }
  };
}

function customAzureQuery(id, last = '2h') {
  const lookback = validateKqlDuration(last);
  const escapedId = escapeKqlString(id);
  return `AppDependencies\n| where TimeGenerated > ago(${lookback})\n| where Properties has "${escapedId}"\n| extend Event=tostring(Properties["agentops.event.name"]), Agent=tostring(Properties["agentops.agent.name"]), Workflow=tostring(Properties["agentops.workflow.name"]), Step=tostring(Properties["agentops.step.name"])\n| project TimeGenerated, Name, Event, Agent, Workflow, Step, OperationId, Success, Properties\n| order by TimeGenerated desc\n| take 50`;
}

async function agentopsCustomEmit(options = {}) {
  const endpoint = (options.endpoint || otlpHttpEndpoint).replace(/\/$/, '');
  const id = options.id || customEventId(options.now);
  const event = {
    event: options.event,
    agent: options.agent,
    parentAgent: options.parentAgent,
    delegationId: options.delegationId,
    workflow: options.workflow,
    step: options.step,
    session: options.session,
    outcome: options.outcome,
    risk: options.risk,
    score: options.score,
    entityType: options.entityType,
    entityIdHash: options.entityIdHash,
    tags: options.tags || [],
    custom: options.custom || {},
    attributes: options.attributes || {}
  };
  const { normalized, payload } = otlpCustomEventPayload([event], { ...options, id });
  const result = {
    ok: true,
    custom_event_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    verify: options.verify !== false,
    workspace_id: options.workspaceId || options.defaultWorkspaceId,
    azure_query: customAzureQuery(id, options.last || '2h'),
    events: normalized,
    payload_preview: {
      event: normalized[0].event,
      agent: normalized[0].agent,
      workflow: normalized[0].workflow,
      step: normalized[0].step,
      content_capture_enabled: false
    }
  };
  if (options.dryRun) return result;

  const response = await (options.postJson || postJson)(`${endpoint}/v1/traces`, payload, options);
  return {
    ...result,
    ok: response.ok,
    collector_response: response,
    next: response.ok
      ? ['node agentops-cli/src/index.js attribution --last 2h', 'Open Grafana: AgentOps Attribution or Runtime Events.']
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

async function agentopsAnnotationConfigChange(options = {}) {
  if (!options.component) throw new Error('annotation config-change requires --component');
  if (!options.target) throw new Error('annotation config-change requires --target');

  const custom = {
    'agentops.custom.annotation_type': 'config_change',
    'agentops.custom.component': options.component,
    'agentops.custom.target': options.target,
    'agentops.custom.change_type': options.changeType || 'updated'
  };
  if (options.changeId) custom['agentops.custom.change_id'] = options.changeId;
  if (options.version) custom['agentops.custom.version'] = options.version;

  const attributes = {
    ...(options.runId ? { 'agentops.run.id': options.runId } : {}),
    ...(options.traceId ? { 'agentops.trace.id': options.traceId } : {})
  };

  return agentopsCustomEmit({
    ...options,
    event: 'agentops.config.changed',
    workflow: 'config-change',
    step: options.component,
    outcome: 'changed',
    entityType: options.component,
    entityIdHash: options.target,
    tags: ['annotation', 'config-change'],
    custom,
    attributes
  });
}

function importJsonl(filePath) {
  const rows = readJsonlRows(filePath);
  const operations = new Map();

  for (const row of rows) {
    const operation = row.name || row.operation || row.attributes?.['gen_ai.operation.name'] || 'unknown';
    operations.set(operation, (operations.get(operation) || 0) + 1);
  }

  return {
    file: filePath,
    rows: rows.length,
    operations: Object.fromEntries(operations)
  };
}

async function agentopsCustomImport(filePath, options = {}) {
  const rows = readJsonlRows(filePath);
  const endpoint = (options.endpoint || otlpHttpEndpoint).replace(/\/$/, '');
  const id = options.id || customEventId(options.now);
  const events = rows.map((row, index) => normalizeCustomEvent(row, { ...options, id }, index));
  const { payload } = otlpCustomEventPayload(events, { ...options, id });
  const result = {
    ok: true,
    file: filePath,
    rows: rows.length,
    custom_event_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    workspace_id: options.workspaceId || options.defaultWorkspaceId,
    azure_query: customAzureQuery(id, options.last || '2h'),
    events: events.slice(0, 5)
  };
  if (options.dryRun) return result;

  const response = await (options.postJson || postJson)(`${endpoint}/v1/traces`, payload, options);
  return {
    ...result,
    ok: response.ok,
    collector_response: response,
    next: response.ok
      ? ['node agentops-cli/src/index.js attribution --last 2h', 'Open Grafana: AgentOps Attribution or Runtime Events.']
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

function createCustomTelemetryContext(dependencies = {}) {
  const { defaultWorkspaceId } = dependencies;
  const emit = agentopsCustomEmit;
  const annotationConfigChange = agentopsAnnotationConfigChange;
  const customImport = agentopsCustomImport;

  return {
    agentopsCustomEmit(options = {}) {
      return emit({ defaultWorkspaceId, ...options });
    },
    agentopsAnnotationConfigChange(options = {}) {
      return annotationConfigChange({ defaultWorkspaceId, ...options });
    },
    agentopsCustomImport(filePath, options = {}) {
      return customImport(filePath, { defaultWorkspaceId, ...options });
    },
    importJsonl
  };
}

function renderCustom(result) {
  const lines = [
    'AgentOps custom telemetry',
    '',
    `Custom event id: ${result.custom_event_id}`,
    `Endpoint: ${result.endpoint}`,
    `Mode: ${result.dry_run ? 'dry-run' : 'sent'}`,
    `Events: ${result.events.length}`
  ];
  for (const event of result.events.slice(0, 5)) {
    lines.push(`- ${event.event} agent=${event.agent}${event.workflow ? ` workflow=${event.workflow}` : ''}${event.step ? ` step=${event.step}` : ''}`);
  }
  if (result.collector_response) {
    lines.push(result.collector_response.ok
      ? `Collector response: ${result.collector_response.statusCode || 'ok'}.`
      : `Collector response: failed (${result.collector_response.error || result.collector_response.statusCode || 'unknown'}).`);
  }
  lines.push('', 'Azure query:', result.azure_query);
  if (result.next?.length) {
    lines.push('', 'Next:');
    for (const item of result.next) lines.push(`- ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  agentopsAnnotationConfigChange,
  agentopsCustomEmit,
  agentopsCustomImport,
  createCustomTelemetryContext,
  customAzureQuery,
  customEventAttributes,
  customEventId,
  customAttributeKey,
  importJsonl,
  normalizeCustomEvent,
  otlpAttr,
  otlpCustomEventPayload,
  parseAnnotationArgs,
  parseCustomArgs,
  parseKeyValues,
  parseTelemetryAttributes,
  renderCustom
};
