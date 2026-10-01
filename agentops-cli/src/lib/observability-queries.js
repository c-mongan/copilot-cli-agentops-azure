// Every KQL builder in this file targets AZURE MONITOR LOGS (a Log Analytics
// workspace), queried through the `AppDependencies`/`AppTraces`/`AppEvents`/
// `AppMetrics` App Insights tables. That is a different product, endpoint and
// identifier shape from AZURE DATA EXPLORER (ADX) Kusto clusters/databases,
// even though both use the Kusto Query Language and so can look identical as
// raw KQL text. A Log Analytics workspace ID is a GUID, not a Kusto cluster
// URI, and the table names above do not exist in an ADX database. A
// configured MCP server merely being named or labelled "Kusto" does NOT
// establish that it can run a Log Analytics query, or that it is pointed at
// this workspace at all — callers must verify the actual configured
// endpoint/operation before trusting one of these canned queries to run
// against it. `logAnalyticsTargetWarning` below is a cheap, local sanity
// check against that specific failure mode (an obviously ADX-shaped target
// where a Log Analytics workspace GUID is expected) — it is not capability
// negotiation with the MCP server, which would be disproportionate here.
const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./paths');
const { escapeKqlString, validateKqlDuration } = require('./kql');
const { contentLikeKeys, safeAttributeKeys } = require('./privacy');

const logAnalyticsWorkspaceIdPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function logAnalyticsTargetWarning(workspaceId) {
  const value = String(workspaceId || '').trim();
  if (!value) {
    return 'No Log Analytics workspace ID is configured. These queries target Azure Monitor Logs (a Log Analytics workspace), not an Azure Data Explorer Kusto cluster, and cannot run without one.';
  }
  if (/kusto\.windows\.net/i.test(value) || /^https?:\/\//i.test(value)) {
    return `Configured target "${value}" looks like an Azure Data Explorer Kusto cluster URI, not a Log Analytics workspace ID. These queries read Azure Monitor Logs tables (AppDependencies/AppTraces/AppEvents/AppMetrics) via a Log Analytics workspace GUID, not an ADX cluster endpoint. Verify the configured MCP server/endpoint actually exposes Log Analytics query access before trusting this query to run.`;
  }
  if (!logAnalyticsWorkspaceIdPattern.test(value)) {
    return `Configured target "${value}" does not look like a Log Analytics workspace ID (expected a GUID). Verify the configured MCP server/endpoint is actually an Azure Monitor Logs workspace, not an Azure Data Explorer Kusto database, before trusting this query to run.`;
  }
  return null;
}

