#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const grafanaDir = path.join(repoRoot, 'grafana');

const datasource = {
  type: 'grafana-azure-monitor-datasource',
  uid: 'azure-monitor-oob',
};

const workspaceResource = '/subscriptions/0222a208-955a-45fd-b6d8-ca4704421bf0/resourceGroups/rg-copilot-agentops-dev/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-dev';
const portalLogsUrl = 'https://portal.azure.com/#@/resource/subscriptions/0222a208-955a-45fd-b6d8-ca4704421bf0/resourceGroups/rg-copilot-agentops-dev/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-dev/logs';
const baseFilter = "Properties has 'github.copilot' and Properties has 'github-copilot-cli'";
const sessionKey = "coalesce(tostring(Properties['gen_ai.conversation.id']), strcat(tostring(Properties['gen_ai.agent.id']), '_', tostring(Properties['github.copilot.turn_count']), '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMdd_HHmm')))";

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
    queryVariable('repo', 'Repo', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend repo=tostring(Properties['agentops.repo.hash']) | where isnotempty(repo) | distinct repo | order by repo asc`),
    queryVariable('tool', 'Tool', `AppDependencies | where TimeGenerated > ago(14d) | where ${baseFilter} | extend tool=tostring(Properties['gen_ai.tool.name']) | where isnotempty(tool) | distinct tool | order by tool asc`),
    customVariable('risk', 'Risk', ['all', 'failed', 'expensive', 'slow', 'policy', 'content'], 'all'),
  ];

  if (includeConversation) {
    variables.splice(1, 0, queryVariable('conversation', 'Session', `AppDependencies | where TimeGenerated > ago(7d) | where ${baseFilter} | extend conversation=${sessionKey} | where isnotempty(conversation) | distinct conversation | order by conversation desc`, false));
  }

  return { list: variables };
}

function dashboardLinks() {
  return [
    { title: 'Overview', url: '/d/copilot-agentops', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Sessions', url: '/d/agentops-sessions', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Traces / Spans', url: '/d/agentops-traces-spans', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Runtime Events', url: '/d/agentops-runtime-events', type: 'link', icon: 'dashboard', targetBlank: false },
    { title: 'Quality', url: '/d/agentops-quality', type: 'link', icon: 'dashboard', targetBlank: false },
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
  return `AppDependencies | where $__timeFilter(TimeGenerated) | where ${baseFilter} | extend operation=tostring(Properties['gen_ai.operation.name']), conversation=${sessionKey}, agent=tostring(Properties['gen_ai.agent.name']), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), error=tostring(Properties['error.type']) | where ('$model' == '$__all' or model in (${'${model:singlequote}'})) | where ('$operation' == '$__all' or operation in (${'${operation:singlequote}'})) | where ('$agent' == '$__all' or agent in (${'${agent:singlequote}'})) | where ('$repo' == '$__all' or repo in (${'${repo:singlequote}'})) | where ('$tool' == '$__all' or tool in (${'${tool:singlequote}'}))`;
}

function sessionsQuery(limit = 100) {
  return `${sessionBaseWhere()} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), CacheRead=todouble(Properties['gen_ai.usage.cache_read.input_tokens']), CacheWrite=todouble(Properties['gen_ai.usage.cache_creation.input_tokens']), Credits=todouble(Properties['github.copilot.cost']), AIU=todouble(Properties['github.copilot.aiu']) | summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), DurationMs=max(DurationMs), Spans=count(), Runs=countif(operation == 'invoke_agent'), ToolCalls=countif(operation == 'execute_tool'), Failures=countif(Success == false or isnotempty(error)), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), CacheRead=sum(CacheRead), CacheWrite=sum(CacheWrite), AICredits=sum(Credits), AIU=sum(AIU), Models=make_set(model, 5), Agents=make_set(agent, 5), Repos=make_set(repo, 3), Operations=make_set(operation, 8) by Session=conversation | extend EstUsd=round(AICredits * 0.01, 4), DurationSec=round(DurationMs / 1000.0, 2), SuccessPct=round(100.0 * (Spans - Failures) / Spans, 1) | extend Risk=case(Failures > 0, 'failed', EstUsd >= 1.0, 'expensive', DurationMs >= 30000, 'slow', 'ok') | where '$risk' == 'all' or Risk == '$risk' | project Started, Ended, Session, Risk, DurationSec, SuccessPct, Spans, Runs, ToolCalls, Failures, Models, Agents, Repos, InputTokens, OutputTokens, CacheRead, CacheWrite, AICredits, EstUsd, AIU, Operations | order by Started desc | take ${limit}`;
}

function workflowRiskQuery() {
  return `${sessionBaseWhere()} | extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), Credits=todouble(Properties['github.copilot.cost']) | summarize HasInvoke=countif(operation == 'invoke_agent') > 0, HasTool=countif(operation == 'execute_tool' or isnotempty(tool)) > 0, ToolFailures=countif((operation == 'execute_tool' or isnotempty(tool)) and (Success == false or isnotempty(error))), Failures=countif(Success == false or isnotempty(error)), InputTokens=sum(InputTokens), Credits=sum(Credits), P95DurationMs=percentile(DurationMs, 95) by Session=conversation | extend Risk=case(Failures > 0, 'failed', ToolFailures > 0, 'tool_failed', Credits * 0.01 >= 1.0, 'expensive', P95DurationMs >= 30000, 'slow', InputTokens >= 30000, 'high_context', HasTool, 'used_tools', HasInvoke, 'invoked', 'other') | summarize Sessions=count() by Risk | order by Sessions desc`;
}

function sessionFilterPipe() {
  return `| where ('$conversation' == '$__all' or conversation == '$conversation')`;
}

function runtimeBaseWhere() {
  return `union isfuzzy=true AppTraces, AppDependencies | where $__timeFilter(TimeGenerated) | where tostring(Properties) has 'github.copilot' or Message has 'github.copilot' | extend conversation=${sessionKey}, operation=tostring(Properties['gen_ai.operation.name']), agent=tostring(Properties['gen_ai.agent.name']), model=tostring(Properties['gen_ai.request.model']), tool=tostring(Properties['gen_ai.tool.name']), repo=tostring(Properties['agentops.repo.hash']), error=tostring(Properties['error.type'])`;
}

function sessionsDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 3, '## AgentOps Sessions\nSession-first LLM observability for Copilot CLI. Sort by risk, cost, failures, or duration; drill into a single session for spans, events, tools, and safety signals.'),
    statPanel(2, 'Sessions', 0, 3, `${sessionBaseWhere()} | summarize Sessions=dcount(conversation) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Failures', 6, 3, `${sessionBaseWhere()} | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'AI Credits', 12, 3, `${sessionBaseWhere()} | extend Credits=todouble(Properties['github.copilot.cost']) | summarize Credits=sum(Credits) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'yellow'),
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
    timeseriesPanel(20, 'Sessions by risk', 0, 21, 12, 8, `${sessionBaseWhere()} | summarize Failures=countif(Success == false or isnotempty(error)), DurationMs=max(DurationMs), Credits=sum(todouble(Properties['github.copilot.cost'])) by bin(TimeGenerated, $__interval), conversation | extend Risk=case(Failures > 0, 'failed', Credits * 0.01 >= 1.0, 'expensive', DurationMs >= 30000, 'slow', 'ok') | summarize Sessions=dcount(conversation) by TimeGenerated, Risk | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Cost and tokens', 12, 21, 12, 8, `${sessionBaseWhere()} | extend Tokens=coalesce(todouble(Properties['gen_ai.usage.input_tokens']), 0.0) + coalesce(todouble(Properties['gen_ai.usage.output_tokens']), 0.0), Credits=todouble(Properties['github.copilot.cost']) | summarize Tokens=sum(Tokens), EstUsd=sum(Credits) * 0.01 by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
  ];
  return baseDashboard('agentops-sessions', 'AgentOps Sessions', panels, false);
}

