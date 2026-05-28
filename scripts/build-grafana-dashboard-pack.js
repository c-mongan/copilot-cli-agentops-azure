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
const agentServiceNames = "('github-copilot', 'copilot-chat', 'github-copilot-cli', 'codex', 'openai-codex', 'openai-codex-cli')";
const baseFilter = `(Properties has 'github.copilot' or Properties has 'gen_ai.operation.name' or Properties has 'agentops.' or AppRoleName in ${agentServiceNames} or tostring(Properties['service.name']) in ${agentServiceNames} or tostring(Properties['agent.runtime']) in ('codex', 'openai-codex-cli'))`;
const skillExpr = "coalesce(tostring(Properties['agentops.skill.name']), tostring(Properties['github.copilot.skill.name']))";
const mcpServerExpr = "coalesce(tostring(Properties['agentops.mcp.server']), tostring(Properties['agentops.mcp.config.servers']), extract('^mcp__([^_]+)__', 1, tostring(Properties['gen_ai.tool.name'])), extract('^([^/]+)/', 1, tostring(Properties['gen_ai.tool.name'])), iff(tostring(Properties['gen_ai.tool.name']) startswith 'azure-mcp-', 'azure-mcp', ''))";
const scriptExpr = "coalesce(tostring(Properties['agentops.script.name']), tostring(Properties['agentops.hook.name']), tostring(Properties['github.copilot.hook.name']), tostring(Properties['github.copilot.hook.type']))";
const sessionFallbackPrefix = "iff(isnotempty(tostring(Properties['gen_ai.agent.id'])), tostring(Properties['gen_ai.agent.id']), iff(isnotempty(tostring(Properties['service.name'])), tostring(Properties['service.name']), iff(isnotempty(AppRoleName), AppRoleName, 'agent')))";
const sessionFallbackTurn = "iff(isnotempty(tostring(Properties['github.copilot.turn_count'])), tostring(Properties['github.copilot.turn_count']), iff(isnotempty(OperationId), OperationId, 'session'))";
const sessionKey = `case(isnotempty(tostring(Properties['gen_ai.conversation.id'])), tostring(Properties['gen_ai.conversation.id']), isnotempty(tostring(Properties['github.copilot.interaction_id'])), tostring(Properties['github.copilot.interaction_id']), strcat(${sessionFallbackPrefix}, '_', ${sessionFallbackTurn}, '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMdd_HHmm')))`;
const directSessionKey = "case(isnotempty(tostring(Properties['gen_ai.conversation.id'])), tostring(Properties['gen_ai.conversation.id']), isnotempty(tostring(Properties['github.copilot.interaction_id'])), tostring(Properties['github.copilot.interaction_id']), '')";
const fallbackSessionKey = `strcat(${sessionFallbackPrefix}, '_', ${sessionFallbackTurn}, '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMdd_HHmm'))`;
const sessionDimensionVariables = ['model', 'operation', 'agent', 'agentops_agent', 'repo', 'tool'];
const coreFilterVariables = [];
const sessionFilterVariables = [...sessionDimensionVariables, 'risk'];
const detailFilterVariables = ['conversation', ...coreFilterVariables];
const liveReplayFilterVariables = ['conversation', 'agentops_agent', 'mcp_server', 'tool'];
const traceFilterVariables = [...sessionDimensionVariables];
const toolMcpFilterVariables = ['mcp_server', 'tool'];
const runtimeFilterVariables = [...coreFilterVariables, 'risk'];
const attributionFilterVariables = ['risk'];
const builtinToolNames = "'bash','powershell','list_bash','list_powershell','read_bash','read_powershell','stop_bash','stop_powershell','write_bash','write_powershell','apply_patch','create','edit','view','list_agents','read_agent','task','ask_user','glob','grep','rg','skill','web_fetch'";

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

