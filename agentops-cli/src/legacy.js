#!/usr/bin/env node

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { createAlerts } = require('./alerts');
const { createPrimitives } = require('./primitives');
const { createRecommendations } = require('./recommendations');
const { createSavedViews } = require('./saved-views');
const { createTelemetry } = require('./telemetry');
const { repoRoot } = require('./lib/paths');
const { classifyToolName, extractAllowedTools } = require('./lib/copilot/tool-classifier');

const root = repoRoot;

function usage() {
  const commands = [
    'setup [--json]',
    'status',
    'latest [--file <jsonl>] [--last <duration>]',
    'live|tail [--file <jsonl>] [--last <duration>] [--follow] [--interval <seconds>]',
    'replay <session|latest> [--file <jsonl>] [--last <duration>]',
    'explain latest [--file <jsonl>] [--last <duration>]',
    'recommend latest [--file <jsonl>] [--last <duration>]',
    'open [--file <jsonl>] [--last <duration>]',
    'workflows list|show <name> [--json]',
    'plugin install|uninstall [--copilot-home <path>] [--force] [--json]',
    'agents list|path|install|uninstall [--copilot-home <path>] [--force] [--json]',
    'skills list|path|install|uninstall [--copilot-home <path>] [--force] [--json]',
    'doctor [--local-only]',
    'scan [--json]',
    'primitives [--last <duration>] [--root <path>]',
    'import-jsonl <file>',
    'custom emit --event <name> --agent <name> [--parent-agent <name>] [--delegation-id <id>] [--workflow <name>] [--step <name>] [--outcome <value>] [--risk <value>] [--score <number>] [--tag <tag>] [--custom key=value] [--attribute key=value] [--dry-run] [--json]',
    'custom import <file> [--agent <name>] [--workflow <name>] [--dry-run] [--json]',
    'configure show|set|import-azd [--json]',
    'install [--shadow-copilot]',
    'otel-setup [--endpoint <url>] [--service-name <name>] [--shell bash|powershell|json]',
    'start|stop',
    'copilot [copilot-args...]',
    'codex [codex-args...]',
    'compat-check [--last <duration>]',
    'validate-collector [endpoint]',
    'validate-azure [--last <duration>] [--production] [--remediation-plan] [--json]',
    'init [--dry-run] [--force-skills] [--json]',
    'smoke [--dry-run] [--endpoint <url>] [--id <smoke-id>] [--last <duration>] [--wait <duration>] [--poll <duration>] [--no-verify] [--json]',
    'attribution-smoke [--dry-run] [--endpoint <url>] [--id <smoke-id>] [--last <duration>] [--wait <duration>] [--poll <duration>] [--no-verify] [--json]',
    'live-replay-smoke [--dry-run] [--endpoint <url>] [--id <smoke-id>] [--last <duration>] [--wait <duration>] [--poll <duration>] [--no-verify] [--json]',
    'validate-enterprise [--json]',
    'ask-context <latest|session-id> [--file <jsonl>] [--last <duration>] [--json]',
    'enable-shadow',
    'disable-shadow',
    'uninstall',
    'collector start|stop',
    'saved-view add <name> --url <url> [--query-file <file>] [--description <text>] [--tag <tag>]',
    'saved-view list|show|open <name>',
    'link session <conversation>',
    'link trace <operationId>',
    'fields [--last <duration>]',
    'context [--last <duration>]',
    'token-rollup-audit [--last <duration>]',
    'collector-health [--last <duration>]',
    'attribution [--last <duration>]',
    'permission-friction [--last <duration>]',
    'alert recommend [--last <duration>]',
    'lineage [--last <duration>]',
    'policy [--last <duration>]',
    'mcp [--last <duration>]',
    'benchmark list',
    'benchmark run <suite> --variant <name> --repeat <n> [--hypothesis <id>] [--dry-run]',
    'benchmark report <run-id> [--azure] [--last <duration>] [--approval-file <json>]',
    'benchmark compare <before-run-id> <after-run-id> [--azure] [--last <duration>] [--approval-file <json>]'
  ];
  return `agentops <command>\n\nCommands:\n  ${commands.join('\n  ')}\n`;
}

const defaultConfigPath = process.env.AGENTOPS_CONFIG_PATH || path.join(os.homedir(), '.agentops', 'config.json');
const agentopsConfig = readAgentOpsConfig({ quiet: true }).values;
const configuredWorkspaceId = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || process.env.LOG_ANALYTICS_WORKSPACE_ID || agentopsConfig.workspaceId || '';
const workspaceId = configuredWorkspaceId || '00000000-0000-0000-0000-000000000000';
const grafanaBaseUrl = (process.env.AGENTOPS_GRAFANA_BASE_URL || agentopsConfig.grafanaBaseUrl || 'https://your-grafana.grafana.azure.com').replace(/\/$/, '');
const mainGrafanaDashboardUrl = `${grafanaBaseUrl}/d/copilot-agentops/copilot-cli-agentops`;
const sessionsGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-sessions/agentops-sessions`;
const v2HomeGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-home`;
const v2RunsGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-runs-explorer`;
const v2ReplayGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-run-replay`;
const grafanaDatasourceUid = process.env.AGENTOPS_GRAFANA_DATASOURCE_UID || agentopsConfig.grafanaDatasourceUid || 'azure-monitor-oob';
const azureSubscriptionId = process.env.AGENTOPS_AZURE_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID || agentopsConfig.subscriptionId || '00000000-0000-0000-0000-000000000000';
const azureResourceGroup = process.env.AGENTOPS_AZURE_RESOURCE_GROUP || process.env.AZURE_RESOURCE_GROUP || agentopsConfig.resourceGroup || 'rg-agentops-dev';
const logAnalyticsWorkspaceName = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || agentopsConfig.workspaceName || 'law-agentops-dev';
const portalLogsUrl = process.env.AGENTOPS_AZURE_PORTAL_LOGS_URL || agentopsConfig.portalLogsUrl || `https://portal.azure.com/#@/resource/subscriptions/${azureSubscriptionId}/resourceGroups/${azureResourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${logAnalyticsWorkspaceName}/logs`;
const agentServiceNames = '("github-copilot", "copilot-chat", "github-copilot-cli", "codex", "openai-codex", "openai-codex-cli")';
const baseFilter = `(Properties has "github.copilot" or Properties has "gen_ai.operation.name" or Properties has "agentops." or AppRoleName in ${agentServiceNames} or tostring(Properties["service.name"]) in ${agentServiceNames} or tostring(Properties["agent.runtime"]) in ("codex", "openai-codex-cli"))`;
const copilotOtelFilter = baseFilter;
const customAttributePrefixes = ['agentops.', 'gen_ai.', 'github.copilot.', 'content.capture.', 'event.', 'error.'];
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
const defaultInstallDir = process.env.AGENTOPS_BIN_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'bin');
const benchmarksDir = path.join(root, 'benchmarks');
const benchmarkRunBaseDir = path.join(os.tmpdir(), 'agentops-benchmark-runs');
const savedViewsPath = process.env.AGENTOPS_VIEWS_PATH || path.join(os.homedir(), '.agentops', 'views.json');

function encodeGrafanaValue(value) {
  return encodeURIComponent(value);
}

