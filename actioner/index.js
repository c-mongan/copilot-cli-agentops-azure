const crypto = require('node:crypto');

const { createAlerts } = require('../agentops-cli/src/alerts');
const { validateRecommendationRow } = require('../agentops-cli/src/lib/schema/recommendation-schema');

const alertRuleNames = new Set([
  'high-aiu',
  'cost-spike',
  'runaway-tool-loop',
  'failed-spans',
  'content-capture'
]);

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

const sharedWriteTables = new Set([
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL'
]);

const sharedWriteRequiredColumns = {
  AgentOpsRecommendations_CL: ['TimeGenerated', 'RecommendationId', 'Action', 'Severity', 'ObservedPattern', 'NextAction'],
  AgentOpsSavedViews_CL: ['TimeGenerated', 'SavedViewId', 'Name', 'Url', 'QueryHash']
};

const sharedWriteLeakPatterns = [
  /SECRET_FAKE_TEST_VALUE/i,
  /api_key\s*=/i,
  /cat ~\/\.ssh\/id_rsa/i,
  /raw transcript/i,
  /gen_ai\.input\.messages/i,
  /gen_ai\.output\.messages/i,
  /prompt\s*=/i,
  /tool_args\s*=/i,
  /tool results?/i,
  /file_content\s*=/i
];