function queryVariable(name, label, query, multi = true, options = {}) {
  const includeAll = options.includeAll !== false;
  const variable = {
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
    includeAll,
    multi,
  };

  if (includeAll) {
    variable.allValue = '__all';
  }

  if (options.current !== false) {
    variable.current = options.current || (multi
      ? { selected: false, text: ['All'], value: ['__all'] }
      : { selected: false, text: 'All', value: '__all' });
  }

  return variable;
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

function sharedVariables(includeConversation = true, options = {}) {
  const variables = [
    constantVariable('workspaceResource', workspaceResource),
    queryVariable('model', 'Model', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend model=tostring(Properties['gen_ai.request.model']) | where isnotempty(model) | distinct model | order by model asc`),
    queryVariable('operation', 'Operation', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend operation=tostring(Properties['gen_ai.operation.name']) | where isnotempty(operation) | distinct operation | order by operation asc`),
    queryVariable('agent', 'Agent', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend agent=tostring(Properties['gen_ai.agent.name']) | where isnotempty(agent) | distinct agent | order by agent asc`),
    queryVariable('agentops_agent', 'Custom Agent', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])) | where isnotempty(agentops_agent) | distinct agentops_agent | order by agentops_agent asc`),
    queryVariable('skill', 'Skill', `let direct = union isfuzzy=true AppDependencies, AppTraces, AppEvents | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('agentops.skill', 'github.copilot.skill') | extend skill=${skillExpr} | where isnotempty(skill) | project skill; let context = AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | where isnotempty(tostring(Properties['github.copilot.context.skills'])) | mv-expand skill=parse_json(tostring(Properties['github.copilot.context.skills'])) to typeof(string) | where isnotempty(skill) | project skill; union direct, context | distinct skill | order by skill asc`),
    queryVariable('mcp_server', 'MCP Server', `union isfuzzy=true AppDependencies, AppTraces, AppEvents | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('agentops.mcp', 'mcp__', 'azure-mcp-', 'github.copilot.tool.parameters.mcp_tool_name') | extend tool=tostring(Properties['gen_ai.tool.name']) | extend mcp_server=coalesce(tostring(Properties['agentops.mcp.server']), tostring(Properties['agentops.mcp.config.servers']), extract('^mcp__([^_]+)__', 1, tool), extract('^([^/]+)/', 1, tool), iff(tool startswith 'azure-mcp-', 'azure-mcp', '')) | where isnotempty(mcp_server) | distinct mcp_server | order by mcp_server asc`),
    queryVariable('script', 'Script / Hook', `union isfuzzy=true AppDependencies, AppTraces, AppEvents | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('agentops.script', 'agentops.hook', 'github.copilot.hook') | extend script=coalesce(tostring(Properties['agentops.script.name']), tostring(Properties['agentops.hook.name']), tostring(Properties['github.copilot.hook.name']), tostring(Properties['github.copilot.hook.type'])) | where isnotempty(script) | distinct script | order by script asc`),
    queryVariable('repo', 'Repo', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend repo=tostring(Properties['agentops.repo.hash']) | where isnotempty(repo) | distinct repo | order by repo asc`),
    queryVariable('tool', 'Tool', `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend tool=tostring(Properties['gen_ai.tool.name']) | where isnotempty(tool) | distinct tool | order by tool asc`),
    customVariable('risk', 'Risk', ['all', 'failed', 'expensive', 'slow', 'policy', 'content'], 'all'),
  ];

  if (includeConversation) {
    variables.splice(1, 0, queryVariable(
      'conversation',
      'Session',
      `${sessionizedDependenciesBase('$__timeFilter(TimeGenerated)')} | where isnotempty(conversation) | distinct conversation | order by conversation desc`,
      false,
      { includeAll: options.conversationIncludeAll !== false, current: options.conversationCurrent }
    ));
  }

  if (Array.isArray(options.variables)) {
    const allowed = new Set(['workspaceResource', ...options.variables]);
    return { list: variables.filter(variable => variable.type === 'constant' || allowed.has(variable.name)) };
  }

  return { list: variables };
}

function dashboardLinks() {
  return [
    { title: 'Overview', url: '/d/copilot-agentops', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Sessions', url: '/d/agentops-sessions', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Session Detail', url: '/d/agentops-session-detail', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Live Replay', url: '/d/agentops-live-replay', type: 'link', icon: 'dashboard', targetBlank: false },
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

function baseDashboard(uid, title, panels, includeConversation = true, options = {}) {
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
    templating: sharedVariables(includeConversation, options),
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

function statPanel(id, title, x, y, query, unit = 'short', color = 'blue', calc = 'lastNotNull') {
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
      reduceOptions: { calcs: [calc], fields: '', values: false },
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

function grafanaSinglequote(name) {
  return '${' + name + ':singlequote}';
}

function grafanaCsv(name) {
  return '${' + name + ':csv}';
}

function grafanaValue(name) {
  return '${' + name + '}';
}

function grafanaText(name) {
  return '${' + name + ':text}';
}

function grafanaRaw(name) {
  return '${' + name + ':raw}';
}

function variableFilter(column, name = column, options = {}) {
  const values = grafanaSinglequote(name);
  const csvValue = grafanaCsv(name);
  const textValue = grafanaText(name);
  const rawValue = grafanaValue(name);
  const emptyClause = options.includeEmpty ? ` or isempty(${column})` : '';
  return `| where ('${textValue}' == 'All' or '${rawValue}' == '__all' or '${rawValue}' == '$__all' or '${rawValue}' contains ',' or '${csvValue}' == '*' or '${csvValue}' == '__all' or '${csvValue}' == '$__all' or '${csvValue}' contains '__all' or '${csvValue}' contains '$__all' or '${csvValue}' contains ',' or '${csvValue}' == ''${emptyClause} or ${column} in (${values}))`;
}

function riskFilter(column = 'risk') {
  const risk = grafanaValue('risk');
  return `| where '${risk}' == 'all' or '${risk}' == '__all' or '${risk}' == '$__all' or '${risk}' == '' or ${column} == '${risk}'`;
}

function dynamicSetFilter(column, name) {
  const rawValue = grafanaRaw(name);
  return `| where ('${rawValue}' == 'All' or '${rawValue}' == '__all' or '${rawValue}' == '$__all' or '${rawValue}' contains ',' or '${rawValue}' == '' or tostring(${column}) contains '${rawValue}')`;
}

function scalarFilter(column, name = column, options = {}) {
  const rawValue = grafanaRaw(name);
  const emptyClause = options.includeEmpty ? ` or isempty(${column})` : '';
  return `| where ('${rawValue}' == 'All' or '${rawValue}' == '__all' or '${rawValue}' == '$__all' or '${rawValue}' contains ',' or '${rawValue}' == ''${emptyClause} or ${column} == '${rawValue}')`;
}

function commonVariableFilters() {
  return '';
}

function healthyEmptyTable(dataQuery, emptyRowQuery) {
  return `let rows = ${dataQuery}; union rows, (${emptyRowQuery} | where toscalar(rows | count) == 0)`;
}

function sessionBaseWhere() {
  return [
    sessionizedDependenciesBase('$__timeFilter(TimeGenerated)'),
    `| extend operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), skill=${skillExpr}, mcp_server=${mcpServerExpr}, script=${scriptExpr}, error=tostring(Properties['error.type'])`,
    commonVariableFilters(),
  ].join(' ');
}

function customLifecycleBaseWhere(options = {}) {
  const lines = [
    sessionizedDependenciesBase('$__timeFilter(TimeGenerated)'),
    `| extend event=tostring(Properties['agentops.event.name']), event_kind=tostring(Properties['agentops.event.kind']), custom_event_id=tostring(Properties['agentops.custom_event_id']), operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), workflow=tostring(Properties['agentops.workflow.name']), step=tostring(Properties['agentops.step.name']), outcome=tostring(Properties['agentops.outcome']), risk=tostring(Properties['agentops.risk']), score=todouble(Properties['agentops.score']), entity_type=tostring(Properties['agentops.entity.type']), entity_id_hash=tostring(Properties['agentops.entity.id_hash']), tags=tostring(Properties['agentops.tags']), custom_source=tostring(Properties['agentops.custom.source']), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), error=tostring(Properties['error.type'])`,
    '| where isnotempty(event)',
  ];
  if (options.filters !== false) {
    lines.push(riskFilter('risk'));
  }
  return lines.join(' ');
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

function sessionDimensionFilters() {
  return [
    dynamicSetFilter('Models', 'model'),
    dynamicSetFilter('Operations', 'operation'),
    dynamicSetFilter('Agents', 'agent'),
    dynamicSetFilter('CustomAgents', 'agentops_agent'),
    dynamicSetFilter('Repos', 'repo'),
    dynamicSetFilter('Tools', 'tool'),
  ].join(' ');
}

function sessionRollupQuery(limit = 1000) {
  return `${sessionBaseWhere()} | extend ${usageFields()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), DurationMs=max(DurationMs), Spans=count(), Runs=countif(operation == 'invoke_agent'), ToolCalls=countif(operation == 'execute_tool'), Failures=countif(Success == false or isnotempty(error)), ${sessionUsageRollup()}, Models=make_set_if(model, isnotempty(model), 5), Operations=make_set_if(operation, isnotempty(operation), 8), Agents=make_set_if(agent, isnotempty(agent), 5), CustomAgents=make_set_if(agentops_agent, isnotempty(agentops_agent), 5), Repos=make_set_if(repo, isnotempty(repo), 3), Tools=make_set_if(tool, isnotempty(tool), 10) by Session=conversation | extend ${extendRecommendedUsage()} | extend EstUsd=round(AICredits * 0.01, 4), DurationSec=round(DurationMs / 1000.0, 2), SuccessPct=round(100.0 * (Spans - Failures) / Spans, 1) | extend Risk=case(Failures > 0, 'failed', EstUsd >= 1.0, 'expensive', DurationMs >= 30000, 'slow', 'ok') ${sessionDimensionFilters()} ${riskFilter('Risk')} | take ${limit}`;
}

function sessionsQuery(limit = 100) {
  return `${sessionRollupQuery(limit)} | project Started, Ended, Session, Risk, DurationSec, SuccessPct, Spans, Runs, ToolCalls, Failures, Models, Agents, CustomAgents, Repos, Tools, InputTokens, OutputTokens, CacheRead, CacheWrite, AICredits, EstUsd, AIU, Operations | order by Started desc | take ${limit}`;
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
  return variableFilter('conversation');
}

function conversationFilterPipe() {
  return '';
}

function traceDimensionFilters() {
  return [
    scalarFilter('model'),
    scalarFilter('operation'),
    scalarFilter('agent'),
    scalarFilter('agentops_agent'),
    scalarFilter('repo'),
    scalarFilter('tool'),
  ].join(' ');
}

function toolMcpFilters() {
  return [
    scalarFilter('mcp_server'),
    scalarFilter('tool'),
  ].join(' ');
}

function toolMcpRowsWhere() {
  return [
    sessionBaseWhere(),
    "| where operation == 'execute_tool' or isnotempty(tool)",
    `| extend mcp_tool=case(tool startswith 'mcp__', extract('^mcp__.+?__(.+)$', 1, tool), tool contains '/', tostring(split(tool, '/')[1]), tool startswith 'azure-mcp-', substring(tool, strlen('azure-mcp-')), tool)`,
    `| extend tool_family=case(tool in (${builtinToolNames}), 'builtin', isnotempty(mcp_server), 'mcp', tool has '-', 'likely_mcp_or_extension', isnotempty(tool), 'custom_or_unknown', 'unknown')`,
    toolMcpFilters(),
  ].join(' ');
}

function toolMcpUsageQuery() {
  return `${toolMcpRowsWhere()} | summarize calls=count(), failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)), sessions=dcount(conversation), p50_duration_ms=percentile(DurationMs, 50), p95_duration_ms=percentile(DurationMs, 95), first_seen=min(TimeGenerated), last_seen=max(TimeGenerated), models=make_set_if(model, isnotempty(model), 5), repos=make_set_if(repo, isnotempty(repo), 5), errors=make_set_if(error, isnotempty(error), 10) by tool_family, mcp_server, mcp_tool, tool | extend failure_pct=round(100.0 * failures / calls, 1) | order by tool_family asc, mcp_server asc, failures desc, calls desc`;
}

function runtimeBaseWhere() {
  return [
    `union isfuzzy=true AppTraces, AppDependencies, AppEvents | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('github.copilot', 'gen_ai.operation.name', 'agentops.', 'copilot_chat', 'codex') or Message has_any ('github.copilot', 'AgentOps', 'copilot_chat', 'codex') or AppRoleName in ${agentServiceNames} or tostring(Properties['service.name']) in ${agentServiceNames} | extend conversation=${sessionKey}, operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), skill=${skillExpr}, mcp_server=${mcpServerExpr}, script=${scriptExpr}, error=tostring(Properties['error.type'])`,
    commonVariableFilters(),
  ].join(' ');
}

function sessionReplayQuery() {
  const spanRows = `${sessionBaseWhere()} ${sessionFilterPipe()} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), Credits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu']), EventType=case(operation == 'invoke_agent', 'agent', operation == 'chat', 'llm', operation == 'execute_tool' or isnotempty(tool), 'tool', 'span') | project TimeGenerated, EventType, Event=operation, Name, OperationId, SpanId=Id, ParentId, agent, model, tool, DurationMs, Success, error, InputTokens, OutputTokens, Credits, AIU, Detail=ResultCode`;
  const eventRows = `${runtimeBaseWhere()} ${sessionFilterPipe()} | extend Event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), EventType=case(Event has 'hook', 'hook', Event has 'skill', 'skill', Event has 'truncation' or Event has 'compaction', 'context', Event has 'shutdown' or Event has 'abort', 'lifecycle', Event == 'exception' or isnotempty(error), 'error', 'event'), tokens_removed=toint(Properties['github.copilot.tokens_removed']), messages_removed=toint(Properties['github.copilot.messages_removed']), hook=tostring(Properties['github.copilot.hook.type']), skill=tostring(Properties['github.copilot.skill.name']) | where EventType != 'event' or tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.skill' | project TimeGenerated, EventType, Event, Name=coalesce(Event, Message), OperationId, SpanId=Id, ParentId, agent, model, tool=coalesce(tool, hook, skill), DurationMs=real(null), Success=iff(tostring(Properties['github.copilot.success']) == 'false' or isnotempty(error), false, true), error, InputTokens=real(null), OutputTokens=real(null), Credits=real(null), AIU=real(null), Detail=strcat('tokens_removed=', tostring(tokens_removed), ' messages_removed=', tostring(messages_removed))`;
  return `union isfuzzy=true (${spanRows}), (${eventRows}) | order by TimeGenerated asc | take 500`;
}

