const { createAlerts } = require('../agentops-cli/src/alerts');

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

module.exports = actioner;
module.exports.buildActionerReview = buildActionerReview;
module.exports.metadataFromPayload = metadataFromPayload;
