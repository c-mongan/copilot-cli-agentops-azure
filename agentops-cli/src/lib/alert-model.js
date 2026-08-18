const {
  configChangeAnnotationsForSession,
  normalizeConfigChangeAnnotation,
  parseDetailsValue,
  propertyValue,
  stringValue
} = require('./change-annotations');

function boolish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function alertRules(last = '14d') {
  return [
    {
      name: 'high-aiu',
      bicep_resource: 'highAiuAlert',
      signal: 'hourly session AIU above tuned p95/p99 history',
      current_threshold: 50000000000,
      suggested_threshold: 'max(p99_aiu * 1.25, p95_aiu * 2)',
      validation_query: 'Run alert recommend and inspect p95_aiu, p99_aiu, max_aiu before changing infra/bicep/alerts.bicep.',
      rollout: 'Keep enableAlerts=false until the threshold has at least 14 days of clean history.'
    },
    {
      name: 'cost-spike',
      bicep_resource: 'highAiuAlert',
      signal: 'hourly GitHub Copilot credits above tuned cost history',
      current_threshold: 1,
      suggested_threshold: 'max(1, p95_credits * 2)',
      validation_query: 'Inspect p95_credits and max_credits before changing budget contacts or alert thresholds.',
      rollout: 'Pair with an Azure Consumption budget and keep action groups off until cost history is understood.'
    },
    {
      name: 'runaway-tool-loop',
      bicep_resource: 'failureAlert',
      signal: 'tool calls per conversation-hour above tuned history',
      current_threshold: 25,
      suggested_threshold: 'max(25, p95_tool_calls * 2)',
      validation_query: 'Compare p95_tool_calls and max_tool_calls with the runaway-tool-loop abuse fixture.',
      rollout: 'Review tool permission policy before routing this rule to action groups.'
    },
    {
      name: 'failed-spans',
      bicep_resource: 'failureAlert',
      signal: 'failed spans or failed tools in a one-hour window',
      current_threshold: 0,
      suggested_threshold: 'start at max(1, p95_failures) for noisy dev stacks; keep 0 for production safety gates',
      validation_query: 'Compare max_failures, p95_failures, max_tool_failures, and p95_tool_failures over the selected lookback.',
      rollout: 'Attach no action group until false positives are reviewed in the Permission Friction dashboard.'
    },
    {
      name: 'content-capture',
      bicep_resource: 'contentCaptureAlert',
      signal: 'prompt, completion, message, or Copilot content fields detected',
      current_threshold: 0,
      suggested_threshold: 0,
      validation_query: 'max_content_capture_signals must remain 0 before sharing telemetry.',
      rollout: 'This rule should stay strict; investigate immediately if it fires.'
    }
  ].map(rule => ({ ...rule, last }));
}

function requireAlertRule(rule, commandName) {
  const normalizedRule = String(rule || '').trim();
  const rules = alertRules();
  const matchedRule = rules.find(candidate => candidate.name === normalizedRule);
  if (!matchedRule) throw new Error(`alert ${commandName} requires --rule ${rules.map(candidate => candidate.name).join('|')}`);
  return matchedRule;
}

function alertResourceState({ workspaceId, resources = [], resourceGroup = null, error = null } = {}) {
  const rules = alertRules();
  const normalized = resources.map(resource => {
    const properties = resource.properties || {};
    const actions = properties.actions || {};
    return {
      name: resource.name || null,
      display_name: properties.displayName || null,
      enabled: boolish(properties.enabled),
      severity: properties.severity ?? null,
      action_groups: Array.isArray(actions.actionGroups) ? actions.actionGroups : [],
      evaluation_frequency: properties.evaluationFrequency || null,
      window_size: properties.windowSize || null
    };
  });

  return {
    workspace_id: workspaceId,
    resource_group: resourceGroup,
    mode: 'read-only-resource-state',
    status: error ? 'unavailable' : 'observed',
    error,
    expected_bicep_resources: rules.map(rule => ({
      rule: rule.name,
      bicep_resource: rule.bicep_resource
    })),
    resources: normalized,
    summary: {
      total: normalized.length,
      enabled: normalized.filter(resource => resource.enabled).length,
      disabled: normalized.filter(resource => !resource.enabled).length,
      routed: normalized.filter(resource => resource.action_groups.length > 0).length
    },
    next: error
      ? ['Verify Azure CLI login, monitor extension, resource group, and scheduled-query rule read permissions.']
      : ['Keep alerts disabled until thresholds are tuned and action groups are approved.']
  };
}

function alertPolicy({ workspaceId, owners = [], service = 'agentops', timezone = 'UTC' } = {}) {
  const normalizedOwners = owners.map(owner => String(owner || '').trim()).filter(Boolean);
  const rules = alertRules();
  return {
    schema_version: 'agentops.alert-policy.v1',
    workspace_id: workspaceId,
    mode: 'metadata-only-policy',
    service,
    timezone,
    ownership: {
      state: normalizedOwners.length > 0 ? 'assigned' : 'needs-owner',
      owners: normalizedOwners,
      fallback: null
    },
    noise_policy: {
      dedupe_key: ['rule', 'session'],
      suppress_duplicates_for: 'PT30M',
      max_review_items_per_rule_per_day: 10,
      quiet_hours: {
        enabled: false,
        start: null,
        end: null,
        timezone
      }
    },
    escalation: {
      page: false,
      create_ticket: false,
      allowed_targets: ['github-issue', 'azure-devops-work-item'],
      requires_manual_review: true
    },
    rule_defaults: rules.map(rule => ({
      rule: rule.name,
      severity: rule.name === 'content-capture' ? 'critical' : 'review',
      owner_required: true,
      action_group_required_before_enablement: true
    })),
    guardrails: [
      'Do not page owners or create tickets automatically from this policy.',
      'Review metadata-only KQL, dashboard links, and exported artifacts before assigning work.',
      'Keep prompts, responses, tool arguments, tool results, and file contents out of incident notes.'
    ],
    next: normalizedOwners.length > 0
      ? ['Review alert resources and incident timelines before enabling notification routes.']
      : ['Assign at least one owner before enabling alert action groups.']
  };
}

module.exports = {
  alertPolicy,
  alertResourceState,
  alertRules,
  boolish,
  configChangeAnnotationsForSession,
  normalizeConfigChangeAnnotation,
  parseDetailsValue,
  propertyValue,
  requireAlertRule,
  stringValue
};