const agentServiceNames = '("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli")';
const baseFilter = `(Properties has "github.copilot" or Properties has "gen_ai.operation.name" or Properties has "agentops." or AppRoleName in ${agentServiceNames} or tostring(Properties["service.name"]) in ${agentServiceNames} or tostring(Properties["agent.runtime"]) in ("codex", "openai-codex-cli"))`;
const copilotOtelFilter = baseFilter;
const copilotMetricNames = [
  'gen_ai.client.operation.duration',
  'gen_ai.client.token.usage',
  'gen_ai.client.operation.time_to_first_chunk',
  'gen_ai.client.operation.time_per_output_chunk',
  'github.copilot.tool.call.count',
  'github.copilot.tool.call.duration',
  'github.copilot.agent.turn.count',
  'copilot_chat.tool.call.count',
  'copilot_chat.tool.call.duration',
  'copilot_chat.agent.invocation.duration',
  'copilot_chat.agent.turn.count',
  'copilot_chat.session.count',
  'copilot_chat.time_to_first_token',
  'copilot_chat.edit.acceptance.count',
  'copilot_chat.chat_edit.outcome.count',
  'copilot_chat.lines_of_code.count',
  'copilot_chat.edit.survival.four_gram',
  'copilot_chat.edit.survival.no_revert',
  'copilot_chat.user.action.count',
  'copilot_chat.user.feedback.count',
  'copilot_chat.agent.edit_response.count',
  'copilot_chat.agent.summarization.count',
  'copilot_chat.pull_request.count',
  'copilot_chat.cloud.session.count',
  'copilot_chat.cloud.pr_ready.count'
];
const copilotEventNames = [
  'gen_ai.client.inference.operation.details',
  'copilot_chat.session.start',
  'copilot_chat.tool.call',
  'copilot_chat.agent.turn',
  'copilot_chat.edit.feedback',
  'copilot_chat.edit.hunk.action',
  'copilot_chat.inline.done',
  'copilot_chat.edit.survival',
  'copilot_chat.user.feedback',
  'copilot_chat.cloud.session.invoke',
  'github.copilot.hook.start',
  'github.copilot.hook.end',
  'github.copilot.hook.error',
  'github.copilot.session.truncation',
  'github.copilot.session.compaction_start',
  'github.copilot.session.compaction_complete',
  'github.copilot.skill.invoked',
  'github.copilot.session.shutdown',
  'github.copilot.session.abort',
  'exception'
];
const sessionFallbackPrefix = 'iff(isnotempty(tostring(Properties["gen_ai.agent.id"])), tostring(Properties["gen_ai.agent.id"]), iff(isnotempty(tostring(Properties["service.name"])), tostring(Properties["service.name"]), iff(isnotempty(AppRoleName), AppRoleName, "agent")))';
const sessionFallbackTurn = 'iff(isnotempty(tostring(Properties["github.copilot.turn_count"])), tostring(Properties["github.copilot.turn_count"]), iff(isnotempty(OperationId), OperationId, "session"))';
const sessionKey = `case(isnotempty(tostring(Properties["gen_ai.conversation.id"])), tostring(Properties["gen_ai.conversation.id"]), isnotempty(tostring(Properties["github.copilot.interaction_id"])), tostring(Properties["github.copilot.interaction_id"]), strcat(${sessionFallbackPrefix}, "_", ${sessionFallbackTurn}, "_", format_datetime(bin(TimeGenerated, 1h), "yyyyMMdd_HHmm")))`;
const directSessionKey = 'case(isnotempty(tostring(Properties["gen_ai.conversation.id"])), tostring(Properties["gen_ai.conversation.id"]), isnotempty(tostring(Properties["github.copilot.interaction_id"])), tostring(Properties["github.copilot.interaction_id"]), "")';
const fallbackSessionKey = `strcat(${sessionFallbackPrefix}, "_", ${sessionFallbackTurn}, "_", format_datetime(bin(TimeGenerated, 1h), "yyyyMMdd_HHmm"))`;

function encodeGrafanaValue(value) {
  return encodeURIComponent(value);
}

function grafanaUrlWithVars(baseUrl, vars = {}) {
  const entries = Object.entries(vars).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeGrafanaValue(String(value))}`).join('&')}`;
}

function sessionQuery(conversation, last = '24h') {
  const escaped = escapeKqlString(conversation);
  const lookback = validateKqlDuration(last);
  return `let selected_session = "${escaped}";\nlet base = AppDependencies\n| where TimeGenerated > ago(${lookback})\n| where ${baseFilter}\n| extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};\nlet selected_operations = base\n| where direct_session == selected_session or fallback_session == selected_session\n| distinct OperationId;\nbase\n| extend linked_to_selected = OperationId in (selected_operations)\n| where direct_session == selected_session or fallback_session == selected_session or linked_to_selected\n| extend conversation=iff(linked_to_selected, selected_session, iff(isnotempty(direct_session), direct_session, fallback_session)), operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), model_actual=tostring(Properties["gen_ai.response.model"]), provider=tostring(Properties["gen_ai.provider.name"]), tool=tostring(Properties["gen_ai.tool.name"]), tool_call_id=tostring(Properties["gen_ai.tool.call.id"]), error=tostring(Properties["error.type"]), input_tokens=tolong(Properties["gen_ai.usage.input_tokens"]), output_tokens=tolong(Properties["gen_ai.usage.output_tokens"]), cache_read_tokens=tolong(Properties["gen_ai.usage.cache_read.input_tokens"]), cache_write_tokens=tolong(Properties["gen_ai.usage.cache_creation.input_tokens"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, operation, model, model_actual, provider, tool, tool_call_id, DurationMs, Success, ResultCode, error, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens\n| order by TimeGenerated asc\n| take 200`;
}