function stableId(value, prefix = 'row') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function safeBlobSegment(value) {
  return stringValue(value)
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function rowIdFor(table, row) {
  const candidate = table === 'AgentOpsRecommendations_CL'
    ? row.RecommendationId
    : row.SavedViewId;
  return safeBlobSegment(candidate) || stableId(JSON.stringify(row));
}

function validateSharedWriteRow(table, row = {}) {
  const errors = [];
  const text = JSON.stringify(row);
  if (!sharedWriteTables.has(table)) errors.push(`unsupported table: ${table || '<missing>'}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) errors.push('row must be an object');

  for (const column of sharedWriteRequiredColumns[table] || []) {
    if (row[column] === undefined || row[column] === null || row[column] === '') errors.push(`${table}: missing required column ${column}`);
  }

  if (table === 'AgentOpsRecommendations_CL') {
    const validation = validateRecommendationRow(row);
    if (!validation.ok) errors.push(...validation.errors.map(error => `${table}: ${error}`));
  }

  const leaks = sharedWriteLeakPatterns
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
  if (leaks.length > 0) errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);

  return { ok: errors.length === 0, errors, leaks };
}

function buildSharedStoreWrite(payload = {}, options = {}) {
  const table = stringValue(payload.table || payload.Table).trim();
  const row = payload.row && typeof payload.row === 'object' ? payload.row : {};
  const owner = stringValue(payload.owner || payload.Owner || process.env.AGENTOPS_SHARED_STORE_OWNER).trim();
  const prefix = safeBlobSegment(options.prefix || process.env.AGENTOPS_SHARED_STORE_PREFIX || payload.prefix || 'agentops-shared');
  const validation = validateSharedWriteRow(table, row);
  const id = safeBlobSegment(options.id || payload.id) || rowIdFor(table, row);
  const blobPath = [prefix, table, `${id}.json`].filter(Boolean).join('/');
  const writtenAt = stringValue(options.writtenAt || new Date().toISOString());

  const packet = {
    schema_version: 'agentops.shared-store-write.v1',
    mode: 'metadata-only-shared-store-write',
    status: validation.ok ? 'ready' : 'rejected',
    table: table || null,
    id,
    owner: owner || null,
    blob_path: blobPath,
    row: validation.ok ? row : null,
    errors: validation.errors,
    privacy: {
      mode: 'metadata-only',
      leaks: validation.leaks,
      excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'source code', 'file contents']
    },
    guardrails: [
      'Accept only metadata-only saved-view and recommendation rows.',
      'Do not store prompts, responses, tool arguments, tool results, source code, or file contents.',
      'Use storage RBAC and function-level authorization for hosted writes.'
    ]
  };

  if (!validation.ok) return packet;

  return {
    ...packet,
    blob: {
      path: blobPath,
      content: `${JSON.stringify({
        schema_version: 'agentops.shared-store-blob.v1',
        written_at: writtenAt,
        table,
        id,
        owner: owner || null,
        row
      }, null, 2)}\n`
    },
    next: [
      'Ingest or export the shared blob row into AgentOpsRecommendations_CL or AgentOpsSavedViews_CL.',
      'Review owner and privacy metadata before sharing the artifact beyond the team.'
    ]
  };
}

function metadataFromPayload(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const essentials = data.essentials && typeof data.essentials === 'object' ? data.essentials : {};
  const customProperties = data.customProperties && typeof data.customProperties === 'object' ? data.customProperties : {};
  const context = data.alertContext && typeof data.alertContext === 'object' ? data.alertContext : {};
  const dimensions = Array.isArray(context.dimensions) ? context.dimensions : [];
  const dimensionMap = Object.fromEntries(dimensions
    .map(item => [stringValue(item.name || item.Name), stringValue(item.value || item.Value)])
    .filter(([name]) => name));

  return {
    rule: stringValue(customProperties['agentops.rule'] || customProperties.rule || dimensionMap.rule || essentials.alertRule || essentials.alertRuleName).trim(),
    session: stringValue(customProperties['agentops.session'] || customProperties.session || dimensionMap.session || dimensionMap.Conversation || dimensionMap.conversation).trim(),
    owner: stringValue(customProperties['agentops.owner'] || customProperties.owner || process.env.AGENTOPS_ACTIONER_OWNER).trim(),
    service: stringValue(customProperties['agentops.service'] || customProperties.service || process.env.AGENTOPS_ACTIONER_SERVICE || 'agentops').trim(),
    last: stringValue(customProperties['agentops.last'] || customProperties.last || process.env.AGENTOPS_ACTIONER_LOOKBACK || '24h').trim(),
    timezone: stringValue(customProperties['agentops.timezone'] || customProperties.timezone || process.env.AGENTOPS_ACTIONER_TIMEZONE || 'UTC').trim(),
    severity: stringValue(essentials.severity || customProperties.severity).trim(),
    monitor_condition: stringValue(essentials.monitorCondition).trim(),
    fired_at: stringValue(essentials.firedDateTime).trim()
  };
}

function buildActionerReview(payload = {}, options = {}) {
  const metadata = metadataFromPayload(payload);
  const errors = [];

  if (!alertRuleNames.has(metadata.rule)) {
    errors.push(`unknown or missing alert rule: ${metadata.rule || '<missing>'}`);
  }
  if (!metadata.session) errors.push('missing alert session/conversation id');

  const workspaceId = stringValue(options.workspaceId || process.env.AGENTOPS_WORKSPACE_ID || 'unknown');
  const alerts = createAlerts({
    workspaceId,
    baseFilter: 'Properties["agentops.signal"] == "true"',
    sessionKey: 'tostring(Properties["gen_ai.conversation.id"])',
    validateKqlDuration(value) {
      const text = stringValue(value || '24h').trim();
      if (!/^\d+[mhd]$/.test(text)) throw new Error(`invalid lookback: ${text}`);
      return text;
    },
    buildLink(conversation) {
      return {
        conversation,
        grafana_url: `${options.grafanaBaseUrl || 'https://grafana.example.invalid'}/d/agentops-session-detail?var-session_id=${encodeURIComponent(conversation)}`,
        azure_portal_url: `${options.azurePortalBaseUrl || 'https://portal.azure.com'}/#blade/Microsoft_Azure_Monitoring_Logs/LogsBlade`
      };
    }
  });

  const packet = {
    schema_version: 'agentops.actioner-review.v1',
    mode: 'metadata-only-actioner-review',
    status: errors.length ? 'needs-review' : 'ready',
    alert: {
      rule: metadata.rule || null,
      session: metadata.session || null,
      severity: metadata.severity || null,
      monitor_condition: metadata.monitor_condition || null,
      fired_at: metadata.fired_at || null,
      last: metadata.last
    },
    ownership: {
      owner: metadata.owner || null,
      service: metadata.service,
      timezone: metadata.timezone
    },
    errors,
    privacy: {
      mode: 'metadata-only',
      excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'file contents', 'raw alert payload']
    },
    guardrails: [
      'Do not page, post tickets, mutate Azure resources, or edit repositories from this actioner.',
      'Review the returned packet before routing any notification.',
      'Keep prompts, responses, tool arguments, tool results, and file contents out of incident systems.'
    ]
  };

  if (errors.length) return packet;

  const owners = metadata.owner ? [metadata.owner] : [];
  const detail = alerts.alertDetail({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const actionPlan = alerts.alertActionPlan({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const artifact = alerts.alertArtifact({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const review = {
    schema_version: 'agentops.actioner-alert-review.v1',
    mode: 'metadata-only-actioner-alert-review',
    alert: {
      rule: metadata.rule,
      session: metadata.session,
      last: metadata.last
    },
    owner: metadata.owner || null,
    evidence: {
      detail,
      action_plan: actionPlan,
      artifact
    },
    commands: {
      detail: `agentops alert detail --rule ${metadata.rule} --session ${metadata.session} --last ${metadata.last}`,
      action_plan: actionPlan.next_command,
      handoff: `agentops alert handoff --rule ${metadata.rule} --session ${metadata.session}${metadata.owner ? ` --owner ${metadata.owner}` : ''} --last ${metadata.last}`
    }
  };
  const routePlan = owners.length
    ? alerts.alertRoutePlan({
      rule: metadata.rule,
      session: metadata.session,
      last: metadata.last,
      owners,
      service: metadata.service,
      timezone: metadata.timezone,
      targets: ['github-issue']
    })
    : null;

  return {
    ...packet,
    review,
    route_plan: routePlan,
    next: [
      'Open the run-scoped review links.',
      'Confirm owner and alert history evidence.',
      'Route a ticket manually or with an explicitly approved guarded CLI route command.'
    ]
  };
}

async function actioner(context, req) {
  try {
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const packet = buildActionerReview(body);
    context.res = {
      status: packet.status === 'ready' ? 200 : 202,
      headers: { 'Content-Type': 'application/json' },
      body: packet
    };
  } catch (error) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        schema_version: 'agentops.actioner-review.v1',
        mode: 'metadata-only-actioner-review',
        status: 'invalid',
        error: error.message
      }
    };
  }
}

async function sharedStoreWrite(context, req) {
  try {
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const packet = buildSharedStoreWrite({
      ...body,
      table: body.table || params.table,
      id: body.id || params.id
    });
    if (packet.status === 'ready') {
      context.bindings.sharedBlob = packet.blob.content;
    }
    context.res = {
      status: packet.status === 'ready' ? 201 : 400,
      headers: { 'Content-Type': 'application/json' },
      body: packet
    };
  } catch (error) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        schema_version: 'agentops.shared-store-write.v1',
        mode: 'metadata-only-shared-store-write',
        status: 'invalid',
        error: error.message
      }
    };
  }
}

module.exports = actioner;
module.exports.buildActionerReview = buildActionerReview;
module.exports.buildSharedStoreWrite = buildSharedStoreWrite;
module.exports.metadataFromPayload = metadataFromPayload;
module.exports.sharedStoreWrite = sharedStoreWrite;
module.exports.validateSharedWriteRow = validateSharedWriteRow;