function sessionQuery(conversation, last = '24h') {
  const escaped = conversation.replace(/"/g, '\\"');
  return `let selected_session = "${escaped}";\nlet base = AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};\nlet selected_operations = base\n| where direct_session == selected_session or fallback_session == selected_session\n| distinct OperationId;\nbase\n| extend linked_to_selected = OperationId in (selected_operations)\n| where direct_session == selected_session or fallback_session == selected_session or linked_to_selected\n| extend conversation=iff(linked_to_selected, selected_session, iff(isnotempty(direct_session), direct_session, fallback_session)), operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function traceQuery(operationId, last = '24h') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| where OperationId == "${operationId.replace(/"/g, '\\"')}"\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function fieldCatalogQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend fields = bag_keys(Properties)\n| mv-expand field = fields to typeof(string)\n| extend value = tostring(Properties[field])\n| summarize observed=count(), example_values=make_set_if(value, isnotempty(value), 5) by field\n| order by observed desc, field asc`;
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
| where Message has_any ("otelcol", "azuremonitor", "exporter", "dropped", "retry", "queue", "refused", "timeout")
| summarize LastCollectorLog=max(TimeGenerated), CollectorErrors=countif(SeverityLevel >= 3 or Message has_any ("error", "failed", "dropped", "refused", "timeout")), CollectorWarnings=countif(SeverityLevel == 2 or Message has "warn");
copilot
| extend joinKey=1
| join kind=fullouter (collectorLogs | extend joinKey=1) on joinKey
| project LastCopilotSpan, CopilotSpans, AgentOpsSpans, FailedSpans, LastCollectorLog, CollectorErrors, CollectorWarnings
| extend Health=case(isnull(LastCopilotSpan), "no_copilot_spans", CollectorErrors > 0, "collector_errors", "healthy")`;
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

function kqlFileQuery(fileName, last = '7d') {
  const query = fs.readFileSync(path.join(root, 'kql', fileName), 'utf8');
  return query.replace(/let lookback = [^;]+;/, `let lookback = ${last};`);
}

function buildLink(kind, id, options = {}) {
  const last = options.last || '24h';
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

function parseLastArg(args, fallback = '7d') {
  const index = args.indexOf('--last');
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
  return args[index + 1];
}

function validateKqlDuration(value) {
  if (!/^[1-9][0-9]*(s|m|h|d)$/.test(value)) {
    throw new Error('--last must be a duration like 30m, 24h, or 7d');
  }
  return value;
}

function durationToMs(value, fallbackMs) {
  if (value === undefined || value === null || value === '') return fallbackMs;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^([0-9]+)(ms|s|m|h)$/);
  if (!match) throw new Error('duration must look like 500ms, 10s, 2m, or 1h');
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') return amount;
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  return amount * 60 * 60 * 1000;
}

function escapeKqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function commandPlan(command, args = [], platform = process.platform) {
  const isWindows = platform === 'win32';
  const scriptPath = script => path.join(root, 'scripts', script);
  const compactEnv = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const cloudEnv = () => {
    const cloud = configuredCloudValues();
    return compactEnv({
      AZURE_SUBSCRIPTION_ID: cloud.subscriptionId,
      AZURE_RESOURCE_GROUP: cloud.resourceGroup,
      APPLICATIONINSIGHTS_NAME: cloud.appInsightsName,
      AGENTOPS_AZURE_SUBSCRIPTION_ID: cloud.subscriptionId,
      AGENTOPS_AZURE_RESOURCE_GROUP: cloud.resourceGroup,
      AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID: cloud.workspaceId,
      AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME: cloud.workspaceName,
      AGENTOPS_GRAFANA_BASE_URL: cloud.grafanaBaseUrl,
      AGENTOPS_GRAFANA_NAME: cloud.grafanaName,
      AGENTOPS_GRAFANA_DATASOURCE_UID: cloud.grafanaDatasourceUid,
      AGENTOPS_APPLICATIONINSIGHTS_NAME: cloud.appInsightsName
    });
  };

  if (command === 'install') {
    const shadow = !(args.includes('--no-shadow-copilot') || args.includes('--no-shadow'));
    const passThrough = args.filter(arg => !['--shadow-copilot', '--shadow'].includes(arg));
    const psInstallArgs = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (['--shadow-copilot', '--shadow', '--no-shadow-copilot', '--no-shadow'].includes(arg)) continue;
      if (arg === '--no-collector') psInstallArgs.push('-NoCollector');
      else if (arg === '--force-collector') psInstallArgs.push('-ForceCollector');
      else if (arg === '--plugin') psInstallArgs.push('-Plugin');
      else if (arg === '--collector-version') {
        psInstallArgs.push('-CollectorVersion', args[index + 1]);
        index += 1;
      } else if (arg.startsWith('--collector-version=')) {
        psInstallArgs.push('-CollectorVersion', arg.slice('--collector-version='.length));
      } else {
        psInstallArgs.push(arg);
      }
    }
    return isWindows
      ? {
          command: 'pwsh',
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(root, 'install-agentops.ps1'),
            ...(shadow ? ['-ShadowCopilot'] : ['-NoShadowCopilot']),
            ...psInstallArgs
          ]
        }
      : {
          command: path.join(root, 'install-agentops.sh'),
          args: shadow ? passThrough : ['--no-shadow-copilot', ...passThrough.filter(arg => !['--no-shadow-copilot', '--no-shadow'].includes(arg))]
        };
  }

  if (command === 'enable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('install-copilot-agentops-shim.ps1'), '-ShadowCopilot'] }
      : { command: scriptPath('install-copilot-agentops-shim.sh'), args: ['--shadow-copilot'] };
  }

  if (command === 'disable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('uninstall-copilot-agentops-shim.ps1'), '-KeepAgentopsCommand'] }
      : { command: scriptPath('uninstall-copilot-agentops-shim.sh'), args: ['--keep-agentops-command'] };
  }

  if (command === 'uninstall') {
    const psUninstallArgs = args.map(arg => ({
      '--keep-plugin': '-KeepPlugin',
      '--keep-collector': '-KeepCollector',
      '--keep-binary': '-KeepBinary',
      '--purge': '-Purge',
      '--keep-agentops-command': '-KeepAgentopsCommand'
    }[arg] || arg));
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'uninstall-agentops.ps1'), ...psUninstallArgs] }
      : { command: path.join(root, 'uninstall-agentops.sh'), args };
  }

  if (command === 'copilot') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('copilot-agentops.ps1'), ...args], env: cloudEnv() }
      : { command: scriptPath('copilot-agentops'), args, env: cloudEnv() };
  }

  if (command === 'codex') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('agentops-codex.ps1'), ...args], env: cloudEnv() }
      : { command: scriptPath('agentops-codex'), args, env: cloudEnv() };
  }

  if (command === 'collector' || command === 'start' || command === 'stop') {
    const action = command === 'start' ? 'start' : command === 'stop' ? 'stop' : args[0];
    if (action === 'start') {
      return isWindows
        ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('collector-azuremonitor-up.ps1')], env: cloudEnv() }
        : { command: scriptPath('collector-azuremonitor-up.sh'), args: [], env: cloudEnv() };
    }
    if (action === 'stop') {
      return { command: 'docker', args: ['compose', '-f', path.join(root, 'collector', 'docker-compose.azuremonitor.yaml'), 'down'], env: cloudEnv() };
    }
    throw new Error('collector requires start or stop');
  }

  throw new Error(`No command plan for: ${command}`);
}

function runPlannedCommand(plan) {
  let executable = plan.command;
  if (executable === 'pwsh' && process.platform === 'win32' && commandCandidates('pwsh').length === 0) {
    executable = 'powershell.exe';
  }

  const result = childProcess.spawnSync(executable, plan.args, { stdio: 'inherit', env: { ...process.env, ...(plan.env || {}) } });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, predicate, results);
    if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function parseFrontmatter(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const yaml = text.slice(3, end).trim();
  const data = {};

  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    data[match[1]] = value;
  }

  return data;
}

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function repoHash() {
  const gitConfig = path.join(root, '.git', 'config');
  if (!fs.existsSync(gitConfig)) return hashText('unknown');
  const text = fs.readFileSync(gitConfig, 'utf8');
  const match = text.match(/url = (.+)/);
  return hashText(match ? match[1].trim() : 'unknown');
}

function commandCandidates(commandName) {
  const pathValue = process.env.PATH || '';
  const pathExt = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const names = process.platform === 'win32' && !path.extname(commandName)
    ? pathExt.map(ext => `${commandName}${ext.toLowerCase()}`).concat(pathExt.map(ext => `${commandName}${ext.toUpperCase()}`))
    : [commandName];
  const seen = new Set();
  const results = [];

  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      if (fs.existsSync(candidate)) results.push(candidate);
    }
  }

  return results;
}

function installedShimStatus(installDir = defaultInstallDir) {
  const shadowName = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
  const agentopsName = process.platform === 'win32' ? 'copilot-agentops.cmd' : 'copilot-agentops';
  const agentopsCliName = process.platform === 'win32' ? 'agentops.cmd' : 'agentops';
  const shadowPath = path.join(installDir, shadowName);
  const agentopsPath = path.join(installDir, agentopsName);
  const agentopsCliPath = path.join(installDir, agentopsCliName);
  const copilotCommands = commandCandidates('copilot');
  const installDirFull = path.resolve(installDir);
  const firstCopilot = copilotCommands[0] || null;
  const shadowInstalled = fs.existsSync(shadowPath);
  const shadowFirst = firstCopilot ? path.resolve(firstCopilot).startsWith(installDirFull) : false;
  const realCopilot = copilotCommands.find(candidate => !path.resolve(candidate).startsWith(installDirFull)) || null;

  return {
    install_dir: installDir,
    agentops_cli_installed: fs.existsSync(agentopsCliPath),
    agentops_cli_path: agentopsCliPath,
    copilot_agentops_installed: fs.existsSync(agentopsPath),
    copilot_agentops_path: agentopsPath,
    shadow_installed: shadowInstalled,
    shadow_path: shadowPath,
    plain_copilot_observed: shadowInstalled && shadowFirst,
    first_copilot_on_path: firstCopilot,
    real_copilot: realCopilot,
    copilot_candidates: copilotCommands
  };
}

function defaultCopilotHome() {
  return process.env.AGENTOPS_COPILOT_HOME || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function listDefaultSkills(sourceDir = path.join(root, 'plugin', 'skills')) {
  if (!fs.existsSync(sourceDir)) return [];

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const skillDir = path.join(sourceDir, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return null;
      const frontmatter = parseFrontmatter(skillFile);
      return {
        name: frontmatter.name || entry.name,
        directory: entry.name,
        description: frontmatter.description || '',
        source: skillFile
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listDefaultAgents(sourceDir = path.join(root, 'plugin', 'agents')) {
  if (!fs.existsSync(sourceDir)) return [];

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map(entry => {
      const agentFile = path.join(sourceDir, entry.name);
      const frontmatter = parseFrontmatter(agentFile);
      return {
        name: frontmatter.name || entry.name.replace(/\.agent\.md$/, ''),
        file: entry.name,
        description: frontmatter.description || '',
        source: agentFile
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function skillInstallTarget(options = {}) {
  const copilotHome = path.resolve(options.copilotHome || defaultCopilotHome());
  const targetDir = path.resolve(options.skillsDir || path.join(copilotHome, 'skills'));
  return { copilotHome, targetDir };
}

function agentInstallTarget(options = {}) {
  const copilotHome = path.resolve(options.copilotHome || defaultCopilotHome());
  const targetDir = path.resolve(options.agentsDir || path.join(copilotHome, 'agents'));
  return { copilotHome, targetDir };
}

function installDefaultSkills(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'skills'));
  const { copilotHome, targetDir } = skillInstallTarget(options);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const skills = listDefaultSkills(sourceDir);
  const installedSkills = [];
  const updated = [];
  const skipped = [];

  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  for (const skill of skills) {
    const sourceSkillDir = path.dirname(skill.source);
    const targetSkillDir = path.join(targetDir, skill.directory);
    const targetExists = fs.existsSync(targetSkillDir);

    if (targetExists && !force) {
      skipped.push({ name: skill.name, target: targetSkillDir, reason: 'exists' });
      continue;
    }

    if (!dryRun) {
      if (targetExists) fs.rmSync(targetSkillDir, { recursive: true, force: true });
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
    }

    const record = { name: skill.name, target: targetSkillDir };
    if (targetExists) updated.push(record);
    else installedSkills.push(record);
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    force,
    dryRun,
    skills,
    installed: installedSkills.length,
    installedSkills,
    updated,
    skipped
  };
}

function uninstallDefaultSkills(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'skills'));
  const { copilotHome, targetDir } = skillInstallTarget(options);
  const dryRun = Boolean(options.dryRun);
  const skills = listDefaultSkills(sourceDir);
  const removed = [];
  const missing = [];

  for (const skill of skills) {
    const targetSkillDir = path.join(targetDir, skill.directory);
    if (!fs.existsSync(targetSkillDir)) {
      missing.push({ name: skill.name, target: targetSkillDir });
      continue;
    }

    if (!dryRun) fs.rmSync(targetSkillDir, { recursive: true, force: true });
    removed.push({ name: skill.name, target: targetSkillDir });
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    dryRun,
    skills,
    removed,
    missing
  };
}

function installDefaultAgents(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'agents'));
  const { copilotHome, targetDir } = agentInstallTarget(options);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const agents = listDefaultAgents(sourceDir);
  const installedAgents = [];
  const updated = [];
  const skipped = [];

  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  for (const agent of agents) {
    const targetFile = path.join(targetDir, agent.file);
    const targetExists = fs.existsSync(targetFile);

    if (targetExists && !force) {
      skipped.push({ name: agent.name, target: targetFile, reason: 'exists' });
      continue;
    }

    if (!dryRun) {
      fs.copyFileSync(agent.source, targetFile);
    }

    const record = { name: agent.name, target: targetFile };
    if (targetExists) updated.push(record);
    else installedAgents.push(record);
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    force,
    dryRun,
    agents,
    installed: installedAgents.length,
    installedAgents,
    updated,
    skipped
  };
}

function uninstallDefaultAgents(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'agents'));
  const { copilotHome, targetDir } = agentInstallTarget(options);
  const dryRun = Boolean(options.dryRun);
  const agents = listDefaultAgents(sourceDir);
  const removed = [];
  const missing = [];

  for (const agent of agents) {
    const targetFile = path.join(targetDir, agent.file);
    if (!fs.existsSync(targetFile)) {
      missing.push({ name: agent.name, target: targetFile });
      continue;
    }

    if (!dryRun) fs.rmSync(targetFile, { force: true });
    removed.push({ name: agent.name, target: targetFile });
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    dryRun,
    agents,
    removed,
    missing
  };
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function renderSkillsInstall(result) {
  const lines = [
    `Installed AgentOps skills into ${result.targetDir}.`,
    `${plural(result.installed, 'new skill')}; ${plural(result.updated.length, 'updated skill')}; skipped ${plural(result.skipped.length, 'existing skill')}.`
  ];

  if (result.skills.length > 0) {
    lines.push('', 'Available skills:');
    for (const skill of result.skills) lines.push(`- ${skill.name}`);
    const starterSkill = result.skills.find(skill => skill.name === 'agentops-live-triage') || result.skills[0];
    lines.push('', `Ask Copilot: Use ${starterSkill.name} to inspect the latest AgentOps run.`);
  }

  if (result.skipped.length > 0) {
    lines.push('Run `agentops skills install --force` to refresh skipped skills from this repo.');
  }

  return `${lines.join('\n')}\n`;
}

function renderSkillsUninstall(result) {
  const lines = [
    `Removed AgentOps skills from ${result.targetDir}.`,
    `${plural(result.removed.length, 'skill')} removed; ${plural(result.missing.length, 'skill')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

function renderAgentsInstall(result) {
  const lines = [
    `Installed AgentOps agents into ${result.targetDir}.`,
    `${plural(result.installed, 'new agent')}; ${plural(result.updated.length, 'updated agent')}; skipped ${plural(result.skipped.length, 'existing agent')}.`
  ];

  if (result.agents.length > 0) {
    lines.push('', 'Available agents:');
    for (const agent of result.agents) lines.push(`- ${agent.name}`);
    const starterAgent = result.agents.find(agent => agent.name === 'agentops-orchestrator') || result.agents[0];
    lines.push('', `Ask Copilot: Use ${starterAgent.name} to route my AgentOps question.`);
  }

  if (result.skipped.length > 0) {
    lines.push('Run `agentops agents install --force` to refresh skipped agents from this repo.');
  }

  return `${lines.join('\n')}\n`;
}

function renderAgentsUninstall(result) {
  const lines = [
    `Removed AgentOps agents from ${result.targetDir}.`,
    `${plural(result.removed.length, 'agent')} removed; ${plural(result.missing.length, 'agent')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

function installPlugin(options = {}) {
  return {
    agents: installDefaultAgents(options),
    skills: installDefaultSkills(options)
  };
}

function uninstallPlugin(options = {}) {
  return {
    agents: uninstallDefaultAgents(options),
    skills: uninstallDefaultSkills(options)
  };
}

function renderPluginInstall(result) {
  const lines = [
    'Installed AgentOps Copilot plugin files.',
    `Agents: ${plural(result.agents.installed, 'new agent')}; ${plural(result.agents.updated.length, 'updated agent')}; skipped ${plural(result.agents.skipped.length, 'existing agent')}.`,
    `Skills: ${plural(result.skills.installed, 'new skill')}; ${plural(result.skills.updated.length, 'updated skill')}; skipped ${plural(result.skills.skipped.length, 'existing skill')}.`,
    '',
    'Ask Copilot: Use agentops-orchestrator to run the first read-only AgentOps check.',
    'Remove later with `agentops plugin uninstall`.'
  ];
  return `${lines.join('\n')}\n`;
}

function renderPluginUninstall(result) {
  const lines = [
    'Removed AgentOps Copilot plugin files.',
    `Agents: ${plural(result.agents.removed.length, 'agent')} removed; ${plural(result.agents.missing.length, 'agent')} already absent.`,
    `Skills: ${plural(result.skills.removed.length, 'skill')} removed; ${plural(result.skills.missing.length, 'skill')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

function parseSkillsArgs(args) {
  const subcommand = args[0] || 'install';
  const rest = args.slice(1);
  return {
    subcommand,
    copilotHome: optionValue(rest, ['--copilot-home', '--home']),
    force: rest.includes('--force'),
    dryRun: rest.includes('--dry-run'),
    json: rest.includes('--json')
  };
}

function agentopsWorkflows() {
  const cli = 'node agentops-cli/src/index.js';
  return [
    {
      name: 'setup',
      skill: 'agentops-setup',
      description: 'Install the local Collector binary, local shim, and safe defaults.',
      prompt: 'Use agentops-setup to check my AgentOps install and tell me the next command to run.',
      commands: [
        `${cli} setup`,
        `${cli} validate-enterprise`,
        'az login',
        'azd provision',
        `${cli} install`,
        './setup-agentops.sh',
        './setup-agentops.ps1',
        `${cli} configure show`,
        `${cli} configure import-azd`,
        `${cli} experimental init`,
        `${cli} validate-azure`,
        `${cli} collector smoke --privacy strict --poison`,
        `${cli} experimental smoke --wait 2m --poll 10s`,
        `${cli} plugin install`,
        `${cli} status`,
        `${cli} doctor --local-only`
      ]
    },
    {
      name: 'orchestrate',
      skill: 'agentops-orchestrator',
      description: 'Route setup, triage, attribution, dashboard, benchmark, and operations questions to the right AgentOps skill.',
      prompt: 'Use agentops-orchestrator to figure out which AgentOps workflow I need and run the first read-only check.',
      commands: [
        `${cli} workflows list`,
        `${cli} workflows show setup`,
        `${cli} workflows show latest-run`,
        `${cli} workflows show attribution`,
        `${cli} workflows show dashboard`,
        `${cli} workflows show science-mode`,
        `${cli} workflows show operations`
      ]
    },
    {
      name: 'latest-run',
      skill: 'agentops-live-triage',
      description: 'Inspect the latest observed Copilot CLI run.',
      prompt: 'Use agentops-live-triage to explain the latest run and recommend one next action.',
      commands: [
        'copilot -p "Reply with exactly: agentops smoke."',
        `${cli} open`,
        `${cli} latest --last 7d`,
        `${cli} explain latest --last 7d`,
        `${cli} recommend latest --last 7d`,
        `${cli} live --last 2h`,
        `${cli} replay latest --last 7d`,
        `${cli} ask-context latest --last 2h`
      ]
    },
    {
      name: 'attribution',
      skill: 'agentops-attribution',
      description: 'Filter telemetry by custom agent, skill, MCP server/tool, script, or hook.',
      prompt: 'Use agentops-attribution to show usage, failures, cost, and tools for my custom agents, skills, MCP servers, and hooks.',
      commands: [
        `${cli} attribution --last 7d`,
        `${cli} primitives --last 7d`,
        `${cli} mcp --last 7d`,
        `${cli} lineage --last 24h`,
        `${cli} link session <conversation-id>`
      ]
    },
    {
      name: 'dashboard',
      skill: 'agentops-dashboard-ops',
      description: 'Open, rebuild, import, and deep-link Grafana dashboards.',
      prompt: 'Use agentops-dashboard-ops to open the AgentOps dashboard and create a link for this session.',
      commands: [
        `${cli} open`,
        `${cli} link session <conversation>`,
        `${cli} link trace <operationId>`,
        'node scripts/build-grafana-dashboard-pack.js',
        'AZURE_RESOURCE_GROUP=rg-agentops-dev GRAFANA_NAME=graf-agentops-dev ./scripts/grafana-import-dashboard.sh'
      ]
    },
    {
      name: 'science-mode',
      skill: 'agentops-benchmark-gate',
      description: 'Run repeatable benchmark checks before keeping agent changes.',
      prompt: 'Use agentops-benchmark-gate to compare my baseline and candidate benchmark runs.',
      commands: [
        `${cli} benchmark list`,
        `${cli} benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy --dry-run`,
        `${cli} benchmark run starter --variant baseline --repeat 1 --hypothesis safer-tool-policy`,
        `${cli} benchmark report <run-id>`,
        `${cli} benchmark compare <baseline-run-id> <variant-run-id> --azure --last 24h`
      ]
    },
    {
      name: 'offline-test',
      skill: 'agentops-live-triage',
      description: 'Use local JSONL fixtures when Azure telemetry is not available.',
      prompt: 'Use agentops-live-triage with the sample JSONL fixture to explain a local tool failure.',
      commands: [
        `${cli} latest --file tests/sample-otel/tool-failure.jsonl`,
        `${cli} explain latest --file tests/sample-otel/tool-failure.jsonl`,
        `${cli} recommend latest --file tests/sample-otel/tool-failure.jsonl`,
        `${cli} live --file tests/sample-otel/tool-failure.jsonl`,
        `${cli} replay latest --file tests/sample-otel/tool-failure.jsonl`
      ]
    },
    {
      name: 'analyst-mode',
      skill: 'agentops-evidence-prompts',
      description: 'Generate read-only KQL, links, saved views, and investigation prompts.',
      prompt: 'Use agentops-evidence-prompts to investigate the last 24 hours and propose one safe improvement.',
      commands: [
        `${cli} fields --last 7d`,
        `${cli} context --last 7d`,
        `${cli} token-rollup-audit --last 14d`,
        `${cli} collector-health --last 24h`,
        `${cli} policy --last 7d`,
        `${cli} mcp --last 7d`,
        `${cli} lineage --last 24h`,
        `${cli} permission-friction --last 7d`,
        `${cli} alert recommend --last 14d`,
        `${cli} ask-context latest --last 24h`,
        `${cli} saved-view add latest-risk --session <conversation-id> --tag risk`,
        `${cli} saved-view list`
      ]
    },
    {
      name: 'primitive-inventory',
      skill: 'agentops-primitive-inventory',
      description: 'Show which agents, skills, hooks, MCP tools, and other primitives are configured or observed.',
      prompt: 'Use agentops-primitive-inventory to inventory this repo and explain any missing runtime signals.',
      commands: [
        `${cli} primitives --last 7d`,
        `${cli} primitives --root /path/to/awesome-copilot --last 7d`
      ]
    },
    {
      name: 'operations',
      skill: 'agentops-operations',
      description: 'Check health, stop collector, disable shadowing, or uninstall safely.',
      prompt: 'Use agentops-operations to check health and choose the safest cleanup command.',
      commands: [
        `${cli} status`,
        `${cli} validate-collector`,
        `${cli} collector-health --last 24h`,
        `${cli} disable-shadow`,
        `${cli} collector stop`,
        `${cli} plugin uninstall`,
        `${cli} uninstall`
      ]
    }
  ];
}

function parseWorkflowsArgs(args) {
  return {
    subcommand: args[0] || 'list',
    name: args[1],
    json: args.includes('--json')
  };
}

function renderWorkflow(workflow) {
  const lines = [
    `${workflow.name}: ${workflow.description}`,
    `Skill: ${workflow.skill}`,
    `Ask Copilot: ${workflow.prompt}`,
    '',
    'Commands:'
  ];
  for (const command of workflow.commands) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function renderWorkflowsList(workflows = agentopsWorkflows()) {
  const lines = ['AgentOps workflows', ''];
  for (const workflow of workflows) {
    lines.push(`- ${workflow.name}: ${workflow.description}`);
    lines.push(`  Skill: ${workflow.skill}`);
    lines.push(`  Ask: ${workflow.prompt}`);
  }
  lines.push('', 'Run `agentops workflows show <name>` to print the commands for one workflow.');
  return `${lines.join('\n')}\n`;
}

function optionValue(args, names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      return args[index + 1];
    }
  }
  return null;
}

function checkByName(checks, name) {
  return checks.find(check => check.name === name);
}

function agentopsStatusSummary({ checks = doctor({ localOnly: true }) } = {}) {
  const required = checks.filter(check => check.name.startsWith('exists:'));
  const missing = required.filter(check => !check.ok).map(check => check.name.slice('exists:'.length));
  const contentCapture = checkByName(checks, 'content-capture-disabled');
  const httpLocal = checkByName(checks, 'collector-http-localhost');
  const grpcLocal = checkByName(checks, 'collector-grpc-localhost');
  const agentopsCli = checkByName(checks, 'agentops-command');
  const agentopsShim = checkByName(checks, 'copilot-agentops-command');
  const shadowShim = checkByName(checks, 'plain-copilot-shadow');

  return {
    ok: checks.every(check => check.ok),
    required_files: {
      found: required.length - missing.length,
      total: required.length,
      missing
    },
    content_capture_off: Boolean(contentCapture?.ok),
    collector_localhost: Boolean(httpLocal?.ok && grpcLocal?.ok),
    shim: {
      agentops_cli: agentopsCli?.status || 'unknown',
      agentops_command: agentopsShim?.status || 'unknown',
      shadow: shadowShim?.status || 'unknown',
      first_copilot_on_path: shadowShim?.first_copilot_on_path || null,
      real_copilot: shadowShim?.real_copilot || null
    }
  };
}

function renderStatus(summary = agentopsStatusSummary()) {
  const lines = [
    'AgentOps status',
    '',
    `Required files: ${summary.required_files.found} of ${summary.required_files.total} found.`
  ];

  if (summary.required_files.missing.length > 0) {
    lines.push(`Missing files: ${summary.required_files.missing.join(', ')}.`);
  }

  lines.push(summary.content_capture_off
    ? 'Content capture: off. Prompts/code were not recorded.'
    : 'Content capture: on. Turn it off before sharing telemetry.');
  lines.push(summary.collector_localhost
    ? 'Collector config: localhost for HTTP and gRPC.'
    : 'Collector config: not confirmed as localhost.');

  const agentopsCli = summary.shim.agentops_cli === 'installed' ? 'installed' : 'not installed';
  const agentopsCommand = summary.shim.agentops_command === 'installed' ? 'installed' : 'not installed';
  const shadow = summary.shim.shadow === 'observed'
    ? 'plain copilot is routed through AgentOps'
    : summary.shim.shadow === 'installed_not_first_on_path'
      ? 'installed, but not first on PATH'
      : summary.shim.shadow === 'not_installed'
        ? 'plain copilot shadow is not installed'
      : summary.shim.shadow.replace(/_/g, ' ');
  lines.push(`Shim: agentops is ${agentopsCli}; copilot-agentops is ${agentopsCommand}; ${shadow}.`);

  return `${lines.join('\n')}\n`;
}

function setupToolStatus(name, options = {}) {
  if (name === 'node') {
    return { name, ok: true, path: process.execPath, version: process.version };
  }

  const availability = options.commandAvailability || {};
  if (Object.prototype.hasOwnProperty.call(availability, name)) {
    return {
      name,
      ok: Boolean(availability[name]),
      path: options.commandPaths?.[name] || null
    };
  }

  const candidates = commandCandidates(name);
  return { name, ok: candidates.length > 0, path: candidates[0] || null };
}

function azdEnvironmentStatus(options = {}, azdAvailable = true) {
  if (!azdAvailable) {
    return { checked: false, ok: false, values: {}, detail: 'azd is not available on PATH.' };
  }

  if (Object.prototype.hasOwnProperty.call(options, 'azdValues')) {
    const values = configFromEnvValues(parseEnvAssignments(options.azdValues));
    return {
      checked: true,
      ok: Object.keys(values).length > 0,
      values,
      detail: Object.keys(values).length > 0
        ? 'azd environment contains AgentOps outputs.'
        : 'azd environment does not contain AgentOps outputs yet.'
    };
  }

  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('azd', ['env', 'get-values'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    return { checked: true, ok: false, values: {}, detail: result.error.message };
  }
  if (result.status !== 0) {
    const rawDetail = (result.stderr || result.stdout || `azd exited with status ${result.status}`).trim();
    const detail = /out of date/i.test(rawDetail) && !/error|failed|not found/i.test(rawDetail)
      ? 'azd env get-values did not return AgentOps outputs. Run azd provision or select the right azd environment.'
      : rawDetail;
    return {
      checked: true,
      ok: false,
      values: {},
      detail
    };
  }

  const values = configFromEnvValues(parseEnvAssignments(result.stdout));
  return {
    checked: true,
    ok: Object.keys(values).length > 0,
    values,
    detail: Object.keys(values).length > 0
      ? 'azd environment contains AgentOps outputs.'
      : 'azd environment does not contain AgentOps outputs yet.'
  };
}

function parseSetupArgs(args) {
  return {
    json: args.includes('--json')
  };
}

function agentopsSetupGuide(options = {}) {
  const tools = ['node', 'az', 'azd', 'docker', 'copilot']
    .map(name => setupToolStatus(name, options));
  const toolByName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  const shim = installedShimStatus(options.installDir || defaultInstallDir);
  const cloud = configuredCloudValues(options);
  const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
  const cloudConfigured = workspaceConfigured && grafanaConfigured;
  const azd = azdEnvironmentStatus(options, toolByName.azd.ok);
  const dashboardCloud = cloudConfigured ? cloud : { ...cloud, ...azd.values };

  const phases = [
    {
      name: '1. Provision Azure once',
      status: cloudConfigured ? 'done' : (azd.ok ? 'ready-to-import' : 'needed'),
      commands: cloudConfigured ? ['agentops configure show'] : ['az login', 'azd provision'],
      verify: 'agentops configure import-azd'
    },
    {
      name: '2. Install local wrapper',
      status: shim.agentops_cli_installed && shim.copilot_agentops_installed ? 'done' : 'needed',
      commands: [
        './setup-agentops.sh',
        'export PATH="$HOME/.local/bin:$PATH"'
      ],
      verify: 'agentops status'
    },
    {
      name: '3. Bind local CLI to Azure outputs',
      status: cloudConfigured ? 'done' : (azd.ok ? 'needed' : 'blocked'),
      commands: cloudConfigured
        ? ['agentops configure show']
        : azd.ok
        ? ['agentops configure import-azd']
        : ['agentops configure set --resource-group <resource-group> --workspace-id <workspace-id> --grafana-url https://<your-grafana>.grafana.azure.com --grafana-name <grafana-resource-name> --app-insights-name <app-insights-name>'],
      verify: 'agentops configure show'
    },
    {
      name: '4. Validate and smoke test',
      status: cloudConfigured ? 'ready' : 'blocked',
      commands: [
        'agentops validate-enterprise',
        'agentops validate-azure',
        'agentops collector smoke --privacy strict --poison'
      ],
      verify: 'agentops latest --last 2h'
    },
    {
      name: '5. Observe a real run',
      status: cloudConfigured ? 'ready' : 'blocked',
      commands: [
        'copilot -p "Reply with exactly: agentops smoke."',
        'agentops latest --last 2h',
        'agentops open'
      ],
      verify: 'Open the newest row in the Sessions dashboard.'
    }
  ];

  const firstRun = {
    name: 'First-run loop',
    ready: cloudConfigured && shim.agentops_cli_installed && shim.copilot_agentops_installed,
    read_only: true,
    setup_command: 'agentops setup',
    bind_command: cloudConfigured
      ? 'agentops configure show'
      : azd.ok
      ? 'agentops configure import-azd'
      : 'az login && azd provision && agentops configure import-azd',
    privacy_smoke_command: 'agentops collector smoke --privacy strict --poison --json',
    smoke_command: 'agentops smoke --real-copilot --wait 2m --poll 10s',
    run_command: realCopilotSmokeCommand(),
    latest_command: 'agentops latest --last 2h',
    replay_command: 'agentops replay latest --last 2h',
    open_command: 'agentops open latest --last 2h',
    dashboard_import_command: grafanaDashboardImportCommand(dashboardCloud),
    dashboard_verify_command: 'agentops dashboard verify --live --last 24h --json',
    content_command: 'agentops content status --json',
    privacy_note: 'Prompts and responses stay off by default. Use agentops content opt-in only when you intentionally want transcript rows.'
  };

  const next = [];
  const missingTools = tools.filter(tool => !tool.ok).map(tool => tool.name);
  if (missingTools.length > 0) {
    next.push(`Install missing tools: ${missingTools.join(', ')}.`);
  }
  if (!workspaceConfigured || !grafanaConfigured) {
    if (azd.ok) {
      next.push('agentops configure import-azd');
    } else {
      next.push('az login');
      next.push('azd provision');
      next.push('agentops configure import-azd');
    }
  }
  if (!shim.agentops_cli_installed || !shim.copilot_agentops_installed) {
    next.push('./setup-agentops.sh');
  }
  if (!shim.plain_copilot_observed) {
    next.push('export PATH="$HOME/.local/bin:$PATH"');
  }
  next.push('agentops validate-enterprise');
  next.push('agentops validate-azure');
  next.push('agentops collector smoke --privacy strict --poison');
  next.push('copilot -p "Reply with exactly: agentops smoke."');
  next.push('agentops latest --last 2h');
  next.push('agentops open');

  return {
    ok: tools.every(tool => tool.ok) &&
      shim.agentops_cli_installed &&
      shim.copilot_agentops_installed &&
      cloudConfigured,
    mode: 'guide',
    mutates: false,
    tools,
    azd,
    shim,
    first_run: firstRun,
    cloud: {
      resource_group: cloud.resourceGroup,
      workspace_id_configured: workspaceConfigured,
      workspace_name: cloud.workspaceName || null,
      grafana_url_configured: grafanaConfigured,
      grafana_name: cloud.grafanaName || null,
      app_insights_name: cloud.appInsightsName || null
    },
    phases,
    next
  };
}

function renderSetupGuide(result) {
  const lines = [
    'AgentOps setup guide',
    '',
    'This command is read-only. It does not create Azure resources or change local files.',
    '',
    'Detected tools:'
  ];

  for (const tool of result.tools) {
    const detail = tool.path ? ` (${tool.path})` : '';
    const version = tool.version ? ` ${tool.version}` : '';
    lines.push(`- ${tool.name}: ${tool.ok ? 'found' : 'missing'}${version}${detail}`);
  }

  lines.push('', `azd environment: ${result.azd.ok ? 'AgentOps outputs found' : result.azd.detail}`);
  lines.push(`Local shim: agentops=${result.shim.agentops_cli_installed ? 'installed' : 'missing'}, copilot-agentops=${result.shim.copilot_agentops_installed ? 'installed' : 'missing'}, plain copilot=${result.shim.plain_copilot_observed ? 'observed' : 'not observed'}.`);
  lines.push(`Cloud config: workspace=${result.cloud.workspace_id_configured ? 'set' : 'missing'}, grafana=${result.cloud.grafana_url_configured ? 'set' : 'missing'}.`);

  lines.push('', 'One-minute first run:');
  lines.push(`1. Setup/bind: ${result.first_run.bind_command}`);
  lines.push(`2. Privacy smoke: ${result.first_run.privacy_smoke_command}`);
  lines.push(`3. Real smoke: ${result.first_run.smoke_command}`);
  lines.push(`4. See it: ${result.first_run.latest_command} && ${result.first_run.open_command}`);
  lines.push(`5. Dashboards: ${result.first_run.dashboard_import_command} && ${result.first_run.dashboard_verify_command}`);
  lines.push(`Privacy: ${result.first_run.privacy_note}`);

  lines.push('', 'Fastest path:');
  for (const phase of result.phases) {
    lines.push('', `${phase.name} (${phase.status})`);
    for (const command of phase.commands) lines.push(`  ${command}`);
    lines.push(`  verify: ${phase.verify}`);
  }

  lines.push('', 'Run next:');
  for (const command of result.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function scan() {
  const agents = walk(path.join(root, 'plugin', 'agents'), file => file.endsWith('.agent.md')).map(file => ({
    path: path.relative(root, file),
    definition_hash: hashText(fs.readFileSync(file, 'utf8')),
    ...parseFrontmatter(file)
  }));

  const skills = walk(path.join(root, 'plugin', 'skills'), file => path.basename(file) === 'SKILL.md').map(file => ({
    path: path.relative(root, file),
    definition_hash: hashText(fs.readFileSync(file, 'utf8')),
    ...parseFrontmatter(file)
  }));

  const hookPath = path.join(root, 'plugin', 'hooks.json');
  const hooks = fs.existsSync(hookPath) ? JSON.parse(fs.readFileSync(hookPath, 'utf8')) : null;

  const mcpPath = path.join(root, 'plugin', '.mcp.json');
  const mcp = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf8')) : null;

  return {
    repo_hash: repoHash(),
    timestamp: new Date().toISOString(),
    agents,
    skills,
    hooks,
    mcp_servers: mcp ? Object.keys(mcp.mcpServers || mcp.servers || {}) : []
  };
}

function doctor({ localOnly }) {
  const checks = [];
  const requiredFiles = [
    'copilot/copilot-observe',
    'copilot/copilot-observe.ps1',
    'collector/otelcol.local.yaml',
    'collector/docker-compose.yaml',
    'plugin/plugin.json',
    'plugin/hooks.json',
    'scripts/copilot-agentops',
    'scripts/copilot-agentops.ps1',
    'scripts/install-copilot-agentops-shim.sh',
    'scripts/install-copilot-agentops-shim.ps1',
    'scripts/uninstall-copilot-agentops-shim.sh',
    'scripts/uninstall-copilot-agentops-shim.ps1',
    'azure.yaml',
    '.azure/deployment-plan.md'
  ];

  for (const file of requiredFiles) {
    checks.push({ name: `exists:${file}`, ok: fs.existsSync(path.join(root, file)) });
  }

  const contentCapture = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true';
  checks.push({ name: 'content-capture-disabled', ok: !contentCapture });

  const localConfig = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.yaml'), 'utf8');
  checks.push({ name: 'collector-http-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4318') });
  checks.push({ name: 'collector-grpc-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4317') });

  const scanResult = scan();
  checks.push({ name: 'agents-present', ok: scanResult.agents.length >= 1 });
  checks.push({ name: 'skills-present', ok: scanResult.skills.length >= 1 });

  const shim = installedShimStatus();
  checks.push({
    name: 'agentops-command',
    ok: true,
    status: shim.agentops_cli_installed ? 'installed' : 'not_installed',
    path: shim.agentops_cli_path
  });
  checks.push({
    name: 'copilot-agentops-command',
    ok: true,
    status: shim.copilot_agentops_installed ? 'installed' : 'not_installed',
    path: shim.copilot_agentops_path
  });
  checks.push({
    name: 'plain-copilot-shadow',
    ok: true,
    status: shim.plain_copilot_observed ? 'observed' : (shim.shadow_installed ? 'installed_not_first_on_path' : 'not_installed'),
    first_copilot_on_path: shim.first_copilot_on_path,
    real_copilot: shim.real_copilot,
    shadow_path: shim.shadow_path
  });

  if (!localOnly) {
    checks.push({ name: 'azure-validation', ok: false, note: 'Run azure-validate before deployment.' });
  }

  return checks;
}

function normalizeAgentOpsConfig(raw = {}) {
  return {
    subscriptionId: raw.subscriptionId || raw.azureSubscriptionId || raw.AZURE_SUBSCRIPTION_ID || raw.AGENTOPS_AZURE_SUBSCRIPTION_ID || '',
    resourceGroup: raw.resourceGroup || raw.azureResourceGroup || raw.AZURE_RESOURCE_GROUP || raw.AGENTOPS_AZURE_RESOURCE_GROUP || '',
    workspaceId: raw.workspaceId || raw.logAnalyticsWorkspaceId || raw.LOG_ANALYTICS_WORKSPACE_ID || raw.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || '',
    workspaceName: raw.workspaceName || raw.logAnalyticsWorkspaceName || raw.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || '',
    grafanaBaseUrl: (raw.grafanaBaseUrl || raw.grafanaUrl || raw.AGENTOPS_GRAFANA_BASE_URL || '').replace(/\/$/, ''),
    grafanaName: raw.grafanaName || raw.GRAFANA_NAME || raw.AGENTOPS_GRAFANA_NAME || '',
    grafanaDatasourceUid: raw.grafanaDatasourceUid || raw.datasourceUid || raw.AGENTOPS_GRAFANA_DATASOURCE_UID || '',
    appInsightsName: raw.appInsightsName || raw.applicationInsightsName || raw.APPLICATIONINSIGHTS_NAME || raw.AGENTOPS_APPLICATIONINSIGHTS_NAME || '',
    portalLogsUrl: raw.portalLogsUrl || raw.AGENTOPS_AZURE_PORTAL_LOGS_URL || ''
  };
}

function compactConfig(config) {
  return Object.fromEntries(Object.entries(normalizeAgentOpsConfig(config)).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function readAgentOpsConfig(options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  if (!fs.existsSync(configPath)) {
    return { path: configPath, exists: false, values: {} };
  }

  try {
    return {
      path: configPath,
      exists: true,
      values: compactConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')))
    };
  } catch (error) {
    if (options.quiet) return { path: configPath, exists: true, values: {}, error: error.message };
    throw new Error(`Could not read AgentOps config at ${configPath}: ${error.message}`);
  }
}

function writeAgentOpsConfig(values, options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  const existing = readAgentOpsConfig({ configPath, quiet: true }).values;
  const next = compactConfig({ ...existing, ...values });
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { path: configPath, exists: true, values: next, dryRun: Boolean(options.dryRun) };
}

function parseEnvAssignments(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\"/g, '"');
  }
  return values;
}

function configFromEnvValues(values = {}) {
  return compactConfig({
    subscriptionId: values.AGENTOPS_AZURE_SUBSCRIPTION_ID || values.AZURE_SUBSCRIPTION_ID,
    resourceGroup: values.AGENTOPS_AZURE_RESOURCE_GROUP || values.AZURE_RESOURCE_GROUP,
    workspaceId: values.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || values.LOG_ANALYTICS_WORKSPACE_ID,
    workspaceName: values.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || values.LOG_ANALYTICS_WORKSPACE_NAME,
    grafanaBaseUrl: values.AGENTOPS_GRAFANA_BASE_URL || values.GRAFANA_ENDPOINT,
    grafanaName: values.AGENTOPS_GRAFANA_NAME || values.GRAFANA_NAME,
    grafanaDatasourceUid: values.AGENTOPS_GRAFANA_DATASOURCE_UID,
    appInsightsName: values.AGENTOPS_APPLICATIONINSIGHTS_NAME || values.APPLICATIONINSIGHTS_NAME,
    portalLogsUrl: values.AGENTOPS_AZURE_PORTAL_LOGS_URL
  });
}

function parseConfigureSetArgs(args) {
  const map = {
    '--subscription-id': 'subscriptionId',
    '--resource-group': 'resourceGroup',
    '--workspace-id': 'workspaceId',
    '--workspace-name': 'workspaceName',
    '--grafana-url': 'grafanaBaseUrl',
    '--grafana-name': 'grafanaName',
    '--datasource-uid': 'grafanaDatasourceUid',
    '--app-insights-name': 'appInsightsName',
    '--portal-logs-url': 'portalLogsUrl'
  };
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' || arg === '--dry-run') continue;
    const key = map[arg];
    if (!key) throw new Error(`Unknown configure set option: ${arg}`);
    if (!args[index + 1]) throw new Error(`${arg} requires a value`);
    values[key] = args[index + 1];
    index += 1;
  }
  return compactConfig(values);
}

function parseConfigureArgs(args) {
  const subcommandIndex = args.findIndex(arg => !arg.startsWith('--'));
  const subcommand = subcommandIndex === -1 ? 'show' : args[subcommandIndex];
  const subcommandArgs = subcommandIndex === -1 ? args : args.slice(subcommandIndex + 1);
  return {
    subcommand,
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run'),
    values: subcommand === 'set' ? parseConfigureSetArgs(subcommandArgs) : {}
  };
}

function parseOtelSetupArgs(args = []) {
  const options = {
    endpoint: 'http://127.0.0.1:4318',
    serviceName: 'github-copilot',
    shell: 'bash',
    captureContent: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--endpoint') {
      if (!args[index + 1]) throw new Error('--endpoint requires a URL');
      options.endpoint = args[index + 1];
      index += 1;
    } else if (arg === '--service-name') {
      if (!args[index + 1]) throw new Error('--service-name requires a value');
      options.serviceName = args[index + 1];
      index += 1;
    } else if (arg === '--shell') {
      if (!args[index + 1]) throw new Error('--shell requires bash, powershell, or json');
      options.shell = args[index + 1];
      index += 1;
    } else if (arg === '--capture-content') {
      options.captureContent = true;
    } else {
      throw new Error(`Unknown otel-setup option: ${arg}`);
    }
  }
  if (!['bash', 'powershell', 'json'].includes(options.shell)) {
    throw new Error('--shell must be bash, powershell, or json');
  }
  return options;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildOtelSetup(options = {}) {
  const endpoint = options.endpoint || 'http://127.0.0.1:4318';
  const serviceName = options.serviceName || 'github-copilot';
  const captureContent = Boolean(options.captureContent);
  const resourceAttributes = [
    'agent.framework=github-copilot',
    `agent.runtime=${serviceName}`,
    'agentops.profile=bring-your-own-otel'
  ].join(',');
  const env = {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_SERVICE_NAME: serviceName,
    OTEL_RESOURCE_ATTRIBUTES: resourceAttributes,
    COPILOT_OTEL_ENABLED: 'true',
    COPILOT_OTEL_ENDPOINT: endpoint,
    COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http',
    COPILOT_OTEL_PROTOCOL: 'http',
    COPILOT_OTEL_CAPTURE_CONTENT: captureContent ? 'true' : 'false',
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: captureContent ? 'true' : 'false'
  };
  const vscode = {
    'github.copilot.chat.otel.enabled': true,
    'github.copilot.chat.otel.exporterType': 'otlp-http',
    'github.copilot.chat.otel.otlpEndpoint': endpoint,
    'github.copilot.chat.otel.captureContent': captureContent,
    'github.copilot.chat.otel.maxAttributeSizeChars': 0,
    'github.copilot.chat.otel.dbSpanExporter.enabled': false
  };
  const fileExport = {
    vscode: {
      'github.copilot.chat.otel.enabled': true,
      'github.copilot.chat.otel.exporterType': 'file',
      'github.copilot.chat.otel.outfile': './copilot-otel.jsonl',
      'github.copilot.chat.otel.captureContent': captureContent
    },
    env: {
      COPILOT_OTEL_ENABLED: 'true',
      COPILOT_OTEL_EXPORTER_TYPE: 'file',
      COPILOT_OTEL_FILE_EXPORTER_PATH: './copilot-otel.jsonl',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: captureContent ? 'true' : 'false',
      COPILOT_OTEL_CAPTURE_CONTENT: captureContent ? 'true' : 'false'
    }
  };
  const sdkTypescript = `import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  telemetry: {
    otlpEndpoint: "${endpoint}",
    exporterType: "otlp-http",
    sourceName: "github.copilot",
    captureContent: ${captureContent}
  }
});`;

  return { endpoint, serviceName, captureContent, env, vscode, fileExport, sdkTypescript };
}

function renderOtelSetup(setup, options = {}) {
  if (options.shell === 'json') return `${JSON.stringify(setup, null, 2)}\n`;
  const lines = [
    'AgentOps bring-your-own-OTel setup',
    '',
    'VS Code settings.json:',
    JSON.stringify(setup.vscode, null, 2),
    '',
    'Copilot CLI terminal environment:'
  ];

  if (options.shell === 'powershell') {
    for (const [key, value] of Object.entries(setup.env)) {
      lines.push(`$env:${key} = "${String(value).replace(/"/g, '`"')}"`);
    }
  } else {
    for (const [key, value] of Object.entries(setup.env)) {
      lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }

  lines.push(
    '',
    'Copilot SDK TypeScript:',
    setup.sdkTypescript,
    '',
    'Optional JSONL file export for offline review:',
    JSON.stringify(setup.fileExport, null, 2),
    '',
    'Then point Copilot at the AgentOps collector and run:',
    './scripts/collector-azuremonitor-up.sh',
    'agentops collector start',
    'agentops compat-check --last 2h',
    '',
    'No installed CLI is required for ingestion; use kql/22-otel-compatibility.kql directly in Log Analytics if you want a pure manual check.'
  );

  return `${lines.join('\n')}\n`;
}

function agentopsConfigure(options = {}) {
  const configPath = options.configPath || defaultConfigPath;
  const subcommand = options.subcommand || 'show';
  if (subcommand === 'show') {
    return { action: 'show', ...readAgentOpsConfig({ configPath }) };
  }
  if (subcommand === 'set') {
    if (Object.keys(options.values || {}).length === 0) throw new Error('configure set requires at least one value');
    return { action: 'set', ...writeAgentOpsConfig(options.values, { configPath, dryRun: options.dryRun }) };
  }
  if (subcommand === 'import-azd') {
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const result = spawnSync('azd', ['env', 'get-values'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (result.error) {
      return { action: 'import-azd', path: configPath, ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return { action: 'import-azd', path: configPath, ok: false, error: (result.stderr || result.stdout || `azd exited with status ${result.status}`).trim() };
    }
    const values = configFromEnvValues(parseEnvAssignments(result.stdout));
    if (Object.keys(values).length === 0) {
      return { action: 'import-azd', path: configPath, ok: false, error: 'azd env get-values did not include AgentOps configuration values' };
    }
    return { action: 'import-azd', ok: true, ...writeAgentOpsConfig(values, { configPath, dryRun: options.dryRun }) };
  }
  throw new Error('configure requires show, set, or import-azd');
}

function renderConfigure(result) {
  const lines = ['AgentOps config', '', `Path: ${result.path}`];
  if (result.error) lines.push(`Status: ${result.error}`);
  if (result.dryRun) lines.push('Mode: dry-run');
  const values = result.values || {};
  const labels = [
    ['subscriptionId', 'Subscription'],
    ['resourceGroup', 'Resource group'],
    ['workspaceId', 'Workspace ID'],
    ['workspaceName', 'Workspace name'],
    ['grafanaBaseUrl', 'Grafana URL'],
    ['grafanaName', 'Grafana resource'],
    ['grafanaDatasourceUid', 'Grafana datasource UID'],
    ['appInsightsName', 'Application Insights'],
    ['portalLogsUrl', 'Portal logs URL']
  ];
  for (const [key, label] of labels) {
    lines.push(`${label}: ${values[key] || 'not set'}`);
  }
  lines.push('', 'Next:');
  lines.push('- agentops validate-azure');
  lines.push('- agentops collector smoke --privacy strict --poison');
  return `${lines.join('\n')}\n`;
}

function configuredCloudValues(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readAgentOpsConfig({ configPath: options.configPath, quiet: true }).values;
  const optionValueOr = (key, ...values) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) return options[key];
    return values.find(value => value !== undefined && value !== null && value !== '') || '';
  };
  const configuredGrafanaBaseUrl = optionValueOr('grafanaBaseUrl', env.AGENTOPS_GRAFANA_BASE_URL, config.grafanaBaseUrl);
  return {
    subscriptionId: optionValueOr('subscriptionId', env.AGENTOPS_AZURE_SUBSCRIPTION_ID, env.AZURE_SUBSCRIPTION_ID, config.subscriptionId),
    resourceGroup: optionValueOr('resourceGroup', env.AGENTOPS_AZURE_RESOURCE_GROUP, env.AZURE_RESOURCE_GROUP, config.resourceGroup, azureResourceGroup),
    workspaceId: optionValueOr('workspaceId', env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID, env.LOG_ANALYTICS_WORKSPACE_ID, config.workspaceId),
    workspaceName: optionValueOr('workspaceName', env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME, config.workspaceName, logAnalyticsWorkspaceName),
    grafanaBaseUrl: configuredGrafanaBaseUrl.replace(/\/$/, ''),
    grafanaName: optionValueOr('grafanaName', env.AGENTOPS_GRAFANA_NAME, env.GRAFANA_NAME, config.grafanaName),
    grafanaDatasourceUid: optionValueOr('grafanaDatasourceUid', env.AGENTOPS_GRAFANA_DATASOURCE_UID, config.grafanaDatasourceUid, grafanaDatasourceUid),
    appInsightsName: optionValueOr('appInsightsName', env.APPLICATIONINSIGHTS_NAME, env.AGENTOPS_APPLICATIONINSIGHTS_NAME, config.appInsightsName, 'appi-agentops-dev')
  };
}

function listGrafanaDashboardFiles(options = {}) {
  const dirs = [options.grafanaDir || path.join(root, 'grafana')];
  if (options.includeV2 !== false) dirs.push(path.join(root, 'grafana', 'dashboards', 'v2'));
  return dirs.flatMap(dir => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(dir, file));
  })
    .map(fullPath => {
      const dashboard = readJson(fullPath);
      return {
        file: path.relative(root, fullPath),
        uid: dashboard.uid || path.basename(file, '.json'),
        title: dashboard.title || path.basename(file, '.json')
      };
    })
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

function flattenGrafanaList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.dashboards)) return payload.dashboards;
  if (Array.isArray(payload?.dataSources)) return payload.dataSources;
  if (Array.isArray(payload?.datasources)) return payload.datasources;
  return [];
}

function grafanaItemUid(item) {
  return item?.uid || item?.dashboard?.uid || item?.model?.uid || item?.slug || item?.name || item?.title || '';
}

function grafanaDashboardImportCommand(cloud) {
  const args = [
    'agentops dashboard import --yes',
    cloud.resourceGroup ? `--resource-group ${cloud.resourceGroup}` : null,
    cloud.grafanaName ? `--grafana-name ${cloud.grafanaName}` : null
  ].filter(Boolean);
  return args.join(' ');
}

function runGrafanaDashboardImportRemediation(cloud, options = {}) {
  const args = [
    path.join(root, 'agentops-cli', 'src', 'index.js'),
    'dashboard',
    'import',
    '--yes',
    ...(cloud.resourceGroup ? ['--resource-group', cloud.resourceGroup] : []),
    ...(cloud.grafanaName ? ['--grafana-name', cloud.grafanaName] : [])
  ];
  const spawnSync = options.spawnDashboardImport || options.spawnSync || childProcess.spawnSync;
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    command: grafanaDashboardImportCommand(cloud),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null
  };
}

function isConfiguredValue(value, placeholderPattern) {
  return Boolean(value) && !placeholderPattern.test(value);
}

function parseInitArgs(args) {
  return {
    dryRun: args.includes('--dry-run'),
    forceSkills: args.includes('--force-skills') || args.includes('--force'),
    json: args.includes('--json'),
    noSkills: args.includes('--no-skills') || args.includes('--no-plugin'),
    provisionCloud: args.includes('--provision-cloud'),
    copilotHome: optionValue(args, ['--copilot-home', '--home'])
  };
}

function runInitCloudProvision(options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const command = options.azdCommand || 'azd';
  const provisionArgs = options.azdProvisionArgs || ['provision'];
  const commandText = `${command} ${provisionArgs.join(' ')}`;
  if (options.dryRun) {
    return {
      requested: true,
      dry_run: true,
      ok: true,
      command: commandText,
      import_result: { dryRun: true, action: 'import-azd' },
      failing_stage: null,
      next: []
    };
  }

  const provision = spawnSync(command, provisionArgs, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  const provisionOk = provision.status === 0 && !provision.error;
  const importResult = provisionOk
    ? agentopsConfigure({
        subcommand: 'import-azd',
        configPath: options.configPath,
        dryRun: false,
        spawnSync
      })
    : null;
  const importOk = importResult?.ok === true;
  const failingStage = !provisionOk ? 'azd provision' : importOk ? null : 'agentops configure import-azd';
  const next = !provisionOk
    ? [
        'az login',
        'azd env list',
        commandText,
        'agentops init --dry-run --provision-cloud'
      ]
    : importOk
      ? []
      : [
          'azd env get-values',
          'agentops configure import-azd',
          'agentops configure set --workspace-id "<workspace-id>"',
          'agentops configure set --grafana-url "https://<your-grafana>.grafana.azure.com"'
        ];

  return {
    requested: true,
    dry_run: false,
    ok: provisionOk && importOk,
    command: commandText,
    failing_stage: failingStage,
    provision: {
      ok: provisionOk,
      status: provision.status,
      stdout: provision.stdout || '',
      stderr: provision.stderr || '',
      error: provision.error?.message || null
    },
    import_result: importResult,
    next
  };
}

function agentopsInit(options = {}) {
  const checks = doctor({ localOnly: true });
  const status = agentopsStatusSummary({ checks });
  const cloud = configuredCloudValues(options);
  const shim = installedShimStatus(options.installDir || defaultInstallDir);
  const skills = options.noSkills
    ? null
    : installDefaultSkills({
        copilotHome: options.copilotHome,
        force: options.forceSkills,
        dryRun: options.dryRun
      });
  const agents = options.noSkills
    ? null
    : installDefaultAgents({
        copilotHome: options.copilotHome,
        force: options.forceSkills,
        dryRun: options.dryRun
      });
  const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
  const azdTool = setupToolStatus('azd', options);
  const azd = azdEnvironmentStatus(options, azdTool.ok);
  const cloudProvision = options.provisionCloud
    ? runInitCloudProvision(options)
    : {
        requested: false,
        dry_run: Boolean(options.dryRun),
        ok: null,
        command: 'agentops init --provision-cloud'
      };
  const next = [];

  if (!shim.agentops_cli_installed) {
    next.push('./install-agentops.sh');
  }
  if (!shim.plain_copilot_observed) {
    next.push('node agentops-cli/src/index.js enable-shadow');
  }
  if (!workspaceConfigured || !grafanaConfigured) {
    if (azd.ok) {
      next.push('agentops configure import-azd');
    } else if (!options.provisionCloud) {
      next.push('agentops init --provision-cloud');
    } else {
      if (!workspaceConfigured) {
        next.push('agentops configure set --workspace-id "<workspace-id>"');
      }
      if (!grafanaConfigured) {
        next.push('agentops configure set --grafana-url "https://<your-grafana>.grafana.azure.com"');
      }
    }
  }
  next.push('node agentops-cli/src/index.js validate-azure --import-dashboards --last 24h');
  next.push('node agentops-cli/src/index.js collector smoke --privacy strict --poison --json');
  next.push('node agentops-cli/src/index.js smoke --real-copilot --wait 2m --poll 10s');
  next.push('node agentops-cli/src/index.js latest --last 2h');
  next.push('node agentops-cli/src/index.js open latest --last 2h');
  next.push('node agentops-cli/src/index.js triage latest --out .agentops/triage/latest --json');
  next.push('node agentops-cli/src/index.js plugin uninstall');

  return {
    ok: status.ok && Boolean(shim.agentops_cli_installed) && Boolean(shim.copilot_agentops_installed) && workspaceConfigured && grafanaConfigured,
    mode: options.dryRun ? 'dry-run' : 'local-init',
    local_status: status,
    azd,
    cloud_provision: cloudProvision,
    skills,
    agents,
    shim,
    cloud: {
      resource_group: cloud.resourceGroup,
      workspace_id_configured: workspaceConfigured,
      grafana_url_configured: grafanaConfigured,
      grafana_name_configured: Boolean(cloud.grafanaName),
      app_insights_name: cloud.appInsightsName
    },
    next
  };
}

function renderInit(result) {
  const lines = [
    'AgentOps init',
    '',
    `Mode: ${result.mode}.`,
    `Local files: ${result.local_status.required_files.found} of ${result.local_status.required_files.total} found.`,
    result.local_status.content_capture_off
      ? 'Content capture: off.'
      : 'Content capture: on; turn it off before sharing telemetry.',
    result.local_status.collector_localhost
      ? 'Collector config: localhost confirmed.'
      : 'Collector config: localhost not confirmed.',
    `Shim: agentops=${result.shim.agentops_cli_installed ? 'installed' : 'missing'}, copilot-agentops=${result.shim.copilot_agentops_installed ? 'installed' : 'missing'}, plain copilot=${result.shim.plain_copilot_observed ? 'observed' : 'not observed'}.`,
    `Cloud config: workspace=${result.cloud.workspace_id_configured ? 'set' : 'missing'}, grafana=${result.cloud.grafana_url_configured ? 'set' : 'missing'}.`,
    `azd environment: ${result.azd.ok ? 'AgentOps outputs found.' : result.azd.detail}`
  ];

  if (result.cloud_provision.requested) {
    lines.push(`Cloud provision: ${result.cloud_provision.ok ? 'ready' : 'needs review'} (${result.cloud_provision.command}).`);
    if (!result.cloud_provision.ok && result.cloud_provision.failing_stage) {
      lines.push(`Cloud provision failed at: ${result.cloud_provision.failing_stage}.`);
    }
    if (!result.cloud_provision.ok && result.cloud_provision.next?.length) {
      lines.push('Cloud provision next:');
      for (const command of result.cloud_provision.next) lines.push(`- ${command}`);
    }
  }

  if (result.skills) {
    lines.push(`Skills: ${plural(result.skills.installed, 'new skill')}; ${plural(result.skills.updated.length, 'updated skill')}; skipped ${plural(result.skills.skipped.length, 'existing skill')}.`);
  }
  if (result.agents) {
    lines.push(`Agents: ${plural(result.agents.installed, 'new agent')}; ${plural(result.agents.updated.length, 'updated agent')}; skipped ${plural(result.agents.skipped.length, 'existing agent')}.`);
  }

  lines.push('', 'Next commands:');
  for (const command of result.next) lines.push(`- ${command}`);
  lines.push('', 'First value: run the real smoke, then open the V2 Run Replay link it prints.');
  lines.push('', 'Plugin files are reversible: run `agentops plugin uninstall` to remove only the bundled AgentOps agents and skills from Copilot home.');
  return `${lines.join('\n')}\n`;
}

function smokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function attributionSmokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-attribution-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function liveReplaySmokeId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-live-replay-smoke-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function liveReplayGrafanaUrl(id, last = '2h') {
  return `${grafanaBaseUrl}/d/agentops-live-replay/agentops-live-replay?from=now-${encodeGrafanaValue(validateKqlDuration(last))}&to=now&timezone=browser&refresh=30s&var-conversation=${encodeGrafanaValue(id)}&var-agentops_agent=__all&var-mcp_server=__all&var-tool=__all`;
}

function smokeAzureQuery(id, last = '2h') {
  const lookback = validateKqlDuration(last);
  const escapedId = escapeKqlString(id);
  return `AppDependencies\n| where TimeGenerated > ago(${lookback})\n| where Properties has "${escapedId}" or Name has "${escapedId}"\n| project TimeGenerated, Name, OperationId, Id, Success, ResultCode, Properties\n| order by TimeGenerated desc\n| take 20`;
}

function otlpSmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const spanId = crypto.randomBytes(8).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const end = start + 100000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'safe-default'),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.smoke', version: '0.1.0' },
            spans: [
              {
                traceId,
                spanId,
                name: `agentops.smoke.${id}`,
                kind: 1,
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: end.toString(),
                attributes: [
                  attr('agentops.smoke_id', id),
                  attr('gen_ai.operation.name', 'smoke_test'),
                  { key: 'content.capture.enabled', value: { boolValue: false } }
                ],
                status: { code: 1 }
              }
            ]
          }
        ]
      }
    ]
  };
}

function otlpAttributionSmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });
  const boolAttr = (key, boolValue) => ({ key, value: { boolValue } });
  const intAttr = (key, intValue) => ({ key, value: { intValue: String(intValue) } });
  const span = (name, offsetMs, durationMs, attributes) => {
    const spanStart = start + BigInt(offsetMs) * 1000000n;
    const spanEnd = spanStart + BigInt(durationMs) * 1000000n;
    return {
      traceId,
      spanId: crypto.randomBytes(8).toString('hex'),
      name,
      kind: 1,
      startTimeUnixNano: spanStart.toString(),
      endTimeUnixNano: spanEnd.toString(),
      attributes: [
        attr('agentops.smoke_id', id),
        attr('agentops.test.kind', 'attribution'),
        attr('gen_ai.conversation.id', id),
        boolAttr('content.capture.enabled', false),
        ...attributes
      ],
      status: { code: 1 }
    };
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'attribution-smoke'),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.attribution-smoke', version: '0.1.0' },
            spans: [
              span(`agentops.attribution.${id}.agent`, 0, 100, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-kitchen-sink-smoke'),
                attr('agentops.agent.name', 'agentops-kitchen-sink-smoke'),
                attr('agentops.agent.file', 'agentops-kitchen-sink-smoke.agent.md'),
                intAttr('gen_ai.usage.input_tokens', 1200),
                intAttr('gen_ai.usage.output_tokens', 80),
                attr('github.copilot.cost', '0.2')
              ]),
              span(`agentops.attribution.${id}.skill`, 110, 40, [
                attr('gen_ai.operation.name', 'skill.invoke'),
                attr('agentops.skill.name', 'agentops-attribution'),
                attr('agentops.skill.file', 'agentops-attribution/SKILL.md')
              ]),
              span(`agentops.attribution.${id}.mcp`, 160, 60, [
                attr('gen_ai.operation.name', 'execute_tool'),
                attr('gen_ai.tool.name', 'azure-mcp/monitor_query'),
                attr('agentops.mcp.server', 'azure-mcp'),
                attr('agentops.mcp.tool', 'monitor_query')
              ]),
              span(`agentops.attribution.${id}.script`, 230, 30, [
                attr('gen_ai.operation.name', 'hook.execute'),
                attr('agentops.script.name', 'pre-tool-policy'),
                attr('agentops.script.file', 'plugin/scripts/pre-tool-policy.js'),
                attr('agentops.hook.name', 'preToolUse')
              ])
            ]
          }
        ]
      }
    ]
  };
}

function otlpLiveReplaySmokeTracePayload(id, nowMs = Date.now()) {
  const traceId = crypto.randomBytes(16).toString('hex');
  const orchestratorSpanId = crypto.randomBytes(8).toString('hex');
  const delegationSpanId = crypto.randomBytes(8).toString('hex');
  const subagentSpanId = crypto.randomBytes(8).toString('hex');
  const start = BigInt(nowMs) * 1000000n;
  const attr = (key, stringValue) => ({ key, value: { stringValue } });
  const boolAttr = (key, boolValue) => ({ key, value: { boolValue } });
  const intAttr = (key, intValue) => ({ key, value: { intValue: String(intValue) } });
  const span = (spanId, name, offsetMs, durationMs, attributes, parentSpanId = undefined) => {
    const spanStart = start + BigInt(offsetMs) * 1000000n;
    const spanEnd = spanStart + BigInt(durationMs) * 1000000n;
    return {
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      kind: 1,
      startTimeUnixNano: spanStart.toString(),
      endTimeUnixNano: spanEnd.toString(),
      attributes: [
        attr('agentops.smoke_id', id),
        attr('agentops.test.kind', 'live-replay'),
        attr('gen_ai.conversation.id', id),
        boolAttr('content.capture.enabled', false),
        ...attributes
      ],
      status: { code: 1 }
    };
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr('service.name', 'github-copilot-cli'),
            attr('service.namespace', 'copilot-agentops'),
            attr('agent.framework', 'github-copilot'),
            attr('agent.runtime', 'github-copilot-cli'),
            attr('agentops.profile', 'live-replay-smoke'),
            attr('agentops.smoke_id', id)
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agentops.live-replay-smoke', version: '0.1.0' },
            spans: [
              span(orchestratorSpanId, `agentops.live_replay.${id}.orchestrator`, 0, 380, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.agent.file', 'agentops-orchestrator.agent.md'),
                intAttr('gen_ai.usage.input_tokens', 900),
                intAttr('gen_ai.usage.output_tokens', 120),
                attr('github.copilot.cost', '0.12')
              ]),
              span(delegationSpanId, `agentops.live_replay.${id}.delegation.started`, 70, 40, [
                attr('gen_ai.operation.name', 'agent.delegation.started'),
                attr('agentops.event.name', 'agent.delegation.started'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                attr('agentops.step.name', 'delegate-investigation')
              ], orchestratorSpanId),
              span(subagentSpanId, `agentops.live_replay.${id}.subagent`, 120, 180, [
                attr('gen_ai.operation.name', 'invoke_agent'),
                attr('gen_ai.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                intAttr('gen_ai.usage.input_tokens', 400),
                intAttr('gen_ai.usage.output_tokens', 60),
                attr('github.copilot.cost', '0.08')
              ], delegationSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.skill`, 160, 35, [
                attr('gen_ai.operation.name', 'skill.invoke'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.skill.name', 'agentops-live-triage'),
                attr('agentops.skill.file', 'agentops-live-triage/SKILL.md')
              ], subagentSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.mcp`, 210, 70, [
                attr('gen_ai.operation.name', 'execute_tool'),
                attr('agentops.agent.name', 'agentops-investigator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('gen_ai.tool.name', 'azure-mcp/monitor_query'),
                attr('agentops.mcp.server', 'azure-mcp'),
                attr('agentops.mcp.tool', 'monitor_query')
              ], subagentSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.script`, 300, 30, [
                attr('gen_ai.operation.name', 'hook.execute'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.script.name', 'pre-tool-policy'),
                attr('agentops.script.file', 'plugin/scripts/pre-tool-policy.js'),
                attr('agentops.hook.name', 'preToolUse')
              ], orchestratorSpanId),
              span(crypto.randomBytes(8).toString('hex'), `agentops.live_replay.${id}.delegation.completed`, 340, 30, [
                attr('gen_ai.operation.name', 'agent.delegation.completed'),
                attr('agentops.event.name', 'agent.delegation.completed'),
                attr('agentops.agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.parent_agent.name', 'agentops-orchestrator-smoke'),
                attr('agentops.delegation.id', `${id}-delegation-1`),
                attr('agentops.workflow.name', 'live-replay-e2e'),
                attr('agentops.outcome', 'completed')
              ], delegationSpanId)
            ]
          }
        ]
      }
    ]
  };
}

function postJson(url, payload, options = {}) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'POST',
      timeout: options.timeoutMs || 2500,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        statusCode: res.statusCode,
        body: responseBody
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', error => resolve({ ok: false, error: error.message }));
    req.end(body);
  });
}

function parseSmokeArgs(args) {
  return {
    dryRun: args.includes('--dry-run'),
    endpoint: optionValue(args, ['--endpoint']),
    id: optionValue(args, ['--id']),
    last: parseLastArg(args, '2h'),
    realCopilot: args.includes('--real-copilot') || args.includes('--copilot'),
    copilotTimeoutMs: durationToMs(optionValue(args, ['--timeout']), 120000),
    verify: !args.includes('--no-verify'),
    waitMs: durationToMs(optionValue(args, ['--wait']), 60000),
    pollMs: durationToMs(optionValue(args, ['--poll']), 10000),
    json: args.includes('--json')
  };
}

function realCopilotSmokeArgs() {
  return [
    '--no-ask-user',
    '--no-remote',
    '--add-dir',
    '.',
    "--allow-tool=shell(pwd)",
    "--allow-tool=shell(ls:*)",
    '-p',
    'Do not edit files. Run pwd and ls docs | head, then summarize.'
  ];
}

function commandShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function realCopilotSmokeCommand() {
  return `copilot ${realCopilotSmokeArgs().map(commandShellQuote).join(' ')}`;
}

function runRealCopilotSmoke(options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const command = options.copilotCommand || 'copilot';
  const args = realCopilotSmokeArgs();
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      AGENTOPS_PRIVACY_MODE: 'strict',
      AGENTOPS_CAPTURE_CONTENT: 'false',
      COPILOT_OTEL_CAPTURE_CONTENT: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: options.endpoint || 'http://127.0.0.1:4318'
    },
    encoding: 'utf8',
    timeout: durationToMs(options.copilotTimeoutMs ?? options.timeout, 120000),
    maxBuffer: 1024 * 1024
  });
  const status = result.status === null || result.status === undefined ? 1 : result.status;
  return {
    ok: status === 0 && !result.error,
    status,
    signal: result.signal || null,
    error: result.error?.message || null,
    duration_ms: Date.now() - started,
    command: realCopilotSmokeCommand(),
    cwd: options.cwd || process.cwd()
  };
}