function traceQuery(operationId, last = '24h') {
  const escaped = escapeKqlString(operationId);
  const lookback = validateKqlDuration(last);
  return `AppDependencies\n| where TimeGenerated > ago(${lookback})\n| where ${baseFilter}\n| where OperationId == "${escaped}"\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), model_actual=tostring(Properties["gen_ai.response.model"]), provider=tostring(Properties["gen_ai.provider.name"]), tool=tostring(Properties["gen_ai.tool.name"]), tool_call_id=tostring(Properties["gen_ai.tool.call.id"]), error=tostring(Properties["error.type"]), input_tokens=tolong(Properties["gen_ai.usage.input_tokens"]), output_tokens=tolong(Properties["gen_ai.usage.output_tokens"]), cache_read_tokens=tolong(Properties["gen_ai.usage.cache_read.input_tokens"]), cache_write_tokens=tolong(Properties["gen_ai.usage.cache_creation.input_tokens"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, operation, model, model_actual, provider, tool, tool_call_id, DurationMs, Success, ResultCode, error, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens\n| order by TimeGenerated asc\n| take 200`;
}

function fieldCatalogQuery(last = '7d') {
  const lookback = validateKqlDuration(last);
  const contentKeys = contentLikeKeys.map(key => JSON.stringify(key)).join(', ');
  const safeKeys = safeAttributeKeys.map(key => JSON.stringify(key)).join(', ');
  return `let exact_content_keys = dynamic([${contentKeys}]);\nlet known_safe_keys = dynamic([${safeKeys}]);\nAppDependencies\n| where TimeGenerated > ago(${lookback})\n| where ${baseFilter}\n| extend fields = bag_keys(Properties)\n| mv-expand field = fields to typeof(string)\n| summarize observed=count() by field\n| extend content_risk = case(field in (exact_content_keys), "exact-content-key", field !in (known_safe_keys) and field matches regex "(?i)(prompt|completion|message|instruction|argument|result|body|secret|password|credential|cookie|url|filepath|file_path|path|token)", "sensitive-key-family", "")\n| order by content_risk desc, observed desc, field asc\n| take 200`;
}

function contextPressureQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), agent=tostring(Properties["gen_ai.agent.name"]), tool=tostring(Properties["gen_ai.tool.name"]), repo=tostring(Properties["agentops.repo.hash"]), error=tostring(Properties["error.type"]), InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]), OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]), CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]), CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]), Credits=todouble(Properties["github.copilot.cost"]), AIU=todouble(Properties["github.copilot.aiu"])\n| summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), Runs=countif(operation == "invoke_agent"), Failures=countif(Success == false or isnotempty(error)), ChatSpans=countif(operation == "chat"), ChatInputTokens=sumif(InputTokens, operation == "chat"), ChatOutputTokens=sumif(OutputTokens, operation == "chat"), ChatCacheRead=sumif(CacheRead, operation == "chat"), ChatCacheWrite=sumif(CacheWrite, operation == "chat"), ChatCredits=sumif(Credits, operation == "chat"), ChatAIU=sumif(AIU, operation == "chat"), AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"), AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"), AgentCacheRead=maxif(CacheRead, operation == "invoke_agent"), AgentCacheWrite=maxif(CacheWrite, operation == "invoke_agent"), AgentCredits=maxif(Credits, operation == "invoke_agent"), AgentAIU=maxif(AIU, operation == "invoke_agent"), P95DurationMs=percentile(DurationMs, 95), Models=make_set(model, 5), Agents=make_set(agent, 5), Repos=make_set_if(repo, isnotempty(repo), 3), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session=conversation\n| extend InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens), OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens), CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead), CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite), Credits=iff(ChatSpans > 0, ChatCredits, AgentCredits), AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)\n| extend FreshInput=iff(InputTokens - CacheRead - CacheWrite < 0, 0.0, InputTokens - CacheRead - CacheWrite), OutputYieldPct=iff(InputTokens > 0, round(100.0 * OutputTokens / InputTokens, 3), 0.0), CacheLeveragePct=iff(InputTokens > 0, round(100.0 * CacheRead / InputTokens, 1), 0.0), EstUsd=round(Credits * 0.01, 4), DurationSec=round(datetime_diff("millisecond", Ended, Started) / 1000.0, 2)\n| extend Pressure=case(InputTokens >= 100000 and OutputYieldPct < 0.1, "severe_low_yield", InputTokens >= 100000, "severe_context", InputTokens >= 30000 and OutputYieldPct < 0.1, "high_low_yield", InputTokens >= 30000, "high_context", FreshInput >= 30000 and CacheLeveragePct < 10, "low_cache_leverage", EstUsd >= 1.0, "expensive", "ok")\n| where Pressure != "ok"\n| project Started, Session, Pressure, InputTokens, OutputTokens, OutputYieldPct, CacheRead, CacheWrite, FreshInput, CacheLeveragePct, Credits, EstUsd, AIU, DurationSec, P95DurationMs, Runs, Spans, Failures, Models, Agents, Repos, Tools, Errors\n| order by InputTokens desc, EstUsd desc\n| take 100`;
}

function tokenRollupAuditQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), agent=tostring(Properties["gen_ai.agent.name"]), InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]), OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]), CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]), CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]), Credits=todouble(Properties["github.copilot.cost"]), AIU=todouble(Properties["github.copilot.aiu"])\n| summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), ChatSpans=countif(operation == "chat"), AgentSpans=countif(operation == "invoke_agent"), AllSpanInputTokens=sum(InputTokens), AllSpanOutputTokens=sum(OutputTokens), ChatInputTokens=sumif(InputTokens, operation == "chat"), ChatOutputTokens=sumif(OutputTokens, operation == "chat"), AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"), AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"), ChatCredits=sumif(Credits, operation == "chat"), AgentCredits=maxif(Credits, operation == "invoke_agent"), ChatAIU=sumif(AIU, operation == "chat"), AgentAIU=maxif(AIU, operation == "invoke_agent"), Models=make_set(model, 5), Agents=make_set(agent, 5) by Session=conversation\n| extend RecommendedInputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens), RecommendedOutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens), RecommendedCredits=iff(ChatSpans > 0, ChatCredits, AgentCredits), RecommendedAIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)\n| extend TokenOvercountRatio=iff(RecommendedInputTokens > 0, round(AllSpanInputTokens / RecommendedInputTokens, 2), 0.0), RollupMode=iff(ChatSpans > 0, "chat_spans", "invoke_agent_fallback"), NeedsReview=AllSpanInputTokens > RecommendedInputTokens * 1.25\n| project Started, Ended, Session, RollupMode, NeedsReview, TokenOvercountRatio, AllSpanInputTokens, RecommendedInputTokens, AgentInputTokens, ChatInputTokens, AllSpanOutputTokens, RecommendedOutputTokens, AgentOutputTokens, ChatOutputTokens, RecommendedCredits, RecommendedAIU, Spans, ChatSpans, AgentSpans, Models, Agents\n| order by NeedsReview desc, TokenOvercountRatio desc, AllSpanInputTokens desc\n| take 100`;
}

function collectorHealthQuery(last = '24h') {
  const lookback = validateKqlDuration(last);
  return `let lookback = ${lookback};
let copilot = AppDependencies
| where TimeGenerated > ago(lookback)
| where ${copilotOtelFilter}
| where isempty(tostring(Properties["agentops.smoke_id"]))
    and tostring(Properties["agentops.profile"]) !has "smoke"
    and isempty(tostring(Properties["agentops.test.kind"]))
| summarize LastCopilotSpan=max(TimeGenerated), CopilotSpans=count(), AgentOpsSpans=countif(Properties has "agentops."), FailedSpans=countif(Success == false or tostring(Success) =~ "false" or isnotempty(tostring(Properties["error.type"])));
let collectorLogs = AppTraces
| where TimeGenerated > ago(lookback)
| where Message has_any ("otelcol", "azuremonitor", "exporter", "dropped", "retry", "queue", "queued", "sending_queue", "refused", "timeout", "backpressure", "memory_limiter")
| summarize LastCollectorLog=max(TimeGenerated),
    CollectorErrors=countif(SeverityLevel >= 3 or Message has_any ("error", "failed", "dropped", "refused", "timeout")),
    CollectorWarnings=countif(SeverityLevel == 2 or Message has "warn"),
    QueueSignals=countif(Message has_any ("queue", "queued", "sending_queue", "enqueue")),
    DroppedSignals=countif(Message has_any ("dropped", "drop", "refused")),
    RetrySignals=countif(Message has_any ("retry", "retried", "retrying")),
    TimeoutSignals=countif(Message has_any ("timeout", "timed out")),
    BackpressureSignals=countif(Message has_any ("backpressure", "memory_limiter", "queue is full", "sending queue", "refused"));
copilot
| extend joinKey=1
| join kind=fullouter (collectorLogs | extend joinKey=1) on joinKey
| project LastCopilotSpan, CopilotSpans, AgentOpsSpans, FailedSpans, LastCollectorLog, CollectorErrors, CollectorWarnings, QueueSignals, DroppedSignals, RetrySignals, TimeoutSignals, BackpressureSignals
| extend Health=case(isnull(LastCopilotSpan), "no_copilot_spans", CollectorErrors > 0, "collector_errors", BackpressureSignals > 0 or DroppedSignals > 0, "collector_backpressure", "healthy")`;
}

