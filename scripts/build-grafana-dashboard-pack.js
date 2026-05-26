#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const grafanaDir = path.join(repoRoot, 'grafana');

const datasource = {
  type: 'grafana-azure-monitor-datasource',
  uid: process.env.AGENTOPS_GRAFANA_DATASOURCE_UID || 'azure-monitor-oob',
};

const subscriptionId = process.env.AGENTOPS_AZURE_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID || '00000000-0000-0000-0000-000000000000';
const resourceGroup = process.env.AGENTOPS_AZURE_RESOURCE_GROUP || process.env.AZURE_RESOURCE_GROUP || 'rg-agentops-dev';
const workspaceName = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || 'law-agentops-dev';
const workspaceResource = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID || `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}`;
const portalLogsUrl = process.env.AGENTOPS_AZURE_PORTAL_LOGS_URL || `https://portal.azure.com/#@/resource${workspaceResource}/logs`;
const baseFilter = "(Properties has 'github.copilot' or Properties has 'gen_ai.operation.name' or AppRoleName in ('github-copilot', 'copilot-chat', 'github-copilot-cli') or tostring(Properties['service.name']) in ('github-copilot', 'copilot-chat', 'github-copilot-cli'))";
const sessionKey = "case(isnotempty(tostring(Properties['gen_ai.conversation.id'])), tostring(Properties['gen_ai.conversation.id']), isnotempty(tostring(Properties['github.copilot.interaction_id'])), tostring(Properties['github.copilot.interaction_id']), strcat(tostring(Properties['gen_ai.agent.id']), '_', tostring(Properties['github.copilot.turn_count']), '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMdd_HHmm')))";
const directSessionKey = "case(isnotempty(tostring(Properties['gen_ai.conversation.id'])), tostring(Properties['gen_ai.conversation.id']), isnotempty(tostring(Properties['github.copilot.interaction_id'])), tostring(Properties['github.copilot.interaction_id']), '')";
const fallbackSessionKey = "strcat(tostring(Properties['gen_ai.agent.id']), '_', tostring(Properties['github.copilot.turn_count']), '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMdd_HHmm'))";

function target(query, resultFormat = 'table') {
  return [{
    refId: 'A',
    queryType: 'Azure Log Analytics',
    datasource,
    azureLogAnalytics: {
      resources: [workspaceResource],
      resultFormat,
      query,
    },
  }];
}

function queryVariable(name, label, query, multi = true) {
  return {
    name,
    label,
    type: 'query',
    datasource,
    queryType: 'Azure Log Analytics',
    query: {
      queryType: 'Azure Log Analytics',
      azureLogAnalytics: {
        resources: [workspaceResource],
        query,
      },
    },
    refresh: 2,
    includeAll: true,
    multi,
    current: multi
      ? { selected: false, text: ['All'], value: ['$__all'] }
      : { selected: false, text: 'All', value: '$__all' },
  };
}

function constantVariable(name, value) {
  return {
    name,
    type: 'constant',
    query: value,
    current: { selected: false, text: value, value },
    hide: 2,
  };
}

function customVariable(name, label, options, current = 'all') {
  return {
    name,
    label,
    type: 'custom',
    query: options.join(','),
    current: { selected: true, text: current, value: current },
  };
}

function sharedVariables(includeConversation = true) {
  const variables = [
    constantVariable('workspaceResource', workspaceResource),
    queryVariable('model', 'Model', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend model=tostring(Properties['gen_ai.request.model']) | where isnotempty(model) | distinct model | order by model asc`),
    queryVariable('operation', 'Operation', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend operation=tostring(Properties['gen_ai.operation.name']) | where isnotempty(operation) | distinct operation | order by operation asc`),
    queryVariable('agent', 'Agent', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend agent=tostring(Properties['gen_ai.agent.name']) | where isnotempty(agent) | distinct agent | order by agent asc`),
    queryVariable('agentops_agent', 'Custom Agent', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])) | where isnotempty(agentops_agent) | distinct agentops_agent | order by agentops_agent asc`),
    queryVariable('skill', 'Skill', `union isfuzzy=true AppDependencies, AppTraces, AppEvents | where TimeGenerated > ago(14d) | where tostring(Properties) has_any ('agentops.skill', 'github.copilot.skill') | extend skill=coalesce(tostring(Properties['agentops.skill.name']), tostring(Properties['github.copilot.skill.name'])) | where isnotempty(skill) | distinct skill | order by skill asc`),
    queryVariable('mcp_server', 'MCP Server', `union isfuzzy=true AppDependencies, AppTraces, AppEvents | where TimeGenerated > ago(14d) | where tostring(Properties) has_any ('agentops.mcp', 'mcp__') | extend tool=tostring(Properties['gen_ai.tool.name']), mcp_server=coalesce(tostring(Properties['agentops.mcp.server']), tostring(Properties['agentops.mcp.config.servers']), extract('^mcp__([^_]+)__', 1, tool), extract('^([^/]+)/', 1, tool)) | where isnotempty(mcp_server) | distinct mcp_server | order by mcp_server asc`),
    queryVariable('script', 'Script / Hook', `union isfuzzy=true AppDependencies, AppTraces, AppEvents | where TimeGenerated > ago(14d) | where tostring(Properties) has_any ('agentops.script', 'agentops.hook', 'github.copilot.hook') | extend script=coalesce(tostring(Properties['agentops.script.name']), tostring(Properties['agentops.hook.name']), tostring(Properties['github.copilot.hook.name']), tostring(Properties['github.copilot.hook.type'])) | where isnotempty(script) | distinct script | order by script asc`),
    queryVariable('repo', 'Repo', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend repo=tostring(Properties['agentops.repo.hash']) | where isnotempty(repo) | distinct repo | order by repo asc`),
    queryVariable('tool', 'Tool', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend tool=tostring(Properties['gen_ai.tool.name']) | where isnotempty(tool) | distinct tool | order by tool asc`),
    customVariable('risk', 'Risk', ['all', 'failed', 'expensive', 'slow', 'policy', 'content'], 'all'),
  ];

  if (includeConversation) {
    variables.splice(1, 0, queryVariable('conversation', 'Session', `${sessionizedDependenciesBase('TimeGenerated > ago(7d)')} | where isnotempty(conversation) | distinct conversation | order by conversation desc`, false));
  }

  return { list: variables };
}