function liveReplayFilters() {
  return [
    scalarFilter('Session', 'conversation'),
    scalarFilter('agentops_agent'),
    scalarFilter('mcp_server'),
    scalarFilter('tool'),
  ].join(' ');
}

function liveReplayRows() {
  const spanRows = [
    sessionBaseWhere(),
    '| extend InputTokens=todouble(Properties[\'gen_ai.usage.input_tokens\']), OutputTokens=todouble(Properties[\'gen_ai.usage.output_tokens\']), Credits=todouble(Properties[\'github.copilot.cost\']), AIU=todouble(Properties[\'github.copilot.aiu\'])',
    '| extend parent_agent=tostring(Properties[\'agentops.parent_agent.name\']), delegation_id=tostring(Properties[\'agentops.delegation.id\'])',
    `| extend mcp_tool=case(tool startswith 'mcp__', extract('^mcp__.+?__(.+)$', 1, tool), tool contains '/', tostring(split(tool, '/')[1]), tool startswith 'azure-mcp-', substring(tool, strlen('azure-mcp-')), tostring(Properties['agentops.mcp.tool']))`,
    "| extend EventType=case(operation == 'invoke_agent', 'agent', operation == 'chat', 'llm', operation == 'execute_tool' or isnotempty(tool), 'tool', 'span')",
    "| extend Event=operation, Actor=coalesce(agentops_agent, agent, tostring(Properties['service.name']), AppRoleName), Lane=case(isnotempty(parent_agent), strcat(parent_agent, ' > ', coalesce(agentops_agent, agent, 'agent')), isnotempty(agentops_agent), agentops_agent, isnotempty(agent), agent, 'agent')",
    "| project TimeGenerated, Session=conversation, EventType, Event, Lane, Actor, ParentAgent=parent_agent, DelegationId=delegation_id, OperationId, SpanId=Id, ParentId, Name, agentops_agent, agent, model, mcp_server, mcp_tool, tool, skill, script, repo, DurationMs, Success, error, InputTokens, OutputTokens, Credits, AIU, ContentCapture=bool(false), Detail=ResultCode",
  ].join(' ');
  const eventRows = [
    runtimeBaseWhere(),
    "| extend Event=coalesce(tostring(Properties['agentops.event.name']), tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name)",
    "| extend parent_agent=tostring(Properties['agentops.parent_agent.name']), delegation_id=tostring(Properties['agentops.delegation.id']), content_signal=tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has_any ('gen_ai.prompt', 'gen_ai.completion', 'gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.tool.call.arguments', 'gen_ai.tool.call.result')",
    "| extend EventType=case(Event has 'delegation', 'delegation', Event has 'hook' or isnotempty(script), 'script_hook', Event has 'skill' or isnotempty(skill), 'skill', Event has 'policy' or Event has 'blocked', 'policy', Event has 'truncation' or Event has 'compaction', 'context', content_signal, 'content', Event == 'exception' or isnotempty(error), 'error', 'event')",
    "| where EventType != 'event' or tostring(Properties) has_any ('agentops.event', 'github.copilot.session', 'github.copilot.hook', 'github.copilot.skill')",
    "| extend Actor=coalesce(agentops_agent, agent, tostring(Properties['service.name']), AppRoleName), Lane=case(isnotempty(parent_agent), strcat(parent_agent, ' > ', coalesce(agentops_agent, agent, 'agent')), isnotempty(agentops_agent), agentops_agent, isnotempty(agent), agent, 'runtime')",
    "| project TimeGenerated, Session=conversation, EventType, Event, Lane, Actor, ParentAgent=parent_agent, DelegationId=delegation_id, OperationId, SpanId=Id, ParentId, Name=coalesce(Event, Message), agentops_agent, agent, model, mcp_server, mcp_tool=tostring(Properties['agentops.mcp.tool']), tool=coalesce(tool, script, skill), skill, script, repo, DurationMs=real(null), Success=iff(tostring(Properties['github.copilot.success']) == 'false' or isnotempty(error), false, true), error, InputTokens=real(null), OutputTokens=real(null), Credits=real(null), AIU=real(null), ContentCapture=content_signal, Detail=Message",
  ].join(' ');
  return `union isfuzzy=true (${spanRows}), (${eventRows}) ${liveReplayFilters()}`;
}