function otelCompatibilityQuery(last = '2h') {
  const lookback = validateKqlDuration(last);
  const metricNames = copilotMetricNames.map(name => `"${name}"`).join(', ');
  const eventNames = copilotEventNames.map(name => `"${name}"`).join(', ');
  return `let lookback = ${lookback};
let expected_metrics = dynamic([${metricNames}]);
let expected_events = dynamic([${eventNames}]);
let span_summary = AppDependencies
| where TimeGenerated > ago(lookback)
| where ${copilotOtelFilter}
| extend operation=tostring(Properties["gen_ai.operation.name"]),
    service=coalesce(AppRoleName, tostring(Properties["service.name"])),
    agent=tostring(Properties["gen_ai.agent.name"]),
    conversation=tostring(Properties["gen_ai.conversation.id"]),
    interaction=tostring(Properties["github.copilot.interaction_id"]),
    model=tostring(Properties["gen_ai.request.model"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    input_tokens=todouble(Properties["gen_ai.usage.input_tokens"]),
    output_tokens=todouble(Properties["gen_ai.usage.output_tokens"]),
    cost=todouble(Properties["github.copilot.cost"]),
    aiu=todouble(Properties["github.copilot.aiu"])
| summarize
    Spans=count(),
    Services=make_set_if(service, isnotempty(service), 10),
    Operations=make_set_if(operation, isnotempty(operation), 10),
    Agents=make_set_if(agent, isnotempty(agent), 10),
    HasOperation=countif(isnotempty(operation)),
    HasSession=countif(isnotempty(conversation) or isnotempty(interaction)),
    HasModel=countif(isnotempty(model)),
    HasTool=countif(isnotempty(tool)),
    HasTokenUsage=countif(isnotnull(input_tokens) or isnotnull(output_tokens)),
    HasCostOrAIU=countif(isnotnull(cost) or isnotnull(aiu)),
    LastSpan=max(TimeGenerated)
| extend joinKey=1;
let metric_summary = union isfuzzy=true AppMetrics
| where TimeGenerated > ago(lookback)
| where Name in (expected_metrics) or tostring(Properties) has_any ("gen_ai", "github.copilot", "copilot_chat")
| summarize
    Metrics=count(),
    MetricNames=make_set(Name, 50),
    HasGenAiMetrics=countif(Name startswith "gen_ai."),
    HasCopilotCliMetrics=countif(Name startswith "github.copilot."),
    HasVsCodeMetrics=countif(Name startswith "copilot_chat."),
    LastMetric=max(TimeGenerated)
| extend joinKey=1;
let event_summary = union isfuzzy=true AppTraces, AppEvents
| where TimeGenerated > ago(lookback)
| extend event=coalesce(tostring(Properties["event.name"]), tostring(Properties["github.copilot.event.name"]), Name)
| where event in (expected_events) or tostring(Properties) has_any ("github.copilot", "copilot_chat", "gen_ai.client.inference") or Message has_any ("github.copilot", "copilot_chat", "gen_ai.client.inference")
| summarize
    Events=count(),
    EventNames=make_set_if(event, isnotempty(event), 50),
    HasLifecycleEvents=countif(event has_any ("session", "hook", "skill", "exception")),
    HasVsCodeEvents=countif(event startswith "copilot_chat."),
    LastEvent=max(TimeGenerated)
| extend joinKey=1;
span_summary
| join kind=fullouter metric_summary on joinKey
| join kind=fullouter event_summary on joinKey
| extend Status=case(Spans == 0, "missing",
    HasOperation == 0 or HasSession == 0, "partial",
    HasModel == 0 or HasTokenUsage == 0, "partial",
    "ready")
| extend Missing=pack_array(
    iff(Spans == 0, "no Copilot/GenAI spans matched", ""),
    iff(Spans > 0 and HasOperation == 0, "gen_ai.operation.name", ""),
    iff(Spans > 0 and HasSession == 0, "gen_ai.conversation.id or github.copilot.interaction_id", ""),
    iff(Spans > 0 and HasModel == 0, "gen_ai.request.model", ""),
    iff(Spans > 0 and HasTokenUsage == 0, "gen_ai.usage.input_tokens/output_tokens", ""),
    iff(Spans > 0 and HasCostOrAIU == 0, "github.copilot.cost or github.copilot.aiu", ""),
    iff(coalesce(Metrics, 0) == 0, "no Copilot/GenAI metrics matched", ""),
    iff(coalesce(Events, 0) == 0, "no Copilot/GenAI events matched", "")
)
| project Status, Spans=coalesce(Spans, 0), Metrics=coalesce(Metrics, 0), Events=coalesce(Events, 0), LastSpan, LastMetric, LastEvent, Services, Operations, Agents, MetricNames, EventNames, HasOperation, HasSession, HasModel, HasTool, HasTokenUsage, HasCostOrAIU, HasGenAiMetrics, HasCopilotCliMetrics, HasVsCodeMetrics, HasLifecycleEvents, HasVsCodeEvents, Missing`;
}

