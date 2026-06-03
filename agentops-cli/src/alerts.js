// Builds KQL queries that recommend alert thresholds based on recent telemetry.
function createAlerts({ workspaceId, baseFilter, sessionKey, validateKqlDuration, buildLink }) {
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
      rules: [
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
      ]
    };
  }

  function alertActionPlan({ rule, session, last = '24h' }) {
    const lookback = validateKqlDuration(last);
    const normalizedRule = String(rule || '').trim();
    const normalizedSession = String(session || '').trim();
    const rules = alertRecommendations(lookback).rules;
    const matchedRule = rules.find(candidate => candidate.name === normalizedRule);

    if (!matchedRule) throw new Error(`alert action-plan requires --rule ${rules.map(candidate => candidate.name).join('|')}`);
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

  return {
    alertRecommendationQuery,
    alertRecommendations,
    alertActionPlan
  };
}

module.exports = {
  createAlerts
};