function dashboardLinks() {
  return [
    { title: 'Overview', url: '/d/copilot-agentops', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Sessions', url: '/d/agentops-sessions', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Session Detail', url: '/d/agentops-session-detail', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Traces / Spans', url: '/d/agentops-traces-spans', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Tools & MCP', url: '/d/agentops-tools-mcp', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Runtime Events', url: '/d/agentops-runtime-events', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Attribution', url: '/d/agentops-attribution', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Safety & Policy', url: '/d/agentops-safety-policy', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Permission Friction', url: '/d/agentops-permission-friction', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Alert Tuning', url: '/d/agentops-alert-tuning', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Quality', url: '/d/agentops-quality', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Experiments', url: '/d/agentops-experiments', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Data Quality', url: '/d/agentops-data-quality', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Azure Portal - Log Analytics', url: portalLogsUrl, type: 'link', icon: 'external link', targetBlank: true },
  ];
}

function baseDashboard(uid, title, panels, includeConversation = true) {
  return {
    annotations: { list: [] },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: dashboardLinks(),
    liveNow: false,
    panels,
    refresh: '1m',
    schemaVersion: 39,
    tags: ['agentops', 'copilot-cli', 'llm-observability'],
    templating: sharedVariables(includeConversation),
    time: { from: 'now-24h', to: 'now' },
    timepicker: {},
    timezone: 'browser',
    title,
    uid,
    version: 1,
    weekStart: '',
  };
}

function textPanel(id, x, y, w, h, content) {
  return {
    id,
    type: 'text',
    gridPos: { h, w, x, y },
    options: { mode: 'markdown', content },
  };
}

function statPanel(id, title, x, y, query, unit = 'short', color = 'blue') {
  return {
    id,
    type: 'stat',
    title,
    gridPos: { h: 4, w: 6, x, y },
    datasource,
    fieldConfig: {
      defaults: {
        color: { mode: 'thresholds' },
        thresholds: { mode: 'absolute', steps: [{ color, value: null }] },
        unit,
      },
      overrides: [],
    },
    options: {
      colorMode: 'value',
      graphMode: 'area',
      justifyMode: 'auto',
      orientation: 'auto',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto',
    },
    targets: target(query, 'time_series'),
  };
}

function tablePanel(id, title, x, y, w, h, query, overrides = []) {
  return {
    id,
    type: 'table',
    title,
    gridPos: { h, w, x, y },
    datasource,
    fieldConfig: {
      defaults: {
        color: { mode: 'thresholds' },
        custom: { align: 'auto', cellOptions: { type: 'auto' }, inspect: false },
      },
      overrides,
    },
    options: {
      cellHeight: 'sm',
      footer: { countRows: false, fields: '', reducer: ['sum'], show: false },
      showHeader: true,
    },
    targets: target(query, 'table'),
  };
}

function timeseriesPanel(id, title, x, y, w, h, query, unit = 'short') {
  return {
    id,
    type: 'timeseries',
    title,
    gridPos: { h, w, x, y },
    datasource,
    fieldConfig: { defaults: { color: { mode: 'palette-classic' }, unit }, overrides: [] },
    options: { legend: { calcs: [], displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'none' } },
    targets: target(query, 'time_series'),
  };
}

function byNameLink(fieldName, title, url, targetBlank = false) {
  return {
    matcher: { id: 'byName', options: fieldName },
    properties: [{ id: 'links', value: [{ title, url, targetBlank }] }],
  };
}

function byNameLinks(fieldName, links) {
  return {
    matcher: { id: 'byName', options: fieldName },
    properties: [{ id: 'links', value: links }],
  };
}

function byNameUnit(fieldName, unit, decimals) {
  const properties = [{ id: 'unit', value: unit }];
  if (decimals !== undefined) properties.push({ id: 'decimals', value: decimals });
  return { matcher: { id: 'byName', options: fieldName }, properties };
}

function sessionBaseWhere() {
  return `${sessionizedDependenciesBase('$__timeFilter(TimeGenerated)')} | extend operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), skill=coalesce(tostring(Properties['agentops.skill.name']), tostring(Properties['github.copilot.skill.name'])), mcp_server=coalesce(tostring(Properties['agentops.mcp.server']), tostring(Properties['agentops.mcp.config.servers']), extract('^mcp__([^_]+)__', 1, tostring(Properties['gen_ai.tool.name'])), extract('^([^/]+)/', 1, tostring(Properties['gen_ai.tool.name']))), script=coalesce(tostring(Properties['agentops.script.name']), tostring(Properties['agentops.hook.name']), tostring(Properties['github.copilot.hook.name']), tostring(Properties['github.copilot.hook.type'])), error=tostring(Properties['error.type']) | where ('$model' == '$__all' or model in (${'${model:singlequote}'})) | where ('$operation' == '$__all' or operation in (${'${operation:singlequote}'})) | where ('$agent' == '$__all' or agent in (${'${agent:singlequote}'})) | where ('$agentops_agent' == '$__all' or agentops_agent in (${'${agentops_agent:singlequote}'})) | where ('$repo' == '$__all' or repo in (${'${repo:singlequote}'})) | where ('$tool' == '$__all' or tool in (${'${tool:singlequote}'})) | where ('$skill' == '$__all' or skill in (${'${skill:singlequote}'})) | where ('$mcp_server' == '$__all' or mcp_server in (${'${mcp_server:singlequote}'})) | where ('$script' == '$__all' or script in (${'${script:singlequote}'}))`;
}

function sessionizedDependenciesBase(timePredicate) {
  return `AppDependencies | where ${timePredicate} | where ${baseFilter} | extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey} | join kind=leftouter (AppDependencies | where ${timePredicate} | where ${baseFilter} | extend direct_session=${directSessionKey} | where isnotempty(direct_session) | summarize operation_session=take_any(direct_session) by OperationId) on OperationId | extend conversation=iff(isnotempty(operation_session), operation_session, iff(isnotempty(direct_session), direct_session, fallback_session))`;
}

function usageFields() {
  return `InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), CacheRead=todouble(Properties['gen_ai.usage.cache_read.input_tokens']), CacheWrite=todouble(Properties['gen_ai.usage.cache_creation.input_tokens']), Credits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu'])`;
}

function sessionUsageRollup() {
  return `ChatSpans=countif(operation == 'chat'), AgentSpans=countif(operation == 'invoke_agent'), ChatInputTokens=sumif(InputTokens, operation == 'chat'), ChatOutputTokens=sumif(OutputTokens, operation == 'chat'), ChatCacheRead=sumif(CacheRead, operation == 'chat'), ChatCacheWrite=sumif(CacheWrite, operation == 'chat'), ChatCredits=sumif(Credits, operation == 'chat'), ChatAIU=sumif(AIU, operation == 'chat'), AgentInputTokens=maxif(InputTokens, operation == 'invoke_agent'), AgentOutputTokens=maxif(OutputTokens, operation == 'invoke_agent'), AgentCacheRead=maxif(CacheRead, operation == 'invoke_agent'), AgentCacheWrite=maxif(CacheWrite, operation == 'invoke_agent'), AgentCredits=maxif(Credits, operation == 'invoke_agent'), AgentAIU=maxif(AIU, operation == 'invoke_agent')`;
}

function extendRecommendedUsage() {
  return `InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens), OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens), CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead), CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite), AICredits=iff(ChatSpans > 0, ChatCredits, AgentCredits), AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)`;
}

function usageTrendQuery(extraFilter = '') {
  return `${sessionBaseWhere()} ${extraFilter} | extend UsageBin=bin(TimeGenerated, $__interval), ${usageFields()} | summarize ${sessionUsageRollup()} by UsageBin, Session=conversation | extend ${extendRecommendedUsage()} | extend Tokens=coalesce(InputTokens, 0.0) + coalesce(OutputTokens, 0.0) | summarize Tokens=sum(Tokens), EstUsd=sum(AICredits) * 0.01, Credits=sum(AICredits), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), CacheRead=sum(CacheRead), CacheWrite=sum(CacheWrite) by TimeGenerated=UsageBin | order by TimeGenerated asc`;
}

function sessionsQuery(limit = 100) {
  return `${sessionBaseWhere()} | extend ${usageFields()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), DurationMs=max(DurationMs), Spans=count(), Runs=countif(operation == 'invoke_agent'), ToolCalls=countif(operation == 'execute_tool'), Failures=countif(Success == false or isnotempty(error)), ${sessionUsageRollup()}, Models=make_set(model, 5), Agents=make_set(agent, 5), Repos=make_set(repo, 3), Operations=make_set(operation, 8) by Session=conversation | extend ${extendRecommendedUsage()} | extend EstUsd=round(AICredits * 0.01, 4), DurationSec=round(DurationMs / 1000.0, 2), SuccessPct=round(100.0 * (Spans - Failures) / Spans, 1) | extend Risk=case(Failures > 0, 'failed', EstUsd >= 1.0, 'expensive', DurationMs >= 30000, 'slow', 'ok') | where '$risk' == 'all' or Risk == '$risk' | project Started, Ended, Session, Risk, DurationSec, SuccessPct, Spans, Runs, ToolCalls, Failures, Models, Agents, Repos, InputTokens, OutputTokens, CacheRead, CacheWrite, AICredits, EstUsd, AIU, Operations | order by Started desc | take ${limit}`;
}

function workflowRiskQuery() {
  return `${sessionBaseWhere()} | extend ${usageFields()} | summarize HasInvoke=countif(operation == 'invoke_agent') > 0, HasTool=countif(operation == 'execute_tool' or isnotempty(tool)) > 0, ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), Failures=countif(Success == false or isnotempty(error)), ${sessionUsageRollup()}, P95DurationMs=percentile(DurationMs, 95) by Session=conversation | extend ${extendRecommendedUsage()} | extend Risk=case(Failures > 0, 'failed', ToolFailures > 0, 'tool_failed', AICredits * 0.01 >= 1.0, 'expensive', P95DurationMs >= 30000, 'slow', InputTokens >= 30000, 'high_context', HasTool, 'used_tools', HasInvoke, 'invoked', 'other') | summarize Sessions=count() by Risk | order by Sessions desc`;
}

function contextPressureSessionsQuery(limit = 100) {
  return `${sessionBaseWhere()} | extend ${usageFields()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), Runs=countif(operation == 'invoke_agent'), Failures=countif(Success == false or isnotempty(error)), ${sessionUsageRollup()}, P95DurationMs=percentile(DurationMs, 95), Models=make_set(model, 5), Agents=make_set(agent, 5), Repos=make_set_if(repo, isnotempty(repo), 3), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session=conversation | extend ${extendRecommendedUsage()} | extend FreshInput=iff(InputTokens - CacheRead - CacheWrite < 0, 0.0, InputTokens - CacheRead - CacheWrite), OutputYieldPct=iff(InputTokens > 0, round(100.0 * OutputTokens / InputTokens, 3), 0.0), CacheLeveragePct=iff(InputTokens > 0, round(100.0 * CacheRead / InputTokens, 1), 0.0), CacheWritePct=iff(InputTokens > 0, round(100.0 * CacheWrite / InputTokens, 1), 0.0), EstUsd=round(AICredits * 0.01, 4), DurationSec=round(datetime_diff('millisecond', Ended, Started) / 1000.0, 2) | extend Pressure=case(InputTokens >= 100000 and OutputYieldPct < 0.1, 'severe_low_yield', InputTokens >= 100000, 'severe_context', InputTokens >= 30000 and OutputYieldPct < 0.1, 'high_low_yield', InputTokens >= 30000, 'high_context', FreshInput >= 30000 and CacheLeveragePct < 10, 'low_cache_leverage', EstUsd >= 1.0, 'expensive', 'ok') | where Pressure != 'ok' | project Started, Session, Pressure, InputTokens, OutputTokens, OutputYieldPct, CacheRead, CacheWrite, FreshInput, CacheLeveragePct, CacheWritePct, Credits=AICredits, EstUsd, AIU, DurationSec, P95DurationMs, Runs, Spans, Failures, Models, Agents, Repos, Tools, Errors | order by InputTokens desc, EstUsd desc | take ${limit}`;
}

function contextPressureContributorsQuery() {
  return `${sessionBaseWhere()} | extend ${usageFields()} | summarize Sessions=dcount(conversation), Failures=countif(Success == false or isnotempty(error)), P95DurationMs=percentile(DurationMs, 95), ${sessionUsageRollup()} by Session=conversation, model, agent, repo | extend ${extendRecommendedUsage()} | extend FreshInput=iff(InputTokens - CacheRead - CacheWrite < 0, 0.0, InputTokens - CacheRead - CacheWrite), OutputYieldPct=iff(InputTokens > 0, OutputTokens / InputTokens, 0.0) | summarize Sessions=dcount(Session), HighContextSessions=dcountif(Session, InputTokens >= 30000), LowYieldSessions=dcountif(Session, InputTokens >= 30000 and OutputYieldPct < 0.001), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), CacheRead=sum(CacheRead), CacheWrite=sum(CacheWrite), FreshInput=sum(FreshInput), EstUsd=sum(AICredits) * 0.01, P95DurationMs=percentile(P95DurationMs, 95), Failures=sum(Failures) by model, agent, repo | extend OutputYieldPct=iff(InputTokens > 0, round(100.0 * OutputTokens / InputTokens, 3), 0.0), CacheLeveragePct=iff(InputTokens > 0, round(100.0 * CacheRead / InputTokens, 1), 0.0) | order by InputTokens desc, EstUsd desc | take 50`;
}

function contextPressureTrendQuery() {
  return usageTrendQuery();
}

function kqlFileQuery(fileName) {
  return fs.readFileSync(path.join(repoRoot, 'kql', fileName), 'utf8');
}

function sessionFilterPipe() {
  return `| where ('$conversation' == '$__all' or conversation == '$conversation')`;
}

function runtimeBaseWhere() {
  return `union isfuzzy=true AppTraces, AppDependencies, AppEvents | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('github.copilot', 'gen_ai.operation.name', 'agentops.', 'copilot_chat') or Message has_any ('github.copilot', 'AgentOps', 'copilot_chat') | extend conversation=${sessionKey}, operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), skill=coalesce(tostring(Properties['agentops.skill.name']), tostring(Properties['github.copilot.skill.name'])), mcp_server=coalesce(tostring(Properties['agentops.mcp.server']), tostring(Properties['agentops.mcp.config.servers']), extract('^mcp__([^_]+)__', 1, tostring(Properties['gen_ai.tool.name'])), extract('^([^/]+)/', 1, tostring(Properties['gen_ai.tool.name']))), script=coalesce(tostring(Properties['agentops.script.name']), tostring(Properties['agentops.hook.name']), tostring(Properties['github.copilot.hook.name']), tostring(Properties['github.copilot.hook.type'])), error=tostring(Properties['error.type']) | where ('$agentops_agent' == '$__all' or agentops_agent in (${'${agentops_agent:singlequote}'})) | where ('$skill' == '$__all' or skill in (${'${skill:singlequote}'})) | where ('$mcp_server' == '$__all' or mcp_server in (${'${mcp_server:singlequote}'})) | where ('$script' == '$__all' or script in (${'${script:singlequote}'}))`;
}

function sessionReplayQuery() {
  const spanRows = `${sessionBaseWhere()} ${sessionFilterPipe()} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), Credits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu']), EventType=case(operation == 'invoke_agent', 'agent', operation == 'chat', 'llm', operation == 'execute_tool' or isnotempty(tool), 'tool', 'span') | project TimeGenerated, EventType, Event=operation, Name, OperationId, SpanId=Id, ParentId, agent, model, tool, DurationMs, Success, error, InputTokens, OutputTokens, Credits, AIU, Detail=ResultCode`;
  const eventRows = `${runtimeBaseWhere()} ${sessionFilterPipe()} | extend Event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), EventType=case(Event has 'hook', 'hook', Event has 'skill', 'skill', Event has 'truncation' or Event has 'compaction', 'context', Event has 'shutdown' or Event has 'abort', 'lifecycle', Event == 'exception' or isnotempty(error), 'error', 'event'), tokens_removed=toint(Properties['github.copilot.tokens_removed']), messages_removed=toint(Properties['github.copilot.messages_removed']), hook=tostring(Properties['github.copilot.hook.type']), skill=tostring(Properties['github.copilot.skill.name']) | where EventType != 'event' or tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.skill' | project TimeGenerated, EventType, Event, Name=coalesce(Event, Message), OperationId, SpanId=Id, ParentId, agent, model, tool=coalesce(tool, hook, skill), DurationMs=real(null), Success=iff(tostring(Properties['github.copilot.success']) == 'false' or isnotempty(error), false, true), error, InputTokens=real(null), OutputTokens=real(null), Credits=real(null), AIU=real(null), Detail=strcat('tokens_removed=', tostring(tokens_removed), ' messages_removed=', tostring(messages_removed))`;
  return `union isfuzzy=true (${spanRows}), (${eventRows}) | order by TimeGenerated asc | take 500`;
}

function sessionsDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 3, '## AgentOps Sessions\nSession-first LLM observability for Copilot CLI. Sort by risk, cost, failures, or duration; drill into a single session for spans, events, tools, and safety signals.'),
    statPanel(2, 'Sessions', 0, 3, `${sessionBaseWhere()} | summarize Sessions=dcount(conversation) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Failures', 6, 3, `${sessionBaseWhere()} | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'AI Credits', 12, 3, `${usageTrendQuery()} | project TimeGenerated, Credits`, 'short', 'yellow'),
    statPanel(5, 'P95 Duration', 18, 3, `${sessionBaseWhere()} | where operation == 'invoke_agent' | summarize P95=percentile(DurationMs, 95) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'ms', 'green'),
    tablePanel(10, 'Session Explorer', 0, 7, 24, 14, sessionsQuery(200), [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open runtime events', url: '/d/agentops-runtime-events?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameUnit('DurationSec', 's', 2),
      byNameUnit('SuccessPct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('AICredits', 'short', 2),
    ]),
    timeseriesPanel(20, 'Sessions by risk', 0, 21, 12, 8, `${sessionBaseWhere()} | extend UsageBin=bin(TimeGenerated, $__interval), ${usageFields()} | summarize Failures=countif(Success == false or isnotempty(error)), DurationMs=max(DurationMs), ${sessionUsageRollup()} by UsageBin, conversation | extend ${extendRecommendedUsage()} | extend Risk=case(Failures > 0, 'failed', AICredits * 0.01 >= 1.0, 'expensive', DurationMs >= 30000, 'slow', 'ok') | summarize Sessions=dcount(conversation) by TimeGenerated=UsageBin, Risk | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Cost and tokens', 12, 21, 12, 8, usageTrendQuery()),
  ];
  return baseDashboard('agentops-sessions', 'AgentOps Sessions', panels, false);
}

function sessionDetailDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Session Detail\nSingle-session investigation: spans, tool waterfall, runtime events, token/cost breakdown, and safety signals.'),
    statPanel(2, 'Spans', 0, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize Spans=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Failures', 6, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Tokens', 12, 2, `${usageTrendQuery(sessionFilterPipe())} | project TimeGenerated, Tokens`, 'short', 'green'),
    statPanel(5, 'Est. USD', 18, 2, `${usageTrendQuery(sessionFilterPipe())} | project TimeGenerated, EstUsd`, 'currencyUSD', 'yellow'),
    tablePanel(10, 'Session replay timeline', 0, 6, 24, 13, sessionReplayQuery(), [
      byNameLinks('OperationId', [
        { title: 'Open traces dashboard', url: '/d/agentops-traces-spans?var-conversation=$conversation&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open Azure Log Analytics', url: portalLogsUrl, targetBlank: true },
      ]),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(20, 'Span duration by operation', 0, 19, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize DurationMs=avg(DurationMs) by bin(TimeGenerated, $__interval), operation | order by TimeGenerated asc`, 'ms'),
    tablePanel(21, 'Tool waterfall', 12, 19, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | where operation == 'execute_tool' or isnotempty(tool) | project TimeGenerated, tool, Name, DurationMs, Success, ResultCode, error | order by TimeGenerated asc`, [byNameUnit('DurationMs', 'ms', 2)]),
    tablePanel(30, 'Runtime events', 0, 27, 24, 9, `${runtimeBaseWhere()} ${sessionFilterPipe()} | where tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.tokens_removed' or isnotempty(error) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), skill=tostring(Properties['github.copilot.skill.name']), hook=tostring(Properties['github.copilot.hook.name']), tokens_removed=toint(Properties['github.copilot.tokens_removed']) | project TimeGenerated, event, operation, agent, model, tool, skill, hook, tokens_removed, error, Message | order by TimeGenerated asc`, [byNameUnit('tokens_removed', 'short')]),
  ];
  return baseDashboard('agentops-session-detail', 'AgentOps Session Detail', panels, true);
}

function tracesDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Traces / Spans\nRaw span inspection for Copilot CLI operations. Use filters for model, operation, tool, repo, and session.'),
    tablePanel(10, 'Trace / span explorer', 0, 2, 24, 14, `${sessionBaseWhere()} ${sessionFilterPipe()} | project TimeGenerated, Session=conversation, OperationId, ParentId, Id, operation, Name, agent, model, tool, repo, DurationMs, Success, ResultCode, error | order by TimeGenerated desc | take 500`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open runtime events', url: '/d/agentops-runtime-events?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameLink('OperationId', 'Open Azure Log Analytics', portalLogsUrl, true),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(20, 'Span count by operation', 0, 16, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize Spans=count() by bin(TimeGenerated, $__interval), operation | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Latency percentiles', 12, 16, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize P50=percentile(DurationMs, 50), P95=percentile(DurationMs, 95), P99=percentile(DurationMs, 99) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'ms'),
    tablePanel(30, 'Errors by operation', 0, 24, 24, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | where Success == false or isnotempty(error) | summarize Failures=count(), P95DurationMs=percentile(DurationMs, 95), ResultCodes=make_set(ResultCode, 5) by operation, error, model, tool | order by Failures desc`, [byNameUnit('P95DurationMs', 'ms', 2)]),
  ];
  return baseDashboard('agentops-traces-spans', 'AgentOps Traces / Spans', panels, true);
}

function attributionBaseWhere() {
  return `union isfuzzy=true (${sessionBaseWhere()} | project TimeGenerated, conversation, operation, agentops_agent, model, tool, repo, skill, mcp_server, script, DurationMs, Success, error, Properties), (${runtimeBaseWhere()} | project TimeGenerated, conversation, operation, agentops_agent, model, tool, repo, skill, mcp_server, script, DurationMs=real(null), Success=bool(null), error, Properties) | extend AttributionKind=case(isnotempty(skill), 'skill', isnotempty(mcp_server), 'mcp', isnotempty(script), 'script_or_hook', isnotempty(agentops_agent), 'agent', 'unattributed'), AttributionName=case(isnotempty(skill), skill, isnotempty(mcp_server), mcp_server, isnotempty(script), script, isnotempty(agentops_agent), agentops_agent, 'unattributed')`;
}

function attributionDashboard() {
  const base = attributionBaseWhere();
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Attribution\nUsage, failures, cost, and tool activity grouped by custom agents, skills, MCP servers/tools, and scripts/hooks. Filters apply across the dashboard.'),
    statPanel(2, 'Attributed Sessions', 0, 2, `${base} | where AttributionKind != 'unattributed' | summarize Sessions=dcount(conversation) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Attributed Failures', 6, 2, `${base} | where AttributionKind != 'unattributed' | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'MCP Tool Calls', 12, 2, `${base} | where isnotempty(mcp_server) or tool startswith 'mcp__' or tool contains '/' | summarize Calls=countif(operation == 'execute_tool' or isnotempty(tool)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(5, 'Skills / Hooks', 18, 2, `${base} | where isnotempty(skill) or isnotempty(script) | summarize Events=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue'),
    tablePanel(10, 'Attribution Explorer', 0, 6, 24, 12, `${base} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), AICredits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu']) | summarize Started=min(TimeGenerated), LastSeen=max(TimeGenerated), Sessions=dcount(conversation), Spans=count(), Failures=countif(Success == false or isnotempty(error)), ToolCalls=countif(operation == 'execute_tool' or isnotempty(tool)), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), AICredits=sum(AICredits), AIU=sum(AIU), Models=make_set_if(model, isnotempty(model), 5), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by AttributionKind, AttributionName | extend EstUsd=round(AICredits * 0.01, 4), FailurePct=iff(Spans > 0, round(100.0 * Failures / Spans, 1), 0.0) | where AttributionKind != 'unattributed' | order by Sessions desc, Failures desc, AICredits desc`, [
      byNameUnit('FailurePct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('AICredits', 'short', 2),
    ]),
    timeseriesPanel(20, 'Sessions by attribution kind', 0, 18, 12, 8, `${base} | where AttributionKind != 'unattributed' | summarize Sessions=dcount(conversation) by TimeGenerated=bin(TimeGenerated, $__interval), AttributionKind | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Failures by attribution kind', 12, 18, 12, 8, `${base} | where AttributionKind != 'unattributed' | summarize Failures=countif(Success == false or isnotempty(error)) by TimeGenerated=bin(TimeGenerated, $__interval), AttributionKind | order by TimeGenerated asc`),
    tablePanel(30, 'MCP server and tool usage', 0, 26, 12, 9, `${base} | where isnotempty(mcp_server) or tool startswith 'mcp__' or tool contains '/' | summarize Calls=count(), Failures=countif(Success == false or isnotempty(error)), Sessions=dcount(conversation), P95DurationMs=percentile(DurationMs, 95), Errors=make_set_if(error, isnotempty(error), 10) by mcp_server, tool | extend FailurePct=iff(Calls > 0, round(100.0 * Failures / Calls, 1), 0.0) | order by Calls desc, Failures desc | take 100`, [
      byNameUnit('FailurePct', 'percent', 1),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
    tablePanel(31, 'Skill and script events', 12, 26, 12, 9, `${base} | where isnotempty(skill) or isnotempty(script) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), operation, tostring(Properties['type'])) | summarize Events=count(), Sessions=dcount(conversation), Failures=countif(Success == false or isnotempty(error)), LastSeen=max(TimeGenerated), EventNames=make_set_if(event, isnotempty(event), 10), Errors=make_set_if(error, isnotempty(error), 10) by skill, script | order by Events desc, Failures desc | take 100`),
  ];
  return baseDashboard('agentops-attribution', 'AgentOps Attribution', panels, true);
}

function toolsMcpDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Tools & MCP\nTool calls, failure rates, and likely MCP or extension-provided tools.'),
    statPanel(2, 'Tool Calls', 0, 2, `${sessionBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | summarize Calls=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Tool Failures', 6, 2, `${sessionBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Likely MCP Tools', 12, 2, `${sessionBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | where tool !in ('bash','powershell','list_bash','list_powershell','read_bash','read_powershell','stop_bash','stop_powershell','write_bash','write_powershell','apply_patch','create','edit','view','list_agents','read_agent','task','ask_user','glob','grep','rg','skill','web_fetch') and isnotempty(tool) | summarize Tools=dcount(tool) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    tablePanel(10, 'Tool and MCP usage', 0, 6, 24, 16, kqlFileQuery('16-mcp-tool-usage.kql'), [
      byNameUnit('failure_pct', 'percent', 1),
      byNameUnit('p50_duration_ms', 'ms', 2),
      byNameUnit('p95_duration_ms', 'ms', 2),
    ]),
    tablePanel(20, 'Recent tool waterfall', 0, 22, 24, 9, `${sessionBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | project TimeGenerated, Session=conversation, tool, model, repo, DurationMs, Success, ResultCode, error | order by TimeGenerated desc | take 300`, [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
  ];
  return baseDashboard('agentops-tools-mcp', 'AgentOps Tools & MCP', panels, false);
}

function runtimeEventsDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Runtime Events\nHooks, skills, compaction/truncation, shutdown, exceptions, and policy decisions.'),
    statPanel(2, 'Content Capture Signals', 0, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'gen_ai.prompt' or tostring(Properties) has 'gen_ai.completion' or tostring(Properties) has 'gen_ai.input.messages' or tostring(Properties) has 'gen_ai.output.messages' | summarize Signals=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(3, 'Compactions / Truncations', 6, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'github.copilot.session.truncation' or tostring(Properties) has 'github.copilot.session.compaction' or tostring(Properties) has 'github.copilot.tokens_removed' | summarize Events=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(4, 'Policy Blocks', 12, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'preToolUse' or tostring(Properties) has 'AgentOps preToolUse policy' or Message has 'AgentOps preToolUse policy' | summarize Blocks=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(5, 'Hook / Skill Events', 18, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.skill' | summarize Events=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue'),
    tablePanel(10, 'Runtime event stream', 0, 6, 24, 14, `${runtimeBaseWhere()} ${sessionFilterPipe()} | where tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.tokens_removed' or tostring(Properties) has 'preToolUse' or isnotempty(error) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), skill=tostring(Properties['github.copilot.skill.name']), hook=tostring(Properties['github.copilot.hook.name']), tokens_removed=toint(Properties['github.copilot.tokens_removed']), policy=iff(tostring(Properties) has 'preToolUse' or Message has 'AgentOps preToolUse policy', 'policy', '') | project TimeGenerated, Session=conversation, event, policy, operation, agent, model, tool, skill, hook, tokens_removed, error, Message | order by TimeGenerated desc | take 500`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameUnit('tokens_removed', 'short'),
    ]),
  ];
  return baseDashboard('agentops-runtime-events', 'AgentOps Runtime Events', panels, true);
}

function safetyPolicyDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Safety & Policy\nPrivacy posture, permission mode, content capture signals, and policy friction.'),
    statPanel(2, 'Content Capture Signals', 0, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'gen_ai.input.messages' or tostring(Properties) has 'gen_ai.output.messages' or tostring(Properties) has 'gen_ai.tool.call.arguments' or tostring(Properties) has 'gen_ai.tool.call.result' | summarize Signals=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(3, 'Allow All Sessions', 6, 2, `${sessionBaseWhere()} | summarize AllowAll=max(toint(tostring(Properties['agentops.cli.allow_all']) == 'true')) by conversation, bin(TimeGenerated, $__interval) | summarize Sessions=sum(AllowAll) by TimeGenerated | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Policy Blocks', 12, 2, `${runtimeBaseWhere()} | where tostring(Properties) has 'preToolUse' or Message has 'AgentOps preToolUse policy' | summarize Blocks=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(5, 'Remote Enabled', 18, 2, `${sessionBaseWhere()} | where tostring(Properties['agentops.cli.remote']) == 'enabled' | summarize Sessions=dcount(conversation) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue'),
    tablePanel(10, 'Governance session review', 0, 6, 24, 17, kqlFileQuery('15-policy-governance.kql'), [
      byNameLink('session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.session}'),
    ]),
    tablePanel(20, 'Permission friction candidates', 0, 23, 24, 9, permissionFrictionSessionsQuery(), [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('FrictionScore', 'short', 0),
      byNameUnit('DurationSec', 's', 2),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
  ];
  return baseDashboard('agentops-safety-policy', 'AgentOps Safety & Policy', panels, false);
}

function permissionFrictionBaseWhere() {
  return `union isfuzzy=true AppDependencies, AppTraces | where $__timeFilter(TimeGenerated) | where tostring(Properties) has 'github.copilot' or Message has 'github.copilot' or Message has 'AgentOps' | extend conversation=${sessionKey}, operation=tostring(Properties['gen_ai.operation.name']), tool=tostring(Properties['gen_ai.tool.name']), agent=tostring(Properties['gen_ai.agent.name']), model=tostring(Properties['gen_ai.request.model']), repo=tostring(Properties['agentops.repo.hash']), error=tostring(Properties['error.type']), allow_all=tostring(Properties['agentops.cli.allow_all']) == 'true', allow_all_tools=tostring(Properties['agentops.cli.allow_all_tools']) == 'true', allow_all_paths=tostring(Properties['agentops.cli.allow_all_paths']) == 'true', allow_all_urls=tostring(Properties['agentops.cli.allow_all_urls']) == 'true', allow_tool_count=toint(Properties['agentops.cli.allow_tool.count']), allow_url_count=toint(Properties['agentops.cli.allow_url.count']), deny_tool_count=toint(Properties['agentops.cli.deny_tool.count']), deny_url_count=toint(Properties['agentops.cli.deny_url.count']), available_tool_count=toint(Properties['agentops.cli.available_tools.count']), excluded_tool_count=toint(Properties['agentops.cli.excluded_tools.count']), disabled_mcp_server_count=toint(Properties['agentops.cli.disabled_mcp_server.count']), extra_mcp_config_count=toint(Properties['agentops.cli.additional_mcp_config.count']), configured_mcp_servers=tostring(Properties['agentops.mcp.config.servers']), disabled_mcp_servers=tostring(Properties['agentops.mcp.disabled.servers']) | extend is_tool=operation == 'execute_tool' or isnotempty(tool), is_policy_block=tostring(Properties) has 'preToolUse' or tostring(Properties) has 'permissionDecision' or tostring(Properties) has 'AgentOps preToolUse policy' or Message has 'AgentOps preToolUse policy' or Message has 'permission', is_retry_hint=Message has 'Recovery hint' or tostring(Properties) has 'Recovery hint'`;
}

function permissionFrictionSessionsQuery(limit = 100) {
  return `${permissionFrictionBaseWhere()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), ToolCalls=countif(is_tool), ToolFailures=countif(is_tool and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), PolicyBlocks=countif(is_policy_block), RetryHints=countif(is_retry_hint), AllowAll=max(toint(allow_all)), AllowAllTools=max(toint(allow_all_tools)), AllowAllPaths=max(toint(allow_all_paths)), AllowAllUrls=max(toint(allow_all_urls)), MaxAllowTools=max(allow_tool_count), MaxAllowUrls=max(allow_url_count), MaxDenyTools=max(deny_tool_count), MaxDenyUrls=max(deny_url_count), MaxAvailableTools=max(available_tool_count), MaxExcludedTools=max(excluded_tool_count), MaxDisabledMcp=max(disabled_mcp_server_count), MaxExtraMcpConfigs=max(extra_mcp_config_count), P95DurationMs=percentile(DurationMs, 95), Tools=make_set_if(tool, isnotempty(tool), 10), Agents=make_set_if(agent, isnotempty(agent), 5), Models=make_set_if(model, isnotempty(model), 5), Repos=make_set_if(repo, isnotempty(repo), 3), ConfiguredMcpServers=make_set_if(configured_mcp_servers, isnotempty(configured_mcp_servers), 10), DisabledMcpServerNames=make_set_if(disabled_mcp_servers, isnotempty(disabled_mcp_servers), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session=conversation | extend AllowAll=coalesce(AllowAll, 0), AllowAllTools=coalesce(AllowAllTools, 0), AllowAllPaths=coalesce(AllowAllPaths, 0), AllowAllUrls=coalesce(AllowAllUrls, 0), MaxAllowTools=coalesce(MaxAllowTools, 0), MaxAllowUrls=coalesce(MaxAllowUrls, 0), MaxDenyTools=coalesce(MaxDenyTools, 0), MaxDenyUrls=coalesce(MaxDenyUrls, 0), MaxAvailableTools=coalesce(MaxAvailableTools, 0), MaxExcludedTools=coalesce(MaxExcludedTools, 0), MaxDisabledMcp=coalesce(MaxDisabledMcp, 0), MaxExtraMcpConfigs=coalesce(MaxExtraMcpConfigs, 0) | extend DurationSec=round(datetime_diff('millisecond', Ended, Started) / 1000.0, 2), FrictionScore=PolicyBlocks * 5 + ToolFailures * 3 + RetryHints * 2 + AllowAll * 2 + MaxDenyTools + MaxDenyUrls + MaxExcludedTools + MaxDisabledMcp, Posture=case(PolicyBlocks > 0, 'blocked', ToolFailures > 0, 'tool_failed', RetryHints > 0, 'retry_hint', AllowAll > 0, 'allow_all', AllowAllTools > 0 or AllowAllPaths > 0 or AllowAllUrls > 0, 'permissive_scope', MaxDenyTools > 0 or MaxDenyUrls > 0 or MaxExcludedTools > 0 or MaxDisabledMcp > 0, 'restricted', 'ok') | where Posture != 'ok' | project Started, Session, Posture, FrictionScore, DurationSec, Spans, ToolCalls, ToolFailures, PolicyBlocks, RetryHints, AllowAll, AllowAllTools, AllowAllPaths, AllowAllUrls, MaxAllowTools, MaxAllowUrls, MaxDenyTools, MaxDenyUrls, MaxAvailableTools, MaxExcludedTools, MaxDisabledMcp, MaxExtraMcpConfigs, P95DurationMs, Tools, Agents, Models, Repos, ConfiguredMcpServers, DisabledMcpServerNames, Errors | order by FrictionScore desc, Started desc | take ${limit}`;
}

function permissionFrictionDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Permission Friction\nPermission posture, policy blocks, retry hints, broad allow modes, and tool failures that slow or risk Copilot CLI sessions.'),
    statPanel(2, 'Policy Blocks', 0, 2, `${permissionFrictionBaseWhere()} | where is_policy_block | summarize Blocks=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(3, 'Tool Failures', 6, 2, `${permissionFrictionBaseWhere()} | where is_tool | summarize Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Retry Hints', 12, 2, `${permissionFrictionBaseWhere()} | where is_retry_hint | summarize Hints=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(5, 'Allow All Sessions', 18, 2, `${permissionFrictionBaseWhere()} | summarize AllowAll=max(toint(allow_all)) by conversation, TimeGenerated=bin(TimeGenerated, $__interval) | summarize Sessions=sum(AllowAll) by TimeGenerated | order by TimeGenerated asc`, 'short', 'red'),
    tablePanel(10, 'Friction sessions', 0, 6, 24, 15, permissionFrictionSessionsQuery(200), [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('FrictionScore', 'short', 0),
      byNameUnit('DurationSec', 's', 2),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(20, 'Friction by posture', 0, 21, 12, 8, `${permissionFrictionBaseWhere()} | summarize ToolFailures=countif(is_tool and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), PolicyBlocks=countif(is_policy_block), RetryHints=countif(is_retry_hint), AllowAll=max(toint(allow_all)), AllowAllTools=max(toint(allow_all_tools)), AllowAllPaths=max(toint(allow_all_paths)), AllowAllUrls=max(toint(allow_all_urls)), MaxDenyTools=max(deny_tool_count), MaxDenyUrls=max(deny_url_count), MaxExcludedTools=max(excluded_tool_count), MaxDisabledMcp=max(disabled_mcp_server_count) by TimeGenerated=bin(TimeGenerated, $__interval), conversation | extend AllowAll=coalesce(AllowAll, 0), AllowAllTools=coalesce(AllowAllTools, 0), AllowAllPaths=coalesce(AllowAllPaths, 0), AllowAllUrls=coalesce(AllowAllUrls, 0), MaxDenyTools=coalesce(MaxDenyTools, 0), MaxDenyUrls=coalesce(MaxDenyUrls, 0), MaxExcludedTools=coalesce(MaxExcludedTools, 0), MaxDisabledMcp=coalesce(MaxDisabledMcp, 0) | extend Posture=case(PolicyBlocks > 0, 'blocked', ToolFailures > 0, 'tool_failed', RetryHints > 0, 'retry_hint', AllowAll > 0, 'allow_all', AllowAllTools > 0 or AllowAllPaths > 0 or AllowAllUrls > 0, 'permissive_scope', MaxDenyTools > 0 or MaxDenyUrls > 0 or MaxExcludedTools > 0 or MaxDisabledMcp > 0, 'restricted', 'ok') | where Posture != 'ok' | summarize Sessions=dcount(conversation) by TimeGenerated, Posture | order by TimeGenerated asc`),
    tablePanel(21, 'Tools behind friction', 12, 21, 12, 8, `${permissionFrictionBaseWhere()} | where is_tool or is_policy_block or is_retry_hint | summarize Calls=countif(is_tool), Failures=countif(is_tool and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), PolicyBlocks=countif(is_policy_block), RetryHints=countif(is_retry_hint), Sessions=dcount(conversation), P95DurationMs=percentile(DurationMs, 95) by tool, error | extend FailurePct=iff(Calls > 0, round(100.0 * Failures / Calls, 1), 0.0), FrictionScore=PolicyBlocks * 5 + Failures * 3 + RetryHints * 2 | order by FrictionScore desc, Failures desc | take 50`, [
      byNameUnit('FailurePct', 'percent', 1),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
  ];
  return baseDashboard('agentops-permission-friction', 'AgentOps Permission Friction', panels, false);
}

function alertRecommendationDashboardQuery() {
  return `let hourly = ${sessionBaseWhere()} | extend AIU=todouble(Properties['github.copilot.aiu']), Credits=todouble(Properties['github.copilot.cost']) | summarize Spans=count(), Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), AIU=sum(AIU), Credits=sum(Credits) by conversation, TimeGenerated=bin(TimeGenerated, 1h); let content = union isfuzzy=true AppDependencies, AppTraces | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.prompt', 'gen_ai.completion', 'github.copilot.message') | summarize ContentCaptureSignals=count() by bin(TimeGenerated, 1h); let session_rollup = hourly | summarize Hours=count(), P50Aiu=percentile(AIU, 50), P95Aiu=percentile(AIU, 95), P99Aiu=percentile(AIU, 99), MaxAiu=max(AIU), P95Failures=percentile(Failures, 95), MaxFailures=max(Failures), P95ToolFailures=percentile(ToolFailures, 95), MaxToolFailures=max(ToolFailures), P95Credits=percentile(Credits, 95), MaxCredits=max(Credits); let content_rollup = content | summarize ContentCaptureHours=countif(ContentCaptureSignals > 0), MaxContentCaptureSignals=max(ContentCaptureSignals); union (session_rollup | extend SuggestedThreshold=case(P99Aiu * 1.25 > P95Aiu * 2, P99Aiu * 1.25, P95Aiu * 2) | project Rule='high-aiu', CurrentThreshold=50000000000.0, SuggestedThreshold, P50=P50Aiu, P95=P95Aiu, P99=P99Aiu, MaxObserved=MaxAiu, SupportingHours=Hours, Rollout='Keep disabled until clean history exists.'), (session_rollup | extend SuggestedThreshold=case(P95Failures > 1, P95Failures, 1.0) | project Rule='failed-spans', CurrentThreshold=0.0, SuggestedThreshold, P50=real(null), P95=P95Failures, P99=real(null), MaxObserved=MaxFailures, SupportingHours=Hours, Rollout='Review false positives before action groups.'), (content_rollup | project Rule='content-capture', CurrentThreshold=0.0, SuggestedThreshold=0.0, P50=real(null), P95=real(null), P99=real(null), MaxObserved=coalesce(MaxContentCaptureSignals, 0), SupportingHours=ContentCaptureHours, Rollout='Keep strict; investigate immediately if nonzero.')`;
}

function alertTuningDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Alert Tuning\nProposal-only threshold evidence for disabled Azure Monitor rules. Keep action groups off until thresholds are validated against real history.'),
    tablePanel(10, 'Threshold recommendations', 0, 2, 24, 12, alertRecommendationDashboardQuery(), [
      byNameUnit('CurrentThreshold', 'short', 2),
      byNameUnit('SuggestedThreshold', 'short', 2),
      byNameUnit('P50', 'short', 2),
      byNameUnit('P95', 'short', 2),
      byNameUnit('P99', 'short', 2),
      byNameUnit('MaxObserved', 'short', 2),
    ]),
    timeseriesPanel(20, 'Hourly failures', 0, 14, 12, 8, `${sessionBaseWhere()} | summarize Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))) by TimeGenerated=bin(TimeGenerated, 1h) | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Hourly AIU', 12, 14, 12, 8, `${sessionBaseWhere()} | extend AIU=todouble(Properties['github.copilot.aiu']) | summarize AIU=sum(AIU) by TimeGenerated=bin(TimeGenerated, 1h) | order by TimeGenerated asc`),
  ];
  return baseDashboard('agentops-alert-tuning', 'AgentOps Alert Tuning', panels, false);
}

function qualityDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Quality / Optimization\nFind expensive, slow, failing, or risky Copilot CLI sessions and the likely tuning candidates.'),
    tablePanel(10, 'Most expensive sessions', 0, 2, 12, 10, `${sessionsQuery(50)} | order by EstUsd desc`, [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('EstUsd', 'currencyUSD', 4),
    ]),
    tablePanel(11, 'Slowest sessions', 12, 2, 12, 10, `${sessionsQuery(50)} | order by DurationSec desc`, [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('DurationSec', 's', 2),
    ]),
    tablePanel(20, 'Tool failure candidates', 0, 12, 12, 10, `${sessionBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | summarize Calls=count(), Failures=countif(Success == false or isnotempty(error)), P95DurationMs=percentile(DurationMs, 95), Sessions=dcount(conversation) by tool, error | extend FailurePct=round(100.0 * Failures / Calls, 1) | where Calls >= 1 | order by FailurePct desc, Failures desc | take 50`, [byNameUnit('FailurePct', 'percent', 1), byNameUnit('P95DurationMs', 'ms', 2)]),
    tablePanel(21, 'Model cost and latency', 12, 12, 12, 10, `${sessionBaseWhere()} | where operation == 'invoke_agent' | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), Credits=todouble(Properties['github.copilot.cost']) | summarize Runs=count(), Sessions=dcount(conversation), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), EstUsd=sum(Credits) * 0.01, P95DurationMs=percentile(DurationMs, 95), Failures=countif(Success == false or isnotempty(error)) by model | order by EstUsd desc`, [byNameUnit('EstUsd', 'currencyUSD', 4), byNameUnit('P95DurationMs', 'ms', 2)]),
    tablePanel(30, 'Repo repeated-failure candidates', 0, 22, 24, 9, `${sessionBaseWhere()} | extend ${usageFields()} | summarize Spans=count(), Failures=countif(Success == false or isnotempty(error)), P95DurationMs=percentile(DurationMs, 95), TopErrors=make_set(error, 5), ${sessionUsageRollup()} by Session=conversation, repo | extend ${extendRecommendedUsage()} | summarize Sessions=dcount(Session), Spans=sum(Spans), Failures=sum(Failures), EstUsd=sum(AICredits) * 0.01, P95DurationMs=percentile(P95DurationMs, 95), TopErrors=make_set(TopErrors, 5) by repo | where isnotempty(repo) | extend FailurePct=round(100.0 * Failures / Spans, 1) | order by Failures desc, EstUsd desc | take 50`, [byNameUnit('EstUsd', 'currencyUSD', 4), byNameUnit('P95DurationMs', 'ms', 2), byNameUnit('FailurePct', 'percent', 1)]),
    tablePanel(40, 'Workflow funnel risks', 0, 31, 24, 8, workflowRiskQuery()),
    tablePanel(41, 'Context pressure sessions', 0, 39, 24, 10, contextPressureSessionsQuery(100), [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('OutputYieldPct', 'percent', 3),
      byNameUnit('CacheLeveragePct', 'percent', 1),
      byNameUnit('CacheWritePct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('DurationSec', 's', 2),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
    tablePanel(42, 'Context pressure contributors', 0, 49, 12, 9, contextPressureContributorsQuery(), [
      byNameUnit('OutputYieldPct', 'percent', 3),
      byNameUnit('CacheLeveragePct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(43, 'Input, output, and cache tokens', 12, 49, 12, 9, contextPressureTrendQuery()),
  ];
  return baseDashboard('agentops-quality', 'AgentOps Quality', panels, false);
}

function dataQualityDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Data Quality\nField discovery, token rollup, collector health, and smoke-ingestion checks for validating dashboard assumptions against real Copilot CLI telemetry.'),
    tablePanel(10, 'Token rollup audit', 0, 2, 24, 13, fs.readFileSync(path.join(repoRoot, 'kql', '13-token-rollup-audit.kql'), 'utf8'), [
      byNameUnit('TokenOvercountRatio', 'short', 2),
    ]),
    tablePanel(20, 'Collector health and smoke ingestion', 0, 15, 24, 8, fs.readFileSync(path.join(repoRoot, 'kql', '21-collector-health.kql'), 'utf8')),
    tablePanel(30, 'Observed property fields', 0, 23, 24, 14, `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend fields = bag_keys(Properties) | mv-expand field = fields to typeof(string) | extend value = tostring(Properties[field]) | summarize observed=count(), example_values=make_set_if(value, isnotempty(value), 5) by field | order by observed desc, field asc`),
  ];
  return baseDashboard('agentops-data-quality', 'AgentOps Data Quality', panels, false);
}

function benchmarkVariables() {
  const benchmarkFilter = `Properties has 'agentops.benchmark' or Properties has 'agentops.hypothesis.id'`;
  return {
    list: [
      constantVariable('workspaceResource', workspaceResource),
      queryVariable('benchmark_suite', 'Suite', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend suite=tostring(Properties['agentops.benchmark.suite']) | where isnotempty(suite) | distinct suite | order by suite asc`),
      queryVariable('benchmark_task', 'Task', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend task_id=tostring(Properties['agentops.benchmark.task_id']) | where isnotempty(task_id) | distinct task_id | order by task_id asc`),
      queryVariable('benchmark_variant', 'Variant', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend variant=tostring(Properties['agentops.benchmark.variant']) | where isnotempty(variant) | distinct variant | order by variant asc`),
      queryVariable('benchmark_run', 'Run', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend run_id=tostring(Properties['agentops.benchmark.run_id']) | where isnotempty(run_id) | distinct run_id | order by run_id desc`),
      queryVariable('hypothesis', 'Hypothesis', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend hypothesis_id=tostring(Properties['agentops.hypothesis.id']) | where isnotempty(hypothesis_id) | distinct hypothesis_id | order by hypothesis_id asc`),
    ],
  };
}

function benchmarkBaseWhere() {
  return `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend suite=tostring(Properties['agentops.benchmark.suite']), task_id=tostring(Properties['agentops.benchmark.task_id']), variant=tostring(Properties['agentops.benchmark.variant']), run_id=tostring(Properties['agentops.benchmark.run_id']), hypothesis_id=tostring(Properties['agentops.hypothesis.id']), operation=tostring(Properties['gen_ai.operation.name']), conversation=${sessionKey}, tool=tostring(Properties['gen_ai.tool.name']), error=tostring(Properties['error.type']) | where isnotempty(suite) or isnotempty(task_id) or isnotempty(variant) or isnotempty(run_id) or isnotempty(hypothesis_id) | where ('$benchmark_suite' == '$__all' or suite in (${'${benchmark_suite:singlequote}'})) | where ('$benchmark_task' == '$__all' or task_id in (${'${benchmark_task:singlequote}'})) | where ('$benchmark_variant' == '$__all' or variant in (${'${benchmark_variant:singlequote}'})) | where ('$benchmark_run' == '$__all' or run_id in (${'${benchmark_run:singlequote}'})) | where ('$hypothesis' == '$__all' or hypothesis_id in (${'${hypothesis:singlequote}'})) | extend Score=coalesce(todouble(Properties['agentops.benchmark.score']), todouble(Properties['agentops.eval.score']), todouble(Properties['agentops.score']), todouble(Properties['score'])), Passed=coalesce(tobool(Properties['agentops.benchmark.passed']), tobool(Properties['agentops.eval.passed']), Success), InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), AICredits=todouble(Properties['github.copilot.cost']), EstUsd=todouble(Properties['github.copilot.cost']) * 0.01, Regression=coalesce(tobool(Properties['agentops.benchmark.regression']), tobool(Properties['agentops.regression'])), SafetyIssue=iff(tostring(Properties['agentops.safety.issue']) != '' or tostring(Properties['agentops.policy.blocked']) == 'true' or tostring(Properties) has 'content_filter' or tostring(Properties) has 'safety', true, false), FailureReason=coalesce(error, tostring(Properties['agentops.benchmark.failure_reason']), tostring(Properties['agentops.eval.failure_reason']), ResultCode)`;
}

function benchmarkRollupQuery() {
  return `${benchmarkBaseWhere()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), Sessions=dcount(conversation), Runs=dcount(run_id), ToolCalls=countif(operation == 'execute_tool' or isnotempty(tool)), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), Failures=countif(Success == false or isnotempty(error)), PassSamples=countif(isnotnull(Passed)), Passes=countif(Passed == true), ScoreSamples=countif(isnotnull(Score)), AverageScore=avg(Score), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), EstUsd=sum(EstUsd), SafetyIssues=countif(SafetyIssue), ExplicitRegressions=countif(Regression == true), FailureReasons=make_set_if(FailureReason, isnotempty(FailureReason), 10) by suite, task_id, hypothesis_id, variant, run_id | extend TokenUse=coalesce(InputTokens, 0.0) + coalesce(OutputTokens, 0.0), PassRate=iff(PassSamples > 0, round(100.0 * Passes / PassSamples, 1), real(null))`;
}

function benchmarkHelpQuery() {
  return `let variants = ${benchmarkRollupQuery()}; let baseline = variants | where tolower(variant) in ('baseline', 'control', 'main', 'default') | summarize BaselineScore=avg(AverageScore), BaselinePassRate=avg(PassRate), BaselineToolFailures=sum(ToolFailures), BaselineCost=avg(EstUsd), BaselineTokenUse=avg(TokenUse) by suite, task_id, hypothesis_id; variants | join kind=leftouter baseline on suite, task_id, hypothesis_id | where isempty(variant) or tolower(variant) !in ('baseline', 'control', 'main', 'default') | extend ScoreDelta=round(AverageScore - BaselineScore, 3), PassRateDelta=round(PassRate - BaselinePassRate, 1), CostDelta=round(EstUsd - BaselineCost, 4), TokenDelta=round(TokenUse - BaselineTokenUse, 0) | extend Verdict=case(isnotnull(ScoreDelta) and ScoreDelta > 0, 'helped', isnotnull(ScoreDelta) and ScoreDelta < 0, 'regressed', isnotnull(PassRateDelta) and PassRateDelta > 0, 'helped', isnotnull(PassRateDelta) and PassRateDelta < 0, 'regressed', ToolFailures < BaselineToolFailures, 'helped', ToolFailures > BaselineToolFailures, 'regressed', isnotnull(BaselineScore) or isnotnull(BaselinePassRate), 'flat', 'needs_score') | project suite, task_id, hypothesis_id, variant, run_id, Verdict, PassRate, PassRateDelta, AverageScore, ScoreDelta, ToolFailures, SafetyIssues, ExplicitRegressions, TokenUse, TokenDelta, EstUsd, CostDelta, Spans, Sessions, Runs, Started, Ended | order by suite asc, task_id asc, hypothesis_id asc, Verdict asc, ScoreDelta desc, PassRateDelta desc`;
}

function benchmarkRegressionsQuery() {
  return `let variants = ${benchmarkRollupQuery()}; let baseline = variants | where tolower(variant) in ('baseline', 'control', 'main', 'default') | summarize BaselineScore=avg(AverageScore), BaselinePassRate=avg(PassRate), BaselineToolFailures=sum(ToolFailures), BaselineCost=avg(EstUsd), BaselineTokenUse=avg(TokenUse) by suite, task_id, hypothesis_id; variants | join kind=leftouter baseline on suite, task_id, hypothesis_id | extend ScoreDelta=round(AverageScore - BaselineScore, 3), PassRateDelta=round(PassRate - BaselinePassRate, 1), CostDelta=round(EstUsd - BaselineCost, 4), TokenDelta=round(TokenUse - BaselineTokenUse, 0) | where ExplicitRegressions > 0 or ScoreDelta < 0 or PassRateDelta < 0 or ToolFailures > BaselineToolFailures | project suite, task_id, hypothesis_id, variant, run_id, ExplicitRegressions, PassRate, PassRateDelta, AverageScore, ScoreDelta, ToolFailures, BaselineToolFailures, TokenUse, TokenDelta, EstUsd, CostDelta, FailureReasons | order by ExplicitRegressions desc, ScoreDelta asc, PassRateDelta asc, ToolFailures desc`;
}

function benchmarkAntiCheatQuery() {
  return `${benchmarkBaseWhere()} | summarize Spans=count(), Runs=dcount(run_id), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), SafetyIssues=countif(SafetyIssue), PolicyBlocks=countif(tostring(Properties['agentops.policy.blocked']) == 'true' or tostring(Properties) has 'policy'), ContentSignals=countif(tostring(Properties) has_any ('content.capture.enabled', 'gen_ai.prompt', 'gen_ai.completion')), MissingRunLabels=countif(isempty(run_id)), FailureReasons=make_set_if(FailureReason, isnotempty(FailureReason), 10), LastSeen=max(TimeGenerated) by suite, task_id, hypothesis_id, variant | extend AntiCheatStatus=case(SafetyIssues > 0 or ContentSignals > 0, 'blocked', PolicyBlocks > 0 or MissingRunLabels > 0, 'review', 'clean') | where AntiCheatStatus != 'clean' | order by AntiCheatStatus asc, SafetyIssues desc, ContentSignals desc, PolicyBlocks desc, MissingRunLabels desc`;
}

function experimentsDashboard() {
  const panels = [
    tablePanel(1, 'Did the change help?', 0, 0, 24, 9, benchmarkHelpQuery(), [
      byNameUnit('PassRate', 'percent', 1),
      byNameUnit('PassRateDelta', 'percent', 1),
      byNameUnit('AverageScore', 'short', 3),
      byNameUnit('ScoreDelta', 'short', 3),
      byNameUnit('TokenUse', 'short', 0),
      byNameUnit('TokenDelta', 'short', 0),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('CostDelta', 'currencyUSD', 4),
    ]),
    statPanel(2, 'Pass rate', 0, 9, `${benchmarkBaseWhere()} | summarize Samples=countif(isnotnull(Passed)), Passes=countif(Passed == true) by TimeGenerated=bin(TimeGenerated, $__interval), variant | extend PassRate=iff(Samples > 0, 100.0 * Passes / Samples, real(null)) | project TimeGenerated, variant, PassRate | order by TimeGenerated asc`, 'percent', 'green'),
    statPanel(3, 'Average score', 6, 9, `${benchmarkBaseWhere()} | summarize AverageScore=avg(Score) by TimeGenerated=bin(TimeGenerated, $__interval), variant | order by TimeGenerated asc`, 'short', 'blue'),
    statPanel(4, 'Tool failures', 12, 9, `${benchmarkBaseWhere()} | where operation == 'execute_tool' or isnotempty(tool) | summarize ToolFailures=countif(Success == false or isnotempty(error)) by TimeGenerated=bin(TimeGenerated, $__interval), variant | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(5, 'Token use', 18, 9, `${benchmarkBaseWhere()} | summarize TokenUse=sum(coalesce(InputTokens, 0.0) + coalesce(OutputTokens, 0.0)) by TimeGenerated=bin(TimeGenerated, $__interval), variant | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(6, 'Cost', 0, 13, `${benchmarkBaseWhere()} | summarize Cost=sum(EstUsd) by TimeGenerated=bin(TimeGenerated, $__interval), variant | order by TimeGenerated asc`, 'currencyUSD', 'yellow'),
    statPanel(7, 'Safety issues', 6, 13, `${benchmarkBaseWhere()} | summarize SafetyIssues=countif(SafetyIssue) by TimeGenerated=bin(TimeGenerated, $__interval), variant | order by TimeGenerated asc`, 'short', 'red'),
    tablePanel(8, 'Regressions', 12, 13, 12, 10, benchmarkRegressionsQuery(), [
      byNameUnit('PassRate', 'percent', 1),
      byNameUnit('PassRateDelta', 'percent', 1),
      byNameUnit('AverageScore', 'short', 3),
      byNameUnit('ScoreDelta', 'short', 3),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('CostDelta', 'currencyUSD', 4),
    ]),
    tablePanel(9, 'Top failure reasons', 0, 23, 24, 10, `${benchmarkBaseWhere()} | where Success == false or isnotempty(error) or isnotempty(FailureReason) | summarize Failures=count(), Runs=dcount(run_id), Sessions=dcount(conversation), Examples=make_set(Name, 5), LastSeen=max(TimeGenerated) by suite, task_id, hypothesis_id, variant, FailureReason | order by Failures desc, LastSeen desc | take 100`),
    tablePanel(10, 'Anti-cheat and promotion blockers', 0, 33, 24, 9, benchmarkAntiCheatQuery()),
  ];
  const dashboard = baseDashboard('agentops-experiments', 'AgentOps Experiments', panels, false);
  dashboard.templating = benchmarkVariables();
  return dashboard;
}

const dashboards = {
  'agentops-sessions.json': sessionsDashboard(),
  'agentops-session-detail.json': sessionDetailDashboard(),
  'agentops-traces-spans.json': tracesDashboard(),
  'agentops-tools-mcp.json': toolsMcpDashboard(),
  'agentops-runtime-events.json': runtimeEventsDashboard(),
  'agentops-attribution.json': attributionDashboard(),
  'agentops-safety-policy.json': safetyPolicyDashboard(),
  'agentops-permission-friction.json': permissionFrictionDashboard(),
  'agentops-alert-tuning.json': alertTuningDashboard(),
  'agentops-quality.json': qualityDashboard(),
  'agentops-experiments.json': experimentsDashboard(),
  'agentops-data-quality.json': dataQualityDashboard(),
};

for (const [fileName, dashboard] of Object.entries(dashboards)) {
  fs.writeFileSync(path.join(grafanaDir, fileName), JSON.stringify(dashboard, null, 2) + '\n');
  console.log(`wrote grafana/${fileName}`);
}