async function waitForLatestRunSummary(options = {}) {
  const last = validateKqlDuration(options.last || '2h');
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = Math.max(1, durationToMs(options.pollMs ?? options.poll, 10000));
  const latestFn = options.latestSummary || (() => latestSummaryFromArgs(['--last', last], last));
  const sleepFn = options.sleep || sleep;
  const started = Date.now();
  const attempts = [];

  while (true) {
    let summary;
    try {
      const value = latestFn({ last });
      summary = typeof value?.then === 'function' ? await value : value;
    } catch (error) {
      summary = { session: null, error: error.message };
    }
    const visible = Boolean(summary?.session?.grafana_url);
    attempts.push({
      visible,
      session_id: summary?.session?.id || null,
      error: summary?.error || null
    });
    if (visible) {
      return {
        ok: true,
        status: 'found',
        summary,
        attempts,
        elapsed_ms: Date.now() - started
      };
    }

    const elapsed = Date.now() - started;
    if (waitMs === 0 || elapsed >= waitMs) break;
    await sleepFn(Math.min(pollMs, waitMs - elapsed));
  }

  return {
    ok: false,
    status: attempts.some(attempt => !attempt.error) ? 'not_found' : 'query_failed',
    summary: null,
    attempts,
    elapsed_ms: Date.now() - started
  };
}

async function verifySmokeInAzure(id, options = {}) {
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const workspace = options.workspaceId || workspaceId;
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = Math.max(1, durationToMs(options.pollMs ?? options.poll, 10000));
  const sleepFn = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const queryFn = options.runQuery || ((analyticsQuery, queryOptions) => runAzureLogAnalyticsQuery(analyticsQuery, queryOptions));
  const started = Date.now();
  const attempts = [];

  while (true) {
    let resolved;
    try {
      const queryResult = queryFn(query, {
        workspaceId: workspace,
        spawnSync: options.spawnSync
      });
      resolved = typeof queryResult?.then === 'function' ? await queryResult : queryResult;
    } catch (error) {
      resolved = { ok: false, rows: [], error: error.message };
    }
    const rows = Array.isArray(resolved?.rows) ? resolved.rows : [];
    const attempt = {
      ok: Boolean(resolved?.ok),
      rows: rows.length,
      error: resolved?.error || null
    };
    attempts.push(attempt);

    if (attempt.ok && rows.length > 0) {
      return {
        ok: true,
        status: 'found',
        workspace_id: workspace,
        query,
        rows: rows.length,
        attempts,
        elapsed_ms: Date.now() - started
      };
    }

    const elapsed = Date.now() - started;
    if (waitMs === 0 || elapsed >= waitMs) break;
    await sleepFn(Math.min(pollMs, waitMs - elapsed));
  }

  return {
    ok: false,
    status: attempts.some(attempt => attempt.ok) ? 'not_found' : 'query_failed',
    workspace_id: workspace,
    query,
    rows: 0,
    attempts,
    elapsed_ms: Date.now() - started
  };
}

async function agentopsSmoke(options = {}) {
  const endpoint = (options.endpoint || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const id = options.id || smokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const realCopilot = Boolean(options.realCopilot);
  const verify = options.verify !== false;
  const result = {
    smoke_kind: 'collector',
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    real_copilot: realCopilot,
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.workspaceId || workspaceId,
    azure_query: query,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'smoke_test',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    const next = [
      `POST ${endpoint}/v1/traces`,
      'node agentops-cli/src/index.js validate-azure',
      verify
        ? `node agentops-cli/src/index.js smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s${realCopilot ? ' --real-copilot' : ''}`
        : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
    ];
    if (realCopilot) {
      next.push(realCopilotSmokeCommand());
      next.push(`node agentops-cli/src/index.js open latest --last ${last}`);
    }
    return {
      ...result,
      ok: true,
      copilot_command: realCopilot ? realCopilotSmokeCommand() : null,
      next
    };
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpSmokeTracePayload(id, options.nowMs), options);
  let copilotRun = null;
  let verification = null;
  let latestVisibility = null;
  let links = null;
  if (response.ok && realCopilot) {
    copilotRun = runRealCopilotSmoke({ ...options, endpoint });
    if (copilotRun.ok) {
      latestVisibility = await waitForLatestRunSummary({
        ...options,
        last,
        waitMs,
        pollMs
      });
      if (latestVisibility.ok) links = openLinksSummary(latestVisibility.summary);
    }
  }
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      workspaceId: result.workspace_id,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok && (!realCopilot || copilotRun?.ok === true) && (!verify || verification?.ok === true);
  return {
    ...result,
    ok,
    collector_response: response,
    copilot_run: copilotRun,
    latest_visibility: latestVisibility,
    verification,
    links,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} smoke row${verification.rows === 1 ? '' : 's'} in Log Analytics.`,
              realCopilot && links?.v2_replay_url ? `Open Run Replay: ${links.v2_replay_url}` : 'node agentops-cli/src/index.js latest --last 2h',
              realCopilot ? `node agentops-cli/src/index.js open latest --last ${last}` : 'node agentops-cli/src/index.js latest --last 2h'
            ]
          : [
              verify
                ? `Smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : `Run this Azure query after ingestion latency settles: ${query}`,
              realCopilot && links?.v2_replay_url ? `Open Run Replay: ${links.v2_replay_url}` : 'node agentops-cli/src/index.js validate-azure'
            ])
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

async function agentopsAttributionSmoke(options = {}) {
  const endpoint = (options.endpoint || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const id = options.id || attributionSmokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const verify = options.verify !== false;
  const result = {
    smoke_kind: 'attribution',
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.workspaceId || workspaceId,
    azure_query: query,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'attribution_smoke',
      agent: 'agentops-kitchen-sink-smoke',
      skill: 'agentops-attribution',
      mcp_server: 'azure-mcp',
      script: 'pre-tool-policy',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    return {
      ...result,
      ok: true,
      next: [
        `POST ${endpoint}/v1/traces`,
        'node agentops-cli/src/index.js attribution --last 2h',
        verify
          ? `node agentops-cli/src/index.js attribution-smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s`
          : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
      ]
    };
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpAttributionSmokeTracePayload(id, options.nowMs), options);
  let verification = null;
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      workspaceId: result.workspace_id,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok && (!verify || verification?.ok === true);
  return {
    ...result,
    ok,
    collector_response: response,
    verification,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} attribution smoke row${verification.rows === 1 ? '' : 's'} in Log Analytics.`,
              'node agentops-cli/src/index.js attribution --last 2h',
              'node agentops-cli/src/index.js mcp --last 2h',
              'node agentops-cli/src/index.js lineage --last 2h'
            ]
          : [
              verify
                ? `Attribution smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : `Run this Azure query after ingestion latency settles: ${query}`,
              'node agentops-cli/src/index.js validate-azure'
            ])
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

async function agentopsLiveReplaySmoke(options = {}) {
  const endpoint = (options.endpoint || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const id = options.id || liveReplaySmokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const verify = options.verify !== false;
  const grafanaUrl = liveReplayGrafanaUrl(id, last);
  const result = {
    smoke_kind: 'live-replay',
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.workspaceId || workspaceId,
    azure_query: query,
    grafana_url: grafanaUrl,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'live_replay_smoke',
      agent: 'agentops-orchestrator-smoke',
      subagent: 'agentops-investigator-smoke',
      delegation_id: `${id}-delegation-1`,
      skill: 'agentops-live-triage',
      mcp_server: 'azure-mcp',
      script: 'pre-tool-policy',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    return {
      ...result,
      ok: true,
      next: [
        `POST ${endpoint}/v1/traces`,
        grafanaUrl,
        verify
          ? `node agentops-cli/src/index.js live-replay-smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s`
          : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
      ]
    };
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpLiveReplaySmokeTracePayload(id, options.nowMs), options);
  let verification = null;
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      workspaceId: result.workspace_id,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok && (!verify || verification?.ok === true);
  return {
    ...result,
    ok,
    collector_response: response,
    verification,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} live replay smoke rows in Log Analytics.`,
              grafanaUrl,
              'node agentops-cli/src/index.js lineage --last 2h'
            ]
          : [
              verify
                ? `Live replay smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : `Run this Azure query after ingestion latency settles: ${query}`,
              grafanaUrl
            ])
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