function attributionUsageQuery(last = '7d') {
  const lookback = validateKqlDuration(last);
  return `let lookback = ${lookback};
let dependency_rows = AppDependencies
| where TimeGenerated > ago(lookback)
| where ${copilotOtelFilter}
| extend conversation=${sessionKey},
    operation=tostring(Properties["gen_ai.operation.name"]),
    agentops_agent=coalesce(tostring(Properties["agentops.agent.name"]), tostring(Properties["agentops.cli.agent"]), tostring(Properties["gen_ai.agent.name"])),
    skill=coalesce(tostring(Properties["agentops.skill.name"]), tostring(Properties["github.copilot.skill.name"])),
    tool=tostring(Properties["gen_ai.tool.name"]),
    mcp_server=coalesce(tostring(Properties["agentops.mcp.server"]), tostring(Properties["agentops.mcp.config.servers"]), extract("^mcp__([^_]+)__", 1, tostring(Properties["gen_ai.tool.name"])), extract("^([^/]+)/", 1, tostring(Properties["gen_ai.tool.name"])), iff(tostring(Properties["gen_ai.tool.name"]) startswith "azure-mcp-", "azure-mcp", "")),
    script=coalesce(tostring(Properties["agentops.script.name"]), tostring(Properties["agentops.hook.name"]), tostring(Properties["github.copilot.hook.name"]), tostring(Properties["github.copilot.hook.type"])),
    model=tostring(Properties["gen_ai.request.model"]),
    repo=tostring(Properties["agentops.repo.hash"]),
    error=tostring(Properties["error.type"]),
    InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]),
    OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]),
    AICredits=todouble(Properties["github.copilot.cost"]),
    AIU=todouble(Properties["github.copilot.aiu"])
| project TimeGenerated, conversation, operation, agentops_agent, skill, tool, mcp_server, script, model, repo, DurationMs, Success, error, InputTokens, OutputTokens, AICredits, AIU, Properties;
let event_rows = union isfuzzy=true AppTraces, AppEvents
| where TimeGenerated > ago(lookback)
| where tostring(Properties) has_any ("agentops.", "github.copilot", "copilot_chat", "codex") or Message has_any ("AgentOps", "github.copilot", "copilot_chat", "codex")
| extend conversation=${sessionKey},
    operation=coalesce(tostring(Properties["gen_ai.operation.name"]), tostring(Properties["event.name"]), Name),
    agentops_agent=coalesce(tostring(Properties["agentops.agent.name"]), tostring(Properties["agentops.cli.agent"]), tostring(Properties["gen_ai.agent.name"])),
    skill=coalesce(tostring(Properties["agentops.skill.name"]), tostring(Properties["github.copilot.skill.name"])),
    tool=tostring(Properties["gen_ai.tool.name"]),
    mcp_server=coalesce(tostring(Properties["agentops.mcp.server"]), tostring(Properties["agentops.mcp.config.servers"]), extract("^mcp__([^_]+)__", 1, tostring(Properties["gen_ai.tool.name"])), extract("^([^/]+)/", 1, tostring(Properties["gen_ai.tool.name"])), iff(tostring(Properties["gen_ai.tool.name"]) startswith "azure-mcp-", "azure-mcp", "")),
    script=coalesce(tostring(Properties["agentops.script.name"]), tostring(Properties["agentops.hook.name"]), tostring(Properties["github.copilot.hook.name"]), tostring(Properties["github.copilot.hook.type"])),
    model=tostring(Properties["gen_ai.request.model"]),
    repo=tostring(Properties["agentops.repo.hash"]),
    error=tostring(Properties["error.type"])
| project TimeGenerated, conversation, operation, agentops_agent, skill, tool, mcp_server, script, model, repo, DurationMs=real(null), Success=bool(null), error, InputTokens=real(null), OutputTokens=real(null), AICredits=real(null), AIU=real(null), Properties;
union isfuzzy=true dependency_rows, event_rows
| extend AttributionKind=case(isnotempty(skill), "skill", isnotempty(mcp_server), "mcp", isnotempty(script), "script_or_hook", isnotempty(agentops_agent), "agent", "unattributed"),
    AttributionName=case(isnotempty(skill), skill, isnotempty(mcp_server), mcp_server, isnotempty(script), script, isnotempty(agentops_agent), agentops_agent, "unattributed")
| summarize Started=min(TimeGenerated), LastSeen=max(TimeGenerated), Sessions=dcount(conversation), SpansOrEvents=count(), Failures=countif(Success == false or isnotempty(error)), ToolCalls=countif(operation == "execute_tool" or isnotempty(tool)), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), AICredits=sum(AICredits), AIU=sum(AIU), Models=make_set_if(model, isnotempty(model), 5), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by AttributionKind, AttributionName
| extend EstUsd=round(AICredits * 0.01, 4), FailurePct=iff(SpansOrEvents > 0, round(100.0 * Failures / SpansOrEvents, 1), 0.0)
| where AttributionKind != "unattributed"
| order by Sessions desc, Failures desc, AICredits desc`;
}