function liveReplayDashboard() {
  const rows = liveReplayRows();
  const panels = [
    textPanel(1, 0, 0, 24, 3, '## Live Replay\nWatch one agent run as a session timeline. Single-agent runs show one lane; orchestrator runs become a tree when delegation or parent-child span fields are present. Content capture remains signal-only by default.'),
    statPanel(2, 'Events', 0, 3, `${rows} | summarize Events=count() by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Tool Calls', 6, 3, `${rows} | summarize ToolCalls=countif(EventType == 'tool' or isnotempty(tool)) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue'),
    statPanel(4, 'Failures', 12, 3, `${rows} | summarize Failures=countif(Success == false or isnotempty(error)) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(5, 'Content Signals', 18, 3, `${rows} | summarize Signals=countif(ContentCapture) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    tablePanel(10, 'Run tree by agent / delegation lane', 0, 7, 24, 9, `${rows} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Events=count(), LlmCalls=countif(EventType == 'llm'), ToolCalls=countif(EventType == 'tool' or isnotempty(tool)), McpCalls=countif(isnotempty(mcp_server)), ScriptHookEvents=countif(EventType == 'script_hook' or isnotempty(script)), SkillEvents=countif(EventType == 'skill' or isnotempty(skill)), Delegations=countif(EventType == 'delegation' or isnotempty(DelegationId)), Failures=countif(Success == false or isnotempty(error)), DurationMs=sum(DurationMs), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), AICredits=sum(Credits), Tools=make_set_if(tool, isnotempty(tool), 10), MCPServers=make_set_if(mcp_server, isnotempty(mcp_server), 10), Scripts=make_set_if(script, isnotempty(script), 10), Skills=make_set_if(skill, isnotempty(skill), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session, Lane, Actor, ParentAgent, DelegationId | extend EstUsd=round(AICredits * 0.01, 4) | order by Started asc`, [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('DurationMs', 'ms', 2),
      byNameUnit('EstUsd', 'currencyUSD', 4),
    ]),
    tablePanel(20, 'Live timeline', 0, 16, 24, 13, `${rows} | project TimeGenerated, Session, Lane, EventType, Event, Name, OperationId, SpanId, ParentId, Actor, ParentAgent, DelegationId, model, mcp_server, mcp_tool, tool, skill, script, DurationMs, Success, error, InputTokens, OutputTokens, Credits, AIU, ContentCapture, Detail | order by TimeGenerated asc | take 600`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}', targetBlank: false },
      ]),
      byNameUnit('DurationMs', 'ms', 2),
      byNameUnit('Credits', 'short', 2),
    ]),
    tablePanel(30, 'Tool / MCP waterfall', 0, 29, 12, 9, `${rows} | where EventType == 'tool' or isnotempty(tool) or isnotempty(mcp_server) | project TimeGenerated, Session, Lane, mcp_server, mcp_tool, tool, model, DurationMs, Success, error, Detail | order by TimeGenerated asc | take 300`, [
      byNameLink('Session', 'Open traces / spans', '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}'),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
    tablePanel(31, 'Agents, skills, scripts, hooks', 12, 29, 12, 9, `${rows} | where isnotempty(Actor) or isnotempty(skill) or isnotempty(script) or EventType in ('delegation', 'skill', 'script_hook') | summarize Events=count(), Sessions=dcount(Session), LastSeen=max(TimeGenerated), Tools=make_set_if(tool, isnotempty(tool), 10), MCPServers=make_set_if(mcp_server, isnotempty(mcp_server), 10), Skills=make_set_if(skill, isnotempty(skill), 10), Scripts=make_set_if(script, isnotempty(script), 10), Failures=countif(Success == false or isnotempty(error)) by Lane, Actor, ParentAgent, DelegationId | order by LastSeen desc, Events desc | take 100`),
    timeseriesPanel(40, 'Calls, duration, and cost over time', 0, 38, 12, 8, `${rows} | summarize Events=count(), ToolCalls=countif(EventType == 'tool' or isnotempty(tool)), DurationMs=sum(DurationMs), EstUsd=sum(Credits) * 0.01, InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    tablePanel(41, 'Safety and policy signals', 12, 38, 12, 8, `${rows} | where ContentCapture or EventType in ('policy', 'content', 'error') or isnotempty(error) | project TimeGenerated, Session, Lane, EventType, Event, ContentCapture, Success, error, Detail | order by TimeGenerated desc | take 100`),
  ];
  return baseDashboard('agentops-live-replay', 'AgentOps Live Replay', panels, true, { variables: liveReplayFilterVariables });
}

function sessionsDashboard() {
  const filteredSessions = sessionRollupQuery(1000);
  const panels = [
    textPanel(1, 0, 0, 24, 3, '## AgentOps Sessions\nSession-first LLM observability for Copilot CLI. Sort by risk, cost, failures, or duration; drill into a single session for spans, events, tools, and safety signals.'),
    statPanel(2, 'Sessions', 0, 3, `let sessions = ${filteredSessions}; sessions | summarize Sessions=dcount(Session) by TimeGenerated=bin(Started, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Failures', 6, 3, `let sessions = ${filteredSessions}; sessions | summarize Failures=sum(Failures) by TimeGenerated=bin(Started, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'AI Credits', 12, 3, `let sessions = ${filteredSessions}; sessions | summarize Credits=sum(AICredits) by TimeGenerated=bin(Started, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(5, 'P95 Duration', 18, 3, `let sessions = ${filteredSessions}; sessions | summarize P95=percentile(DurationMs, 95) by TimeGenerated=bin(Started, $__interval) | order by TimeGenerated asc`, 'ms', 'green'),
    tablePanel(10, 'Session Explorer', 0, 7, 24, 14, sessionsQuery(200), [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open live replay', url: '/d/agentops-live-replay?var-conversation=${__data.fields.Session}&var-agentops_agent=${agentops_agent}&var-mcp_server=${mcp_server}&var-tool=${tool}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open runtime events', url: '/d/agentops-runtime-events?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameUnit('DurationSec', 's', 2),
      byNameUnit('SuccessPct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('AICredits', 'short', 2),
    ]),
    timeseriesPanel(20, 'Sessions by risk', 0, 21, 12, 8, `let sessions = ${filteredSessions}; sessions | summarize Sessions=dcount(Session) by TimeGenerated=bin(Started, $__interval), Risk | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Cost and tokens', 12, 21, 12, 8, `let sessions = ${filteredSessions}; sessions | summarize Tokens=sum(coalesce(InputTokens, 0.0) + coalesce(OutputTokens, 0.0)), EstUsd=sum(EstUsd), Credits=sum(AICredits), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), CacheRead=sum(CacheRead), CacheWrite=sum(CacheWrite) by TimeGenerated=bin(Started, $__interval) | order by TimeGenerated asc`),
  ];
  return baseDashboard('agentops-sessions', 'AgentOps Sessions', panels, false, { variables: sessionFilterVariables });
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
    tablePanel(30, 'Runtime events', 0, 27, 24, 9, `${runtimeBaseWhere()} ${sessionFilterPipe()} | where tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.context.skills' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.tokens_removed' or isnotempty(error) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), skill=tostring(Properties['github.copilot.skill.name']), context_skills=tostring(Properties['github.copilot.context.skills']), hook=tostring(Properties['github.copilot.hook.name']), tokens_removed=toint(Properties['github.copilot.tokens_removed']) | project TimeGenerated, event, operation, agent, model, tool, skill, context_skills, hook, tokens_removed, error, Message | order by TimeGenerated asc`, [byNameUnit('tokens_removed', 'short')]),
  ];
  return baseDashboard('agentops-session-detail', 'AgentOps Session Detail', panels, true, {
    conversationIncludeAll: false,
    conversationCurrent: false,
    variables: detailFilterVariables,
  });
}

function tracesDashboard() {
  const errorsByOperation = healthyEmptyTable(
    `${sessionBaseWhere()} ${conversationFilterPipe()} ${traceDimensionFilters()} | where Success == false or isnotempty(error) | summarize Failures=count(), P95DurationMs=percentile(DurationMs, 95), ResultCodes=make_set(ResultCode, 5) by operation, error, model, tool | order by Failures desc`,
    "print operation='No errors observed', error='', model='', tool='', Failures=0, P95DurationMs=real(0), ResultCodes=dynamic([])"
  );
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Traces / Spans\nRaw span inspection for Copilot CLI operations. Use filters for model, operation, tool, repo, and session.'),
    tablePanel(10, 'Trace / span explorer', 0, 2, 24, 14, `${sessionBaseWhere()} ${conversationFilterPipe()} ${traceDimensionFilters()} | project TimeGenerated, Session=conversation, OperationId, ParentId, Id, operation, Name, agent, model, tool, repo, DurationMs, Success, ResultCode, error | order by TimeGenerated desc | take 500`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open runtime events', url: '/d/agentops-runtime-events?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameLink('OperationId', 'Open Azure Log Analytics', portalLogsUrl, true),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(20, 'Span count by operation', 0, 16, 12, 8, `${sessionBaseWhere()} ${conversationFilterPipe()} ${traceDimensionFilters()} | summarize Spans=count() by bin(TimeGenerated, $__interval), operation | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Latency percentiles', 12, 16, 12, 8, `${sessionBaseWhere()} ${conversationFilterPipe()} ${traceDimensionFilters()} | summarize P50=percentile(DurationMs, 50), P95=percentile(DurationMs, 95), P99=percentile(DurationMs, 99) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'ms'),
    tablePanel(30, 'Errors by operation', 0, 24, 24, 8, errorsByOperation, [byNameUnit('P95DurationMs', 'ms', 2)]),
  ];
  return baseDashboard('agentops-traces-spans', 'AgentOps Traces / Spans', panels, true, { variables: traceFilterVariables });
}

function attributionBaseWhere() {
  return `union isfuzzy=true (${sessionBaseWhere()} ${conversationFilterPipe()} | project TimeGenerated, conversation, operation, agentops_agent, model, tool, repo, skill, mcp_server, script, DurationMs, Success, error, Properties), (${runtimeBaseWhere()} ${conversationFilterPipe()} | project TimeGenerated, conversation, operation, agentops_agent, model, tool, repo, skill, mcp_server, script, DurationMs=real(null), Success=bool(null), error, Properties) | extend AttributionKind=case(isnotempty(skill), 'skill', isnotempty(mcp_server), 'mcp', isnotempty(script), 'script_or_hook', isnotempty(agentops_agent), 'agent', 'unattributed'), AttributionName=case(isnotempty(skill), skill, isnotempty(mcp_server), mcp_server, isnotempty(script), script, isnotempty(agentops_agent), agentops_agent, 'unattributed')`;
}

function attributionDashboard() {
  const base = attributionBaseWhere();
  const mcpUsage = healthyEmptyTable(
    `${base} | where isnotempty(mcp_server) or tool startswith 'mcp__' or tool contains '/' | summarize Calls=count(), Failures=countif(Success == false or isnotempty(error)), Sessions=dcount(conversation), P95DurationMs=percentile(DurationMs, 95), Errors=make_set_if(error, isnotempty(error), 10) by mcp_server, tool | extend FailurePct=iff(Calls > 0, round(100.0 * Failures / Calls, 1), 0.0) | order by Calls desc, Failures desc | take 100`,
    "print mcp_server='No MCP activity observed', tool='', Calls=0, Failures=0, Sessions=0, P95DurationMs=real(0), Errors=dynamic([]), FailurePct=real(0)"
  );
  const skillEvents = healthyEmptyTable(
    `${base} | where isnotempty(skill) or isnotempty(script) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), operation, tostring(Properties['type'])) | summarize Events=count(), Sessions=dcount(conversation), Failures=countif(Success == false or isnotempty(error)), LastSeen=max(TimeGenerated), EventNames=make_set_if(event, isnotempty(event), 10), Errors=make_set_if(error, isnotempty(error), 10) by skill, script | order by Events desc, Failures desc | take 100`,
    "print skill='No skill or script events observed', script='', Events=0, Sessions=0, Failures=0, LastSeen=now(), EventNames=dynamic([]), Errors=dynamic([])"
  );
  const mcpEvidence = healthyEmptyTable(
    `${sessionBaseWhere()} ${conversationFilterPipe()} | where operation == 'execute_tool' or isnotempty(tool) | where isnotempty(mcp_server) or tool startswith 'azure-mcp-' or tool startswith 'mcp__' or tool contains '/' | extend mcp_tool=coalesce(tostring(Properties['agentops.mcp.tool']), tostring(Properties['github.copilot.tool.parameters.mcp_tool_name']), tool) | summarize Calls=count(), Failures=countif(Success == false or isnotempty(error)), LastSeen=max(TimeGenerated), Sessions=dcount(conversation), Tools=make_set_if(mcp_tool, isnotempty(mcp_tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by mcp_server | extend FailurePct=iff(Calls > 0, round(100.0 * Failures / Calls, 1), 0.0) | order by Calls desc`,
    "print mcp_server='No MCP inference evidence observed', Calls=0, Failures=0, LastSeen=now(), Sessions=0, Tools=dynamic([]), Errors=dynamic([]), FailurePct=real(0)"
  );
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Attribution\nUsage, failures, cost, and tool activity grouped by custom agents, skills, MCP servers/tools, and scripts/hooks. Filters apply across the dashboard.'),
    statPanel(2, 'Attributed Sessions', 0, 2, `${base} | where AttributionKind != 'unattributed' | summarize Sessions=dcount(conversation) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Attributed Failures', 6, 2, `${base} | where AttributionKind != 'unattributed' | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'MCP Tool Calls', 12, 2, `${base} | summarize Calls=countif((operation == 'execute_tool' or isnotempty(tool)) and (isnotempty(mcp_server) or tool startswith 'mcp__' or tool contains '/')) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    statPanel(5, 'Skills / Hooks', 18, 2, `${base} | summarize Events=countif(isnotempty(skill) or isnotempty(script)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue'),
    tablePanel(10, 'Attribution Explorer', 0, 6, 24, 12, `${base} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), AICredits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu']) | summarize Started=min(TimeGenerated), LastSeen=max(TimeGenerated), Sessions=dcount(conversation), Spans=count(), Failures=countif(Success == false or isnotempty(error)), ToolCalls=countif(operation == 'execute_tool' or isnotempty(tool)), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), AICredits=sum(AICredits), AIU=sum(AIU), Models=make_set_if(model, isnotempty(model), 5), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by AttributionKind, AttributionName | extend EstUsd=round(AICredits * 0.01, 4), FailurePct=iff(Spans > 0, round(100.0 * Failures / Spans, 1), 0.0) | where AttributionKind != 'unattributed' | order by Sessions desc, Failures desc, AICredits desc`, [
      byNameUnit('FailurePct', 'percent', 1),
      byNameUnit('EstUsd', 'currencyUSD', 4),
      byNameUnit('AICredits', 'short', 2),
    ]),
    timeseriesPanel(20, 'Sessions by attribution kind', 0, 18, 12, 8, `${base} | where AttributionKind != 'unattributed' | summarize Sessions=dcount(conversation) by TimeGenerated=bin(TimeGenerated, $__interval), AttributionKind | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Failures by attribution kind', 12, 18, 12, 8, `${base} | where AttributionKind != 'unattributed' | summarize Failures=countif(Success == false or isnotempty(error)) by TimeGenerated=bin(TimeGenerated, $__interval), AttributionKind | order by TimeGenerated asc`),
    tablePanel(30, 'MCP server and tool usage', 0, 26, 12, 9, mcpUsage, [
      byNameUnit('FailurePct', 'percent', 1),
      byNameUnit('P95DurationMs', 'ms', 2),
    ]),
    tablePanel(31, 'Skill and script events', 12, 26, 12, 9, skillEvents),
    tablePanel(32, 'Loaded skill context', 0, 35, 12, 9, `${sessionBaseWhere()} ${conversationFilterPipe()} | where operation == 'invoke_agent' and isnotempty(tostring(Properties['github.copilot.context.skills'])) | mv-expand LoadedSkill=parse_json(tostring(Properties['github.copilot.context.skills'])) to typeof(string) | where isnotempty(LoadedSkill) | summarize Sessions=dcount(conversation), Runs=count(), LastSeen=max(TimeGenerated), Agents=make_set_if(agentops_agent, isnotempty(agentops_agent), 10), Models=make_set_if(model, isnotempty(model), 5) by LoadedSkill | order by Sessions desc, LastSeen desc | take 100`),
    tablePanel(33, 'MCP inference evidence', 12, 35, 12, 9, mcpEvidence, [
      byNameUnit('FailurePct', 'percent', 1),
    ]),
    tablePanel(34, 'Custom lifecycle rollup', 0, 44, 24, 9, `${customLifecycleBaseWhere()} ${conversationFilterPipe()} | summarize Events=count(), Sessions=dcount(conversation), LastSeen=max(TimeGenerated), Outcomes=make_set_if(outcome, isnotempty(outcome), 10), Risks=make_set_if(risk, isnotempty(risk), 10), AvgScore=avg(score), Sources=make_set_if(custom_source, isnotempty(custom_source), 10) by agentops_agent, workflow, event | order by LastSeen desc, Events desc | take 100`, [
      byNameUnit('AvgScore', 'short', 3),
    ]),
  ];
  return baseDashboard('agentops-attribution', 'AgentOps Attribution', panels, true, { variables: attributionFilterVariables });
}

function toolsMcpDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Tools & MCP\nTool calls, failure rates, and likely MCP or extension-provided tools.'),
    statPanel(2, 'Tool Calls', 0, 2, `${toolMcpRowsWhere()} | summarize Calls=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Tool Failures', 6, 2, `${toolMcpRowsWhere()} | summarize Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Likely MCP Tools', 12, 2, `${toolMcpRowsWhere()} | where tool_family != 'builtin' and isnotempty(tool) | summarize Tools=dcount(tool) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
    tablePanel(10, 'Tool and MCP usage', 0, 6, 24, 16, toolMcpUsageQuery(), [
      byNameUnit('failure_pct', 'percent', 1),
      byNameUnit('p50_duration_ms', 'ms', 2),
      byNameUnit('p95_duration_ms', 'ms', 2),
    ]),
    tablePanel(20, 'Recent tool waterfall', 0, 22, 24, 9, `${toolMcpRowsWhere()} | project TimeGenerated, Session=conversation, tool_family, mcp_server, mcp_tool, tool, model, repo, DurationMs, Success, ResultCode, error | order by TimeGenerated desc | take 300`, [
      byNameLink('Session', 'Open session detail', '/d/agentops-session-detail?var-conversation=${__data.fields.Session}'),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
  ];
  return baseDashboard('agentops-tools-mcp', 'AgentOps Tools & MCP', panels, false, { variables: toolMcpFilterVariables });
}

function runtimeEventsDashboard() {
  const customBase = customLifecycleBaseWhere();
  const contentSignalExpr = "tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has 'gen_ai.prompt' or tostring(Properties) has 'gen_ai.completion' or tostring(Properties) has 'gen_ai.input.messages' or tostring(Properties) has 'gen_ai.output.messages'";
  const compactionSignalExpr = "tostring(Properties) has 'github.copilot.session.truncation' or tostring(Properties) has 'github.copilot.session.compaction' or tostring(Properties) has 'github.copilot.tokens_removed'";
  const policyBlockExpr = "tostring(Properties) has 'preToolUse' or tostring(Properties) has 'AgentOps preToolUse policy' or Message has 'AgentOps preToolUse policy'";
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Runtime Events\nHooks, skills, compaction/truncation, shutdown, exceptions, and policy decisions.'),
    statPanel(2, 'Content Capture Signals', 0, 2, `${runtimeBaseWhere()} ${conversationFilterPipe()} | summarize Signals=countif(${contentSignalExpr}) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(3, 'Compactions / Truncations', 6, 2, `${runtimeBaseWhere()} ${conversationFilterPipe()} | summarize Events=countif(${compactionSignalExpr}) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow', 'sum'),
    statPanel(4, 'Policy Blocks', 12, 2, `${runtimeBaseWhere()} ${conversationFilterPipe()} | summarize Blocks=countif(${policyBlockExpr}) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(5, 'Hook / Skill Context', 18, 2, `${runtimeBaseWhere()} ${conversationFilterPipe()} | where tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.context.skills' | summarize Events=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue', 'sum'),
    statPanel(6, 'Custom Lifecycle Events', 0, 6, `${customBase} ${conversationFilterPipe()} | summarize Events=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'green', 'sum'),
    timeseriesPanel(7, 'Custom events by type', 6, 6, 18, 4, `${customBase} ${conversationFilterPipe()} | summarize Events=count() by TimeGenerated=bin(TimeGenerated, $__interval), event | order by TimeGenerated asc`),
    tablePanel(11, 'Custom lifecycle events', 0, 10, 24, 10, `${customBase} ${conversationFilterPipe()} | project TimeGenerated, Session=conversation, custom_event_id, event, agentops_agent, workflow, step, outcome, risk, score, entity_type, entity_id_hash, tags, custom_source | order by TimeGenerated desc | take 500`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameUnit('score', 'short', 3),
    ]),
    tablePanel(10, 'Runtime event stream', 0, 20, 24, 14, `${runtimeBaseWhere()} ${conversationFilterPipe()} | where tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.context.skills' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.tokens_removed' or tostring(Properties) has 'preToolUse' or isnotempty(error) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), skill=tostring(Properties['github.copilot.skill.name']), context_skills=tostring(Properties['github.copilot.context.skills']), hook=tostring(Properties['github.copilot.hook.name']), tokens_removed=toint(Properties['github.copilot.tokens_removed']), policy=iff(tostring(Properties) has 'preToolUse' or Message has 'AgentOps preToolUse policy', 'policy', '') | project TimeGenerated, Session=conversation, event, policy, operation, agent, model, tool, skill, context_skills, hook, tokens_removed, error, Message | order by TimeGenerated desc | take 500`, [
      byNameLinks('Session', [
        { title: 'Open session detail', url: '/d/agentops-session-detail?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open traces / spans', url: '/d/agentops-traces-spans?var-conversation=${__data.fields.Session}&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
      ]),
      byNameUnit('tokens_removed', 'short'),
    ]),
  ];
  return baseDashboard('agentops-runtime-events', 'AgentOps Runtime Events', panels, true, { variables: runtimeFilterVariables });
}

function safetyPolicyDashboard() {
  const contentSignalExpr = "tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has 'gen_ai.input.messages' or tostring(Properties) has 'gen_ai.output.messages' or tostring(Properties) has 'gen_ai.tool.call.arguments' or tostring(Properties) has 'gen_ai.tool.call.result'";
  const policyBlockExpr = "tostring(Properties) has 'preToolUse' or Message has 'AgentOps preToolUse policy'";
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Safety & Policy\nPrivacy posture, permission mode, content capture signals, and policy friction.'),
    statPanel(2, 'Content Capture Signals', 0, 2, `${runtimeBaseWhere()} | summarize Signals=countif(${contentSignalExpr}) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(3, 'Allow All Sessions', 6, 2, `${sessionBaseWhere()} | summarize AllowAll=max(toint(tostring(Properties['agentops.cli.allow_all']) == 'true')) by conversation, bin(TimeGenerated, $__interval) | summarize Sessions=sum(AllowAll) by TimeGenerated | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(4, 'Policy Blocks', 12, 2, `${runtimeBaseWhere()} | summarize Blocks=countif(${policyBlockExpr}) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow', 'sum'),
    statPanel(5, 'Remote Enabled', 18, 2, `${sessionBaseWhere()} | summarize Sessions=dcountif(conversation, tostring(Properties['agentops.cli.remote']) == 'enabled') by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'blue', 'sum'),
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
  return baseDashboard('agentops-safety-policy', 'AgentOps Safety & Policy', panels, false, { variables: coreFilterVariables });
}

function permissionFrictionBaseWhere() {
  return `union isfuzzy=true AppDependencies, AppTraces | where $__timeFilter(TimeGenerated) | where tostring(Properties) has_any ('github.copilot', 'agentops.', 'gen_ai.operation.name', 'codex') or Message has_any ('github.copilot', 'AgentOps', 'codex') or AppRoleName in ${agentServiceNames} or tostring(Properties['service.name']) in ${agentServiceNames} | extend conversation=${sessionKey}, operation=tostring(Properties['gen_ai.operation.name']), tool=tostring(Properties['gen_ai.tool.name']), agent=tostring(Properties['gen_ai.agent.name']), agentops_agent=coalesce(tostring(Properties['agentops.agent.name']), tostring(Properties['agentops.cli.agent']), tostring(Properties['gen_ai.agent.name'])), model=tostring(Properties['gen_ai.request.model']), repo=tostring(Properties['agentops.repo.hash']), error=tostring(Properties['error.type']), allow_all=tostring(Properties['agentops.cli.allow_all']) == 'true', allow_all_tools=tostring(Properties['agentops.cli.allow_all_tools']) == 'true', allow_all_paths=tostring(Properties['agentops.cli.allow_all_paths']) == 'true', allow_all_urls=tostring(Properties['agentops.cli.allow_all_urls']) == 'true', allow_tool_count=toint(Properties['agentops.cli.allow_tool.count']), allow_url_count=toint(Properties['agentops.cli.allow_url.count']), deny_tool_count=toint(Properties['agentops.cli.deny_tool.count']), deny_url_count=toint(Properties['agentops.cli.deny_url.count']), available_tool_count=toint(Properties['agentops.cli.available_tools.count']), excluded_tool_count=toint(Properties['agentops.cli.excluded_tools.count']), disabled_mcp_server_count=toint(Properties['agentops.cli.disabled_mcp_server.count']), extra_mcp_config_count=toint(Properties['agentops.cli.additional_mcp_config.count']), configured_mcp_servers=tostring(Properties['agentops.mcp.config.servers']), disabled_mcp_servers=tostring(Properties['agentops.mcp.disabled.servers']) ${commonVariableFilters()} | extend is_tool=operation == 'execute_tool' or isnotempty(tool), is_policy_block=tostring(Properties) has 'preToolUse' or tostring(Properties) has 'permissionDecision' or tostring(Properties) has 'AgentOps preToolUse policy' or Message has 'AgentOps preToolUse policy' or Message has 'permission', is_retry_hint=Message has 'Recovery hint' or tostring(Properties) has 'Recovery hint'`;
}

function permissionFrictionSessionsQuery(limit = 100) {
  return `${permissionFrictionBaseWhere()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), ToolCalls=countif(is_tool), ToolFailures=countif(is_tool and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), PolicyBlocks=countif(is_policy_block), RetryHints=countif(is_retry_hint), AllowAll=max(toint(allow_all)), AllowAllTools=max(toint(allow_all_tools)), AllowAllPaths=max(toint(allow_all_paths)), AllowAllUrls=max(toint(allow_all_urls)), MaxAllowTools=max(allow_tool_count), MaxAllowUrls=max(allow_url_count), MaxDenyTools=max(deny_tool_count), MaxDenyUrls=max(deny_url_count), MaxAvailableTools=max(available_tool_count), MaxExcludedTools=max(excluded_tool_count), MaxDisabledMcp=max(disabled_mcp_server_count), MaxExtraMcpConfigs=max(extra_mcp_config_count), P95DurationMs=percentile(DurationMs, 95), Tools=make_set_if(tool, isnotempty(tool), 10), Agents=make_set_if(agent, isnotempty(agent), 5), Models=make_set_if(model, isnotempty(model), 5), Repos=make_set_if(repo, isnotempty(repo), 3), ConfiguredMcpServers=make_set_if(configured_mcp_servers, isnotempty(configured_mcp_servers), 10), DisabledMcpServerNames=make_set_if(disabled_mcp_servers, isnotempty(disabled_mcp_servers), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session=conversation | extend AllowAll=coalesce(AllowAll, 0), AllowAllTools=coalesce(AllowAllTools, 0), AllowAllPaths=coalesce(AllowAllPaths, 0), AllowAllUrls=coalesce(AllowAllUrls, 0), MaxAllowTools=coalesce(MaxAllowTools, 0), MaxAllowUrls=coalesce(MaxAllowUrls, 0), MaxDenyTools=coalesce(MaxDenyTools, 0), MaxDenyUrls=coalesce(MaxDenyUrls, 0), MaxAvailableTools=coalesce(MaxAvailableTools, 0), MaxExcludedTools=coalesce(MaxExcludedTools, 0), MaxDisabledMcp=coalesce(MaxDisabledMcp, 0), MaxExtraMcpConfigs=coalesce(MaxExtraMcpConfigs, 0) | extend DurationSec=round(datetime_diff('millisecond', Ended, Started) / 1000.0, 2), FrictionScore=PolicyBlocks * 5 + ToolFailures * 3 + RetryHints * 2 + AllowAll * 2 + MaxDenyTools + MaxDenyUrls + MaxExcludedTools + MaxDisabledMcp, Posture=case(PolicyBlocks > 0, 'blocked', ToolFailures > 0, 'tool_failed', RetryHints > 0, 'retry_hint', AllowAll > 0, 'allow_all', AllowAllTools > 0 or AllowAllPaths > 0 or AllowAllUrls > 0, 'permissive_scope', MaxDenyTools > 0 or MaxDenyUrls > 0 or MaxExcludedTools > 0 or MaxDisabledMcp > 0, 'restricted', 'ok') | where Posture != 'ok' | project Started, Session, Posture, FrictionScore, DurationSec, Spans, ToolCalls, ToolFailures, PolicyBlocks, RetryHints, AllowAll, AllowAllTools, AllowAllPaths, AllowAllUrls, MaxAllowTools, MaxAllowUrls, MaxDenyTools, MaxDenyUrls, MaxAvailableTools, MaxExcludedTools, MaxDisabledMcp, MaxExtraMcpConfigs, P95DurationMs, Tools, Agents, Models, Repos, ConfiguredMcpServers, DisabledMcpServerNames, Errors | order by FrictionScore desc, Started desc | take ${limit}`;
}

function permissionFrictionDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Permission Friction\nPermission posture, policy blocks, retry hints, broad allow modes, and tool failures that slow or risk Copilot CLI sessions.'),
    statPanel(2, 'Policy Blocks', 0, 2, `${permissionFrictionBaseWhere()} | summarize Blocks=countif(is_policy_block) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(3, 'Tool Failures', 6, 2, `${permissionFrictionBaseWhere()} | where is_tool | summarize Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red', 'sum'),
    statPanel(4, 'Retry Hints', 12, 2, `${permissionFrictionBaseWhere()} | summarize Hints=countif(is_retry_hint) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow', 'sum'),
    statPanel(5, 'Allow All Sessions', 18, 2, `${permissionFrictionBaseWhere()} | summarize AllowAll=max(toint(allow_all)) by conversation, TimeGenerated=bin(TimeGenerated, $__interval) | summarize Sessions=sum(AllowAll) by TimeGenerated | order by TimeGenerated asc`, 'short', 'red', 'sum'),
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
  return baseDashboard('agentops-permission-friction', 'AgentOps Permission Friction', panels, false, { variables: coreFilterVariables });
}

function alertRecommendationDashboardQuery() {
  return `let hourly = ${sessionBaseWhere()} | extend AIU=todouble(Properties['github.copilot.aiu']), Credits=todouble(Properties['github.copilot.cost']) | summarize Spans=count(), Failures=countif(Success == false or tostring(Success) =~ 'false' or isnotempty(error)), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or tostring(Success) =~ 'false' or isnotempty(error))), AIU=sum(AIU), Credits=sum(Credits) by conversation, TimeGenerated=bin(TimeGenerated, 1h); let content = union isfuzzy=true AppDependencies, AppTraces | where $__timeFilter(TimeGenerated) | summarize ContentCaptureSignals=countif(tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has_any ('gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.prompt', 'gen_ai.completion', 'github.copilot.message')) by bin(TimeGenerated, 1h); let session_rollup = hourly | summarize Hours=count(), P50Aiu=percentile(AIU, 50), P95Aiu=percentile(AIU, 95), P99Aiu=percentile(AIU, 99), MaxAiu=max(AIU), P95Failures=percentile(Failures, 95), MaxFailures=max(Failures), P95ToolFailures=percentile(ToolFailures, 95), MaxToolFailures=max(ToolFailures), P95Credits=percentile(Credits, 95), MaxCredits=max(Credits); let content_rollup = content | summarize ContentCaptureHours=countif(ContentCaptureSignals > 0), MaxContentCaptureSignals=max(ContentCaptureSignals); union (session_rollup | extend SuggestedThreshold=case(P99Aiu * 1.25 > P95Aiu * 2.0, todouble(P99Aiu * 1.25), todouble(P95Aiu * 2.0)) | project Rule='high-aiu', CurrentThreshold=50000000000.0, SuggestedThreshold, P50=P50Aiu, P95=P95Aiu, P99=P99Aiu, MaxObserved=MaxAiu, SupportingHours=Hours, Rollout='Keep disabled until clean history exists.'), (session_rollup | extend SuggestedThreshold=case(P95Failures > 1.0, todouble(P95Failures), 1.0) | project Rule='failed-spans', CurrentThreshold=0.0, SuggestedThreshold, P50=real(null), P95=P95Failures, P99=real(null), MaxObserved=todouble(MaxFailures), SupportingHours=Hours, Rollout='Review false positives before action groups.'), (content_rollup | project Rule='content-capture', CurrentThreshold=0.0, SuggestedThreshold=0.0, P50=real(null), P95=real(null), P99=real(null), MaxObserved=todouble(coalesce(MaxContentCaptureSignals, 0)), SupportingHours=ContentCaptureHours, Rollout='Keep strict; investigate immediately if nonzero.')`;
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
  return baseDashboard('agentops-alert-tuning', 'AgentOps Alert Tuning', panels, false, { variables: coreFilterVariables });
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
  return baseDashboard('agentops-quality', 'AgentOps Quality', panels, false, { variables: sessionFilterVariables });
}

function dataQualityDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Data Quality\nField discovery, token rollup, collector health, and real-ingestion checks for validating dashboard assumptions against real Copilot CLI telemetry.'),
    tablePanel(10, 'Token rollup audit', 0, 2, 24, 13, fs.readFileSync(path.join(repoRoot, 'kql', '13-token-rollup-audit.kql'), 'utf8'), [
      byNameUnit('TokenOvercountRatio', 'short', 2),
    ]),
    tablePanel(20, 'Collector health and real ingestion', 0, 15, 24, 8, fs.readFileSync(path.join(repoRoot, 'kql', '21-collector-health.kql'), 'utf8')),
    tablePanel(30, 'Observed property fields', 0, 23, 24, 14, `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend fields = bag_keys(Properties) | mv-expand field = fields to typeof(string) | extend value = tostring(Properties[field]) | summarize observed=count(), example_values=make_set_if(value, isnotempty(value), 5) by field | order by observed desc, field asc`),
  ];
  return baseDashboard('agentops-data-quality', 'AgentOps Data Quality', panels, false, { variables: [] });
}

function benchmarkVariables() {
  const benchmarkFilter = `Properties has 'agentops.benchmark' or Properties has 'agentops.hypothesis.id'`;
  return {
    list: [
      constantVariable('workspaceResource', workspaceResource),
      queryVariable('benchmark_suite', 'Suite', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend suite=tostring(Properties['agentops.benchmark.suite']) | where isnotempty(suite) | distinct suite | order by suite asc`, false, { includeAll: false, current: false }),
      queryVariable('benchmark_task', 'Task', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend task_id=tostring(Properties['agentops.benchmark.task_id']) | where isnotempty(task_id) | distinct task_id | order by task_id asc`, false, { includeAll: false, current: false }),
      queryVariable('benchmark_variant', 'Variant', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend variant=tostring(Properties['agentops.benchmark.variant']) | where isnotempty(variant) | distinct variant | order by variant asc`, false, { includeAll: false, current: false }),
      queryVariable('benchmark_run', 'Run', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend run_id=tostring(Properties['agentops.benchmark.run_id']) | where isnotempty(run_id) | distinct run_id | order by run_id desc`, false, { includeAll: false, current: false }),
      queryVariable('hypothesis', 'Hypothesis', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | where ${benchmarkFilter} | extend hypothesis_id=tostring(Properties['agentops.hypothesis.id']) | where isnotempty(hypothesis_id) | distinct hypothesis_id | order by hypothesis_id asc`, false, { includeAll: false, current: false }),
    ],
  };
}

function benchmarkBaseWhere() {
  return [
    `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend suite=tostring(Properties['agentops.benchmark.suite']), task_id=tostring(Properties['agentops.benchmark.task_id']), variant=tostring(Properties['agentops.benchmark.variant']), run_id=tostring(Properties['agentops.benchmark.run_id']), hypothesis_id=tostring(Properties['agentops.hypothesis.id']), operation=tostring(Properties['gen_ai.operation.name']), conversation=${sessionKey}, tool=tostring(Properties['gen_ai.tool.name']), error=tostring(Properties['error.type']) | where isnotempty(suite) or isnotempty(task_id) or isnotempty(variant) or isnotempty(run_id) or isnotempty(hypothesis_id)`,
    variableFilter('suite', 'benchmark_suite'),
    variableFilter('task_id', 'benchmark_task'),
    variableFilter('variant', 'benchmark_variant'),
    variableFilter('run_id', 'benchmark_run'),
    variableFilter('hypothesis_id', 'hypothesis'),
    "| extend Passed=coalesce(tobool(Properties['agentops.benchmark.passed']), tobool(Properties['agentops.eval.passed']), Success), InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), AICredits=todouble(Properties['github.copilot.cost']), EstUsd=todouble(Properties['github.copilot.cost']) * 0.01, Regression=coalesce(tobool(Properties['agentops.benchmark.regression']), tobool(Properties['agentops.regression'])), SafetyIssue=iff(tostring(Properties['agentops.safety.issue']) != '' or tostring(Properties['agentops.policy.blocked']) == 'true' or tostring(Properties) has 'content_filter' or tostring(Properties) has 'safety', true, false), FailureReason=coalesce(error, tostring(Properties['agentops.benchmark.failure_reason']), tostring(Properties['agentops.eval.failure_reason']), ResultCode)",
    "| extend Score=coalesce(todouble(Properties['agentops.benchmark.score']), todouble(Properties['agentops.eval.score']), todouble(Properties['agentops.score']), todouble(Properties['score']), iff(Passed == true, 100.0, iff(Passed == false, 0.0, real(null))))",
  ].join(' ');
}

function benchmarkRollupQuery() {
  return `${benchmarkBaseWhere()} | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), Sessions=dcount(conversation), Runs=dcount(run_id), ToolCalls=countif(operation == 'execute_tool' or isnotempty(tool)), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), Failures=countif(Success == false or isnotempty(error)), PassSamples=countif(isnotnull(Passed)), Passes=countif(Passed == true), ScoreSamples=countif(isnotnull(Score)), AverageScore=avg(Score), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), EstUsd=sum(EstUsd), SafetyIssues=countif(SafetyIssue), ExplicitRegressions=countif(Regression == true), FailureReasons=make_set_if(FailureReason, isnotempty(FailureReason), 10) by suite, task_id, hypothesis_id, variant, run_id | extend TokenUse=coalesce(InputTokens, 0.0) + coalesce(OutputTokens, 0.0), PassRate=iff(PassSamples > 0, round(100.0 * Passes / PassSamples, 1), real(null))`;
}

function benchmarkHelpQuery() {
  return `let variants = ${benchmarkRollupQuery()}; let baseline = variants | where tolower(variant) in ('baseline', 'control', 'main', 'default') | summarize BaselineScore=avg(AverageScore), BaselinePassRate=avg(PassRate), BaselineToolFailures=sum(ToolFailures), BaselineCost=avg(EstUsd), BaselineTokenUse=avg(TokenUse) by suite, task_id, hypothesis_id; variants | join kind=leftouter baseline on suite, task_id, hypothesis_id | extend IsBaseline=tolower(variant) in ('baseline', 'control', 'main', 'default') | extend ScoreDelta=iff(IsBaseline, 0.0, round(AverageScore - BaselineScore, 3)), PassRateDelta=iff(IsBaseline, 0.0, round(PassRate - BaselinePassRate, 1)), CostDelta=iff(IsBaseline, 0.0, round(EstUsd - BaselineCost, 4)), TokenDelta=iff(IsBaseline, 0.0, round(TokenUse - BaselineTokenUse, 0)) | extend Verdict=case(IsBaseline, 'baseline', isnotnull(ScoreDelta) and ScoreDelta > 0, 'helped', isnotnull(ScoreDelta) and ScoreDelta < 0, 'regressed', isnotnull(PassRateDelta) and PassRateDelta > 0, 'helped', isnotnull(PassRateDelta) and PassRateDelta < 0, 'regressed', ToolFailures < BaselineToolFailures, 'helped', ToolFailures > BaselineToolFailures, 'regressed', isnotnull(BaselineScore) or isnotnull(BaselinePassRate), 'flat', 'needs_score') | project suite, task_id, hypothesis_id, variant, run_id, Verdict, PassRate, PassRateDelta, AverageScore, ScoreDelta, ToolFailures, SafetyIssues, ExplicitRegressions, TokenUse, TokenDelta, EstUsd, CostDelta, Spans, Sessions, Runs, Started, Ended | order by suite asc, task_id asc, hypothesis_id asc, Verdict asc, ScoreDelta desc, PassRateDelta desc`;
}

function benchmarkRegressionsQuery() {
  return `let variants = ${benchmarkRollupQuery()}; let baseline = variants | where tolower(variant) in ('baseline', 'control', 'main', 'default') | summarize BaselineScore=avg(AverageScore), BaselinePassRate=avg(PassRate), BaselineToolFailures=sum(ToolFailures), BaselineCost=avg(EstUsd), BaselineTokenUse=avg(TokenUse) by suite, task_id, hypothesis_id; let rows = variants | join kind=leftouter baseline on suite, task_id, hypothesis_id | extend ScoreDelta=round(AverageScore - BaselineScore, 3), PassRateDelta=round(PassRate - BaselinePassRate, 1), CostDelta=round(EstUsd - BaselineCost, 4), TokenDelta=round(TokenUse - BaselineTokenUse, 0) | where ExplicitRegressions > 0 or ScoreDelta < 0 or PassRateDelta < 0 or ToolFailures > BaselineToolFailures | project suite, task_id, hypothesis_id, variant, run_id, ExplicitRegressions, PassRate, PassRateDelta, AverageScore, ScoreDelta, ToolFailures, BaselineToolFailures, TokenUse, TokenDelta, EstUsd, CostDelta, FailureReasons; union (rows | order by ExplicitRegressions desc, ScoreDelta asc, PassRateDelta asc, ToolFailures desc), (print suite='All clear', task_id='', hypothesis_id='', variant='', run_id='', ExplicitRegressions=0, PassRate=real(null), PassRateDelta=real(0), AverageScore=real(null), ScoreDelta=real(0), ToolFailures=0, BaselineToolFailures=0, TokenUse=real(0), TokenDelta=real(0), EstUsd=real(0), CostDelta=real(0), FailureReasons=dynamic(['No regressions observed']) | where toscalar(rows | count) == 0)`;
}

function benchmarkAntiCheatQuery() {
  return `let rows = ${benchmarkBaseWhere()} | summarize Spans=count(), Runs=dcount(run_id), ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), SafetyIssues=countif(SafetyIssue), PolicyBlocks=countif(tostring(Properties['agentops.policy.blocked']) == 'true' or tostring(Properties) has 'policy'), ContentSignals=countif(tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has_any ('content.capture.enabled', 'gen_ai.prompt', 'gen_ai.completion')), MissingRunLabels=countif(isempty(run_id)), FailureReasons=make_set_if(FailureReason, isnotempty(FailureReason), 10), LastSeen=max(TimeGenerated) by suite, task_id, hypothesis_id, variant | extend AntiCheatStatus=case(SafetyIssues > 0 or ContentSignals > 0, 'blocked', PolicyBlocks > 0 or MissingRunLabels > 0, 'review', 'clean') | where AntiCheatStatus != 'clean'; union (rows | order by AntiCheatStatus asc, SafetyIssues desc, ContentSignals desc, PolicyBlocks desc, MissingRunLabels desc), (print suite='All clear', task_id='', hypothesis_id='', variant='', Spans=0, Runs=0, ToolFailures=0, SafetyIssues=0, PolicyBlocks=0, ContentSignals=0, MissingRunLabels=0, FailureReasons=dynamic(['No blockers observed']), LastSeen=now(), AntiCheatStatus='clean' | where toscalar(rows | count) == 0)`;
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
    tablePanel(11, 'Custom eval scores', 0, 42, 24, 9, `${customLifecycleBaseWhere({ filters: false })} | where event == 'agent.eval.scored' or isnotnull(score) | summarize Samples=count(), Sessions=dcount(conversation), AverageScore=avg(score), MinScore=min(score), MaxScore=max(score), LastSeen=max(TimeGenerated), Outcomes=make_set_if(outcome, isnotempty(outcome), 10), Sources=make_set_if(custom_source, isnotempty(custom_source), 10) by agentops_agent, workflow, step | order by LastSeen desc, AverageScore desc`, [
      byNameUnit('AverageScore', 'short', 3),
      byNameUnit('MinScore', 'short', 3),
      byNameUnit('MaxScore', 'short', 3),
    ]),
  ];
  const dashboard = baseDashboard('agentops-experiments', 'AgentOps Experiments', panels, false);
  dashboard.templating = benchmarkVariables();
  return dashboard;
}

const dashboards = {
  'agentops-sessions.json': sessionsDashboard(),
  'agentops-session-detail.json': sessionDetailDashboard(),
  'agentops-live-replay.json': liveReplayDashboard(),
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