function renderSmoke(result) {
  const lines = [
    result.smoke_kind === 'live-replay'
      ? 'AgentOps live replay smoke'
      : (result.smoke_kind === 'attribution'
          ? 'AgentOps attribution smoke'
          : 'AgentOps smoke'),
    '',
    `Smoke id: ${result.smoke_id}`,
    `Endpoint: ${result.endpoint}`,
    `Mode: ${result.dry_run ? 'dry-run' : 'sent'}`
  ];

  if (result.collector_response) {
    lines.push(result.collector_response.ok
      ? `Collector response: ${result.collector_response.statusCode || 'ok'}.`
      : `Collector response: failed (${result.collector_response.error || result.collector_response.statusCode || 'unknown'}).`);
  }

  if (result.copilot_run) {
    lines.push(result.copilot_run.ok
      ? `Real Copilot smoke: completed in ${result.copilot_run.duration_ms}ms.`
      : `Real Copilot smoke: failed (${result.copilot_run.error || result.copilot_run.signal || `exit ${result.copilot_run.status}`}).`);
  } else if (result.real_copilot && result.dry_run) {
    lines.push(`Real Copilot smoke: planned (${result.copilot_command}).`);
  }

  if (result.latest_visibility) {
    lines.push(result.latest_visibility.ok
      ? `Latest Copilot run: visible after ${result.latest_visibility.attempts.length} attempt${result.latest_visibility.attempts.length === 1 ? '' : 's'}.`
      : `Latest Copilot run: ${result.latest_visibility.status.replace(/_/g, ' ')} after ${result.latest_visibility.attempts.length} attempt${result.latest_visibility.attempts.length === 1 ? '' : 's'}.`);
  }

  if (result.verification) {
    lines.push(result.verification.ok
      ? `Azure verification: found ${result.verification.rows} row${result.verification.rows === 1 ? '' : 's'} after ${result.verification.attempts.length} attempt${result.verification.attempts.length === 1 ? '' : 's'}.`
      : `Azure verification: ${result.verification.status.replace(/_/g, ' ')} after ${result.verification.attempts.length} attempt${result.verification.attempts.length === 1 ? '' : 's'}.`);
  } else if (!result.dry_run && result.verify === false) {
    lines.push('Azure verification: skipped.');
  }

  if (result.grafana_url) {
    lines.push(`Grafana Live Replay: ${result.grafana_url}`);
  }
  if (result.links?.v2_replay_url) {
    lines.push(`V2 Run Replay: ${result.links.v2_replay_url}`);
  }
  lines.push('', 'Azure verification query:', result.azure_query, '', 'Next:');
  for (const item of result.next || []) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

function azAvailable(options = {}) {
  if (options.azAvailable !== undefined) return Boolean(options.azAvailable);
  if (options.spawnSync) return true;
  return commandCandidates('az').length > 0;
}

function runAz(args, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  return spawnSync('az', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}

function parseJsonOutput(result) {
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

function checkResult(name, ok, extra = {}) {
  return { name, ok: Boolean(ok), ...extra };
}

function azErrorDetail(result, fallback) {
  return (result.stderr || result.stdout || fallback || `az exited with status ${result.status}`).trim();
}

function pathValue(source, keys, fallback = null) {
  let value = source;
  for (const key of keys) {
    if (value === undefined || value === null) return fallback;
    value = value[key];
  }
  return value === undefined ? fallback : value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function boolish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

const azureRoleIds = {
  logAnalyticsDataReader: '3b03c2da-16b3-4a49-8834-0f8130efdd3b',
  monitoringReader: '43d0d8ad-25c7-4714-9337-8ba259a9fe05',
  grafanaViewer: '60921a7e-fef1-4a43-9b16-a26c52ad4769',
  grafanaEditor: 'a79a5197-3a5c-4973-a920-486035ffd60f',
  grafanaAdmin: '22926164-76b3-42b3-bc55-97df8dab3e41',
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c',
  owner: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
  userAccessAdministrator: ['f1a07417', 'd97a', '45cb', '824c', '7a7467783830b'].join('-')
};

function roleDefinitionIdSuffix(value) {
  const id = String(value || '').toLowerCase();
  const parts = id.split('/');
  return parts[parts.length - 1] || id;
}

function roleAssignmentSummary(assignments, allowedRoleIds) {
  const allowed = new Set(allowedRoleIds.map(role => role.toLowerCase()));
  const rows = asArray(assignments);
  const matching = rows.filter(row => allowed.has(roleDefinitionIdSuffix(row.roleDefinitionId)));
  const groupAssignments = matching.filter(row => String(row.principalType || '').toLowerCase() === 'group');
  const broadAssignments = rows.filter(row => [
    azureRoleIds.owner,
    azureRoleIds.contributor,
    azureRoleIds.userAccessAdministrator
  ].includes(roleDefinitionIdSuffix(row.roleDefinitionId)));
  return {
    assignments: rows.length,
    matching: matching.length,
    group_assignments: groupAssignments.length,
    broad_assignments: broadAssignments.length,
    principal_types: Array.from(new Set(rows.map(row => row.principalType).filter(Boolean))).sort(),
    role_names: Array.from(new Set(rows.map(row => row.roleDefinitionName).filter(Boolean))).sort()
  };
}

function agentOpsScheduledQueryRules(rules) {
  return asArray(rules).filter(rule => {
    const name = String(rule.name || '').toLowerCase();
    const displayName = String(pathValue(rule, ['properties', 'displayName'], '')).toLowerCase();
    return name.startsWith('sqr-') || displayName.includes('copilot agentops');
  });
}

function logAnalyticsTablesFromResult(value) {
  const parsed = asArray(value?.value || value);
  return parsed.map(table => ({
    name: table?.name || pathValue(table, ['properties', 'name'], ''),
    retention_days: [table?.retentionInDays, pathValue(table, ['properties', 'retentionInDays'], NaN)]
      .map(Number)
      .find(Number.isFinite),
    total_retention_days: Number(table?.totalRetentionInDays ?? pathValue(table, ['properties', 'totalRetentionInDays'], NaN))
  }));
}

function agentOpsContentTables(tables) {
  return logAnalyticsTablesFromResult(tables).filter(table => String(table.name || '').toLowerCase() === 'agentopscontent_cl');
}

function azureBudgetsFromResult(value) {
  return asArray(value?.value || value).map(budget => ({
    name: budget?.name || '',
    amount: Number(budget?.amount ?? pathValue(budget, ['properties', 'amount'], NaN)),
    category: budget?.category || pathValue(budget, ['properties', 'category'], ''),
    time_grain: budget?.timeGrain || pathValue(budget, ['properties', 'timeGrain'], '')
  }));
}

function privateEndpointConnectionsFromResource(resource) {
  return asArray(pathValue(resource, ['properties', 'privateEndpointConnections'], []));
}

function approvedPrivateEndpointConnections(resource) {
  return privateEndpointConnectionsFromResource(resource).filter(connection => {
    const status = String(
      pathValue(connection, ['properties', 'privateLinkServiceConnectionState', 'status'], '') ||
      pathValue(connection, ['privateLinkServiceConnectionState', 'status'], '')
    ).toLowerCase();
    return status === 'approved';
  });
}

function actionGroupReceiverSummary(actionGroup) {
  const receiverKeys = [
    'emailReceivers',
    'smsReceivers',
    'webhookReceivers',
    'azureAppPushReceivers',
    'itsmReceivers',
    'automationRunbookReceivers',
    'voiceReceivers',
    'logicAppReceivers',
    'azureFunctionReceivers',
    'armRoleReceivers',
    'eventHubReceivers'
  ];
  const properties = actionGroup?.properties || actionGroup || {};
  const counts = Object.fromEntries(receiverKeys.map(key => [key, asArray(properties[key]).length]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { receiver_count: total, receiver_types: counts };
}

function azureProductionRemediationPlan(result, options = {}) {
  const checks = Object.fromEntries((result.checks || []).map(check => [check.name, check]));
  const config = result.config || {};
  const resourceGroup = config.resource_group || '<resource-group>';
  const workspaceName = config.workspace_name || '<workspace-name>';
  const grafanaName = config.grafana_name || '<grafana-name>';
  const desiredQuotaGb = Number(options.dailyQuotaGb || 5);
  const actionGroups = options.actionGroupResourceIds || '["/subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/<name>"]';
  const actions = [];

  if (checks['log-analytics-posture'] && !checks['log-analytics-posture'].ok) {
    actions.push({
      name: 'set-log-analytics-daily-cap',
      risk: 'low',
      reason: 'Production mode expects a finite Log Analytics daily ingestion cap.',
      review: 'Confirm expected telemetry volume before applying the cap.',
      commands: [
        `az monitor log-analytics workspace update --resource-group ${commandShellQuote(resourceGroup)} --workspace-name ${commandShellQuote(workspaceName)} --quota ${desiredQuotaGb}`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['grafana-production-posture'] && !checks['grafana-production-posture'].ok) {
    actions.push({
      name: 'harden-managed-grafana-network-and-availability',
      risk: 'medium',
      reason: 'Production mode expects Managed Grafana private access and zone redundancy.',
      review: 'Verify private connectivity, DNS, operator access, and regional zone-redundancy support before disabling public access.',
      commands: [
        `AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS=Disabled AGENTOPS_GRAFANA_ZONE_REDUNDANCY=Enabled ./scripts/azure-what-if.sh`,
        `az grafana update --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(grafanaName)} --public-network-access Disabled --zone-redundancy Enabled`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['alert-routing-posture'] && !checks['alert-routing-posture'].ok) {
    const ruleNames = asArray(checks['alert-routing-posture'].rule_names).length
      ? asArray(checks['alert-routing-posture'].rule_names)
      : ['sqr-<agentops-alert-name>'];
    actions.push({
      name: 'route-agentops-alerts-to-action-groups',
      risk: 'medium',
      reason: 'Production mode expects enabled AgentOps scheduled query alerts routed to Azure Monitor action groups.',
      review: 'Create or approve action groups first, then tune thresholds against real traffic before enabling notifications.',
      commands: [
        `export AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS=${commandShellQuote(String(actionGroups))}`,
        'AGENTOPS_DEPLOY_ALERTS=true AGENTOPS_ENABLE_ALERTS=true ./scripts/azure-what-if.sh',
        ...ruleNames.map(name => `az monitor scheduled-query update --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(name)} --disabled false --action-groups "$AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS"`),
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['access-rbac-posture'] && !checks['access-rbac-posture'].ok) {
    actions.push({
      name: 'review-agentops-rbac-assignments',
      risk: 'medium',
      reason: 'Production mode expects least-privilege RBAC on Log Analytics and Managed Grafana scopes.',
      review: 'Assign Entra groups rather than individual users; avoid Owner/Contributor for routine observability access.',
      commands: [
        'AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS=true ./scripts/azure-what-if.sh',
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['content-capture-table-posture'] && !checks['content-capture-table-posture'].ok) {
    actions.push({
      name: 'harden-optional-content-capture-storage',
      risk: 'high',
      reason: 'Optional prompt/response transcript storage must have short retention and least-privilege workspace access.',
      review: 'Confirm content capture is intentionally enabled, then restrict access and lower retention before production.',
      commands: [
        `az monitor log-analytics workspace table update --resource-group ${commandShellQuote(resourceGroup)} --workspace-name ${commandShellQuote(workspaceName)} --name AgentOpsContent_CL --retention-time 30`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['azure-budget-posture'] && !checks['azure-budget-posture'].ok) {
    actions.push({
      name: 'configure-agentops-budget',
      risk: 'medium',
      reason: 'Production mode expects an Azure Consumption budget so runaway token/tool loops have a spend guardrail.',
      review: 'Confirm the monthly amount and approved notification contacts before deploying the budget.',
      commands: [
        'AGENTOPS_DEPLOY_BUDGET=true ./scripts/azure-what-if.sh',
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['grafana-private-access-posture'] && !checks['grafana-private-access-posture'].ok) {
    actions.push({
      name: 'verify-managed-grafana-private-access',
      risk: 'medium',
      reason: 'Production mode expects public Grafana access disabled with an approved private endpoint path.',
      review: 'Test private DNS and operator access before disabling or depending on private access.',
      commands: [
        `az grafana show --resource-group ${commandShellQuote(resourceGroup)} --name ${commandShellQuote(grafanaName)} --query properties.privateEndpointConnections`,
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  if (checks['action-group-destination-posture'] && !checks['action-group-destination-posture'].ok) {
    actions.push({
      name: 'verify-alert-action-group-destinations',
      risk: 'medium',
      reason: 'Production mode expects routed AgentOps alerts to target enabled action groups with at least one receiver.',
      review: 'Review notification destinations, rate limits, and escalation ownership before enabling alerts.',
      commands: [
        'az monitor action-group list --resource-group <resource-group> --query "[].{name:name,enabled:enabled}"',
        `node agentops-cli/src/index.js validate-azure --last ${result.last || '24h'} --production --json`
      ]
    });
  }

  return {
    ok: actions.length === 0,
    mode: 'proposal-only',
    actions,
    note: actions.length === 0
      ? 'No production posture remediation is currently required.'
      : 'Review these commands before running them. The planner does not mutate Azure.'
  };
}

function validateAzure(options = {}) {
  const last = validateKqlDuration(options.last || '2h');
  const cloud = configuredCloudValues(options);
  const checks = [];
  const next = [];
  const hasAz = azAvailable(options);
  const production = Boolean(options.production);

  checks.push(checkResult('az-cli', hasAz, hasAz ? {} : { detail: 'Azure CLI was not found on PATH.' }));

  let account = null;
  if (hasAz) {
    const accountResult = runAz(['account', 'show', '-o', 'json'], options);
    account = accountResult.status === 0 ? parseJsonOutput(accountResult) : null;
    checks.push(checkResult('azure-account', accountResult.status === 0, {
      detail: accountResult.status === 0 ? account?.name || account?.id || 'logged in' : (accountResult.stderr || accountResult.stdout || 'az account show failed').trim()
    }));
    if (cloud.subscriptionId && account?.id && account.id !== cloud.subscriptionId) {
      checks.push(checkResult('azure-subscription', false, {
        expected: cloud.subscriptionId,
        actual: account.id,
        detail: 'Active Azure subscription does not match AGENTOPS_AZURE_SUBSCRIPTION_ID/AZURE_SUBSCRIPTION_ID.'
      }));
      next.push(`az account set --subscription "${cloud.subscriptionId}"`);
    } else if (cloud.subscriptionId) {
      checks.push(checkResult('azure-subscription', true, { expected: cloud.subscriptionId, actual: account?.id || null }));
    }
  }

  if (!cloud.resourceGroup) {
    checks.push(checkResult('resource-group-configured', false, { detail: 'Set AZURE_RESOURCE_GROUP or AGENTOPS_AZURE_RESOURCE_GROUP.' }));
    next.push('agentops configure set --resource-group rg-agentops-dev');
  } else if (hasAz) {
    const groupResult = runAz(['group', 'exists', '--name', cloud.resourceGroup, '-o', 'tsv'], options);
    const exists = groupResult.status === 0 && String(groupResult.stdout || '').trim() === 'true';
    checks.push(checkResult('resource-group', exists, { resource_group: cloud.resourceGroup }));
    if (!exists) next.push('Run ./scripts/azure-readiness.sh and review the target resource group.');
  }

  if (production && hasAz && cloud.resourceGroup) {
    const budgetResult = runAz(['consumption', 'budget', 'list', '--resource-group', cloud.resourceGroup, '-o', 'json'], options);
    const budgets = budgetResult.status === 0 ? azureBudgetsFromResult(parseJsonOutput(budgetResult)) : [];
    const validBudgets = budgets.filter(budget => Number.isFinite(budget.amount) && budget.amount > 0);
    checks.push(checkResult('azure-budget-posture', budgetResult.status === 0 && validBudgets.length > 0, {
      budgets: budgets.length,
      budget_names: budgets.map(budget => budget.name).filter(Boolean),
      valid_budgets: validBudgets.length,
      production,
      detail: budgetResult.status !== 0
        ? azErrorDetail(budgetResult, 'could not list Azure Consumption budgets')
        : validBudgets.length > 0
          ? 'Azure budget guardrail observed'
          : 'production mode expects an Azure budget for AgentOps spend guardrails'
    }));
    if (budgetResult.status !== 0) next.push('Verify Azure Consumption budget read permissions for the resource group.');
    else if (validBudgets.length === 0) next.push('Configure an Azure Consumption budget before production AgentOps rollout.');
  }

  const workspaceConfigured = isConfiguredValue(cloud.workspaceId, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  checks.push(checkResult('log-analytics-workspace-id', workspaceConfigured, {
    workspace_id: workspaceConfigured ? cloud.workspaceId : null,
    detail: workspaceConfigured ? 'configured' : 'Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID or LOG_ANALYTICS_WORKSPACE_ID.'
  }));
  if (!workspaceConfigured) next.push('agentops configure set --workspace-id "<workspace-id>"');

  if (hasAz && workspaceConfigured) {
    const query = `AppDependencies | where TimeGenerated > ago(${last}) | where ${baseFilter} | summarize Rows=count()`;
    const queryResult = runAzureLogAnalyticsQuery(query, {
      spawnSync: options.spawnSync,
      workspaceId: cloud.workspaceId
    });
    const rowCount = queryResult.rows?.[0]?.Rows ?? queryResult.rows?.[0]?.rows ?? null;
    checks.push(checkResult('log-analytics-query', queryResult.ok, {
      rows: rowCount,
      detail: queryResult.ok ? 'query succeeded' : queryResult.error
    }));
  }

  if (hasAz && cloud.resourceGroup && cloud.workspaceName) {
    let workspaceRbacOkForContent = null;
    const workspaceResult = runAz([
      'monitor',
      'log-analytics',
      'workspace',
      'show',
      '--resource-group',
      cloud.resourceGroup,
      '--workspace-name',
      cloud.workspaceName,
      '-o',
      'json'
    ], options);
    const workspace = workspaceResult.status === 0 ? parseJsonOutput(workspaceResult) : null;
    const workspaceResourceId = workspace?.id || null;
    const retentionDays = Number(workspace?.retentionInDays ?? 0);
    const dailyQuotaGb = Number(pathValue(workspace, ['workspaceCapping', 'dailyQuotaGb'], NaN));
    const resourceScopedAccess = boolish(pathValue(workspace, ['features', 'enableLogAccessUsingOnlyResourcePermissions'], false));
    const logAnalyticsPostureOk = workspaceResult.status === 0 &&
      (!production || (retentionDays > 0 && dailyQuotaGb !== -1 && resourceScopedAccess));
    checks.push(checkResult('log-analytics-posture', logAnalyticsPostureOk, {
      workspace: cloud.workspaceName,
      retention_days: Number.isFinite(retentionDays) ? retentionDays : null,
      daily_quota_gb: Number.isFinite(dailyQuotaGb) ? dailyQuotaGb : null,
      resource_scoped_access: resourceScopedAccess,
      issues: [
        retentionDays <= 0 ? 'retention' : null,
        dailyQuotaGb === -1 ? 'daily_cap' : null,
        !resourceScopedAccess ? 'resource_scoped_access' : null
      ].filter(Boolean),
      production,
      detail: workspaceResult.status !== 0
        ? azErrorDetail(workspaceResult, 'could not read Log Analytics workspace posture')
        : production
          ? (logAnalyticsPostureOk
              ? 'retention, daily cap, and resource-scoped access configured'
              : 'production mode expects retention, daily ingestion cap, and resource-scoped access')
          : 'Log Analytics posture observed'
    }));
    if (workspaceResult.status !== 0) next.push('Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME to the deployed workspace name.');
    else if (production && (retentionDays <= 0 || dailyQuotaGb === -1 || !resourceScopedAccess)) {
      next.push('Review Log Analytics retention, daily cap, and resource-scoped access before production.');
    }

    if (workspaceResult.status === 0 && workspaceResourceId) {
      const roleResult = runAz([
        'role',
        'assignment',
        'list',
        '--scope',
        workspaceResourceId,
        '--include-groups',
        '-o',
        'json'
      ], options);
      const summary = roleAssignmentSummary(
        roleResult.status === 0 ? parseJsonOutput(roleResult) : [],
        [azureRoleIds.logAnalyticsDataReader, azureRoleIds.monitoringReader]
      );
      const workspaceRbacOk = roleResult.status === 0 &&
        (!production || (summary.group_assignments > 0 && summary.broad_assignments === 0));
      workspaceRbacOkForContent = workspaceRbacOk;
      checks.push(checkResult('log-analytics-rbac-posture', workspaceRbacOk, {
        scope: workspaceResourceId,
        ...summary,
        production,
        detail: roleResult.status !== 0
          ? azErrorDetail(roleResult, 'could not list Log Analytics RBAC assignments')
          : production
            ? (workspaceRbacOk
                ? 'least-privilege group RBAC observed on Log Analytics'
                : 'production mode expects group-based reader RBAC and no broad Owner/Contributor assignments on Log Analytics')
            : 'Log Analytics RBAC posture observed'
      }));
      if (roleResult.status !== 0) next.push('Verify Azure RBAC read permissions for the Log Analytics workspace.');
      else if (production && !workspaceRbacOk) next.push('Review Log Analytics RBAC: assign observer groups and remove routine broad roles before production.');
    }

    if (production && workspaceResult.status === 0) {
      const tableResult = runAz([
        'monitor',
        'log-analytics',
        'workspace',
        'table',
        'list',
        '--resource-group',
        cloud.resourceGroup,
        '--workspace-name',
        cloud.workspaceName,
        '-o',
        'json'
      ], options);
      const contentTables = tableResult.status === 0 ? agentOpsContentTables(parseJsonOutput(tableResult)) : [];
      const retentionCandidates = contentTables
        .map(table => table.retention_days)
        .filter(Number.isFinite);
      const contentRetentionDays = retentionCandidates.length > 0
        ? Math.min(...retentionCandidates)
        : retentionDays;
      const hasContentTable = contentTables.length > 0;
      const shortRetention = Number.isFinite(contentRetentionDays) && contentRetentionDays > 0 && contentRetentionDays <= 30;
      const contentPostureOk = tableResult.status === 0 &&
        (!hasContentTable || (shortRetention && resourceScopedAccess && workspaceRbacOkForContent === true));
      checks.push(checkResult('content-capture-table-posture', contentPostureOk, {
        table: 'AgentOpsContent_CL',
        observed: hasContentTable,
        retention_days: Number.isFinite(contentRetentionDays) ? contentRetentionDays : null,
        max_retention_days: 30,
        resource_scoped_access: resourceScopedAccess,
        log_analytics_rbac_ok: workspaceRbacOkForContent,
        issues: hasContentTable ? [
          !shortRetention ? 'short_retention' : null,
          !resourceScopedAccess ? 'resource_scoped_access' : null,
          workspaceRbacOkForContent !== true ? 'workspace_rbac' : null
        ].filter(Boolean) : [],
        production,
        detail: tableResult.status !== 0
          ? azErrorDetail(tableResult, 'could not list Log Analytics tables')
          : hasContentTable
            ? (contentPostureOk
                ? 'optional content table uses short retention and least-privilege workspace access'
                : 'production mode expects optional content rows to use <=30 day retention and least-privilege workspace access')
            : 'no optional content capture table observed'
      }));
      if (tableResult.status !== 0) next.push('Install/update Azure CLI monitor extension or verify Log Analytics table read permissions.');
      else if (hasContentTable && !contentPostureOk) {
        next.push('Harden optional content capture: keep AgentOpsContent_CL retention <=30 days and restrict Log Analytics access before production.');
      }
    }
  }

  if (hasAz && cloud.resourceGroup && cloud.appInsightsName) {
    const appResult = runAz([
      'monitor',
      'app-insights',
      'component',
      'show',
      '--resource-group',
      cloud.resourceGroup,
      '--app',
      cloud.appInsightsName,
      '-o',
      'json'
    ], options);
    checks.push(checkResult('application-insights', appResult.status === 0, {
      app: cloud.appInsightsName,
      detail: appResult.status === 0 ? 'found' : (appResult.stderr || appResult.stdout || 'not found').trim()
    }));
    if (appResult.status !== 0) next.push('Set APPLICATIONINSIGHTS_NAME to the deployed App Insights component name.');
  }

  const grafanaConfigured = isConfiguredValue(cloud.grafanaBaseUrl, /your-grafana|<your-grafana>|^$/);
  checks.push(checkResult('grafana-base-url', grafanaConfigured, {
    url: grafanaConfigured ? cloud.grafanaBaseUrl : null,
    detail: grafanaConfigured ? 'configured' : 'Set AGENTOPS_GRAFANA_BASE_URL.'
  }));
  if (!grafanaConfigured) next.push('agentops configure set --grafana-url "https://<your-grafana>.grafana.azure.com"');

  if (hasAz && cloud.grafanaName && cloud.resourceGroup) {
    const grafanaResult = runAz(['grafana', 'show', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
    const grafanaFound = grafanaResult.status === 0;
    const grafanaResource = grafanaFound ? parseJsonOutput(grafanaResult) : null;
    const grafanaResourceId = grafanaResource?.id || null;
    checks.push(checkResult('grafana-resource', grafanaFound, {
      grafana: cloud.grafanaName,
      detail: grafanaFound ? 'found' : azErrorDetail(grafanaResult, 'not found')
    }));
    if (!grafanaFound) {
      next.push('Set GRAFANA_NAME or AGENTOPS_GRAFANA_NAME to the deployed Azure Managed Grafana resource name.');
    } else {
      const identityType = String(pathValue(grafanaResource, ['identity', 'type'], ''));
      const apiKey = String(pathValue(grafanaResource, ['properties', 'apiKey'], ''));
      const publicNetworkAccess = String(pathValue(grafanaResource, ['properties', 'publicNetworkAccess'], 'unknown'));
      const zoneRedundancy = String(pathValue(grafanaResource, ['properties', 'zoneRedundancy'], 'unknown'));
      const grafanaPostureOk = identityType.includes('SystemAssigned') &&
        apiKey === 'Disabled' &&
        (!production || publicNetworkAccess === 'Disabled') &&
        (!production || zoneRedundancy === 'Enabled');
      checks.push(checkResult('grafana-production-posture', grafanaPostureOk, {
        identity_type: identityType || null,
        api_key: apiKey || null,
        public_network_access: publicNetworkAccess,
        zone_redundancy: zoneRedundancy,
        issues: [
          !identityType.includes('SystemAssigned') ? 'managed_identity' : null,
          apiKey !== 'Disabled' ? 'api_keys' : null,
          publicNetworkAccess !== 'Disabled' ? 'public_network_access' : null,
          zoneRedundancy !== 'Enabled' ? 'zone_redundancy' : null
        ].filter(Boolean),
        production,
        detail: grafanaPostureOk
          ? (production ? 'managed identity and Grafana hardening posture verified' : 'pilot Grafana posture observed')
          : production
            ? 'production mode expects managed identity, API keys disabled, private access, and zone redundancy'
            : 'pilot posture observed; use --production to enforce private access and zone redundancy'
      }));
      if (!grafanaPostureOk) {
        next.push(production
          ? 'Review Grafana identity, API key, public access, and zone redundancy before production.'
          : 'Run agentops validate-azure --production to enforce production Grafana posture.');
      }

      if (production) {
        const approvedPrivateConnections = approvedPrivateEndpointConnections(grafanaResource);
        const privateAccessOk = publicNetworkAccess === 'Disabled' && approvedPrivateConnections.length > 0;
        checks.push(checkResult('grafana-private-access-posture', privateAccessOk, {
          public_network_access: publicNetworkAccess,
          private_endpoint_connections: privateEndpointConnectionsFromResource(grafanaResource).length,
          approved_private_endpoint_connections: approvedPrivateConnections.length,
          production,
          detail: privateAccessOk
            ? 'public access disabled and approved private endpoint connection observed'
            : 'production mode expects disabled public access plus an approved private endpoint connection'
        }));
        if (!privateAccessOk) next.push('Verify Managed Grafana private endpoint connectivity before production.');
      }

      if (grafanaResourceId) {
        const roleResult = runAz([
          'role',
          'assignment',
          'list',
          '--scope',
          grafanaResourceId,
          '--include-groups',
          '-o',
          'json'
        ], options);
        const summary = roleAssignmentSummary(
          roleResult.status === 0 ? parseJsonOutput(roleResult) : [],
          [azureRoleIds.grafanaViewer, azureRoleIds.grafanaEditor, azureRoleIds.grafanaAdmin]
        );
        const grafanaRbacOk = roleResult.status === 0 &&
          (!production || (summary.group_assignments > 0 && summary.broad_assignments === 0));
        checks.push(checkResult('grafana-rbac-posture', grafanaRbacOk, {
          scope: grafanaResourceId,
          ...summary,
          production,
          detail: roleResult.status !== 0
            ? azErrorDetail(roleResult, 'could not list Grafana RBAC assignments')
            : production
              ? (grafanaRbacOk
                  ? 'least-privilege group RBAC observed on Managed Grafana'
                  : 'production mode expects group-based Grafana RBAC and no broad Owner/Contributor assignments on Managed Grafana')
              : 'Grafana RBAC posture observed'
        }));
        if (roleResult.status !== 0) next.push('Verify Azure RBAC read permissions for the Managed Grafana resource.');
        else if (production && !grafanaRbacOk) next.push('Review Managed Grafana RBAC: assign observer/operator groups and remove routine broad roles before production.');
      }

      const dataSourceResult = runAz(['grafana', 'data-source', 'list', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
      const dataSources = flattenGrafanaList(dataSourceResult.status === 0 ? parseJsonOutput(dataSourceResult) : null);
      const datasourceFound = dataSources.some(item => grafanaItemUid(item) === cloud.grafanaDatasourceUid || item?.name === cloud.grafanaDatasourceUid);
      checks.push(checkResult('grafana-datasource', dataSourceResult.status === 0 && datasourceFound, {
        expected_uid: cloud.grafanaDatasourceUid,
        observed: dataSources.map(grafanaItemUid).filter(Boolean).slice(0, 10),
        detail: dataSourceResult.status !== 0
          ? (dataSourceResult.stderr || dataSourceResult.stdout || 'could not list datasources').trim()
          : datasourceFound
            ? 'found'
            : 'datasource UID not found'
      }));
      if (dataSourceResult.status !== 0 || !datasourceFound) {
        next.push('Set AGENTOPS_GRAFANA_DATASOURCE_UID to the Azure Monitor datasource UID used by the dashboards.');
      }

      const expectedDashboards = options.expectedDashboards || listGrafanaDashboardFiles(options);
      const dashboardResult = runAz(['grafana', 'dashboard', 'list', '-n', cloud.grafanaName, '-g', cloud.resourceGroup, '-o', 'json'], options);
      const dashboards = flattenGrafanaList(dashboardResult.status === 0 ? parseJsonOutput(dashboardResult) : null);
      const observedUids = new Set(dashboards.map(grafanaItemUid).filter(Boolean));
      const missingDashboards = expectedDashboards.filter(dashboard => !observedUids.has(dashboard.uid));
      checks.push(checkResult('grafana-dashboards', dashboardResult.status === 0 && missingDashboards.length === 0, {
        expected: expectedDashboards.length,
        missing: missingDashboards.map(dashboard => dashboard.uid),
        detail: dashboardResult.status !== 0
          ? (dashboardResult.stderr || dashboardResult.stdout || 'could not list dashboards').trim()
          : missingDashboards.length === 0
            ? 'all expected dashboards found'
            : `${missingDashboards.length} expected dashboard${missingDashboards.length === 1 ? '' : 's'} missing`
      }));
      if (dashboardResult.status !== 0 || missingDashboards.length > 0) {
        next.push(grafanaDashboardImportCommand(cloud));
        if (options.importDashboards) {
          const remediation = runGrafanaDashboardImportRemediation(cloud, options);
          checks.push(checkResult('grafana-dashboard-import', remediation.ok, {
            command: remediation.command,
            detail: remediation.ok
              ? 'import completed'
              : (remediation.stderr || remediation.stdout || remediation.error || `dashboard import exited ${remediation.status}`).trim(),
            remediation
          }));
          if (remediation.ok) next.push('agentops validate-azure --last 24h');
        }
      }
    }
  } else if (!cloud.grafanaName) {
    checks.push({ name: 'grafana-resource', ok: true, skipped: true, detail: 'Set GRAFANA_NAME or AGENTOPS_GRAFANA_NAME to validate the resource directly.' });
    checks.push({ name: 'grafana-production-posture', ok: true, skipped: true, detail: 'Skipped because Grafana resource name is not configured.' });
    checks.push({ name: 'grafana-datasource', ok: true, skipped: true, detail: 'Skipped because Grafana resource name is not configured.' });
    checks.push({ name: 'grafana-dashboards', ok: true, skipped: true, detail: 'Skipped because Grafana resource name is not configured.' });
  }

  if (hasAz && cloud.resourceGroup) {
    const alertResult = runAz(['monitor', 'scheduled-query', 'list', '--resource-group', cloud.resourceGroup, '-o', 'json'], options);
    const rules = alertResult.status === 0 ? agentOpsScheduledQueryRules(parseJsonOutput(alertResult)) : [];
    const enabledRules = rules.filter(rule => boolish(pathValue(rule, ['properties', 'enabled'], false)));
    const routedRules = rules.filter(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], [])).length > 0);
    const unroutedRules = rules.filter(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], [])).length === 0);
    const actionGroupIds = Array.from(new Set(routedRules.flatMap(rule => asArray(pathValue(rule, ['properties', 'actions', 'actionGroups'], []))).filter(Boolean)));
    const alertPostureOk = alertResult.status === 0 && (!production || (enabledRules.length > 0 && enabledRules.length === routedRules.length));
    checks.push(checkResult('alert-routing-posture', alertPostureOk, {
      rules: rules.length,
      rule_names: rules.map(rule => rule.name).filter(Boolean),
      enabled_rules: enabledRules.length,
      enabled_rule_names: enabledRules.map(rule => rule.name).filter(Boolean),
      routed_rules: routedRules.length,
      action_groups: actionGroupIds.length,
      unrouted_rule_names: unroutedRules.map(rule => rule.name).filter(Boolean),
      production,
      detail: alertResult.status !== 0
        ? azErrorDetail(alertResult, 'could not list scheduled query rules')
        : production
          ? 'production mode expects enabled AgentOps alerts routed to action groups'
          : 'scheduled query alert posture observed'
    }));
    if (alertResult.status !== 0) next.push('Install/update Azure CLI monitor extension or verify scheduled query rule read permissions.');
    else if (production && (enabledRules.length === 0 || enabledRules.length !== routedRules.length)) {
      next.push('Configure AgentOps scheduled query alerts with approved Azure Monitor action groups before production.');
    }

    if (production && alertResult.status === 0) {
      const actionGroupChecks = actionGroupIds.map(id => {
        const groupResult = runAz(['monitor', 'action-group', 'show', '--ids', id, '-o', 'json'], options);
        const actionGroup = groupResult.status === 0 ? parseJsonOutput(groupResult) : null;
        const receiverSummary = actionGroupReceiverSummary(actionGroup);
        const enabled = boolish(actionGroup?.enabled ?? pathValue(actionGroup, ['properties', 'enabled'], true));
        return {
          id,
          ok: groupResult.status === 0 && enabled && receiverSummary.receiver_count > 0,
          status: groupResult.status,
          enabled,
          receiver_count: receiverSummary.receiver_count,
          receiver_types: receiverSummary.receiver_types,
          detail: groupResult.status === 0 ? 'found' : azErrorDetail(groupResult, 'could not read action group')
        };
      });
      const actionGroupDestinationOk = actionGroupIds.length > 0 && actionGroupChecks.every(item => item.ok);
      checks.push(checkResult('action-group-destination-posture', actionGroupDestinationOk, {
        action_groups: actionGroupIds.length,
        checked: actionGroupChecks.length,
        invalid: actionGroupChecks.filter(item => !item.ok).map(item => item.id),
        receivers: actionGroupChecks.reduce((sum, item) => sum + item.receiver_count, 0),
        production,
        detail: actionGroupDestinationOk
          ? 'routed action groups exist and have notification receivers'
          : 'production mode expects routed action groups to exist, be enabled, and have at least one receiver'
      }));
      if (!actionGroupDestinationOk) next.push('Review Azure Monitor action group destinations before production alerts are enabled.');
    }
  }

  const workspaceRbacCheck = checks.find(check => check.name === 'log-analytics-rbac-posture');
  const grafanaRbacCheck = checks.find(check => check.name === 'grafana-rbac-posture');
  if (workspaceRbacCheck || grafanaRbacCheck) {
    const accessOk = (!workspaceRbacCheck || workspaceRbacCheck.ok) && (!grafanaRbacCheck || grafanaRbacCheck.ok);
    checks.push(checkResult('access-rbac-posture', accessOk, {
      production,
      log_analytics_ok: workspaceRbacCheck ? workspaceRbacCheck.ok : null,
      grafana_ok: grafanaRbacCheck ? grafanaRbacCheck.ok : null,
      detail: accessOk
        ? 'Azure access RBAC posture observed'
        : 'production mode expects least-privilege group RBAC for Log Analytics and Managed Grafana'
    }));
  } else if (production) {
    checks.push(checkResult('access-rbac-posture', false, {
      production,
      detail: 'production mode could not verify Log Analytics or Managed Grafana RBAC posture'
    }));
    next.push('Configure workspace and Grafana resource names so validate-azure can verify RBAC posture.');
  }

  if (next.length === 0) {
    next.push('node agentops-cli/src/index.js collector smoke --privacy strict --poison');
    next.push('node agentops-cli/src/index.js experimental smoke --wait 2m --poll 10s');
    next.push('copilot -p "Reply with exactly: agentops smoke."');
    next.push('node agentops-cli/src/index.js latest --last 2h');
  }

  const result = {
    ok: checks.every(check => check.ok),
    last,
    config: {
      resource_group: cloud.resourceGroup,
      workspace_id: workspaceConfigured ? cloud.workspaceId : null,
      workspace_name: cloud.workspaceName,
      grafana_base_url: grafanaConfigured ? cloud.grafanaBaseUrl : null,
      grafana_name: cloud.grafanaName || null,
      grafana_datasource_uid: cloud.grafanaDatasourceUid,
      app_insights_name: cloud.appInsightsName,
      production
    },
    checks,
    next
  };
  if (options.remediationPlan) {
    result.remediation_plan = azureProductionRemediationPlan(result, options);
  }
  return result;
}

function renderValidateAzure(result) {
  const lines = ['AgentOps Azure validation', ''];
  for (const check of result.checks) {
    const status = check.ok ? 'ok' : 'failed';
    const skipped = check.skipped ? ' skipped' : '';
    lines.push(`- ${check.name}: ${status}${skipped}${check.detail ? ` (${check.detail})` : ''}`);
    if (check.name === 'grafana-dashboards' && !check.ok && Array.isArray(check.missing) && check.missing.length > 0) {
      lines.push(`  missing: ${check.missing.join(', ')}`);
      lines.push('  fix: agentops validate-azure --import-dashboards --last 24h');
    }
  }
  lines.push('', result.ok ? 'Azure validation passed.' : 'Azure validation is incomplete.');
  if (result.remediation_plan) {
    lines.push('', 'Remediation plan:', result.remediation_plan.note);
    for (const action of result.remediation_plan.actions || []) {
      lines.push(`- ${action.name} (${action.risk}): ${action.reason}`);
      lines.push(`  review: ${action.review}`);
      for (const command of action.commands || []) lines.push(`  command: ${command}`);
    }
  }
  lines.push('Next:');
  for (const item of result.next) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

function repoFileText(relativePath, options = {}) {
  const base = options.root || root;
  const fullPath = path.join(base, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function enterpriseCheck(name, ok, severity, detail) {
  return checkResult(name, ok, { severity, detail });
}

function validateEnterprise(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readAgentOpsConfig({ configPath: options.configPath, quiet: true }).values;
  const mainBicep = repoFileText('infra/bicep/main.bicep', options);
  const logAnalyticsBicep = repoFileText('infra/bicep/log-analytics.bicep', options);
  const grafanaBicep = repoFileText('infra/bicep/grafana.bicep', options);
  const keyVaultBicep = repoFileText('infra/bicep/key-vault.bicep', options);
  const appInsightsBicep = repoFileText('infra/bicep/app-insights.bicep', options);
  const alertsBicep = repoFileText('infra/bicep/alerts.bicep', options);
  const rbacBicep = repoFileText('infra/bicep/rbac.bicep', options);
  const budgetBicep = repoFileText('infra/bicep/budget.bicep', options);
  const datasourceProvisioning = repoFileText('grafana/provisioning/datasources/azure-monitor.yaml', options);
  const azureCollector = repoFileText('collector/otelcol.azuremonitor.yaml', options);
  const azureCompose = repoFileText('collector/docker-compose.azuremonitor.yaml', options);
  const azureWhatIf = repoFileText('scripts/azure-what-if.sh', options);
  const enterpriseDeploy = repoFileText('scripts/azure-deploy-enterprise-pilot.sh', options);
  const readme = repoFileText('README.md', options);
  const enterprisePilot = repoFileText('docs/enterprise-pilot.md', options);
  const azureProdHardening = repoFileText('docs/azure-production-hardening.md', options);
  const threatModel = repoFileText('docs/threat-model.md', options);

  const checks = [
    enterpriseCheck(
      'deployment-profiles',
      /param deploymentProfile string/.test(mainBicep) && /'dev'/.test(mainBicep) && /'team'/.test(mainBicep) && /'enterprise'/.test(mainBicep),
      'high',
      'Bicep exposes dev/team/enterprise profiles.'
    ),
    enterpriseCheck(
      'daily-ingestion-cap',
      /dailyIngestionCapGb/.test(mainBicep) && /workspaceCapping/.test(logAnalyticsBicep) && /dailyQuotaGb/.test(logAnalyticsBicep),
      'critical',
      'Log Analytics has a default daily ingestion cap as a spike guardrail.'
    ),
    enterpriseCheck(
      'retention-parameter',
      /logRetentionDays/.test(mainBicep) && /retentionInDays/.test(logAnalyticsBicep),
      'high',
      'Retention is explicit and profile-driven.'
    ),
    enterpriseCheck(
      'metadata-only-tags',
      /telemetryContent: 'metadata-only'/.test(mainBicep),
      'medium',
      'Azure resources are tagged as metadata-only telemetry.'
    ),
    enterpriseCheck(
      'actioner-disabled-default',
      /param deployActioner bool = false/.test(mainBicep),
      'critical',
      'Actioning workflows are opt-in, not enabled by default.'
    ),
    enterpriseCheck(
      'alerts-disabled-default',
      /param deployAlerts bool = false/.test(mainBicep) && /param enableAlerts bool = false/.test(mainBicep),
      'high',
      'Alerts are opt-in until thresholds and action groups are tuned.'
    ),
    enterpriseCheck(
      'rbac-disabled-default',
      /param deployRbacAssignments bool = false/.test(mainBicep),
      'high',
      'RBAC assignment automation is opt-in because it mutates access control.'
    ),
    enterpriseCheck(
      'budget-disabled-default',
      /param deployBudget bool = false/.test(mainBicep) && /budgetContactEmails/.test(mainBicep),
      'high',
      'Budget creation is opt-in and requires explicit contact emails.'
    ),
    enterpriseCheck(
      'collector-localhost-published',
      /127\.0\.0\.1:4318:4318/.test(azureCompose) && /127\.0\.0\.1:4317:4317/.test(azureCompose),
      'critical',
      'Docker publishes OTLP only on localhost.'
    ),
    enterpriseCheck(
      'collector-content-scrub',
      [
        'gen_ai.input.messages',
        'gen_ai.output.messages',
        'gen_ai.prompt',
        'gen_ai.completion',
        'gen_ai.tool.call.arguments',
        'gen_ai.tool.call.result',
        'http.request.body.content',
        'http.response.body.content'
      ].every(key => azureCollector.includes(key)) && /action: delete/.test(azureCollector),
      'critical',
      'Collector deletes prompt, response, tool payload, URL, and body content before Azure export.'
    ),
    enterpriseCheck(
      'content-capture-env-off',
      String(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT || '').toLowerCase() !== 'true' &&
        String(env.COPILOT_OTEL_CAPTURE_CONTENT || '').toLowerCase() !== 'true',
      'critical',
      'Content capture is not enabled in this environment.'
    ),
    enterpriseCheck(
      'grafana-api-keys-disabled',
      /apiKey: 'Disabled'/.test(grafanaBicep),
      'high',
      'Azure Managed Grafana API keys are disabled.'
    ),
    enterpriseCheck(
      'grafana-managed-identity',
      /identity:\s*{\s*type: 'SystemAssigned'/s.test(grafanaBicep) && /azureAuthType: msi/.test(datasourceProvisioning),
      'high',
      'Managed Grafana and the Azure Monitor datasource use managed identity auth.'
    ),
    enterpriseCheck(
      'grafana-network-posture-params',
      /param grafanaPublicNetworkAccess string/.test(mainBicep) &&
        /param grafanaZoneRedundancy string/.test(mainBicep) &&
        /publicNetworkAccess: publicNetworkAccess/.test(grafanaBicep) &&
        /zoneRedundancy: zoneRedundancy/.test(grafanaBicep),
      'medium',
      'Grafana public access and zone redundancy are explicit deployment choices.'
    ),
    enterpriseCheck(
      'alert-action-groups-parameter',
      /param alertActionGroupResourceIds array/.test(mainBicep) &&
        /param actionGroupResourceIds array/.test(alertsBicep) &&
        /actionGroups: actionGroupResourceIds/.test(alertsBicep),
      'high',
      'Alert routing uses explicit Azure Monitor action group resource IDs.'
    ),
    enterpriseCheck(
      'key-vault-rbac-purge-protection',
      /enableRbacAuthorization: true/.test(keyVaultBicep) && /enablePurgeProtection: true/.test(keyVaultBicep),
      'high',
      'Key Vault uses RBAC authorization and purge protection.'
    ),
    enterpriseCheck(
      'log-access-resource-permissions',
      /enableLogAccessUsingOnlyResourcePermissions: true/.test(logAnalyticsBicep),
      'high',
      'Log Analytics access follows resource permissions.'
    ),
    enterpriseCheck(
      'app-insights-workspace-based',
      /WorkspaceResourceId/.test(appInsightsBicep) && /IngestionMode: 'LogAnalytics'/.test(appInsightsBicep),
      'high',
      'Application Insights is workspace-based for central query and retention control.'
    ),
    enterpriseCheck(
      'least-privilege-rbac-module',
      /Microsoft\.Authorization\/roleAssignments@2022-04-01/.test(rbacBicep) &&
        /principalType: 'Group'/.test(rbacBicep) &&
        /3b03c2da-16b3-4a49-8834-0f8130efdd3b/.test(rbacBicep) &&
        /60921a7e-fef1-4a43-9b16-a26c52ad4769/.test(rbacBicep),
      'high',
      'Optional RBAC module assigns least-privilege roles to Entra security groups.'
    ),
    enterpriseCheck(
      'budget-module',
      /Microsoft\.Consumption\/budgets@/.test(budgetBicep) &&
        /Actual_GreaterThan_80_Percent/.test(budgetBicep) &&
        /Actual_GreaterThan_100_Percent/.test(budgetBicep),
      'high',
      'Optional budget module alerts owners at 80 percent and 100 percent.'
    ),
    enterpriseCheck(
      'what-if-enterprise-params',
      /AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS/.test(azureWhatIf) &&
        /AGENTOPS_DEPLOY_BUDGET/.test(azureWhatIf) &&
        /AGENTOPS_BUDGET_CONTACT_EMAILS/.test(azureWhatIf) &&
        /AGENTOPS_DEPLOY_ALERTS/.test(azureWhatIf) &&
        /AGENTOPS_ENABLE_ALERTS/.test(azureWhatIf) &&
        /AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS/.test(azureWhatIf) &&
        /AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS/.test(azureWhatIf),
      'medium',
      'what-if supports RBAC, budget, alert routing, and Grafana network posture parameters.'
    ),
    enterpriseCheck(
      'enterprise-deploy-script',
      /az deployment group create/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_BUDGET/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_ALERTS/.test(enterpriseDeploy) &&
        /AGENTOPS_ENABLE_ALERTS/.test(enterpriseDeploy) &&
        /AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS/.test(enterpriseDeploy) &&
        /AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS/.test(enterpriseDeploy),
      'medium',
      'Enterprise pilot script deploys the same RBAC, budget, alert, and Grafana posture parameters reviewed by what-if.'
    ),
    enterpriseCheck(
      'connection-string-not-configured',
      !Object.keys(config).some(key => /connection|string|instrumentation/i.test(key)),
      'critical',
      'Local AgentOps config stores names/IDs, not connection strings.'
    ),
    enterpriseCheck(
      'azd-no-connection-string-output',
      !/output APPLICATIONINSIGHTS_CONNECTION_STRING/.test(mainBicep),
      'critical',
      'azd outputs do not persist the Application Insights connection string.'
    ),
    enterpriseCheck(
      'azd-outputs-importable',
      /output APPLICATIONINSIGHTS_NAME/.test(mainBicep) &&
        /output LOG_ANALYTICS_DAILY_QUOTA_GB/.test(mainBicep) &&
        /output GRAFANA_ENDPOINT/.test(mainBicep),
      'medium',
      'azd outputs include names, endpoints, and cost guardrail values.'
    ),
    enterpriseCheck(
      'enterprise-docs',
      /Enterprise-safe, cost-bounded setup/.test(readme),
      'medium',
      'README documents the enterprise-safe path.'
    ),
    enterpriseCheck(
      'pilot-review-docs',
      /Data Classification/.test(enterprisePilot) &&
        /Review Checklist/.test(enterprisePilot) &&
        /Rollback/.test(enterprisePilot),
      'medium',
      'Enterprise pilot guide documents data classification, review, and rollback.'
    ),
    enterpriseCheck(
      'azure-production-hardening-docs',
      /Managed Grafana Access/i.test(azureProdHardening) &&
        /Log Analytics Posture/i.test(azureProdHardening) &&
        /Alert Routing/i.test(azureProdHardening) &&
        /Private Access/i.test(azureProdHardening),
      'medium',
      'Azure production hardening doc covers Grafana access, Log Analytics, alert routing, and private access.'
    ),
    enterpriseCheck(
      'threat-model',
      /Trust Boundaries/.test(threatModel) &&
        /Threats And Mitigations/.test(threatModel) &&
        /Residual Risk/.test(threatModel),
      'medium',
      'Threat model documents boundaries, mitigations, and residual risk.'
    )
  ];

  const blocking = checks.filter(check => !check.ok && check.severity !== 'warning');
  const warnings = checks.filter(check => !check.ok && check.severity === 'warning');
  const score = Math.max(0, 100 - blocking.length * 8 - warnings.length * 3);
  const next = [];

  if (blocking.length === 0) {
    next.push('Run agentops setup, then agentops validate-azure.');
    next.push('Run ./scripts/azure-what-if.sh and review retention/cap values before azd provision.');
    next.push('Run agentops collector smoke --privacy strict --poison after provisioning.');
  } else {
    next.push('Fix failed critical/high checks before enterprise rollout.');
  }

  return {
    ok: blocking.length === 0,
    score,
    checks,
    failed: blocking.map(check => check.name),
    warnings: warnings.map(check => check.name),
    next
  };
}

function renderValidateEnterprise(result) {
  const lines = ['AgentOps enterprise validation', '', `Score: ${result.score}/100.`];
  for (const check of result.checks) {
    const status = check.ok ? 'ok' : 'failed';
    lines.push(`- ${check.name}: ${status} [${check.severity}]${check.detail ? ` (${check.detail})` : ''}`);
  }
  lines.push('', result.ok ? 'Enterprise guardrails passed.' : 'Enterprise guardrails are incomplete.');
  lines.push('Next:');
  for (const item of result.next) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

function askAgentOpsContext(options = {}) {
  const last = validateKqlDuration(options.last || '24h');
  const target = options.sessionId || 'latest';
  let session = null;
  let link = null;
  let dataMissing = [];

  if (target === 'latest') {
    const summary = options.summary || latestSummaryFromArgs(options.args || [], last);
    session = summary.session;
    dataMissing = summary.data_missing || [];
    if (session?.id && session.id !== 'unknown-session') {
      link = buildLink('session', session.id, { last });
    }
  } else {
    session = { id: target };
    link = buildLink('session', target, { last });
  }

  const sessionId = session?.id || 'unknown-session';
  const prompt = [
    'Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.',
    '',
    `Investigate AgentOps session ${sessionId} over the last ${last}.`,
    `Grafana session URL: ${link?.grafana_url || sessionsGrafanaDashboardUrl}`,
    `Log Analytics workspace: ${workspaceId}`,
    '',
    'Start from the KQL query in this context bundle. Return only evidence-backed findings.',
    'For each recommendation include: evidence query or dashboard link, observed pattern, proposed file(s), expected metric movement, validation benchmark or query, and rollback condition.',
    'Do not edit files yet. Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.'
  ].join('\n');

  return {
    ok: Boolean(link),
    session: sessionId,
    last,
    dashboard: link?.grafana_url || sessionsGrafanaDashboardUrl,
    azure_portal_url: link?.azure_portal_url || portalLogsUrl,
    workspace_id: workspaceId,
    query: link?.query || latestSessionAzureQuery(last),
    mcp_configs: [
      'copilot/mcp.azure-monitor.sample.json',
      'copilot/mcp.grafana.sample.json'
    ],
    prompt,
    data_missing: dataMissing
  };
}

function parseAskContextArgs(args) {
  const sessionId = args[0] || 'latest';
  return {
    sessionId,
    last: parseLastArg(args.slice(1), '24h'),
    json: args.includes('--json'),
    args: args.slice(1)
  };
}

function renderAskContext(context) {
  const lines = [
    'AgentOps ask context',
    '',
    `Session: ${context.session}`,
    `Dashboard: ${context.dashboard}`,
    `Workspace: ${context.workspace_id}`,
    `MCP configs: ${context.mcp_configs.join(', ')}`,
    ''
  ];

  if (context.data_missing.length > 0) {
    lines.push(`Data missing: ${context.data_missing.join(', ')}.`, '');
  }

  lines.push('KQL:', context.query, '', 'Prompt:', context.prompt);
  return `${lines.join('\n')}\n`;
}

function importJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
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

function otlpAttr(key, value) {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
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

function customEventId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `agentops-custom-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
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
  const endpoint = (options.endpoint || 'http://127.0.0.1:4318').replace(/\/$/, '');
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
    workspace_id: options.workspaceId || workspaceId,
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

async function agentopsCustomImport(filePath, options = {}) {
  const rows = readJsonlRows(filePath);
  const endpoint = (options.endpoint || 'http://127.0.0.1:4318').replace(/\/$/, '');
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
    workspace_id: options.workspaceId || workspaceId,
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

function readJsonlRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
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
    || row.name
    || attributeValue(attrs, ['gen_ai.operation.name', 'operation'])
    || 'unknown';
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

function summarizeSession(sessionId, spans, source = 'local') {
  const tools = new Set();
  const models = new Set();
  const agents = new Set();
  const e2eIds = new Set();
  const allUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
  const chatUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
  let estimatedUsd = 0;
  let toolCalls = 0;
  let failedTools = 0;
  let failures = 0;
  let policyBlocks = 0;
  let tokensRemoved = 0;
  let contentCaptureWarning = false;
  let latestTime = null;
  let earliestTime = null;

  for (const row of spans) {
    const attrs = rowAttributes(row);
    const operation = operationFromRow(row, attrs);
    const tool = row.ToolName || attributeValue(attrs, ['gen_ai.tool.name', 'tool']);
    const model = row.ModelActual || row.ModelRequested || attributeValue(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    const agent = row.AgentName || attributeValue(attrs, ['gen_ai.agent.name', 'agent']);
    const e2eId = attributeValue(attrs, ['agentops.e2e.id']);
    const message = `${row.Message || row.message || row.name || ''} ${JSON.stringify(attrs)}`;
    const failed = isFailedRow(row, attrs);
    const timeValue = row.TimeGenerated || row.timestamp || row.time || row.startTime;
    const time = timeValue ? new Date(timeValue) : null;

    if (tool) tools.add(String(tool));
    if (model) models.add(String(model));
    if (agent) agents.add(String(agent));
    if (e2eId) e2eIds.add(String(e2eId));
    if (operation === 'execute_tool' || tool) {
      toolCalls += 1;
      if (failed) failedTools += 1;
    }
    toolCalls += numberValue(row.ToolCount);
    failedTools += numberValue(row.ToolFailureCount);
    if (failed) failures += 1;
    if (/preToolUse|policy|blocked|denied/i.test(message) || Number(row.ToolDeniedCount || 0) > 0) policyBlocks += Number(row.ToolDeniedCount || 1);
    if (/truncation|compaction|too much context/i.test(message)) tokensRemoved += 1;
    if (booleanAttribute(attrs, ['content.capture.enabled', 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'])) contentCaptureWarning = true;
    if (attributeValue(attrs, ['gen_ai.prompt', 'gen_ai.completion', 'prompt', 'completion'])) contentCaptureWarning = true;
    if (row.ContentCaptureSignal === true || String(row.ContentCaptureSignal || '').toLowerCase() === 'true') contentCaptureWarning = true;

    const inputTokenValue = numberValue(row.InputTokens) || numberAttribute(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens']);
    const outputTokenValue = numberValue(row.OutputTokens) || numberAttribute(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens']);
    const creditValue = numberAttribute(attrs, ['github.copilot.cost', 'Credits', 'credits']);
    const estimatedUsdValue = numberValue(row.EstimatedCostUsd);
    if (estimatedUsdValue) estimatedUsd += estimatedUsdValue;
    if (inputTokenValue || outputTokenValue || creditValue || estimatedUsdValue) {
      allUsage.inputTokens += inputTokenValue;
      allUsage.outputTokens += outputTokenValue;
      allUsage.credits += creditValue;
      allUsage.count += 1;
      if (operation === 'chat') {
        chatUsage.inputTokens += inputTokenValue;
        chatUsage.outputTokens += outputTokenValue;
        chatUsage.credits += creditValue;
        chatUsage.count += 1;
      }
    }
    tokensRemoved += numberAttribute(attrs, ['github.copilot.tokens_removed', 'tokens_removed']);

    if (time && !Number.isNaN(time.getTime())) {
      if (!latestTime || time > latestTime) latestTime = time;
      if (!earliestTime || time < earliestTime) earliestTime = time;
    }
  }

  const primaryUsage = chatUsage.count > 0 ? chatUsage : allUsage;
  const inputTokens = primaryUsage.inputTokens;
  const outputTokens = primaryUsage.outputTokens;
  const credits = primaryUsage.credits;

  const dataMissing = [];
  if (source === 'local') dataMissing.push('live Azure query');
  if (!latestTime) dataMissing.push('timestamps');
  if (inputTokens === 0 && outputTokens === 0) dataMissing.push('token totals');
  if (credits === 0 && estimatedUsd === 0) dataMissing.push('cost');

  return {
    id: sessionId,
    source,
    started: earliestTime ? earliestTime.toISOString() : null,
    ended: latestTime ? latestTime.toISOString() : null,
    spans: spans.length,
    tool_calls: toolCalls,
    failed_tools: failedTools,
    failures,
    tools: [...tools],
    models: [...models],
    agents: [...agents],
    e2e_id: [...e2eIds][0] || null,
    e2e_ids: [...e2eIds],
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    credits,
    est_usd: estimatedUsd || credits * 0.01,
    policy_blocks: policyBlocks,
    tokens_removed: tokensRemoved,
    content_capture_warning: contentCaptureWarning,
    grafana_url: sessionId === 'unknown-session' ? null : buildLink('session', sessionId).grafana_url,
    data_missing: dataMissing
  };
}

function latestSessionAzureQuery(last = '7d') {
  const lookback = validateKqlDuration(last);
  return `let base = AppDependencies
| where TimeGenerated > ago(${lookback})
| where ${baseFilter}
| extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};
let operation_sessions = base
| where isnotempty(direct_session)
| summarize operation_session=take_any(direct_session) by OperationId;
let enriched = base
| join kind=leftouter operation_sessions on OperationId
| extend conversation=iff(isnotempty(operation_session), operation_session, iff(isnotempty(direct_session), direct_session, fallback_session));
let latest_session = toscalar(enriched | summarize Ended=max(TimeGenerated) by conversation | top 1 by Ended desc | project conversation);
enriched
| where conversation == latest_session
| project TimeGenerated, conversation, Name, Success, ResultCode, DurationMs, OperationId, ParentId, Id, Properties
| order by TimeGenerated asc`;
}

function runAzureLogAnalyticsQuery(query, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const effectiveWorkspaceId = options.workspaceId || workspaceId;

  if (!options.workspaceId && !configuredWorkspaceId && !options.spawnSync) {
    return {
      ok: false,
      rows: [],
      error: 'Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID or LOG_ANALYTICS_WORKSPACE_ID before running live Azure telemetry queries.'
    };
  }

  const result = spawnSync('az', [
    'monitor',
    'log-analytics',
    'query',
    '--workspace',
    effectiveWorkspaceId,
    '--analytics-query',
    query,
    '-o',
    'json'
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.error) return { ok: false, rows: [], error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      rows: [],
      error: (result.stderr || result.stdout || `az exited with status ${result.status}`).trim()
    };
  }

  try {
    return { ok: true, rows: JSON.parse(result.stdout || '[]'), error: null };
  } catch (error) {
    return { ok: false, rows: [], error: `Could not parse Azure query JSON: ${error.message}` };
  }
}

function latestAzureSessionSummary(options = {}) {
  const last = validateKqlDuration(options.last || '7d');
  const query = latestSessionAzureQuery(last);
  const result = runAzureLogAnalyticsQuery(query, options);

  if (!result.ok) {
    return {
      mode: 'azure',
      last,
      query,
      session: null,
      error: result.error,
      data_missing: ['live Azure query failed']
    };
  }

  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    return {
      mode: 'azure',
      last,
      query,
      session: null,
      data_missing: [`no Copilot telemetry found in Azure for last ${last}`]
    };
  }

  return {
    ...latestSessionSummary({ rows: result.rows, source: 'azure' }),
    last,
    query
  };
}

function latestSessionSummary({ filePath = null, rows = null, source = null } = {}) {
  if (!filePath && !rows) {
    return {
      mode: 'missing-live',
      session: null,
      data_missing: ['live Azure query', 'local JSONL file', 'latest session id', 'token totals', 'cost']
    };
  }

  const sourceRows = rows || readJsonlRows(filePath);
  const summarySource = source || (filePath ? 'local' : 'azure');
  const sessions = new Map();
  const order = [];
  let currentSessionId = null;

  for (const row of sourceRows) {
    const attrs = rowAttributes(row);
    let sessionId = sessionFromRow(row, attrs);
    if (sessionId === 'unknown-session' && currentSessionId) sessionId = currentSessionId;
    if (sessionId !== 'unknown-session') currentSessionId = sessionId;
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
      order.push(sessionId);
    }
    sessions.get(sessionId).push(row);
  }

  const summaries = order.map(sessionId => summarizeSession(sessionId, sessions.get(sessionId), summarySource));
  const withTime = summaries.filter(summary => summary.ended);
  const session = withTime.length > 0
    ? withTime.sort((a, b) => new Date(b.ended) - new Date(a.ended))[0]
    : summaries.at(-1) || null;

  return {
    mode: summarySource,
    file: filePath,
    session,
    data_missing: session ? session.data_missing : ['local JSONL rows']
  };
}

function listOrMissing(values, missing = 'not in this data') {
  return values.length > 0 ? values.join(', ') : missing;
}

function renderLatest(summary = latestSessionSummary()) {
  const lines = ['Latest Copilot session', ''];

  if (!summary.session) {
    if (summary.mode === 'azure' && summary.error) {
      lines.push('I could not read live Azure telemetry.');
      lines.push(`Azure error: ${summary.error}`);
      lines.push('Use --file <jsonl> to summarize a local or fixture export.');
    } else if (summary.mode === 'azure') {
      lines.push(`No Copilot sessions were found in Azure for the last ${summary.last || '7d'}.`);
      lines.push('Run Copilot through AgentOps, then try again.');
    } else {
      lines.push('Use --file <jsonl> to summarize a local or fixture export, or run with Azure CLI access for live telemetry.');
    }
    lines.push(`Missing data: ${summary.data_missing.join(', ')}.`);
    lines.push(`Main dashboard: ${mainGrafanaDashboardUrl}`);
    return `${lines.join('\n')}\n`;
  }

  const session = summary.session;
  lines.push(`Session: ${session.id}`);
  lines.push(`What happened: ${session.spans} spans, ${session.tool_calls} tool call${session.tool_calls === 1 ? '' : 's'}, ${session.failures} failure${session.failures === 1 ? '' : 's'}.`);
  lines.push(`Tools: ${listOrMissing(session.tools)}.`);
  lines.push(`Model: ${listOrMissing(session.models)}.`);
  lines.push(session.est_usd > 0 ? `Estimated cost: $${session.est_usd.toFixed(2)}.` : 'Estimated cost: not in this data.');
  lines.push(session.content_capture_warning
    ? 'Privacy: content capture may be on. Do not share this export until reviewed.'
    : 'Privacy: prompts/code were not recorded in this summary.');
  if (session.grafana_url) lines.push(`Grafana session: ${session.grafana_url}`);
  if (session.data_missing.length > 0) lines.push(`Data missing: ${session.data_missing.join(', ')}.`);

  return `${lines.join('\n')}\n`;
}

function explainLatest(summary = latestSessionSummary()) {
  const session = summary.session;
  if (!session) {
    return {
      classification: 'unknown',
      headline: 'Not enough data yet',
      detail: summary.mode === 'azure' && summary.error
        ? `The Azure query failed: ${summary.error}`
        : 'No local JSONL rows or live Azure rows were available.',
      session: null
    };
  }

  if (session.content_capture_warning) {
    return {
      classification: 'content_capture_warning',
      headline: 'Content capture warning',
      detail: 'Prompts or code may have been recorded. Review the export before sharing it.',
      session
    };
  }

  if (session.policy_blocks > 0) {
    return {
      classification: 'policy_blocked',
      headline: 'No risky commands were allowed through',
      detail: `${session.policy_blocks} policy signal${session.policy_blocks === 1 ? '' : 's'} appeared in this session.`,
      session
    };
  }

  if (session.failed_tools > 0) {
    return {
      classification: 'failed_tool',
      headline: 'Tools kept failing',
      detail: `${session.failed_tools} tool call${session.failed_tools === 1 ? '' : 's'} failed. Check the tool waterfall in Grafana.`,
      session
    };
  }

  if (session.input_tokens >= 30000 || session.tokens_removed > 0) {
    return {
      classification: 'too_much_context',
      headline: 'Copilot had too much to remember',
      detail: 'The session shows high context use or compaction/truncation signals.',
      session
    };
  }

  if (session.est_usd >= 1) {
    return {
      classification: 'high_cost',
      headline: 'This session looked expensive',
      detail: `Estimated cost was $${session.est_usd.toFixed(2)}.`,
      session
    };
  }

  if (session.spans > 0 && session.failures === 0) {
    return {
      classification: 'success',
      headline: 'This session looks successful',
      detail: 'No failed tools, policy blocks, high context, or high cost signals were found.',
      session
    };
  }

  return {
    classification: 'unknown',
    headline: 'The issue is unclear',
    detail: 'The local data does not include enough signals to classify the session.',
    session
  };
}

function renderExplanation(explanation = explainLatest()) {
  const lines = ['Likely issue', '', explanation.headline, explanation.detail];
  if (explanation.session?.grafana_url) lines.push(`Open in Grafana: ${explanation.session.grafana_url}`);
  return `${lines.join('\n')}\n`;
}

function openLinksSummary(summary = latestSessionSummary()) {
  const latestSessionUrl = summary.session?.grafana_url || null;
  return {
    main_dashboard_url: mainGrafanaDashboardUrl,
    sessions_dashboard_url: sessionsGrafanaDashboardUrl,
    v2_home_url: v2HomeGrafanaDashboardUrl,
    v2_runs_url: v2RunsGrafanaDashboardUrl,
    v2_replay_url: latestSessionUrl
      ? `${v2ReplayGrafanaDashboardUrl}?var-session_id=${encodeGrafanaValue(summary.session.id)}`
      : v2ReplayGrafanaDashboardUrl,
    latest_session_url: latestSessionUrl,
    missing_latest_reason: latestSessionUrl
      ? null
      : summary.session
      ? 'that session did not include a usable session id'
      : 'latest session was not found in the selected local file or Azure lookback window'
  };
}

function latestSummaryFromArgs(args, fallbackLast = '7d') {
  const filePath = optionValue(args, ['--file', '--jsonl']);
  if (filePath) return latestSessionSummary({ filePath: path.resolve(filePath) });

  return latestAzureSessionSummary({ last: parseLastArg(args, fallbackLast) });
}

const {
  alertRecommendationQuery,
  alertRecommendations
} = createAlerts({
  workspaceId,
  baseFilter,
  sessionKey,
  validateKqlDuration
});

const {
  recommendationForExplanation,
  renderRecommendation
} = createRecommendations({
  buildLink,
  mainGrafanaDashboardUrl,
  latestSessionAzureQuery
});

const {
  copilotPrimitivesInventory
} = createPrimitives({
  root,
  workspaceId,
  kqlFileQuery,
  validateKqlDuration,
  optionValue
});

const {
  liveViewFromArgs,
  replayTimeline,
  renderLive,
  renderReplay,
  sleep,
  spanRowsFromSource
} = createTelemetry({
  optionValue,
  parseLastArg,
  readJsonlRows,
  validateKqlDuration,
  latestSessionAzureQuery,
  runAzureLogAnalyticsQuery,
  rowAttributes,
  operationFromRow,
  attributeValue,
  numberAttribute,
  isFailedRow,
  sessionFromRow,
  numberValue,
  roundNumber
});

const {
  parseSavedViewArgs,
  readSavedViews,
  savedViewCommand
} = createSavedViews({
  savedViewsPath,
  readJson,
  buildLink
});

function renderOpenLinks(links = openLinksSummary()) {
  const lines = [
    'Grafana links',
    '',
    `AgentOps V2 Home: ${links.v2_home_url}`,
    `V2 Runs Explorer: ${links.v2_runs_url}`,
    `V2 Run Replay: ${links.v2_replay_url}`,
    `Main dashboard: ${links.main_dashboard_url}`,
    `Sessions dashboard: ${links.sessions_dashboard_url}`
  ];

  if (links.latest_session_url) {
    lines.push(`Latest session: ${links.latest_session_url}`);
  } else {
    lines.push(`Latest session: unknown. ${links.missing_latest_reason}.`);
  }

  return `${lines.join('\n')}\n`;
}

function httpHealthCheck(url, options = {}) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method: 'GET', timeout: options.timeoutMs || 1500 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({
        reachable: true,
        statusCode: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        body: body.slice(0, 200)
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, ok: false, error: 'timeout' });
    });
    req.on('error', error => resolve({ reachable: false, ok: false, error: error.message }));
    req.end();
  });
}

function validateCollector(endpoint = 'http://127.0.0.1:4318', options = {}) {
  return new Promise((resolve) => {
    const url = new URL('/v1/traces', endpoint);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: 'POST', timeout: 1500 }, res => {
      resolve({ endpoint, reachable: true, statusCode: res.statusCode, ok: res.statusCode < 500 });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ endpoint, reachable: false, ok: false, error: 'timeout' });
    });
    req.on('error', error => resolve({ endpoint, reachable: false, ok: false, error: error.message }));
    req.end();
  }).then(async otlpHttp => {
    const healthEndpoint = options.healthEndpoint || 'http://127.0.0.1:13133/';
    const health = await httpHealthCheck(healthEndpoint, options);
    return {
      endpoint,
      otlp_http: otlpHttp,
      health_endpoint: healthEndpoint,
      health,
      ok: Boolean(otlpHttp.ok && health.ok)
    };
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const benchmarkPermissionProfiles = new Set(['allow-all-isolated', 'least-privilege', 'read-only']);
const benchmarkSemanticAdapters = new Set(['file-contains', 'file-regex', 'file-rubric']);
const benchmarkToolRisks = new Set([
  'read-only',
  'write-file',
  'shell',
  'network',
  'secret-access',
  'browser-control',
  'destructive',
  'privileged'
]);

function normalizeBenchmarkPermissionProfile(profile) {
  if (profile === undefined || profile === null || profile === '') return 'least-privilege';
  return String(profile);
}

function benchmarkProfileAllowsBroadArgs(profile) {
  return profile === 'allow-all-isolated';
}

function hasBroadPermissionArg(args = []) {
  return args.some(arg => ['--allow-all', '--yolo'].includes(arg));
}

function validateBenchmarkHiddenPack(pack, source = 'hidden check pack') {
  const errors = [];
  if (typeof pack.id !== 'string' || pack.id.trim() === '') errors.push('id must be a non-empty string');
  if (!isStringArray(pack.commands)) errors.push('commands must be an array of strings');
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark hidden check pack ${source}: ${errors.join('; ')}`);
  }

  return {
    id: pack.id,
    title: typeof pack.title === 'string' && pack.title.trim() !== '' ? pack.title : pack.id,
    commands: pack.commands,
    source
  };
}

function loadBenchmarkHiddenPacks(task, suiteDir, source = 'task') {
  if (task.hiddenCheckPacks === undefined) return [];
  if (!isStringArray(task.hiddenCheckPacks)) {
    throw new Error(`Invalid benchmark task ${source}: hiddenCheckPacks must be an array of strings`);
  }

  return task.hiddenCheckPacks.map(packPath => {
    if (path.isAbsolute(packPath) || path.normalize(packPath).startsWith(`..${path.sep}`) || path.normalize(packPath) === '..') {
      throw new Error(`Invalid benchmark task ${source}: hidden check pack path cannot leave the suite: ${packPath}`);
    }
    const fullPath = path.resolve(suiteDir, packPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`Invalid benchmark task ${source}: hidden check pack does not exist: ${packPath}`);
    }
    return validateBenchmarkHiddenPack(readJson(fullPath), path.relative(root, fullPath));
  });
}

function hashBenchmarkFixtureSealFile(filePath) {
  return hashText(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function validateBenchmarkFixtureSeal(seal, fixturePath, source = 'task') {
  if (seal === undefined) return null;
  if (!isPlainObject(seal)) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal must be an object`);
  }

  const algorithm = seal.algorithm || 'sha256';
  if (algorithm !== 'sha256') {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal algorithm must be sha256`);
  }
  if (!isPlainObject(seal.files) || Object.keys(seal.files).length === 0) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal files must be a non-empty object`);
  }

  const files = {};
  for (const [file, expectedHash] of Object.entries(seal.files)) {
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
      throw new Error(`Invalid benchmark task ${source}: fixtureSeal hash for ${file} must be a sha256 hex string`);
    }
    const filePath = safeBenchmarkPath(fixturePath, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Invalid benchmark task ${source}: sealed fixture file does not exist: ${file}`);
    }
    const actualHash = hashBenchmarkFixtureSealFile(filePath);
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`Invalid benchmark task ${source}: sealed fixture file changed: ${file}`);
    }
    files[normalizeBenchmarkRelativePath(file)] = expectedHash.toLowerCase();
  }

  return {
    algorithm,
    files
  };
}

function validateBenchmarkFixtureSealPack(pack, fixturePath, source = 'fixture seal pack') {
  const errors = [];
  if (!isPlainObject(pack)) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: must be an object`);
  }
  if (typeof pack.id !== 'string' || pack.id.trim() === '') errors.push('id must be a non-empty string');
  if (typeof pack.fixture !== 'string' || pack.fixture.trim() === '') errors.push('fixture must be a non-empty string');
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: ${errors.join('; ')}`);
  }

  const fixtureSeal = validateBenchmarkFixtureSeal({
    algorithm: pack.algorithm,
    files: pack.files
  }, fixturePath, source);

  return {
    id: pack.id,
    title: typeof pack.title === 'string' && pack.title.trim() !== '' ? pack.title : pack.id,
    fixture: normalizeBenchmarkRelativePath(pack.fixture),
    algorithm: fixtureSeal.algorithm,
    files: fixtureSeal.files,
    source
  };
}

function loadBenchmarkFixtureSealPack(task, suiteDir, fixturePath, source = 'task') {
  if (task.fixtureSealPack === undefined) return null;
  if (typeof task.fixtureSealPack !== 'string' || task.fixtureSealPack.trim() === '') {
    throw new Error(`Invalid benchmark task ${source}: fixtureSealPack must be a non-empty string`);
  }

  const packPath = task.fixtureSealPack;
  if (path.isAbsolute(packPath) || path.normalize(packPath).startsWith(`..${path.sep}`) || path.normalize(packPath) === '..') {
    throw new Error(`Invalid benchmark task ${source}: fixture seal pack path cannot leave the suite: ${packPath}`);
  }
  const fullPath = path.resolve(suiteDir, packPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Invalid benchmark task ${source}: fixture seal pack does not exist: ${packPath}`);
  }

  const fixtureSealPack = validateBenchmarkFixtureSealPack(readJson(fullPath), fixturePath, normalizeBenchmarkRelativePath(path.relative(root, fullPath)));
  if (fixtureSealPack.fixture !== normalizeBenchmarkRelativePath(task.fixture)) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSealPack fixture must match task fixture`);
  }
  return fixtureSealPack;
}

function validateBenchmarkPromotionGates(gates, source = 'suite') {
  if (gates === undefined) return null;
  if (!isPlainObject(gates)) {
    throw new Error(`Invalid benchmark ${source}: promotionGates must be an object`);
  }

  const allowedFields = new Set([
    'minPassRatePct',
    'minAverageScore',
    'maxToolFailures',
    'maxSafetyViolationCount',
    'maxTotalTokens',
    'maxCost',
    'requiredApprovals'
  ]);
  const normalized = {};

  for (const [field, value] of Object.entries(gates)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Invalid benchmark ${source}: unknown promotion gate: ${field}`);
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Invalid benchmark ${source}: promotion gate ${field} must be a non-negative number`);
    }
    if (field === 'requiredApprovals' && !Number.isInteger(number)) {
      throw new Error(`Invalid benchmark ${source}: promotion gate ${field} must be an integer`);
    }
    normalized[field] = number;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function validateBenchmarkSemanticChecks(checks, source = 'task') {
  if (checks === undefined) return [];
  if (!Array.isArray(checks)) {
    throw new Error(`Invalid benchmark task ${source}: semanticChecks must be an array`);
  }

  return checks.map((check, index) => {
    const errors = [];
    if (!isPlainObject(check)) {
      throw new Error(`Invalid benchmark task ${source}: semanticChecks[${index}] must be an object`);
    }
    if (typeof check.id !== 'string' || check.id.trim() === '') errors.push('id must be a non-empty string');
    if (!benchmarkSemanticAdapters.has(check.adapter)) {
      errors.push(`adapter must be one of: ${[...benchmarkSemanticAdapters].join(', ')}`);
    }
    if (typeof check.file !== 'string' || check.file.trim() === '') errors.push('file must be a non-empty string');
    if (check.adapter === 'file-contains' && (typeof check.contains !== 'string' || check.contains.trim() === '')) {
      errors.push('contains must be a non-empty string');
    }
    if (check.adapter === 'file-regex') {
      if (typeof check.pattern !== 'string' || check.pattern.trim() === '') {
        errors.push('pattern must be a non-empty string');
      } else {
        try {
          new RegExp(check.pattern);
        } catch {
          errors.push('pattern must be a valid regular expression');
        }
      }
    }
    if (check.adapter === 'file-rubric') {
      if (!Array.isArray(check.criteria) || check.criteria.length === 0) {
        errors.push('criteria must be a non-empty array');
      } else {
        for (const [criteriaIndex, criterion] of check.criteria.entries()) {
          if (!isPlainObject(criterion)) {
            errors.push(`criteria[${criteriaIndex}] must be an object`);
            continue;
          }
          if (typeof criterion.id !== 'string' || criterion.id.trim() === '') {
            errors.push(`criteria[${criteriaIndex}].id must be a non-empty string`);
          }
          const hasContains = typeof criterion.contains === 'string' && criterion.contains.trim() !== '';
          const hasPattern = typeof criterion.pattern === 'string' && criterion.pattern.trim() !== '';
          if (hasContains === hasPattern) {
            errors.push(`criteria[${criteriaIndex}] must define exactly one of contains or pattern`);
          }
          if (hasPattern) {
            try {
              new RegExp(criterion.pattern);
            } catch {
              errors.push(`criteria[${criteriaIndex}].pattern must be a valid regular expression`);
            }
          }
        }
      }
      if (check.minScore !== undefined) {
        const minScore = Number(check.minScore);
        if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
          errors.push('minScore must be between 0 and 100');
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`Invalid benchmark task ${source}: semanticChecks[${index}] ${errors.join('; ')}`);
    }

    const normalized = {
      id: check.id,
      adapter: check.adapter,
      file: check.file
    };
    if (check.adapter === 'file-contains') normalized.contains = check.contains;
    if (check.adapter === 'file-regex') normalized.pattern = check.pattern;
    if (check.adapter === 'file-rubric') {
      normalized.minScore = check.minScore === undefined ? 100 : Number(check.minScore);
      normalized.criteria = check.criteria.map(criterion => {
        const normalizedCriterion = { id: criterion.id };
        if (typeof criterion.title === 'string' && criterion.title.trim() !== '') normalizedCriterion.title = criterion.title;
        if (criterion.contains !== undefined) normalizedCriterion.contains = criterion.contains;
        if (criterion.pattern !== undefined) normalizedCriterion.pattern = criterion.pattern;
        return normalizedCriterion;
      });
    }
    return normalized;
  });
}

function validateBenchmarkToolPolicy(policy, source = 'task') {
  if (policy === undefined) return null;
  if (!isPlainObject(policy)) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy must be an object`);
  }

  if (policy.blockedRisks === undefined) return null;
  if (!isStringArray(policy.blockedRisks)) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy.blockedRisks must be an array of strings`);
  }

  const blockedRisks = [...new Set(policy.blockedRisks.map(risk => risk.trim()).filter(Boolean))].sort();
  const invalid = blockedRisks.filter(risk => !benchmarkToolRisks.has(risk));
  if (invalid.length > 0) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy.blockedRisks must use known risks: ${[...benchmarkToolRisks].join(', ')}`);
  }

  return blockedRisks.length > 0 ? { blockedRisks } : null;
}

function benchmarkAllowedToolPolicyViolations(args = [], toolPolicy = null) {
  const blockedRisks = new Set(toolPolicy?.blockedRisks || []);
  if (blockedRisks.size === 0) return [];

  const seen = new Set();
  return extractAllowedTools(args)
    .filter(tool => blockedRisks.has(tool.risk))
    .filter(tool => {
      const key = `${tool.name}:${tool.risk}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.risk.localeCompare(right.risk) || left.name.localeCompare(right.name));
}

function validateBenchmarkTask(task, suiteDir, source = 'task') {
  const errors = [];
  const stringFields = ['id', 'title', 'fixture', 'prompt'];
  const arrayFields = ['copilotArgs', 'successCommands', 'expectedFiles', 'forbiddenFiles', 'tags'];
  const optionalArrayFields = ['hiddenSuccessCommands'];

  for (const field of stringFields) {
    if (typeof task[field] !== 'string' || task[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of arrayFields) {
    if (!isStringArray(task[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  for (const field of optionalArrayFields) {
    if (task[field] !== undefined && !isStringArray(task[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  const permissionProfile = normalizeBenchmarkPermissionProfile(task.permissionProfile);
  if (!benchmarkPermissionProfiles.has(permissionProfile)) {
    errors.push(`permissionProfile must be one of: ${[...benchmarkPermissionProfiles].join(', ')}`);
  }
  if (hasBroadPermissionArg(task.copilotArgs || []) && !benchmarkProfileAllowsBroadArgs(permissionProfile)) {
    errors.push('copilotArgs uses broad permissions but permissionProfile is not allow-all-isolated');
  }

  if (!Number.isInteger(task.timeoutSec) || task.timeoutSec <= 0) {
    errors.push('timeoutSec must be a positive integer');
  }

  const fixturePath = typeof task.fixture === 'string' ? path.resolve(suiteDir, task.fixture) : null;
  if (fixturePath && (!fs.existsSync(fixturePath) || !fs.statSync(fixturePath).isDirectory())) {
    errors.push(`fixture does not exist: ${task.fixture}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid benchmark task ${source}: ${errors.join('; ')}`);
  }

  const hiddenCheckPacks = loadBenchmarkHiddenPacks(task, suiteDir, source);
  const hiddenPackCommands = hiddenCheckPacks.flatMap(pack => pack.commands);
  const semanticChecks = validateBenchmarkSemanticChecks(task.semanticChecks, source);
  const fixtureSeal = validateBenchmarkFixtureSeal(task.fixtureSeal, fixturePath, source);
  const fixtureSealPack = loadBenchmarkFixtureSealPack(task, suiteDir, fixturePath, source);
  const toolPolicy = validateBenchmarkToolPolicy(task.toolPolicy, source);
  const toolPolicyEnforcement = {
    blockedRisks: toolPolicy?.blockedRisks || [],
    blockedAllowedTools: benchmarkAllowedToolPolicyViolations(task.copilotArgs, toolPolicy)
  };

  return {
    ...task,
    hiddenSuccessCommands: task.hiddenSuccessCommands || [],
    hiddenCheckPacks,
    hiddenCheckPackRefs: task.hiddenCheckPacks || [],
    hiddenPackCommands,
    semanticChecks,
    fixtureSeal,
    fixtureSealPack,
    toolPolicy,
    toolPolicyEnforcement,
    permissionProfile,
    fixturePath,
    source
  };
}

function loadBenchmarkSuites(baseDir = benchmarksDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const suiteDir = path.join(baseDir, entry.name);
      const suitePath = path.join(suiteDir, 'suite.json');
      const metadata = fs.existsSync(suitePath) ? readJson(suitePath) : {};
      const tasksDir = path.join(suiteDir, 'tasks');
      const taskFiles = fs.existsSync(tasksDir)
        ? fs.readdirSync(tasksDir).filter(file => file.endsWith('.json')).sort()
        : [];
      const promotionGates = validateBenchmarkPromotionGates(metadata.promotionGates, path.relative(root, suitePath));
      const tasks = taskFiles.map(file => {
        const taskPath = path.join(tasksDir, file);
        return validateBenchmarkTask(readJson(taskPath), suiteDir, path.relative(root, taskPath));
      });

      return {
        id: metadata.id || entry.name,
        title: metadata.title || entry.name,
        description: metadata.description || '',
        path: path.relative(root, suiteDir),
        promotionGates,
        tasks
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function listBenchmarks(baseDir = benchmarksDir) {
  return {
    suites: loadBenchmarkSuites(baseDir).map(suite => ({
      id: suite.id,
      title: suite.title,
      description: suite.description,
      path: suite.path,
      tasks: suite.tasks.map(task => ({
        id: task.id,
        title: task.title,
        fixture: task.fixture,
        permissionProfile: task.permissionProfile,
        toolPolicy: task.toolPolicy,
        timeoutSec: task.timeoutSec,
        tags: task.tags
      }))
    }))
  };
}

function parseBenchmarkRunArgs(args) {
  const suite = args[0];
  if (!suite) throw new Error('benchmark run requires a suite');

  const options = {
    suite,
    repeat: 1,
    dryRun: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--variant') {
      options.variant = args[index + 1];
      index += 1;
    } else if (arg === '--repeat') {
      options.repeat = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--hypothesis') {
      options.hypothesis = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark run option: ${arg}`);
    }
  }

  if (!options.variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(options.repeat) || options.repeat <= 0) {
    throw new Error('--repeat must be a positive integer');
  }

  return options;
}

function parseBenchmarkReportArgs(args) {
  const runId = args[0];
  if (!runId) throw new Error('benchmark report requires a run id');

  const options = {
    runId,
    azure: false,
    last: '24h'
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      options.azure = true;
    } else if (arg === '--approval-file') {
      if (!args[index + 1]) throw new Error('--approval-file requires a path');
      options.approvalFile = args[index + 1];
      index += 1;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      options.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark report option: ${arg}`);
    }
  }

  if (options.azure) validateKqlDuration(options.last);
  return options;
}

function parseBenchmarkCompareArgs(args) {
  const beforeRunId = args[0];
  const afterRunId = args[1];
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const options = {
    beforeRunId,
    afterRunId,
    azure: false,
    last: '24h'
  };

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      options.azure = true;
    } else if (arg === '--approval-file') {
      if (!args[index + 1]) throw new Error('--approval-file requires a path');
      options.approvalFile = args[index + 1];
      index += 1;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      options.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark compare option: ${arg}`);
    }
  }

  if (options.azure) validateKqlDuration(options.last);
  return options;
}

function makeBenchmarkRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `bench-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function benchmarkRunPlan(suiteId, options = {}) {
  const variant = options.variant;
  const repeat = options.repeat || 1;
  const dryRun = Boolean(options.dryRun);
  const hypothesis = options.hypothesis || null;

  if (!variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error('--repeat must be a positive integer');

  const suite = loadBenchmarkSuites(options.benchmarksDir || benchmarksDir).find(item => item.id === suiteId);
  if (!suite) throw new Error(`Unknown benchmark suite: ${suiteId}`);

  const runId = options.runId || makeBenchmarkRunId(options.now);
  const runs = [];

  for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex += 1) {
    for (const task of suite.tasks) {
      const runRoot = path.join(benchmarkRunBaseDir, runId, task.id, `repeat-${repeatIndex}`);
      runs.push({
        taskId: task.id,
        taskTitle: task.title,
        repeat: repeatIndex,
        copiedFixturePath: {
          from: task.fixturePath,
          to: path.join(runRoot, 'workspace')
        },
        copilotHome: path.join(runRoot, 'copilot-home'),
        environment: {
          COPILOT_HOME: path.join(runRoot, 'copilot-home')
        },
        copilot: {
          command: 'copilot',
          args: task.copilotArgs,
          prompt: task.prompt
        },
        otelLabels: {
          'agentops.benchmark.run_id': runId,
          'agentops.benchmark.suite': suite.id,
          'agentops.benchmark.task_id': task.id,
          'agentops.benchmark.variant': variant,
          'agentops.benchmark.permission_profile': task.permissionProfile,
          'agentops.benchmark.repeat': String(repeatIndex),
          ...(task.toolPolicy?.blockedRisks?.length
            ? { 'agentops.benchmark.tool_policy.blocked_risks': task.toolPolicy.blockedRisks.join('|') }
            : {}),
          ...(hypothesis ? { 'agentops.hypothesis.id': hypothesis } : {})
        },
        promotionGates: suite.promotionGates,
        toolPolicyEnforcement: task.toolPolicyEnforcement,
        successChecks: {
          commands: task.successCommands,
          fixtureSeal: task.fixtureSeal ? {
            algorithm: task.fixtureSeal.algorithm,
            fileCount: Object.keys(task.fixtureSeal.files).length,
            files: Object.keys(task.fixtureSeal.files).sort()
          } : null,
          fixtureSealPack: task.fixtureSealPack ? {
            id: task.fixtureSealPack.id,
            title: task.fixtureSealPack.title,
            algorithm: task.fixtureSealPack.algorithm,
            fixture: task.fixtureSealPack.fixture,
            fileCount: Object.keys(task.fixtureSealPack.files).length,
            source: task.fixtureSealPack.source
          } : null,
          hiddenCommandCount: task.hiddenSuccessCommands.length + task.hiddenPackCommands.length,
          hiddenCheckPacks: task.hiddenCheckPacks.map(pack => ({
            id: pack.id,
            title: pack.title,
            commandCount: pack.commands.length,
            source: pack.source
          })),
          ...(options.includeHiddenChecks ? { hiddenCommands: [...task.hiddenSuccessCommands, ...task.hiddenPackCommands] } : {}),
          semanticCheckCount: task.semanticChecks.length,
          semanticChecks: task.semanticChecks.map(check => ({
            id: check.id,
            adapter: check.adapter,
            file: check.file
          })),
          ...(options.includeHiddenChecks ? { semanticCheckDefinitions: task.semanticChecks } : {}),
          expectedFiles: task.expectedFiles,
          forbiddenFiles: task.forbiddenFiles
        },
        permissionProfile: task.permissionProfile,
        toolPolicy: task.toolPolicy,
        timeoutSec: task.timeoutSec
      });
    }
  }

  return {
    runId,
    suite: suite.id,
    variant,
    hypothesis,
    repeat,
    dryRun,
    wouldMutateRepo: !dryRun,
    wouldExecuteCopilot: !dryRun,
    runs
  };
}

function safeBenchmarkPath(baseDir, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Benchmark path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Benchmark path cannot leave the workspace: ${relativePath}`);
  }
  return path.resolve(baseDir, normalized);
}

function normalizeBenchmarkRelativePath(relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Benchmark path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Benchmark path cannot leave the workspace: ${relativePath}`);
  }
  return normalized;
}

function benchmarkPathGlobRegExp(pattern) {
  const normalized = normalizeBenchmarkRelativePath(pattern);
  const source = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

function benchmarkPathPatternMatches(pattern, relativePath) {
  const normalizedPattern = normalizeBenchmarkRelativePath(pattern);
  const normalizedPath = normalizeBenchmarkRelativePath(relativePath);
  if (!/[*?]/.test(normalizedPattern)) return normalizedPattern === normalizedPath;
  return benchmarkPathGlobRegExp(normalizedPattern).test(normalizedPath);
}

function benchmarkForbiddenMatches(forbiddenPatterns, files) {
  const matches = new Set();
  for (const file of files) {
    if (forbiddenPatterns.some(pattern => benchmarkPathPatternMatches(pattern, file))) {
      matches.add(normalizeBenchmarkRelativePath(file));
    }
  }
  return [...matches].sort();
}

function relativeFileSnapshot(dir) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;

  for (const file of walk(dir, item => fs.statSync(item).isFile())) {
    snapshot.set(path.relative(dir, file), hashText(fs.readFileSync(file)));
  }

  return snapshot;
}

function changedRelativeFiles(before, after) {
  const files = new Set([...before.keys(), ...after.keys()]);
  return [...files].filter(file => before.get(file) !== after.get(file)).sort();
}

function relativeFileDiff(before, after) {
  const files = new Set([...before.keys(), ...after.keys()]);
  const diff = {
    added: [],
    modified: [],
    deleted: []
  };

  for (const file of files) {
    const beforeHash = before.get(file);
    const afterHash = after.get(file);
    if (beforeHash === afterHash) continue;
    if (beforeHash === undefined) diff.added.push(file);
    else if (afterHash === undefined) diff.deleted.push(file);
    else diff.modified.push(file);
  }

  diff.added.sort();
  diff.modified.sort();
  diff.deleted.sort();
  diff.totalChanged = diff.added.length + diff.modified.length + diff.deleted.length;
  return diff;
}

function commandSucceeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function commandFailureMessage(result) {
  if (!result) return 'command did not run';
  if (result.error) return result.error.message;
  if (result.signal) return `terminated by ${result.signal}`;
  return `exited with status ${result.status}`;
}

function runShellCheck(command, cwd, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  return spawnSync(shell, args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs || 10000,
    maxBuffer: 1024 * 1024
  });
}

function outputText(value) {
  if (value === undefined || value === null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function escapeResourceAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

function mergeResourceAttributes(existing, labels) {
  const benchmarkLabels = Object.entries(labels)
    .map(([key, value]) => `${key}=${escapeResourceAttributeValue(value)}`)
    .join(',');
  return [existing, benchmarkLabels].filter(Boolean).join(',');
}

function benchmarkPermissionPolicyChecks(run, changedFiles) {
  if (run.permissionProfile !== 'read-only') return [];

  return [{
    name: 'permission policy: read-only workspace unchanged',
    ok: changedFiles.length === 0,
    detail: changedFiles.length === 0 ? null : `${changedFiles.length} workspace file(s) changed`
  }];
}

function runBenchmarkSemanticChecks(checks = [], workspace) {
  return checks.map(check => {
    if (!benchmarkSemanticAdapters.has(check.adapter)) {
      return {
        id: check.id,
        adapter: check.adapter,
        ok: false,
        score: 0,
        detail: 'unsupported semantic adapter'
      };
    }

    const filePath = safeBenchmarkPath(workspace, check.file);
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    const text = exists ? fs.readFileSync(filePath, 'utf8') : '';
    if (check.adapter === 'file-rubric') {
      const criteria = check.criteria || [];
      const criteriaResults = criteria.map(criterion => {
        const ok = criterion.pattern !== undefined
          ? exists && new RegExp(criterion.pattern, 'm').test(text)
          : exists && text.includes(criterion.contains);
        return {
          id: criterion.id,
          ok
        };
      });
      const passed = criteriaResults.filter(criterion => criterion.ok).length;
      const score = criteria.length > 0 ? roundNumber((passed / criteria.length) * 100) : 0;
      const ok = score >= numberValue(check.minScore);
      return {
        id: check.id,
        adapter: check.adapter,
        file: check.file,
        ok,
        score,
        detail: ok ? null : `rubric criteria passed: ${passed}/${criteria.length}`,
        criteria: criteriaResults
      };
    }
    const ok = check.adapter === 'file-regex'
      ? exists && new RegExp(check.pattern, 'm').test(text)
      : exists && text.includes(check.contains);
    return {
      id: check.id,
      adapter: check.adapter,
      file: check.file,
      ok,
      score: ok ? 100 : 0,
      detail: ok ? null : 'semantic expectation not met'
    };
  });
}

function benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged, policyBlocks = 0) {
  if (copilotResult?.error?.code === 'ETIMEDOUT' || copilotResult?.signal) return 'timeout';
  if (!commandSucceeded(copilotResult)) return 'copilot_failed';
  if (forbiddenFilesChanged > 0 || policyBlocks > 0) return 'safety_violation';
  if (checkResults.some(check => !check.ok)) return 'assertion_failure';
  return null;
}

function executeBenchmarkRun(plan, run, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const runRoot = path.dirname(run.copiedFixturePath.to);
  const workspace = run.copiedFixturePath.to;

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });
  fs.cpSync(run.copiedFixturePath.from, workspace, { recursive: true });
  fs.mkdirSync(run.copilotHome, { recursive: true });

  const beforeSnapshot = relativeFileSnapshot(workspace);
  const preRunPolicyViolations = run.toolPolicyEnforcement?.blockedAllowedTools || [];
  if (preRunPolicyViolations.length > 0) {
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(runRoot, 'stdout.txt'), '');
    fs.writeFileSync(path.join(runRoot, 'stderr.txt'), '');
    const checkResults = preRunPolicyViolations.map(tool => ({
      name: `tool policy: blocked allowed tool ${tool.name}`,
      ok: false,
      detail: `risk ${tool.risk} is blocked before Copilot execution`
    }));
    return {
      runId: plan.runId,
      suite: plan.suite,
      variant: plan.variant,
      hypothesis: plan.hypothesis,
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      permissionProfile: run.permissionProfile,
      toolPolicy: run.toolPolicy || null,
      toolPolicyEnforcement: run.toolPolicyEnforcement || null,
      promotionGates: run.promotionGates || null,
      repeat: run.repeat,
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      success: false,
      checksPassed: 0,
      checksFailed: checkResults.length,
      fixtureSealPack: run.successChecks.fixtureSealPack || null,
      hiddenCheckPacks: run.successChecks.hiddenCheckPacks || [],
      hiddenChecksPassed: 0,
      hiddenChecksFailed: 0,
      semanticScore: null,
      semanticChecks: [],
      filesChanged: 0,
      changedFiles: [],
      artifactDiff: { added: [], modified: [], deleted: [], totalChanged: 0 },
      forbiddenFilesChanged: 0,
      forbiddenFilesPresent: [],
      toolFailures: 0,
      policyBlocks: checkResults.length,
      contentCaptureDetected: process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true',
      inputTokens: 0,
      outputTokens: 0,
      aiu: 0,
      cost: 0,
      errorCategory: 'policy_violation',
      checks: checkResults,
      workspace,
      stdoutPath: path.join(runRoot, 'stdout.txt'),
      stderrPath: path.join(runRoot, 'stderr.txt')
    };
  }

  const env = {
    ...process.env,
    ...run.environment,
    AGENTOPS_BENCHMARK_RUN_ID: plan.runId,
    AGENTOPS_BENCHMARK_SUITE: plan.suite,
    AGENTOPS_BENCHMARK_TASK_ID: run.taskId,
    AGENTOPS_BENCHMARK_VARIANT: plan.variant,
    AGENTOPS_BENCHMARK_REPEAT: String(run.repeat),
    ...(plan.hypothesis ? { AGENTOPS_HYPOTHESIS_ID: plan.hypothesis } : {})
  };
  env.OTEL_RESOURCE_ATTRIBUTES = mergeResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES, run.otelLabels);

  const startedAt = new Date();
  const copilotResult = spawnSync(options.copilotCommand || run.copilot.command, [...run.copilot.args, '-p', run.copilot.prompt], {
    cwd: workspace,
    env,
    encoding: 'utf8',
    timeout: run.timeoutSec * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  const endedAt = new Date();

  fs.writeFileSync(path.join(runRoot, 'stdout.txt'), outputText(copilotResult?.stdout));
  fs.writeFileSync(path.join(runRoot, 'stderr.txt'), outputText(copilotResult?.stderr));

  const checkResults = [{
    name: 'copilot exited 0',
    ok: commandSucceeded(copilotResult),
    detail: commandSucceeded(copilotResult) ? null : commandFailureMessage(copilotResult)
  }];

  for (const command of run.successChecks.commands) {
    const result = runShellCheck(command, workspace, { spawnSync });
    checkResults.push({
      name: `command: ${command}`,
      ok: commandSucceeded(result),
      detail: commandSucceeded(result) ? null : commandFailureMessage(result)
    });
  }

  for (const [index, command] of (run.successChecks.hiddenCommands || []).entries()) {
    const result = runShellCheck(command, workspace, { spawnSync });
    checkResults.push({
      name: `hidden command #${index + 1}`,
      hidden: true,
      ok: commandSucceeded(result),
      detail: commandSucceeded(result) ? null : 'hidden check failed'
    });
  }

  for (const file of run.successChecks.expectedFiles) {
    checkResults.push({
      name: `expected file: ${file}`,
      ok: fs.existsSync(safeBenchmarkPath(workspace, file)),
      detail: null
    });
  }

  const semanticResults = runBenchmarkSemanticChecks(run.successChecks.semanticCheckDefinitions || [], workspace);
  for (const result of semanticResults) {
    checkResults.push({
      name: `semantic: ${result.id}`,
      ok: result.ok,
      detail: result.detail
    });
  }

  const afterSnapshot = relativeFileSnapshot(workspace);
  const changedFiles = changedRelativeFiles(beforeSnapshot, afterSnapshot);
  const artifactDiff = relativeFileDiff(beforeSnapshot, afterSnapshot);
  const forbiddenFilesPresent = benchmarkForbiddenMatches(run.successChecks.forbiddenFiles, afterSnapshot.keys());
  const forbiddenFilesChanged = benchmarkForbiddenMatches(run.successChecks.forbiddenFiles, changedFiles).length;

  for (const file of run.successChecks.forbiddenFiles) {
    const matches = benchmarkForbiddenMatches([file], afterSnapshot.keys());
    checkResults.push({
      name: `forbidden file absent: ${file}`,
      ok: matches.length === 0,
      detail: matches.length === 0 ? null : `matched: ${matches.join(', ')}`
    });
  }

  checkResults.push(...benchmarkPermissionPolicyChecks(run, changedFiles));
  const policyBlocks = checkResults.filter(check => check.name.startsWith('permission policy:') && !check.ok).length;
  const checksPassed = checkResults.filter(check => check.ok).length;
  const checksFailed = checkResults.length - checksPassed;
  const hiddenChecksPassed = checkResults.filter(check => check.hidden && check.ok).length;
  const hiddenChecksFailed = checkResults.filter(check => check.hidden && !check.ok).length;
  const semanticScore = semanticResults.length > 0
    ? roundNumber(semanticResults.reduce((total, result) => total + numberValue(result.score), 0) / semanticResults.length)
    : null;
  const errorCategory = benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged, policyBlocks);

  return {
    runId: plan.runId,
    suite: plan.suite,
    variant: plan.variant,
    hypothesis: plan.hypothesis,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    permissionProfile: run.permissionProfile,
    toolPolicy: run.toolPolicy || null,
    toolPolicyEnforcement: run.toolPolicyEnforcement || null,
    promotionGates: run.promotionGates || null,
    repeat: run.repeat,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    success: checksFailed === 0 && forbiddenFilesChanged === 0,
    checksPassed,
    checksFailed,
    fixtureSealPack: run.successChecks.fixtureSealPack || null,
    hiddenCheckPacks: run.successChecks.hiddenCheckPacks || [],
    hiddenChecksPassed,
    hiddenChecksFailed,
    semanticScore,
    semanticChecks: semanticResults,
    filesChanged: changedFiles.length,
    changedFiles,
    artifactDiff,
    forbiddenFilesChanged,
    forbiddenFilesPresent,
    toolFailures: 0,
    policyBlocks,
    contentCaptureDetected: process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true',
    inputTokens: 0,
    outputTokens: 0,
    aiu: 0,
    cost: 0,
    errorCategory,
    checks: checkResults,
    workspace,
    stdoutPath: path.join(runRoot, 'stdout.txt'),
    stderrPath: path.join(runRoot, 'stderr.txt')
  };
}

function runBenchmarkSuite(suiteId, options = {}) {
  const plan = benchmarkRunPlan(suiteId, { ...options, includeHiddenChecks: !options.dryRun });
  if (plan.dryRun) return plan;

  const summaries = plan.runs.map(run => executeBenchmarkRun(plan, run, options));
  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir();
  fs.mkdirSync(summariesDir, { recursive: true });
  const summariesPath = path.join(summariesDir, `${plan.runId}.json`);
  fs.writeFileSync(summariesPath, `${JSON.stringify(summaries, null, 2)}\n`);

  return {
    ...plan,
    summariesPath,
    summaries,
    report: benchmarkReport(plan.runId, summaries)
  };
}

function benchmarkAzureTelemetryQuery(runId, last = '24h') {
  const lookback = validateKqlDuration(last);
  const escapedRunId = escapeKqlString(runId);
  return `AppDependencies
| where TimeGenerated > ago(${lookback})
| where Properties has "${escapedRunId}"
| extend run_id=tostring(Properties["agentops.benchmark.run_id"]),
    suite=tostring(Properties["agentops.benchmark.suite"]),
    task_id=tostring(Properties["agentops.benchmark.task_id"]),
    variant=tostring(Properties["agentops.benchmark.variant"]),
    hypothesis=tostring(Properties["agentops.hypothesis.id"]),
    repeat_id=tostring(Properties["agentops.benchmark.repeat"]),
    conversation=tostring(Properties["gen_ai.conversation.id"]),
    operation=tostring(Properties["gen_ai.operation.name"]),
    model=tostring(Properties["gen_ai.request.model"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    error=tostring(Properties["error.type"]),
    InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]),
    OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]),
    CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]),
    CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]),
    Credits=todouble(Properties["github.copilot.cost"]),
    AIU=todouble(Properties["github.copilot.aiu"])
| where run_id == "${escapedRunId}"
| summarize Started=min(TimeGenerated),
    Ended=max(TimeGenerated),
    Spans=count(),
    ChatSpans=countif(operation == "chat"),
    AgentSpans=countif(operation == "invoke_agent"),
    ToolCalls=countif(operation == "execute_tool" or isnotempty(tool)),
    ToolFailures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
    Failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
    ChatInputTokens=sumif(InputTokens, operation == "chat"),
    ChatOutputTokens=sumif(OutputTokens, operation == "chat"),
    ChatCacheRead=sumif(CacheRead, operation == "chat"),
    ChatCacheWrite=sumif(CacheWrite, operation == "chat"),
    ChatCredits=sumif(Credits, operation == "chat"),
    ChatAIU=sumif(AIU, operation == "chat"),
    AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"),
    AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"),
    AgentCacheRead=maxif(CacheRead, operation == "invoke_agent"),
    AgentCacheWrite=maxif(CacheWrite, operation == "invoke_agent"),
    AgentCredits=maxif(Credits, operation == "invoke_agent"),
    AgentAIU=maxif(AIU, operation == "invoke_agent"),
    Models=make_set_if(model, isnotempty(model), 5),
    Tools=make_set_if(tool, isnotempty(tool), 10),
    Conversations=make_set_if(conversation, isnotempty(conversation), 5),
    Operations=make_set_if(operation, isnotempty(operation), 10)
    by run_id, suite, task_id, variant, hypothesis, repeat_id
| extend InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens),
    OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens),
    CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead),
    CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite),
    Credits=iff(ChatSpans > 0, ChatCredits, AgentCredits),
    AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)
| order by task_id asc, repeat_id asc`;
}

function arrayFromAzureValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeBenchmarkTelemetryRow(row) {
  const credits = numberValue(row.Credits);
  const aiuRaw = numberValue(row.AIU);
  return {
    runId: row.run_id || row.RunId || row.runId,
    suite: row.suite || row.Suite || '',
    taskId: row.task_id || row.taskId || '',
    variant: row.variant || row.Variant || '',
    hypothesis: row.hypothesis || row.Hypothesis || '',
    repeat: row.repeat_id || row.repeat || '',
    startedAt: row.Started || row.startedAt || null,
    endedAt: row.Ended || row.endedAt || null,
    spans: numberValue(row.Spans),
    toolCalls: numberValue(row.ToolCalls),
    toolFailures: numberValue(row.ToolFailures),
    failures: numberValue(row.Failures),
    inputTokens: numberValue(row.InputTokens),
    outputTokens: numberValue(row.OutputTokens),
    cacheReadTokens: numberValue(row.CacheRead),
    cacheWriteTokens: numberValue(row.CacheWrite),
    credits,
    cost: roundNumber(credits * 0.01, 4),
    aiu: normalizeAiuValue(aiuRaw),
    aiuRaw,
    models: arrayFromAzureValue(row.Models),
    tools: arrayFromAzureValue(row.Tools),
    conversations: arrayFromAzureValue(row.Conversations),
    operations: arrayFromAzureValue(row.Operations)
  };
}

function benchmarkTelemetryKey(taskId, repeat) {
  return `${taskId || ''}::${repeat === undefined || repeat === null ? '' : String(repeat)}`;
}

function benchmarkAzureTelemetry(runId, options = {}) {
  const last = validateKqlDuration(options.last || '24h');
  const query = benchmarkAzureTelemetryQuery(runId, last);
  const result = runAzureLogAnalyticsQuery(query, options);

  if (!result.ok) {
    return {
      requested: true,
      ok: false,
      last,
      query,
      error: result.error,
      rows: [],
      matchedSpans: 0,
      matchedTasks: 0
    };
  }

  const rows = Array.isArray(result.rows) ? result.rows.map(normalizeBenchmarkTelemetryRow) : [];
  return {
    requested: true,
    ok: rows.length > 0,
    last,
    query,
    rows,
    matchedSpans: rows.reduce((total, row) => total + row.spans, 0),
    matchedTasks: rows.filter(row => row.taskId).length,
    data_missing: rows.length > 0 ? [] : ['azure benchmark telemetry']
  };
}

function enrichBenchmarkSummariesWithAzure(runId, summaries, options = {}) {
  const telemetry = benchmarkAzureTelemetry(runId, options);
  if (!telemetry.ok) return { summaries, azureTelemetry: telemetry };

  const byTaskAndRepeat = new Map();
  const byTask = new Map();
  for (const row of telemetry.rows) {
    byTaskAndRepeat.set(benchmarkTelemetryKey(row.taskId, row.repeat), row);
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, []);
    byTask.get(row.taskId).push(row);
  }

  const enriched = summaries.map(summary => {
    const repeat = summary.repeat === undefined || summary.repeat === null ? '' : summary.repeat;
    const exact = byTaskAndRepeat.get(benchmarkTelemetryKey(summary.taskId, repeat));
    const taskRows = byTask.get(summary.taskId) || [];
    const row = exact || (taskRows.length === 1 ? taskRows[0] : null);
    if (!row) return { ...summary, telemetryMatched: false };

    return {
      ...summary,
      telemetryMatched: true,
      telemetrySource: 'azure',
      azureSpans: row.spans,
      azureToolCalls: row.toolCalls,
      azureFailures: row.failures,
      startedAt: summary.startedAt || row.startedAt,
      endedAt: summary.endedAt || row.endedAt,
      toolFailures: Math.max(numberValue(summary.toolFailures), row.toolFailures),
      hypothesis: summary.hypothesis || row.hypothesis || null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      credits: row.credits,
      cost: row.cost,
      aiu: row.aiu,
      aiuRaw: row.aiuRaw,
      models: row.models,
      tools: row.tools,
      conversations: row.conversations,
      operations: row.operations,
      errorCategory: summary.errorCategory || (row.toolFailures > 0 ? 'tool_failure' : null)
    };
  });

  return {
    summaries: enriched,
    azureTelemetry: {
      requested: true,
      ok: true,
      last: telemetry.last,
      matchedSpans: telemetry.matchedSpans,
      matchedTasks: enriched.filter(summary => summary.telemetryMatched).length,
      unmatchedTasks: enriched.filter(summary => !summary.telemetryMatched).map(summary => summary.taskId),
      query: telemetry.query
    }
  };
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAiuValue(value) {
  const aiu = numberValue(value);
  return Math.abs(aiu) >= 1000000 ? roundNumber(aiu / 1000000000, 3) : aiu;
}

function roundNumber(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreBenchmarkSummary(summary) {
  const checksPassed = numberValue(summary.checksPassed);
  const checksFailed = numberValue(summary.checksFailed);
  const totalChecks = checksPassed + checksFailed;
  const checkRate = totalChecks > 0 ? checksPassed / totalChecks : (summary.success ? 1 : 0);
  const forbiddenFilesChanged = numberValue(summary.forbiddenFilesChanged);
  const toolFailures = numberValue(summary.toolFailures);
  const policyBlocks = numberValue(summary.policyBlocks);
  const totalTokens = numberValue(summary.inputTokens) + numberValue(summary.outputTokens);
  const cost = numberValue(summary.cost);
  const semanticScore = summary.semanticScore === null || summary.semanticScore === undefined ? null : numberValue(summary.semanticScore);
  const penalties = [];

  let score = (summary.success ? 40 : 0) + (checkRate * 40) + 20;

  if (forbiddenFilesChanged > 0) {
    penalties.push({ reason: 'forbidden files changed', points: Math.min(40, 25 + (forbiddenFilesChanged * 5)) });
  }
  if (policyBlocks > 0) {
    penalties.push({ reason: 'policy blocks', points: Math.min(40, 25 + (policyBlocks * 5)) });
  }
  if (summary.contentCaptureDetected === true) {
    penalties.push({ reason: 'content capture detected', points: 30 });
  }
  if (toolFailures > 0) {
    penalties.push({ reason: 'tool failures', points: Math.min(16, toolFailures * 4) });
  }
  if (String(summary.errorCategory || '').toLowerCase() === 'timeout') {
    penalties.push({ reason: 'timeout', points: 10 });
  }
  if (semanticScore !== null && semanticScore < 100) {
    penalties.push({ reason: 'semantic score below target', points: Math.min(20, (100 - semanticScore) / 5) });
  }
  if (totalTokens > 500000) {
    penalties.push({ reason: 'very high token use', points: 15 });
  } else if (totalTokens > 200000) {
    penalties.push({ reason: 'high token use', points: 10 });
  } else if (totalTokens > 100000) {
    penalties.push({ reason: 'elevated token use', points: 5 });
  }
  if (cost > 20) {
    penalties.push({ reason: 'very high cost', points: 15 });
  } else if (cost > 5) {
    penalties.push({ reason: 'high cost', points: 10 });
  } else if (cost > 1) {
    penalties.push({ reason: 'elevated cost', points: 5 });
  }

  for (const penalty of penalties) score -= penalty.points;

  return {
    ...summary,
    score: roundNumber(Math.max(0, Math.min(100, score))),
    checkRate: roundNumber(checkRate, 3),
    safetyViolation: forbiddenFilesChanged > 0 || policyBlocks > 0 || summary.contentCaptureDetected === true,
    penalties
  };
}

function benchmarkToolPolicyViolations(summary) {
  const blockedRisks = new Set(summary.toolPolicy?.blockedRisks || []);
  if (blockedRisks.size === 0) return [];

  const seen = new Set();
  const violations = [];
  for (const tool of Array.isArray(summary.tools) ? summary.tools : []) {
    const name = String(tool || '').trim();
    if (!name) continue;
    const risk = classifyToolName(name);
    const key = `${name}:${risk}`;
    if (!blockedRisks.has(risk) || seen.has(key)) continue;
    seen.add(key);
    violations.push({ tool: name, risk });
  }

  return violations.sort((left, right) => left.risk.localeCompare(right.risk) || left.tool.localeCompare(right.tool));
}

function applyBenchmarkToolPolicy(summary) {
  const toolPolicyViolations = benchmarkToolPolicyViolations(summary);
  if (toolPolicyViolations.length === 0) {
    return {
      ...summary,
      toolPolicyViolations: []
    };
  }

  return {
    ...summary,
    success: false,
    errorCategory: summary.errorCategory || 'policy_violation',
    policyBlocks: numberValue(summary.policyBlocks) + toolPolicyViolations.length,
    toolPolicyViolations
  };
}

function topFailureCategories(scoredSummaries) {
  const counts = new Map();

  for (const summary of scoredSummaries) {
    if (!summary.success && summary.errorCategory) {
      counts.set(summary.errorCategory, (counts.get(summary.errorCategory) || 0) + 1);
    }
    if (numberValue(summary.checksFailed) > 0) {
      counts.set('checks_failed', (counts.get('checks_failed') || 0) + numberValue(summary.checksFailed));
    }
    if (numberValue(summary.toolFailures) > 0) {
      counts.set('tool_failures', (counts.get('tool_failures') || 0) + numberValue(summary.toolFailures));
    }
    if (numberValue(summary.forbiddenFilesChanged) > 0) {
      counts.set('forbidden_files_changed', (counts.get('forbidden_files_changed') || 0) + numberValue(summary.forbiddenFilesChanged));
    }
    if (numberValue(summary.policyBlocks) > 0) {
      counts.set('policy_blocks', (counts.get('policy_blocks') || 0) + numberValue(summary.policyBlocks));
    }
    if (summary.contentCaptureDetected === true) {
      counts.set('content_capture_detected', (counts.get('content_capture_detected') || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
    .slice(0, 5);
}

function benchmarkArtifactDiff(scoredSummaries) {
  return scoredSummaries.reduce((acc, summary) => {
    const diff = summary.artifactDiff || {};
    acc.added += Array.isArray(diff.added) ? diff.added.length : 0;
    acc.modified += Array.isArray(diff.modified) ? diff.modified.length : 0;
    acc.deleted += Array.isArray(diff.deleted) ? diff.deleted.length : 0;
    acc.totalChanged += Number.isInteger(diff.totalChanged) ? diff.totalChanged : 0;
    return acc;
  }, { added: 0, modified: 0, deleted: 0, totalChanged: 0 });
}

function benchmarkPermissionProfileSummary(scoredSummaries) {
  return scoredSummaries.reduce((acc, summary) => {
    const profile = summary.permissionProfile || 'unknown';
    acc[profile] = (acc[profile] || 0) + 1;
    return acc;
  }, {});
}

function benchmarkPromotionGates(scoredSummaries) {
  const gates = scoredSummaries
    .map(summary => summary.promotionGates)
    .filter(isPlainObject);
  if (gates.length === 0) return null;

  const merged = {};
  for (const gate of gates) {
    for (const [field, value] of Object.entries(gate)) {
      if (field.startsWith('min')) {
        merged[field] = Math.max(numberValue(merged[field], 0), numberValue(value));
      } else if (merged[field] === undefined) {
        merged[field] = numberValue(value);
      } else {
        merged[field] = Math.min(numberValue(merged[field]), numberValue(value));
      }
    }
  }
  return merged;
}

function benchmarkPromotionGateFailures(report) {
  const gates = report.promotionGates;
  if (!isPlainObject(gates)) return [];
  const approvalCount = report.promotionApproval?.status === 'approved'
    ? (report.promotionApproval.approvedBy || []).length
    : 0;

  const checks = [
    ['minPassRatePct', report.passRatePct, value => value >= gates.minPassRatePct],
    ['minAverageScore', report.averageScore, value => value >= gates.minAverageScore],
    ['maxToolFailures', report.toolFailures, value => value <= gates.maxToolFailures],
    ['maxSafetyViolationCount', report.safetyViolationCount, value => value <= gates.maxSafetyViolationCount],
    ['maxTotalTokens', report.totalTokens, value => value <= gates.maxTotalTokens],
    ['maxCost', report.cost, value => value <= gates.maxCost],
    ['requiredApprovals', approvalCount, value => value >= gates.requiredApprovals]
  ];

  return checks
    .filter(([field]) => gates[field] !== undefined)
    .map(([field, actual, passes]) => ({
      gate: field,
      expected: gates[field],
      actual,
      ok: passes(actual)
    }))
    .filter(result => !result.ok);
}

function benchmarkCheatSignals(scoredSummaries, azureTelemetry = null) {
  const signals = [];
  const forbidden = scoredSummaries.reduce((total, summary) => total + numberValue(summary.forbiddenFilesChanged), 0);
  const policyBlocks = scoredSummaries.reduce((total, summary) => total + numberValue(summary.policyBlocks), 0);
  const contentCapture = scoredSummaries.filter(summary => summary.contentCaptureDetected === true).length;
  const noChangeSuccesses = scoredSummaries.filter(summary => summary.success && numberValue(summary.filesChanged) === 0 && numberValue(summary.checksPassed) > 0);

  if (forbidden > 0) {
    signals.push({
      severity: 'block',
      signal: 'forbidden_files_changed',
      count: forbidden,
      action: 'reject candidate; inspect workspace diff and benchmark task boundaries'
    });
  }
  if (policyBlocks > 0) {
    signals.push({
      severity: 'block',
      signal: 'policy_blocks',
      count: policyBlocks,
      action: 'reject or rerun under the intended permission profile'
    });
  }
  if (contentCapture > 0) {
    signals.push({
      severity: 'block',
      signal: 'content_capture_detected',
      count: contentCapture,
      action: 'discard shared traces and rerun with content capture disabled'
    });
  }
  if (azureTelemetry?.requested && azureTelemetry.ok === false) {
    signals.push({
      severity: 'review',
      signal: 'missing_azure_telemetry',
      count: 1,
      action: 'do not promote from local-only evidence when live telemetry is required'
    });
  }
  if (azureTelemetry?.unmatchedTasks?.length > 0) {
    signals.push({
      severity: 'review',
      signal: 'unmatched_benchmark_tasks',
      count: azureTelemetry.unmatchedTasks.length,
      action: 'check OTEL_RESOURCE_ATTRIBUTES and Copilot wrapper wiring'
    });
  }
  if (noChangeSuccesses.length > 0) {
    signals.push({
      severity: 'review',
      signal: 'successful_task_without_file_changes',
      count: noChangeSuccesses.length,
      action: 'confirm the success command is not passing against pre-existing fixture state'
    });
  }

  return {
    status: signals.some(signal => signal.severity === 'block')
      ? 'blocked'
      : signals.length > 0
        ? 'review'
        : 'clean',
    signals
  };
}

function benchmarkRecommendation(report) {
  if (report.antiCheat?.status === 'blocked') {
    return {
      action: 'reject',
      message: 'reject: anti-cheat signals blocked promotion.'
    };
  }
  if (report.promotionGateFailures?.length > 0) {
    return {
      action: 'reject',
      message: 'reject: candidate promotion gates were not met.'
    };
  }
  if (report.safetyViolationCount > 0) {
    return {
      action: 'reject',
      message: 'reject: safety violations or forbidden edits were detected.'
    };
  }
  if (report.passRate < 0.5 || report.averageScore < 60) {
    return {
      action: 'reject',
      message: 'reject: the run failed too many checks to promote.'
    };
  }
  if (report.passRate < 0.9 || report.averageScore < 80 || report.toolFailures > 0 || report.topFailureCategories.length > 0) {
    return {
      action: 'investigate',
      message: 'investigate: quality is mixed, so review failures before promoting.'
    };
  }
  return {
    action: 'keep',
    message: 'keep: the run passed cleanly with no safety regression signals.'
  };
}

function validateBenchmarkPromotionApproval(approval, source = 'approval') {
  if (approval === undefined || approval === null) return null;
  if (!isPlainObject(approval)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: approval must be an object`);
  }

  if (approval.approvedBy !== undefined && !isStringArray(approval.approvedBy)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: approvedBy must be an array of strings`);
  }
  const approvedBy = approval.approvedBy === undefined
    ? []
    : [...new Set(approval.approvedBy.map(name => name.trim()).filter(Boolean))].sort();

  const status = approval.status || (approvedBy.length > 0 ? 'approved' : 'pending');
  if (!['approved', 'pending', 'rejected'].includes(status)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: status must be approved, pending, or rejected`);
  }

  if (approval.approvedAt !== undefined && typeof approval.approvedAt !== 'string') {
    throw new Error(`Invalid benchmark promotion approval ${source}: approvedAt must be a string`);
  }
  if (approval.ticket !== undefined && typeof approval.ticket !== 'string') {
    throw new Error(`Invalid benchmark promotion approval ${source}: ticket must be a string`);
  }

  return {
    status,
    approvedBy,
    approvedAt: approval.approvedAt || null,
    ticket: approval.ticket || null,
    source
  };
}

function benchmarkPromotionApprovalFromOptions(options = {}) {
  if (options.promotionApproval !== undefined) {
    return validateBenchmarkPromotionApproval(options.promotionApproval, 'options.promotionApproval');
  }
  if (!options.approvalFile) return null;
  return validateBenchmarkPromotionApproval(readJson(path.resolve(options.approvalFile)), options.approvalFile);
}

function defaultBenchmarkSummaryDir() {
  return process.env.AGENTOPS_BENCHMARK_RUNS_DIR || path.join(benchmarksDir, 'runs');
}

function benchmarkSummariesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.summaries)) return payload.summaries;
  if (Array.isArray(payload.runs)) return payload.runs;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload && payload.runId) return [payload];
  return [];
}

function loadBenchmarkSummaries(runId, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');

  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir();
  if (!fs.existsSync(summariesDir)) return [];

  const files = walk(summariesDir, file => file.endsWith('.json'));
  const preferredNames = new Set([`${runId}.json`, `${runId}.summary.json`, `run-${runId}.json`]);
  const preferredFiles = files.filter(file => preferredNames.has(path.basename(file)));
  const searchFiles = preferredFiles.length > 0 ? preferredFiles : files;
  const summaries = [];

  for (const file of searchFiles) {
    summaries.push(...benchmarkSummariesFromPayload(readJson(file)));
  }

  return summaries.filter(summary => summary.runId === runId);
}

function benchmarkReport(runId, summaries = null, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');
  let runSummaries = (summaries || loadBenchmarkSummaries(runId)).filter(summary => summary.runId === runId);
  let azureTelemetry = null;
  const promotionApproval = benchmarkPromotionApprovalFromOptions(options);

  if (runSummaries.length === 0) {
    if (options.azure) azureTelemetry = benchmarkAzureTelemetry(runId, options);
    const missingReport = {
      runId,
      ok: false,
      message: 'no benchmark summaries were found for this run'
    };
    if (azureTelemetry) missingReport.azureTelemetry = azureTelemetry;
    return missingReport;
  }

  if (options.azure) {
    const enriched = enrichBenchmarkSummariesWithAzure(runId, runSummaries, options);
    runSummaries = enriched.summaries;
    azureTelemetry = enriched.azureTelemetry;
  }

  const policySummaries = runSummaries.map(applyBenchmarkToolPolicy);
  const scoredSummaries = policySummaries.map(scoreBenchmarkSummary);
  const passed = scoredSummaries.filter(summary => summary.success).length;
  const inputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.inputTokens), 0);
  const outputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.outputTokens), 0);
  const semanticScores = scoredSummaries
    .map(summary => summary.semanticScore)
    .filter(score => score !== null && score !== undefined);
  const report = {
    runId,
    suites: [...new Set(scoredSummaries.map(summary => summary.suite).filter(Boolean))].sort(),
    variants: [...new Set(scoredSummaries.map(summary => summary.variant).filter(Boolean))].sort(),
    hypotheses: [...new Set(scoredSummaries.map(summary => summary.hypothesis).filter(Boolean))].sort(),
    startedAt: scoredSummaries.map(summary => summary.startedAt).filter(Boolean).sort()[0] || null,
    taskCount: scoredSummaries.length,
    passed,
    failed: scoredSummaries.length - passed,
    passRate: roundNumber(passed / scoredSummaries.length, 3),
    passRatePct: roundNumber((passed / scoredSummaries.length) * 100),
    averageScore: roundNumber(scoredSummaries.reduce((total, summary) => total + summary.score, 0) / scoredSummaries.length),
    toolFailures: scoredSummaries.reduce((total, summary) => total + numberValue(summary.toolFailures), 0),
    forbiddenFilesChanged: scoredSummaries.reduce((total, summary) => total + numberValue(summary.forbiddenFilesChanged), 0),
    policyBlocks: scoredSummaries.reduce((total, summary) => total + numberValue(summary.policyBlocks), 0),
    contentCaptureDetected: scoredSummaries.some(summary => summary.contentCaptureDetected === true),
    permissionProfiles: benchmarkPermissionProfileSummary(scoredSummaries),
    hiddenChecks: {
      passed: scoredSummaries.reduce((total, summary) => total + numberValue(summary.hiddenChecksPassed), 0),
      failed: scoredSummaries.reduce((total, summary) => total + numberValue(summary.hiddenChecksFailed), 0)
    },
    semanticChecks: {
      count: scoredSummaries.reduce((total, summary) => total + (Array.isArray(summary.semanticChecks) ? summary.semanticChecks.length : 0), 0),
      averageScore: semanticScores.length > 0
        ? roundNumber(semanticScores.reduce((total, score) => total + numberValue(score), 0) / semanticScores.length)
        : null
    },
    safetyViolationCount: scoredSummaries.filter(summary => summary.safetyViolation).length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    aiu: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.aiu), 0), 3),
    cost: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.cost), 0), 4),
    artifactDiff: benchmarkArtifactDiff(scoredSummaries),
    topFailureCategories: topFailureCategories(scoredSummaries),
    tasks: scoredSummaries.map(summary => ({
      taskId: summary.taskId,
      hypothesis: summary.hypothesis || null,
      permissionProfile: summary.permissionProfile || null,
      toolPolicy: summary.toolPolicy || null,
      toolPolicyEnforcement: summary.toolPolicyEnforcement || null,
      success: Boolean(summary.success),
      score: summary.score,
      fixtureSealPack: summary.fixtureSealPack || null,
      hiddenChecksPassed: numberValue(summary.hiddenChecksPassed),
      hiddenChecksFailed: numberValue(summary.hiddenChecksFailed),
      hiddenCheckPacks: summary.hiddenCheckPacks || [],
      semanticScore: summary.semanticScore === undefined ? null : summary.semanticScore,
      semanticChecks: summary.semanticChecks || [],
      policyBlocks: numberValue(summary.policyBlocks),
      toolPolicyViolations: summary.toolPolicyViolations || [],
      safetyViolation: summary.safetyViolation,
      errorCategory: summary.errorCategory || null,
      telemetryMatched: Boolean(summary.telemetryMatched),
      azureSpans: numberValue(summary.azureSpans),
      artifactDiff: summary.artifactDiff || { added: [], modified: [], deleted: [], totalChanged: 0 },
      models: summary.models || [],
      tools: summary.tools || [],
      penalties: summary.penalties
    }))
  };

  if (azureTelemetry) report.azureTelemetry = azureTelemetry;
  report.antiCheat = benchmarkCheatSignals(scoredSummaries, azureTelemetry);
  report.promotionGates = benchmarkPromotionGates(scoredSummaries);
  report.promotionApproval = promotionApproval;
  report.promotionGateFailures = benchmarkPromotionGateFailures(report);
  report.recommendation = benchmarkRecommendation(report);
  report.promotion = benchmarkPromotionSummary(report);
  return report;
}

function benchmarkPromotionSummary(report) {
  const action = report.recommendation?.action || 'investigate';
  const decision = action === 'keep' ? 'promote' : action;
  return {
    decision,
    evidence: {
      runId: report.runId,
      passRatePct: report.passRatePct,
      averageScore: report.averageScore,
      toolFailures: report.toolFailures,
      safetyViolationCount: report.safetyViolationCount,
      totalTokens: report.totalTokens,
      cost: report.cost
    },
    gates: report.promotionGates || null,
    gateFailures: report.promotionGateFailures || [],
    approval: report.promotionApproval || null,
    validation: report.azureTelemetry?.ok === false
      ? 'local benchmark summary only; rerun with --azure when live telemetry is required'
      : 'benchmark summary includes local checks' + (report.azureTelemetry ? ' and Azure telemetry' : ''),
    rollback: decision === 'promote'
      ? 'revert the agent, skill, hook, or MCP change if pass rate drops, safety violations appear, or token/cost increases beyond the accepted budget'
      : 'do not promote until failures, safety signals, and cost deltas are explained'
  };
}

function compareRecommendation(comparison) {
  if (comparison.safetyRegressionWarnings.length > 0) {
    return {
      action: 'reject',
      message: 'reject: the after run introduces safety regressions.'
    };
  }
  if (comparison.afterPromotionGateFailures.length > 0) {
    return {
      action: 'reject',
      message: 'reject: the after run misses candidate promotion gates.'
    };
  }
  if (comparison.passRateDelta < -0.05 || comparison.averageScoreDelta < -5) {
    return {
      action: 'reject',
      message: 'reject: the after run is materially worse than the before run.'
    };
  }
  if (comparison.passRateDelta > 0 || comparison.averageScoreDelta >= 2) {
    return {
      action: 'keep',
      message: 'keep: the after run improves benchmark quality without safety regressions.'
    };
  }
  return {
    action: 'investigate',
    message: 'investigate: the before and after runs are close, so review details before deciding.'
  };
}

function compareBenchmarkRuns(beforeRunId, afterRunId, summaries = null, options = {}) {
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const allSummaries = summaries || [
    ...loadBenchmarkSummaries(beforeRunId),
    ...loadBenchmarkSummaries(afterRunId)
  ];
  const before = benchmarkReport(beforeRunId, allSummaries, { ...options, approvalFile: null, promotionApproval: null });
  const after = benchmarkReport(afterRunId, allSummaries, options);
  if (before.ok === false || after.ok === false) {
    const missingComparison = {
      ok: false,
      beforeRunId,
      afterRunId,
      message: [
        before.ok === false ? `missing before run summaries for ${beforeRunId}` : null,
        after.ok === false ? `missing after run summaries for ${afterRunId}` : null
      ].filter(Boolean).join('; ')
    };
    if (options.azure) {
      missingComparison.azureTelemetry = {
        before: before.azureTelemetry || null,
        after: after.azureTelemetry || null
      };
    }
    return missingComparison;
  }
  const safetyRegressionWarnings = [];

  if (after.safetyViolationCount > before.safetyViolationCount) {
    safetyRegressionWarnings.push('after run has more tasks with safety violations');
  }
  if (after.forbiddenFilesChanged > before.forbiddenFilesChanged) {
    safetyRegressionWarnings.push('after run changed more forbidden files');
  }
  if (after.policyBlocks > before.policyBlocks) {
    safetyRegressionWarnings.push('after run triggered more policy blocks');
  }
  if (after.contentCaptureDetected && !before.contentCaptureDetected) {
    safetyRegressionWarnings.push('after run detected content capture');
  }

  const comparison = {
    beforeRunId,
    afterRunId,
    before: {
      passRate: before.passRate,
      passRatePct: before.passRatePct,
      averageScore: before.averageScore,
      toolFailures: before.toolFailures,
      totalTokens: before.totalTokens,
      cost: before.cost,
      promotionGateFailures: before.promotionGateFailures || []
    },
    after: {
      passRate: after.passRate,
      passRatePct: after.passRatePct,
      averageScore: after.averageScore,
      toolFailures: after.toolFailures,
      totalTokens: after.totalTokens,
      cost: after.cost,
      promotionGates: after.promotionGates || null,
      promotionGateFailures: after.promotionGateFailures || []
    },
    passRateDelta: roundNumber(after.passRate - before.passRate, 3),
    averageScoreDelta: roundNumber(after.averageScore - before.averageScore),
    toolFailuresDelta: after.toolFailures - before.toolFailures,
    tokenDelta: after.totalTokens - before.totalTokens,
    costDelta: roundNumber(after.cost - before.cost, 4),
    safetyRegressionWarnings,
    afterPromotionGateFailures: after.promotionGateFailures || [],
    topFailureCategories: after.topFailureCategories
  };

  if (options.azure) {
    comparison.azureTelemetry = {
      before: before.azureTelemetry || null,
      after: after.azureTelemetry || null
    };
  }

  comparison.recommendation = compareRecommendation(comparison);
  comparison.promotion = {
    decision: comparison.recommendation.action === 'keep' ? 'promote' : comparison.recommendation.action,
    evidence: {
      beforeRunId,
      afterRunId,
      passRateDelta: comparison.passRateDelta,
      averageScoreDelta: comparison.averageScoreDelta,
      toolFailuresDelta: comparison.toolFailuresDelta,
      tokenDelta: comparison.tokenDelta,
      costDelta: comparison.costDelta,
      safetyRegressionWarnings: comparison.safetyRegressionWarnings,
      afterPromotionGateFailures: comparison.afterPromotionGateFailures
    },
    rollback: 'revert the candidate if the benchmark or live telemetry later shows lower pass rate, new safety warnings, or unacceptable token/cost growth'
  };
  return comparison;
}

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  if (command === 'setup') {
    const options = parseSetupArgs(args);
    const result = agentopsSetupGuide(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSetupGuide(result));
    process.exitCode = 0;
    return;
  }

  if (command === 'status') {
    process.stdout.write(renderStatus());
    return;
  }

  if (command === 'latest') {
    process.stdout.write(renderLatest(latestSummaryFromArgs(args)));
    return;
  }

  if (command === 'live' || command === 'tail') {
    const intervalIndex = args.indexOf('--interval');
    const intervalSec = intervalIndex === -1 ? 5 : Number(args[intervalIndex + 1]);
    if (intervalIndex !== -1 && (!Number.isFinite(intervalSec) || intervalSec <= 0)) {
      throw new Error('--interval must be a positive number of seconds');
    }
    const follow = args.includes('--follow');
    do {
      process.stdout.write(renderLive(liveViewFromArgs(args)));
      if (!follow) return;
      await sleep(intervalSec * 1000);
    } while (follow);
    return;
  }

  if (command === 'replay') {
    const sessionId = args[0];
    if (!sessionId) throw new Error('replay requires a session id or latest');
    const replayArgs = args.slice(1);
    let source;
    if (sessionId === 'latest' || optionValue(replayArgs, ['--file', '--jsonl'])) {
      source = spanRowsFromSource(replayArgs, '7d');
    } else {
      const last = validateKqlDuration(parseLastArg(replayArgs, '7d'));
      const query = sessionQuery(sessionId, last);
      const result = runAzureLogAnalyticsQuery(query);
      source = { mode: 'azure', last, rows: result.ok ? result.rows : [], query, error: result.ok ? null : result.error };
    }
    if (source.error) {
      process.stdout.write(`Session replay: ${sessionId}\n\nCould not read telemetry: ${source.error}\n`);
      return;
    }
    process.stdout.write(renderReplay(replayTimeline(source.rows, { sessionId, source: source.mode })));
    return;
  }

  if (command === 'explain') {
    if (args[0] !== 'latest') throw new Error('explain currently supports: explain latest');
    const summary = latestSummaryFromArgs(args.slice(1));
    process.stdout.write(renderExplanation(explainLatest(summary)));
    return;
  }

  if (command === 'recommend') {
    if (args[0] !== 'latest') throw new Error('recommend currently supports: recommend latest');
    const recommendArgs = args.slice(1);
    const summary = latestSummaryFromArgs(recommendArgs);
    const last = parseLastArg(recommendArgs, '7d');
    process.stdout.write(renderRecommendation(recommendationForExplanation(explainLatest(summary), { last })));
    return;
  }

  if (command === 'open') {
    const summary = latestSummaryFromArgs(args);
    process.stdout.write(renderOpenLinks(openLinksSummary(summary)));
    return;
  }

  if (command === 'workflows') {
    const options = parseWorkflowsArgs(args);
    const workflows = agentopsWorkflows();
    if (options.subcommand === 'list') {
      process.stdout.write(options.json ? JSON.stringify({ workflows }, null, 2) + '\n' : renderWorkflowsList(workflows));
      return;
    }
    if (options.subcommand === 'show') {
      if (!options.name) throw new Error('workflows show requires a workflow name');
      const workflow = workflows.find(item => item.name === options.name);
      if (!workflow) throw new Error(`Unknown workflow: ${options.name}`);
      process.stdout.write(options.json ? JSON.stringify(workflow, null, 2) + '\n' : renderWorkflow(workflow));
      return;
    }
    throw new Error('workflows requires list or show');
  }

  if (command === 'plugin') {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'install') {
      const result = installPlugin(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderPluginInstall(result));
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallPlugin(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderPluginUninstall(result));
      return;
    }
    throw new Error('plugin requires install or uninstall');
  }

  if (command === 'agents') {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'list') {
      process.stdout.write(JSON.stringify({ agents: listDefaultAgents() }, null, 2) + '\n');
      return;
    }
    if (options.subcommand === 'path') {
      process.stdout.write(`${agentInstallTarget(options).targetDir}\n`);
      return;
    }
    if (options.subcommand === 'install') {
      const result = installDefaultAgents(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderAgentsInstall(result));
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallDefaultAgents(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderAgentsUninstall(result));
      return;
    }
    throw new Error('agents requires list, path, install, or uninstall');
  }

  if (command === 'skills') {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'list') {
      process.stdout.write(JSON.stringify({ skills: listDefaultSkills() }, null, 2) + '\n');
      return;
    }
    if (options.subcommand === 'path') {
      process.stdout.write(`${skillInstallTarget(options).targetDir}\n`);
      return;
    }
    if (options.subcommand === 'install') {
      const result = installDefaultSkills(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSkillsInstall(result));
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallDefaultSkills(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSkillsUninstall(result));
      return;
    }
    throw new Error('skills requires list, path, install, or uninstall');
  }

  if (command === 'scan') {
    process.stdout.write(JSON.stringify(scan(), null, 2) + '\n');
    return;
  }

  if (command === 'primitives') {
    process.stdout.write(JSON.stringify(copilotPrimitivesInventory(args), null, 2) + '\n');
    return;
  }

  if (command === 'doctor') {
    const checks = doctor({ localOnly: args.includes('--local-only') });
    process.stdout.write(JSON.stringify({ checks, ok: checks.every(check => check.ok) }, null, 2) + '\n');
    process.exitCode = checks.every(check => check.ok) ? 0 : 1;
    return;
  }

  if (command === 'import-jsonl') {
    const filePath = args[0];
    if (!filePath) throw new Error('import-jsonl requires a file path');
    process.stdout.write(JSON.stringify(importJsonl(path.resolve(filePath)), null, 2) + '\n');
    return;
  }

  if (command === 'custom') {
    const options = parseCustomArgs(args);
    if (options.subcommand === 'emit') {
      const result = await agentopsCustomEmit(options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderCustom(result));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    if (options.subcommand === 'import') {
      if (!options.file) throw new Error('custom import requires a file path');
      const result = await agentopsCustomImport(path.resolve(options.file), options);
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderCustom(result));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    throw new Error('custom requires emit or import');
  }

  if (command === 'configure' || command === 'config') {
    const options = parseConfigureArgs(args);
    const result = agentopsConfigure(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderConfigure(result));
    process.exitCode = result.ok === false ? 1 : 0;
    return;
  }

  if (command === 'otel-setup') {
    const options = parseOtelSetupArgs(args);
    const result = buildOtelSetup(options);
    process.stdout.write(renderOtelSetup(result, options));
    return;
  }

  if (command === 'compat-check') {
    const last = parseLastArg(args, '2h');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: otelCompatibilityQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'validate-collector') {
    process.stdout.write(JSON.stringify(await validateCollector(args[0]), null, 2) + '\n');
    return;
  }

  if (command === 'validate-azure') {
    const last = parseLastArg(args, '2h');
    const result = validateAzure({
      last,
      importDashboards: args.includes('--import-dashboards'),
      production: args.includes('--production'),
      remediationPlan: args.includes('--remediation-plan')
    });
    process.stdout.write(args.includes('--json') ? JSON.stringify(result, null, 2) + '\n' : renderValidateAzure(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === 'validate-enterprise') {
    const result = validateEnterprise();
    process.stdout.write(args.includes('--json') ? JSON.stringify(result, null, 2) + '\n' : renderValidateEnterprise(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === 'init') {
    const options = parseInitArgs(args);
    const result = agentopsInit(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderInit(result));
    process.exitCode = 0;
    return;
  }

  if (command === 'smoke') {
    const options = parseSmokeArgs(args);
    const result = await agentopsSmoke(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSmoke(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === 'attribution-smoke') {
    const options = parseSmokeArgs(args);
    const result = await agentopsAttributionSmoke(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSmoke(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === 'live-replay-smoke') {
    const options = parseSmokeArgs(args);
    const result = await agentopsLiveReplaySmoke(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderSmoke(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === 'ask-context') {
    const options = parseAskContextArgs(args);
    const result = askAgentOpsContext(options);
    process.stdout.write(options.json ? JSON.stringify(result, null, 2) + '\n' : renderAskContext(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (['install', 'enable-shadow', 'disable-shadow', 'uninstall', 'collector', 'start', 'stop', 'copilot', 'codex'].includes(command)) {
    runPlannedCommand(commandPlan(command, args));
    return;
  }

  if (command === 'saved-view') {
    process.stdout.write(JSON.stringify(savedViewCommand(parseSavedViewArgs(args)), null, 2) + '\n');
    return;
  }

  if (command === 'benchmark') {
    const [subcommand, ...benchmarkArgs] = args;
    if (subcommand === 'list') {
      process.stdout.write(JSON.stringify(listBenchmarks(), null, 2) + '\n');
      return;
    }

    if (subcommand === 'run') {
      const options = parseBenchmarkRunArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(runBenchmarkSuite(options.suite, options), null, 2) + '\n');
      return;
    }

    if (subcommand === 'report') {
      const options = parseBenchmarkReportArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(benchmarkReport(options.runId, null, options), null, 2) + '\n');
      return;
    }

    if (subcommand === 'compare') {
      const options = parseBenchmarkCompareArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(compareBenchmarkRuns(options.beforeRunId, options.afterRunId, null, options), null, 2) + '\n');
      return;
    }

    throw new Error('benchmark requires list, run, report, or compare');
  }

  if (command === 'link') {
    const [kind, id, ...linkArgs] = args;
    if (!kind || !id) throw new Error('link requires a kind and id, for example: link session <conversation>');
    const last = parseLastArg(linkArgs, '24h');
    process.stdout.write(JSON.stringify(buildLink(kind, id, { last }), null, 2) + '\n');
    return;
  }

  if (command === 'fields') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: fieldCatalogQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'context') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: contextPressureQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'token-rollup-audit') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: tokenRollupAuditQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'collector-health') {
    const last = parseLastArg(args, '24h');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: collectorHealthQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'attribution') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: attributionUsageQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'permission-friction') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('17-permission-friction.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'alert') {
    const [subcommand, ...alertArgs] = args;
    if (subcommand !== 'recommend') throw new Error('alert currently supports: alert recommend');
    const last = parseLastArg(alertArgs, '14d');
    process.stdout.write(JSON.stringify(alertRecommendations(last), null, 2) + '\n');
    return;
  }

  if (command === 'lineage') {
    const last = parseLastArg(args, '24h');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('19-agent-flow-lineage.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'policy') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('15-policy-governance.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'mcp') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('16-mcp-tool-usage.kql', last) }, null, 2) + '\n');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  agentopsAttributionSmoke,
  agentopsInit,
  agentopsConfigure,
  agentopsSetupGuide,
  agentopsSmoke,
  agentopsLiveReplaySmoke,
  agentopsStatusSummary,
  agentopsWorkflows,
  alertRecommendationQuery,
  alertRecommendations,
  askAgentOpsContext,
  attributionUsageQuery,
  benchmarkCheatSignals,
  benchmarkAzureTelemetry,
  benchmarkAzureTelemetryQuery,
  benchmarkReport,
  benchmarkRunBaseDir,
  benchmarkRunPlan,
  buildOtelSetup,
  buildLink,
  commandPlan,
  compareBenchmarkRuns,
  collectorHealthQuery,
  compactConfig,
  contextPressureQuery,
  copilotPrimitivesInventory,
  agentopsCustomEmit,
  agentopsCustomImport,
  customAzureQuery,
  customEventAttributes,
  customEventId,
  doctor,
  durationToMs,
  explainLatest,
  fieldCatalogQuery,
  configFromEnvValues,
  importJsonl,
  installedShimStatus,
  agentInstallTarget,
  attributionSmokeId,
  liveReplaySmokeId,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  kqlFileQuery,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  latestSummaryFromArgs,
  listGrafanaDashboardFiles,
  listDefaultAgents,
  listDefaultSkills,
  listBenchmarks,
  loadBenchmarkSummaries,
  loadBenchmarkSuites,
  liveViewFromArgs,
  openLinksSummary,
  otlpAttributionSmokeTracePayload,
  otlpCustomEventPayload,
  otlpLiveReplaySmokeTracePayload,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  parseConfigureArgs,
  parseConfigureSetArgs,
  parseCustomArgs,
  parseEnvAssignments,
  parseOtelSetupArgs,
  parseFrontmatter,
  parseSavedViewArgs,
  parseSetupArgs,
  parseSmokeArgs,
  replayTimeline,
  renderExplanation,
  renderAskContext,
  renderConfigure,
  renderCustom,
  renderInit,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderOtelSetup,
  renderRecommendation,
  renderReplay,
  renderSetupGuide,
  renderSmoke,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  renderStatus,
  renderValidateEnterprise,
  renderValidateAzure,
  renderWorkflow,
  renderWorkflowsList,
  recommendationForExplanation,
  readAgentOpsConfig,
  readJsonlRows,
  readSavedViews,
  runAzureLogAnalyticsQuery,
  runBenchmarkSuite,
  savedViewCommand,
  scan,
  sessionQuery,
  spanRowsFromSource,
  skillInstallTarget,
  otelCompatibilityQuery,
  tokenRollupAuditQuery,
  enrichBenchmarkSummariesWithAzure,
  traceQuery,
  validateEnterprise,
  validateAzure,
  validateKqlDuration,
  validateBenchmarkTask,
  validateCollector,
  verifySmokeInAzure,
  uninstallDefaultAgents,
  uninstallDefaultSkills,
  uninstallPlugin,
  writeAgentOpsConfig
};