function kqlFileQuery(fileName, last = '7d', options = {}) {
  const root = options.root || repoRoot;
  const query = fs.readFileSync(path.join(root, 'kql', fileName), 'utf8');
  return query.replace(/let lookback = [^;]+;/, `let lookback = ${last};`);
}

function buildLink(kind, id, options = {}) {
  const last = options.last || '24h';
  const grafanaBaseUrl = options.grafanaBaseUrl;
  const portalLogsUrl = options.portalLogsUrl;
  const workspaceId = options.workspaceId;
  if (kind === 'session') {
    return {
      kind,
      conversation: id,
      grafana_url: `${grafanaBaseUrl}/d/agentops-session-detail?var-conversation=${encodeGrafanaValue(id)}`,
      azure_portal_url: portalLogsUrl,
      workspace_id: workspaceId,
      query: sessionQuery(id, last)
    };
  }

  if (kind === 'trace') {
    return {
      kind,
      operation_id: id,
      grafana_url: `${grafanaBaseUrl}/d/agentops-traces-spans?var-conversation=__all`,
      azure_portal_url: portalLogsUrl,
      workspace_id: workspaceId,
      query: traceQuery(id, last)
    };
  }

  throw new Error(`Unknown link kind: ${kind}`);
}

module.exports = {
  agentServiceNames,
  attributionUsageQuery,
  baseFilter,
  buildLink,
  collectorHealthQuery,
  contextPressureQuery,
  copilotEventNames,
  copilotMetricNames,
  copilotOtelFilter,
  directSessionKey,
  encodeGrafanaValue,
  fallbackSessionKey,
  fieldCatalogQuery,
  grafanaUrlWithVars,
  kqlFileQuery,
  logAnalyticsTargetWarning,
  otelCompatibilityQuery,
  sessionFallbackPrefix,
  sessionFallbackTurn,
  sessionKey,
  sessionQuery,
  tokenRollupAuditQuery,
  traceQuery
};
