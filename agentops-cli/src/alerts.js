// Builds KQL queries that recommend alert thresholds based on recent telemetry.
function createAlerts({ workspaceId, baseFilter, sessionKey, validateKqlDuration, buildLink }) {
  function kqlString(value) {
    return JSON.stringify(String(value));
  }

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

  function alertRecommendationQuery(last = '14d') {
    const lookback = validateKqlDuration(last);
    return `let lookback = ${lookback};
let hourly =
AppDependencies
| where TimeGenerated > ago(lookback)
| where ${baseFilter}
| extend conversation=${sessionKey},
    operation=tostring(Properties["gen_ai.operation.name"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    error=tostring(Properties["error.type"]),
    AIU=todouble(Properties["github.copilot.aiu"]),
    Credits=todouble(Properties["github.copilot.cost"])
| summarize
    started=min(TimeGenerated),
    spans=count(),
    failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
    tool_failures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
    tool_calls=countif(operation == "execute_tool" or isnotempty(tool)),
    aiu=sum(AIU),
    credits=sum(Credits)
  by conversation, bin(TimeGenerated, 1h);
let content =
union isfuzzy=true AppDependencies, AppTraces
| where TimeGenerated > ago(lookback)
| where tostring(Properties) has_any ("gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.prompt", "gen_ai.completion", "github.copilot.message")
| summarize content_capture_signals=count() by bin(TimeGenerated, 1h);
let session_rollup =
hourly
| summarize
    hours=count(),
    p50_aiu=percentile(aiu, 50),
    p95_aiu=percentile(aiu, 95),
    p99_aiu=percentile(aiu, 99),
    max_aiu=max(aiu),
    p95_failures=percentile(failures, 95),
    max_failures=max(failures),
    p95_tool_failures=percentile(tool_failures, 95),
    max_tool_failures=max(tool_failures),
    p95_tool_calls=percentile(tool_calls, 95),
    max_tool_calls=max(tool_calls),
    p95_credits=percentile(credits, 95),
    max_credits=max(credits);
let content_rollup =
content
| summarize content_capture_hours=countif(content_capture_signals > 0), max_content_capture_signals=max(content_capture_signals);
union
(session_rollup
| extend suggested_threshold = case(p99_aiu * 1.25 > p95_aiu * 2, p99_aiu * 1.25, p95_aiu * 2)
| project rule="high-aiu", current_threshold=50000000000.0, suggested_threshold, p50=p50_aiu, p95=p95_aiu, p99=p99_aiu, max_observed=max_aiu, supporting_hours=hours),
(session_rollup
| extend suggested_threshold = case(p95_credits * 2 > 1.0, p95_credits * 2, 1.0)
| project rule="cost-spike", current_threshold=1.0, suggested_threshold, p50=real(null), p95=p95_credits, p99=real(null), max_observed=max_credits, supporting_hours=hours),
(session_rollup
| extend suggested_threshold = case(p95_tool_calls * 2 > 25.0, p95_tool_calls * 2, 25.0)
| project rule="runaway-tool-loop", current_threshold=25.0, suggested_threshold, p50=real(null), p95=p95_tool_calls, p99=real(null), max_observed=todouble(max_tool_calls), supporting_hours=hours),
(session_rollup
| extend suggested_threshold = case(p95_failures > 1, p95_failures, 1.0)
| project rule="failed-spans", current_threshold=0.0, suggested_threshold, p50=real(null), p95=p95_failures, p99=real(null), max_observed=max_failures, supporting_hours=hours),
(content_rollup
| project rule="content-capture", current_threshold=0.0, suggested_threshold=0.0, p50=real(null), p95=real(null), p99=real(null), max_observed=coalesce(max_content_capture_signals, 0), supporting_hours=content_capture_hours)`;
  }

  function alertRecommendations(last = '14d') {
    const lookback = validateKqlDuration(last);
    return {
      workspace_id: workspaceId,
      last: lookback,
      mode: 'proposal-only',
      evidence_query: alertRecommendationQuery(lookback),
      rules: alertRules(lookback)
    };
  }

  function alertResourceState({ resources = [], resourceGroup = null, error = null } = {}) {
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

  function alertHistoryQuery(rule, last = '24h', options = {}) {
    const lookback = validateKqlDuration(last);
    const matchedRule = requireAlertRule(rule, 'history');
    const selectedSession = options.session ? `\n| where Conversation == ${kqlString(String(options.session).trim())}` : '';
    return `let lookback = ${lookback};
let selected_rule = ${kqlString(matchedRule.name)};
let hourly =
AppDependencies
| where TimeGenerated > ago(lookback)
| where ${baseFilter}
| extend conversation=${sessionKey},
    operation=tostring(Properties["gen_ai.operation.name"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    error=tostring(Properties["error.type"]),
    AIU=todouble(Properties["github.copilot.aiu"]),
    Credits=todouble(Properties["github.copilot.cost"])
| summarize
    Started=min(TimeGenerated),
    LastSeen=max(TimeGenerated),
    Spans=count(),
    Failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
    ToolFailures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
    ToolCalls=countif(operation == "execute_tool" or isnotempty(tool)),
    AIU=sum(AIU),
    Credits=sum(Credits)
  by Conversation=conversation, TimeGenerated=bin(TimeGenerated, 1h);
let content =
union isfuzzy=true AppDependencies, AppTraces
| where TimeGenerated > ago(lookback)
| where tostring(Properties) has_any ("gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.prompt", "gen_ai.completion", "github.copilot.message")
| summarize Started=min(TimeGenerated), LastSeen=max(TimeGenerated), ContentCaptureSignals=count() by TimeGenerated=bin(TimeGenerated, 1h)
| extend Conversation="content-capture-window";
let alert_history =
union
(hourly | extend Rule="high-aiu", TriggerValue=AIU, Threshold=50000000000.0, Reason="hourly AIU exceeded static proposal threshold" | where TriggerValue > Threshold),
(hourly | extend Rule="cost-spike", TriggerValue=Credits, Threshold=1.0, Reason="hourly Copilot credits exceeded static proposal threshold" | where TriggerValue > Threshold),
(hourly | extend Rule="runaway-tool-loop", TriggerValue=todouble(ToolCalls), Threshold=25.0, Reason="tool calls exceeded static proposal threshold" | where TriggerValue > Threshold),
(hourly | extend Rule="failed-spans", TriggerValue=todouble(Failures + ToolFailures), Threshold=0.0, Reason="failed spans or tools observed" | where TriggerValue > Threshold),
(content | extend Rule="content-capture", TriggerValue=todouble(ContentCaptureSignals), Threshold=0.0, Reason="content-like telemetry attributes observed", Spans=long(null), Failures=long(null), ToolFailures=long(null), ToolCalls=long(null), AIU=real(null), Credits=real(null) | where TriggerValue > Threshold);
alert_history
| where Rule == selected_rule
${selectedSession}
| project Rule, TimeGenerated, Started, LastSeen, Conversation, TriggerValue, Threshold, Reason, Spans, Failures, ToolFailures, ToolCalls, AIU, Credits
| order by TimeGenerated desc`;
  }

  function alertHistory({ rule, last = '24h' }) {
    const matchedRule = requireAlertRule(rule, 'history');
    const lookback = validateKqlDuration(last);
    return {
      workspace_id: workspaceId,
      mode: 'metadata-only-history',
      rule: matchedRule.name,
      last: lookback,
      query: alertHistoryQuery(matchedRule.name, lookback),
      next: 'Run the query, choose a Conversation from the result, then run alert detail for session-scoped triage.'
    };
  }

  function alertDetail({ rule, session, last = '24h' }) {
    const matchedRule = requireAlertRule(rule, 'detail');
    const lookback = validateKqlDuration(last);
    const normalizedSession = String(session || '').trim();
    if (!normalizedSession) throw new Error('alert detail requires --session <conversation>');
    const sessionLink = buildLink
      ? buildLink('session', normalizedSession, { last: lookback })
      : { kind: 'session', conversation: normalizedSession, workspace_id: workspaceId };
    return {
      workspace_id: workspaceId,
      mode: 'metadata-only-detail',
      rule: matchedRule.name,
      last: lookback,
      session: normalizedSession,
      history_query: alertHistoryQuery(matchedRule.name, lookback, { session: normalizedSession }),
      session_link: sessionLink,
      action_plan_command: `agentops alert action-plan --rule ${matchedRule.name} --session ${normalizedSession} --last ${lookback}`,
      guardrails: [
        'Inspect metadata-only KQL and Grafana links before notifying owners.',
        'Keep prompt, response, tool argument, tool result, and file content out of alert tickets.'
      ]
    };
  }

  function alertActionPlan({ rule, session, last = '24h' }) {
    const lookback = validateKqlDuration(last);
    const normalizedSession = String(session || '').trim();
    const matchedRule = requireAlertRule(rule, 'action-plan');

    if (!normalizedSession) throw new Error('alert action-plan requires --session <conversation>');

    const sessionLink = buildLink
      ? buildLink('session', normalizedSession, { last: lookback })
      : { kind: 'session', conversation: normalizedSession, workspace_id: workspaceId };

    return {
      workspace_id: workspaceId,
      mode: 'deterministic-plan',
      rule: matchedRule.name,
      last: lookback,
      session: normalizedSession,
      severity: matchedRule.name === 'content-capture' ? 'critical' : 'review',
      title: `AgentOps alert: ${matchedRule.name} for session ${normalizedSession}`,
      safe_metadata: {
        signal: matchedRule.signal,
        current_threshold: matchedRule.current_threshold,
        suggested_threshold: matchedRule.suggested_threshold,
        rollout: matchedRule.rollout
      },
      links: {
        session: sessionLink,
        threshold_evidence_query: alertRecommendationQuery(lookback)
      },
      action_targets: [
        {
          type: 'github-issue',
          action: 'create',
          fields: ['title', 'rule', 'session', 'safe_metadata', 'session.grafana_url', 'session.query'],
          note: 'Create only after reviewing the alert and assigning an owner.'
        },
        {
          type: 'azure-devops-work-item',
          action: 'create',
          fields: ['title', 'rule', 'session', 'safe_metadata', 'session.grafana_url', 'session.query'],
          note: 'Use for teams that track production incidents in Azure Boards.'
        }
      ],
      guardrails: [
        'Do not include prompts, responses, tool arguments, tool results, or raw file contents.',
        'Do not edit repositories, Azure resources, thresholds, or alert rules from this plan.',
        'Do not invoke broad LLM tools automatically; use the linked KQL and Grafana evidence first.'
      ]
    };
  }

  function alertArtifact({ rule, session, last = '24h', createdAt } = {}) {
    const detail = alertDetail({ rule, session, last });
    const actionPlan = alertActionPlan({ rule, session, last });
    return {
      schema_version: 'agentops.alert-artifact.v1',
      created_at: createdAt || new Date().toISOString(),
      workspace_id: workspaceId,
      rule: detail.rule,
      session: detail.session,
      last: detail.last,
      privacy: {
        mode: 'metadata-only',
        excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'file contents']
      },
      evidence: {
        history_query: detail.history_query,
        session_link: detail.session_link,
        threshold_evidence_query: actionPlan.links.threshold_evidence_query
      },
      action_plan: {
        title: actionPlan.title,
        severity: actionPlan.severity,
        safe_metadata: actionPlan.safe_metadata,
        action_targets: actionPlan.action_targets,
        guardrails: actionPlan.guardrails
      },
      status: {
        state: 'review',
        owner: null,
        ticket: null,
        notes: []
      }
    };
  }

  function alertIncidentTimeline({ artifacts = [], createdAt, incidentId } = {}) {
    const created = createdAt || new Date().toISOString();
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      throw new Error('incident timeline requires at least one alert artifact');
    }

    const normalized = artifacts.map((artifact, index) => {
      if (!artifact || artifact.schema_version !== 'agentops.alert-artifact.v1') {
        throw new Error(`incident timeline artifact ${index + 1} must be an agentops.alert-artifact.v1 JSON file`);
      }
      if (!artifact.rule || !artifact.session || !artifact.evidence) {
        throw new Error(`incident timeline artifact ${index + 1} is missing rule, session, or evidence`);
      }
      return {
        source_index: index + 1,
        created_at: artifact.created_at || created,
        rule: artifact.rule,
        session: artifact.session,
        last: artifact.last,
        severity: artifact.action_plan && artifact.action_plan.severity ? artifact.action_plan.severity : 'review',
        status: artifact.status || { state: 'review', owner: null, ticket: null, notes: [] },
        evidence: {
          history_query: artifact.evidence.history_query,
          session_link: artifact.evidence.session_link,
          threshold_evidence_query: artifact.evidence.threshold_evidence_query
        },
        action_plan: {
          title: artifact.action_plan && artifact.action_plan.title,
          safe_metadata: artifact.action_plan && artifact.action_plan.safe_metadata,
          guardrails: artifact.action_plan && artifact.action_plan.guardrails ? artifact.action_plan.guardrails : []
        }
      };
    }).sort((left, right) => {
      if (left.created_at !== right.created_at) return String(left.created_at).localeCompare(String(right.created_at));
      if (left.rule !== right.rule) return String(left.rule).localeCompare(String(right.rule));
      return String(left.session).localeCompare(String(right.session));
    });

    const excluded = new Set(['prompts', 'responses', 'tool arguments', 'tool results', 'file contents']);
    for (const artifact of artifacts) {
      for (const item of (artifact.privacy && artifact.privacy.excluded) || []) excluded.add(item);
    }

    return {
      schema_version: 'agentops.incident-timeline.v1',
      created_at: created,
      incident_id: incidentId || `incident-${created.replace(/[^0-9]/g, '').slice(0, 14)}`,
      workspace_id: normalized[0].evidence.session_link && normalized[0].evidence.session_link.workspace_id
        ? normalized[0].evidence.session_link.workspace_id
        : workspaceId,
      privacy: {
        mode: 'metadata-only',
        excluded: Array.from(excluded)
      },
      status: {
        state: 'review',
        owner: null,
        tickets: normalized.map(item => item.status.ticket).filter(Boolean),
        notes: []
      },
      timeline: normalized.map((item, index) => ({
        sequence: index + 1,
        type: 'alert_artifact',
        at: item.created_at,
        rule: item.rule,
        session: item.session,
        severity: item.severity,
        state: item.status.state || 'review',
        summary: `AgentOps alert ${item.rule} for session ${item.session}`
      })),
      artifacts: normalized,
      next: [
        'Review the metadata-only timeline and assign an owner.',
        'Create a ticket manually only after confirming the KQL and dashboard evidence.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of incident notes.'
      ]
    };
  }

  return {
    alertRecommendationQuery,
    alertRecommendations,
    alertResourceState,
    alertHistoryQuery,
    alertHistory,
    alertDetail,
    alertActionPlan,
    alertArtifact,
    alertIncidentTimeline
  };
}

module.exports = {
  createAlerts
};
