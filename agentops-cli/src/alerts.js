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

  function alertTunePlan({ last = '14d', rule = null, owner = null } = {}) {
    const lookback = validateKqlDuration(last);
    const rules = rule ? [requireAlertRule(rule, 'tune-plan')] : alertRules(lookback);
    const normalizedOwner = owner ? String(owner).trim() : null;

    return {
      schema_version: 'agentops.alert-tune-plan.v1',
      workspace_id: workspaceId,
      mode: 'proposal-only-threshold-plan',
      last: lookback,
      owner: normalizedOwner || null,
      evidence: {
        threshold_recommendation_query: alertRecommendationQuery(lookback),
        fired_alert_history: rules.map(candidate => ({
          rule: candidate.name,
          query: alertHistoryQuery(candidate.name, lookback)
        }))
      },
      threshold_changes: rules.map(candidate => ({
        rule: candidate.name,
        bicep_resource: candidate.bicep_resource,
        patch_target: 'infra/bicep/alerts.bicep',
        current_threshold: candidate.current_threshold,
        suggested_threshold: candidate.suggested_threshold,
        signal: candidate.signal,
        validation: candidate.validation_query,
        rollout: candidate.rollout,
        decision: candidate.name === 'content-capture' ? 'keep-strict' : 'review'
      })),
      guardrails: [
        'Do not edit infra/bicep/alerts.bicep until the recommendation query and fired-alert history have been reviewed.',
        'Do not enable alerts or attach action groups from this plan.',
        'Keep content-capture threshold at 0; investigate any content-like telemetry before sharing or routing alerts.'
      ],
      next: [
        'Run the threshold recommendation query over the selected lookback.',
        'Review fired-alert history for each rule and record an owner decision.',
        'Apply any Bicep threshold edits manually in a reviewed PR, then run validate-azure before enabling alerts.'
      ]
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

  function alertPolicy({ owners = [], service = 'agentops', timezone = 'UTC' } = {}) {
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

  function alertHandoff({ rule, session, last = '24h', owners = [], service = 'agentops', timezone = 'UTC', createdAt, resourceGroup = null } = {}) {
    const created = createdAt || new Date().toISOString();
    const artifact = alertArtifact({ rule, session, last, createdAt: created });
    const tunePlan = alertTunePlan({ last, rule: artifact.rule, owner: owners[0] || null });
    const policy = alertPolicy({ owners, service, timezone });
    const resources = alertResourceState({ resourceGroup });
    const timeline = alertIncidentTimeline({
      artifacts: [artifact],
      createdAt: created,
      incidentId: `handoff-${artifact.rule}-${artifact.session}`.replace(/[^A-Za-z0-9_.-]/g, '-')
    });

    return {
      schema_version: 'agentops.alert-handoff.v1',
      created_at: created,
      workspace_id: workspaceId,
      mode: 'metadata-only-operator-handoff',
      alert: {
        rule: artifact.rule,
        session: artifact.session,
        last: artifact.last,
        severity: artifact.action_plan.severity
      },
      ownership: policy.ownership,
      noise_policy: policy.noise_policy,
      escalation: policy.escalation,
      evidence: {
        detail: {
          history_query: artifact.evidence.history_query,
          session_link: artifact.evidence.session_link,
          threshold_evidence_query: artifact.evidence.threshold_evidence_query
        },
        tune_plan: tunePlan,
        resources,
        timeline
      },
      operator_steps: [
        'Review the session link and metadata-only alert history.',
        'Review the tune-plan threshold evidence before changing any alert rule.',
        'Assign an owner and create a ticket manually only after confirming the evidence.',
        'Run validate-azure before enabling alert rules or attaching action groups.'
      ],
      guardrails: [
        'Do not include prompts, responses, tool arguments, tool results, or file contents in handoff notes.',
        'Do not page, create tickets, edit Bicep, enable alerts, or attach action groups from this handoff.',
        'Treat this as an operator review packet, not an automated remediation.'
      ],
      status: {
        state: 'review',
        owner: policy.ownership.owners[0] || null,
        ticket: null,
        notes: []
      }
    };
  }

  function alertRoutePlan({ rule, session, last = '24h', owners = [], service = 'agentops', timezone = 'UTC', targets = [], createdAt, resourceGroup = null } = {}) {
    const handoff = alertHandoff({ rule, session, last, owners, service, timezone, createdAt, resourceGroup });
    const selectedTargets = targets.length > 0 ? targets : ['github-issue', 'azure-devops-work-item'];
    const allowedTargets = new Set(handoff.escalation.allowed_targets);
    const unknownTarget = selectedTargets.find(target => !allowedTargets.has(target));
    if (unknownTarget) throw new Error(`alert route-plan target must be one of: ${Array.from(allowedTargets).join(', ')}`);

    const title = `AgentOps alert: ${handoff.alert.rule} for session ${handoff.alert.session}`;
    const bodyLines = [
      `AgentOps alert route preview for ${handoff.alert.rule}.`,
      '',
      `Session: ${handoff.alert.session}`,
      `Severity: ${handoff.alert.severity}`,
      `Lookback: ${handoff.alert.last}`,
      `Owner: ${handoff.status.owner || 'needs-owner'}`,
      `Service: ${service}`,
      '',
      'Evidence to review:',
      '- Session dashboard/KQL link from the handoff detail evidence.',
      '- Alert history KQL scoped to this rule and session.',
      '- Tune-plan threshold evidence before changing alert rules.',
      '',
      'Privacy guardrails:',
      '- Do not include prompts, responses, tool arguments, tool results, or file contents.',
      '- Do not page, create tickets, edit Bicep, enable alerts, or attach action groups automatically.'
    ].join('\n');

    const destinationPayloads = selectedTargets.map(target => {
      if (target === 'github-issue') {
        return {
          target,
          operation: 'preview-only',
          payload: {
            title,
            body: bodyLines,
            labels: ['agentops-alert', handoff.alert.rule, handoff.alert.severity],
            assignees: handoff.ownership.owners
          }
        };
      }
      return {
        target,
        operation: 'preview-only',
        payload: [
          { op: 'add', path: '/fields/System.Title', value: title },
          { op: 'add', path: '/fields/System.Description', value: bodyLines },
          { op: 'add', path: '/fields/System.Tags', value: `AgentOps; ${handoff.alert.rule}; ${handoff.alert.severity}` }
        ]
      };
    });

    return {
      schema_version: 'agentops.alert-route-plan.v1',
      created_at: handoff.created_at,
      workspace_id: workspaceId,
      mode: 'preview-only-routing-plan',
      alert: handoff.alert,
      ownership: handoff.ownership,
      destinations: destinationPayloads,
      evidence: {
        handoff_schema: handoff.schema_version,
        history_query: handoff.evidence.detail.history_query,
        session_link: handoff.evidence.detail.session_link,
        tune_plan_schema: handoff.evidence.tune_plan.schema_version
      },
      guardrails: [
        'Do not post these payloads automatically; review the handoff evidence first.',
        'Keep prompts, responses, tool arguments, tool results, and file contents out of route payloads.',
        'Do not enable alert rules or attach action groups from this route plan.'
      ],
      next: [
        'Review the generated payload for the selected destination.',
        'Create the issue or work item manually only after confirming safe metadata and owner assignment.',
        'Attach the exported handoff artifact if your incident process allows metadata-only JSON.'
      ]
    };
  }

  return {
    alertRecommendationQuery,
    alertRecommendations,
    alertTunePlan,
    alertResourceState,
    alertPolicy,
    alertHistoryQuery,
    alertHistory,
    alertDetail,
    alertActionPlan,
    alertArtifact,
    alertIncidentTimeline,
    alertHandoff,
    alertRoutePlan
  };
}

module.exports = {
  createAlerts
};