function sessionDetailDashboard() {
  const panels = [
    textPanel(1, 0, 0, 24, 2, '## Session Detail\nSingle-session investigation: spans, tool waterfall, runtime events, token/cost breakdown, and safety signals.'),
    statPanel(2, 'Spans', 0, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize Spans=count() by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    statPanel(3, 'Failures', 6, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize Failures=countif(Success == false or isnotempty(error)) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'red'),
    statPanel(4, 'Tokens', 12, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | extend Tokens=coalesce(todouble(Properties['gen_ai.usage.input_tokens']), 0.0) + coalesce(todouble(Properties['gen_ai.usage.output_tokens']), 0.0) | summarize Tokens=sum(Tokens) by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'short', 'green'),
    statPanel(5, 'Est. USD', 18, 2, `${sessionBaseWhere()} ${sessionFilterPipe()} | extend Credits=todouble(Properties['github.copilot.cost']) | summarize EstUsd=sum(Credits) * 0.01 by bin(TimeGenerated, $__interval) | order by TimeGenerated asc`, 'currencyUSD', 'yellow'),
    tablePanel(10, 'Trace / span timeline', 0, 6, 24, 11, `${sessionBaseWhere()} ${sessionFilterPipe()} | project TimeGenerated, OperationId, ParentId, Id, operation, Name, agent, model, tool, repo, DurationMs, Success, ResultCode, error, Properties | order by TimeGenerated asc`, [
      byNameLinks('OperationId', [
        { title: 'Open traces dashboard', url: '/d/agentops-traces-spans?var-conversation=$conversation&var-model=${model}&var-agent=${agent}&var-repo=${repo}&var-tool=${tool}', targetBlank: false },
        { title: 'Open Azure Log Analytics', url: portalLogsUrl, targetBlank: true },
      ]),
      byNameUnit('DurationMs', 'ms', 2),
    ]),
    timeseriesPanel(20, 'Span duration by operation', 0, 17, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | summarize DurationMs=avg(DurationMs) by bin(TimeGenerated, $__interval), operation | order by TimeGenerated asc`, 'ms'),
    tablePanel(21, 'Tool waterfall', 12, 17, 12, 8, `${sessionBaseWhere()} ${sessionFilterPipe()} | where operation == 'execute_tool' or isnotempty(tool) | project TimeGenerated, tool, Name, DurationMs, Success, ResultCode, error | order by TimeGenerated asc`, [byNameUnit('DurationMs', 'ms', 2)]),
    tablePanel(30, 'Runtime events', 0, 25, 24, 9, `${runtimeBaseWhere()} ${sessionFilterPipe()} | where tostring(Properties) has 'github.copilot.session' or tostring(Properties) has 'github.copilot.skill' or tostring(Properties) has 'github.copilot.hook' or tostring(Properties) has 'github.copilot.tokens_removed' or isnotempty(error) | extend event=coalesce(tostring(Properties['event.name']), tostring(Properties['github.copilot.event.name']), Name), skill=tostring(Properties['github.copilot.skill.name']), hook=tostring(Properties['github.copilot.hook.name']), tokens_removed=toint(Properties['github.copilot.tokens_removed']) | project TimeGenerated, event, operation, agent, model, tool, skill, hook, tokens_removed, error, Message | order by TimeGenerated asc`, [byNameUnit('tokens_removed', 'short')]),
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
    tablePanel(30, 'Repo repeated-failure candidates', 0, 22, 24, 9, `${sessionBaseWhere()} | summarize Sessions=dcount(conversation), Spans=count(), Failures=countif(Success == false or isnotempty(error)), EstUsd=sum(todouble(Properties['github.copilot.cost'])) * 0.01, P95DurationMs=percentile(DurationMs, 95), TopErrors=make_set(error, 5) by repo | where isnotempty(repo) | extend FailurePct=round(100.0 * Failures / Spans, 1) | order by Failures desc, EstUsd desc | take 50`, [byNameUnit('EstUsd', 'currencyUSD', 4), byNameUnit('P95DurationMs', 'ms', 2), byNameUnit('FailurePct', 'percent', 1)]),
    tablePanel(40, 'Workflow funnel risks', 0, 31, 24, 8, workflowRiskQuery()),
  ];
  return baseDashboard('agentops-quality', 'AgentOps Quality', panels, false);
}

const dashboards = {
  'agentops-sessions.json': sessionsDashboard(),
  'agentops-session-detail.json': sessionDetailDashboard(),
  'agentops-traces-spans.json': tracesDashboard(),
  'agentops-runtime-events.json': runtimeEventsDashboard(),
  'agentops-quality.json': qualityDashboard(),
};

for (const [fileName, dashboard] of Object.entries(dashboards)) {
  fs.writeFileSync(path.join(grafanaDir, fileName), JSON.stringify(dashboard, null, 2) + '\n');
  console.log(`wrote grafana/${fileName}`);
}
