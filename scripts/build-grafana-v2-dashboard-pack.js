#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'grafana', 'dashboards', 'v2');
const provisioningDashboardsDir = path.join(repoRoot, 'grafana', 'provisioning', 'dashboards');
const provisioningDatasourcesDir = path.join(repoRoot, 'grafana', 'provisioning', 'datasources');

const datasource = {
  type: 'grafana-azure-monitor-datasource',
  uid: process.env.AGENTOPS_GRAFANA_DATASOURCE_UID || 'azure-monitor-oob'
};

const subscriptionId = process.env.AGENTOPS_AZURE_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID || '00000000-0000-0000-0000-000000000000';
const resourceGroup = process.env.AGENTOPS_AZURE_RESOURCE_GROUP || process.env.AZURE_RESOURCE_GROUP || 'rg-agentops-dev';
const workspaceName = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || 'law-agentops-dev';
const workspaceResource = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID || `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}`;

const globalVariables = [
  ['datasource', datasource.uid],
  ['workspace', workspaceResource],
  ['timeRange', '24h'],
  ['run_id', '__all'],
  ['session_id', '__all'],
  ['trace_id', '__all'],
  ['surface', '__all,cli,sdk,vscode_mcp,github_action,cloud_agent,custom'],
  ['repo_hash', '__all'],
  ['branch_hash', '__all'],
  ['model', '__all'],
  ['agent_name', '__all'],
  ['skill_name', '__all'],
  ['mcp_server', '__all'],
  ['sub_agent', '__all'],
  ['task_type', '__all,explain,review,test,fix,refactor,docs,debug_ci,unknown'],
  ['tool_name', '__all'],
  ['tool_risk', '__all,read-only,write-file,shell,network,secret-access,browser-control,destructive,privileged'],
  ['pattern_key', '__all'],
  ['privacy_mode', '__all,strict,compat,unsafe'],
  ['outcome_status', '__all,success,failed,cancelled,blocked,unknown'],
  ['eval_bucket', '__all,ok,review,poor']
];

const nav = [
  ['Home', 'agentops-v2-home'],
  ['Runs', 'agentops-v2-runs-explorer'],
  ['Replay', 'agentops-v2-run-replay'],
  ['Models', 'agentops-v2-models-cost-tokens'],
  ['Tools', 'agentops-v2-tools-mcp-risk'],
  ['Privacy', 'agentops-v2-safety-privacy-policy'],
  ['Outcomes', 'agentops-v2-code-outcomes'],
  ['Evals', 'agentops-v2-evals-quality'],
  ['Insights', 'agentops-v2-insights-regressions'],
  ['Collector', 'agentops-v2-collector-health']
].map(([title, uid]) => ({ title, uid, type: 'link', icon: 'dashboard', url: `/d/${uid}`, targetBlank: false, keepTime: true, includeVars: true }));

function variable(name, value) {
  return {
    name,
    type: 'custom',
    label: name.replace(/_/g, ' '),
    query: value,
    current: { selected: true, text: value === '__all' ? 'All' : value, value }
  };
}

function target(query, resultFormat = 'table') {
  return [{
    refId: 'A',
    datasource,
    queryType: 'Azure Log Analytics',
    azureLogAnalytics: {
      resources: [workspaceResource],
      resultFormat,
      query
    }
  }];
}

function textPanel(id, title, x, y, w, h, content) {
  return {
    id,
    title,
    type: 'text',
    gridPos: { h, w, x, y },
    options: { mode: 'markdown', content }
  };
}

function statPanel(id, title, x, y, query, unit = 'short', color = 'blue') {
  return {
    id,
    title,
    type: 'stat',
    datasource,
    gridPos: { h: 4, w: 4, x, y },
    fieldConfig: {
      defaults: {
        unit,
        color: { mode: 'thresholds' },
        thresholds: { mode: 'absolute', steps: [{ color, value: null }] }
      },
      overrides: []
    },
    options: {
      colorMode: 'value',
      graphMode: 'none',
      justifyMode: 'auto',
      reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      textMode: 'auto'
    },
    targets: target(query, 'time_series')
  };
}

function tablePanel(id, title, x, y, w, h, query, links = []) {
  return {
    id,
    title,
    type: 'table',
    datasource,
    gridPos: { h, w, x, y },
    fieldConfig: {
      defaults: {
        custom: { align: 'auto', cellOptions: { type: 'auto' }, inspect: false },
        links
      },
      overrides: [
        {
          matcher: { id: 'byName', options: 'RunId' },
          properties: [{ id: 'links', value: [{ title: 'Open Run Replay', url: '/d/agentops-v2-run-replay?var-run_id=${__data.fields.RunId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'SessionId' },
          properties: [{ id: 'links', value: [{ title: 'Open Session Replay', url: '/d/agentops-v2-run-replay?var-session_id=${__data.fields.SessionId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'TraceId' },
          properties: [{ id: 'links', value: [{ title: 'Open Trace Replay', url: '/d/agentops-v2-run-replay?var-trace_id=${__data.fields.TraceId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'ToolName' },
          properties: [{ id: 'links', value: [{ title: 'Open Tools Risk', url: '/d/agentops-v2-tools-mcp-risk?var-tool_name=${__data.fields.ToolName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'McpServerName' },
          properties: [{ id: 'links', value: [{ title: 'Open MCP Server', url: '/d/agentops-v2-tools-mcp-risk?var-mcp_server=${__data.fields.McpServerName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'McpServer' },
          properties: [{ id: 'links', value: [{ title: 'Open MCP Server', url: '/d/agentops-v2-tools-mcp-risk?var-mcp_server=${__data.fields.McpServer}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'ModelActual' },
          properties: [{ id: 'links', value: [{ title: 'Open Models', url: '/d/agentops-v2-models-cost-tokens?var-model=${__data.fields.ModelActual}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'AgentName' },
          properties: [{ id: 'links', value: [{ title: 'Open Agent Runs', url: '/d/agentops-v2-runs-explorer?var-agent_name=${__data.fields.AgentName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'SkillName' },
          properties: [{ id: 'links', value: [{ title: 'Open Skill Runs', url: '/d/agentops-v2-runs-explorer?var-skill_name=${__data.fields.SkillName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'SubAgentName' },
          properties: [{ id: 'links', value: [{ title: 'Open Sub-agent Replay', url: '/d/agentops-v2-run-replay?var-sub_agent=${__data.fields.SubAgentName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'ParentAgentName' },
          properties: [{ id: 'links', value: [{ title: 'Open Parent Agent Runs', url: '/d/agentops-v2-runs-explorer?var-agent_name=${__data.fields.ParentAgentName}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'RepoHash' },
          properties: [{ id: 'links', value: [{ title: 'Open Runs for Repo', url: '/d/agentops-v2-runs-explorer?var-repo_hash=${__data.fields.RepoHash}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'PrNumberHash' },
          properties: [{ id: 'links', value: [{ title: 'Open Code Outcomes', url: '/d/agentops-v2-code-outcomes?var-repo_hash=${__data.fields.RepoHash}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'CiStatus' },
          properties: [{ id: 'links', value: [{ title: 'Open Code Outcomes', url: '/d/agentops-v2-code-outcomes?var-outcome_status=${__data.fields.CiStatus}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'EvalOverall' },
          properties: [{ id: 'links', value: [{ title: 'Open Evals', url: '/d/agentops-v2-evals-quality?var-run_id=${__data.fields.RunId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'PatternKey' },
          properties: [{ id: 'links', value: [{ title: 'Open Pattern', url: '/d/agentops-v2-insights-regressions?var-pattern_key=${__data.fields.PatternKey}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenTranscript' },
          properties: [{ id: 'links', value: [{ title: 'Open prompt/response viewer', url: '/d/agentops-v2-run-replay?viewPanel=26&var-run_id=${__data.fields.RunId}&var-session_id=${__data.fields.SessionId}&var-trace_id=${__data.fields.TraceId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenReplay' },
          properties: [{ id: 'links', value: [{ title: 'Open Run Replay', url: '/d/agentops-v2-run-replay?var-run_id=${__data.fields.RunId}&var-session_id=${__data.fields.SessionId}&var-trace_id=${__data.fields.TraceId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenTrace' },
          properties: [{ id: 'links', value: [{ title: 'Open Trace Replay', url: '/d/agentops-v2-run-replay?var-trace_id=${__data.fields.TraceId}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenGithub' },
          properties: [{ id: 'links', value: [{ title: 'Open GitHub Outcome', url: '/d/agentops-v2-code-outcomes?var-run_id=${__data.fields.RunId}&var-repo_hash=${__data.fields.RepoHash}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenPattern' },
          properties: [{ id: 'links', value: [{ title: 'Open Pattern', url: '/d/agentops-v2-insights-regressions?var-pattern_key=${__data.fields.PatternKey}&${__url_time_range}', targetBlank: false }] }]
        },
        {
          matcher: { id: 'byName', options: 'OpenSavedView' },
          properties: [{ id: 'links', value: [{ title: 'Open saved view', url: '${__data.fields.Url}', targetBlank: true }] }]
        }
      ]
    },
    options: { cellHeight: 'sm', showHeader: true, footer: { show: false } },
    targets: target(query, 'table')
  };
}

function timeseriesPanel(id, title, x, y, w, h, query, unit = 'short') {
  return {
    id,
    title,
    type: 'timeseries',
    datasource,
    gridPos: { h, w, x, y },
    fieldConfig: { defaults: { unit, color: { mode: 'palette-classic' } }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'none' } },
    targets: target(query, 'time_series')
  };
}

function dashboard(uid, title, panels) {
  return {
    annotations: { list: [] },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: nav,
    panels,
    refresh: '1m',
    schemaVersion: 39,
    tags: ['agentops', 'agentops-v2', 'copilot', 'azure'],
    templating: { list: globalVariables.map(([name, value]) => variable(name, value)) },
    time: { from: 'now-24h', to: 'now' },
    timepicker: {},
    timezone: 'browser',
    title,
    uid,
    version: 1,
    weekStart: ''
  };
}

const emptyState = 'Uses AgentOps V2 custom tables when present and falls back to existing Copilot OpenTelemetry in Application Insights. If every panel is empty, run `agentops collector smoke --privacy strict --poison --json`; for local demos run `agentops demo generate --runs 50 --with-failures --with-privacy-drops --json`.';

function filter(field, variable) {
  return `| where ('$${variable}' == '__all' or tostring(column_ifexists('${field}', '')) == '$${variable}')`;
}

function evalBucketFilter() {
  return "| where ('$eval_bucket' == '__all' or tostring(column_ifexists('EvalBucket', '')) == iff('$eval_bucket' == 'ok', 'good', '$eval_bucket'))";
}

function runNormalize() {
  return [
    "| extend SkillName=tostring(column_ifexists('SkillName', ''))",
    "| extend ParentAgentName=tostring(column_ifexists('ParentAgentName', ''))",
    "| extend SubAgentName=case(isnotempty(tostring(column_ifexists('SubAgentName', ''))), tostring(column_ifexists('SubAgentName', '')), isnotempty(ParentAgentName) and isnotempty(tostring(column_ifexists('AgentName', ''))) and tostring(column_ifexists('AgentName', '')) != ParentAgentName, tostring(column_ifexists('AgentName', '')), '')",
    "| extend DelegationId=tostring(column_ifexists('DelegationId', ''))",
    "| extend CacheReadTokens=todouble(column_ifexists('CacheReadTokens', 0.0))",
    "| extend CacheCreationTokens=todouble(column_ifexists('CacheCreationTokens', 0.0))",
    "| extend ContextWindowPct=todouble(column_ifexists('ContextWindowPct', 0.0))",
    "| extend TokensRemoved=todouble(column_ifexists('TokensRemoved', 0.0))",
    "| extend PermissionWaitMs=todouble(column_ifexists('PermissionWaitMs', 0.0))"
  ].join(' ');
}

function eventNormalize() {
  return [
    "| extend SkillName=tostring(column_ifexists('SkillName', ''))",
    "| extend ParentAgentName=tostring(column_ifexists('ParentAgentName', ''))",
    "| extend SubAgentName=case(isnotempty(tostring(column_ifexists('SubAgentName', ''))), tostring(column_ifexists('SubAgentName', '')), isnotempty(ParentAgentName) and isnotempty(tostring(column_ifexists('AgentName', ''))) and tostring(column_ifexists('AgentName', '')) != ParentAgentName, tostring(column_ifexists('AgentName', '')), '')",
    "| extend DelegationId=tostring(column_ifexists('DelegationId', ''))",
    "| extend McpServer=case(isnotempty(tostring(column_ifexists('McpServer', ''))), tostring(column_ifexists('McpServer', '')), isnotempty(tostring(column_ifexists('McpServerName', ''))), tostring(column_ifexists('McpServerName', '')), tostring(column_ifexists('ServerName', '')))"
  ].join(' ');
}

function toolNormalize() {
  return [
    "| extend Surface=tostring(column_ifexists('Surface', ''))",
    "| extend AgentName=tostring(column_ifexists('AgentName', ''))",
    "| extend SkillName=tostring(column_ifexists('SkillName', ''))",
    "| extend ParentAgentName=tostring(column_ifexists('ParentAgentName', ''))",
    "| extend SubAgentName=case(isnotempty(tostring(column_ifexists('SubAgentName', ''))), tostring(column_ifexists('SubAgentName', '')), isnotempty(ParentAgentName) and isnotempty(AgentName) and AgentName != ParentAgentName, AgentName, '')",
    "| extend DelegationId=tostring(column_ifexists('DelegationId', ''))",
    "| extend McpServer=case(isnotempty(tostring(column_ifexists('McpServer', ''))), tostring(column_ifexists('McpServer', '')), isnotempty(tostring(column_ifexists('McpServerName', ''))), tostring(column_ifexists('McpServerName', '')), tostring(column_ifexists('ServerName', '')))"
  ].join(' ');
}

function runFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('SessionId', 'session_id'),
    filter('TraceId', 'trace_id'),
    filter('Surface', 'surface'),
    filter('RepoHash', 'repo_hash'),
    filter('BranchHash', 'branch_hash'),
    filter('ModelActual', 'model'),
    filter('AgentName', 'agent_name'),
    filter('SkillName', 'skill_name'),
    filter('SubAgentName', 'sub_agent'),
    filter('TaskType', 'task_type'),
    filter('PrivacyMode', 'privacy_mode'),
    filter('OutcomeStatus', 'outcome_status'),
    "| extend EvalBucket=case(EvalOverall >= 80, 'good', EvalOverall >= 60, 'review', 'poor')",
    evalBucketFilter()
  ].join(' ');
}

function eventFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('SessionId', 'session_id'),
    filter('TraceId', 'trace_id'),
    filter('Surface', 'surface'),
    filter('AgentName', 'agent_name'),
    filter('SkillName', 'skill_name'),
    filter('SubAgentName', 'sub_agent'),
    filter('ToolName', 'tool_name')
  ].join(' ');
}

function toolFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('TraceId', 'trace_id'),
    filter('Surface', 'surface'),
    filter('AgentName', 'agent_name'),
    filter('SkillName', 'skill_name'),
    filter('SubAgentName', 'sub_agent'),
    filter('ModelActual', 'model'),
    filter('ToolName', 'tool_name'),
    filter('ToolRisk', 'tool_risk'),
    filter('McpServer', 'mcp_server')
  ].join(' ');
}

function privacyFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('TraceId', 'trace_id'),
    filter('PrivacyMode', 'privacy_mode')
  ].join(' ');
}

function evalFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('TraceId', 'trace_id'),
    filter('RepoHash', 'repo_hash'),
    filter('ModelActual', 'model'),
    filter('TaskType', 'task_type'),
    evalBucketFilter()
  ].join(' ');
}

function evalNormalize() {
  return [
    "| extend RepoHash=tostring(column_ifexists('RepoHash', ''))",
    "| extend ModelActual=tostring(column_ifexists('ModelActual', ''))",
    "| extend TaskType=tostring(column_ifexists('TaskType', ''))",
    "| extend EvalBucket=tostring(column_ifexists('EvalBucket', ''))",
    "| extend EvalBucket=iff(isempty(EvalBucket), case(todouble(column_ifexists('EvalOverall', 0.0)) >= 80, 'good', todouble(column_ifexists('EvalOverall', 0.0)) >= 60, 'review', 'poor'), EvalBucket)"
  ].join(' ');
}

function githubFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('RepoHash', 'repo_hash'),
    filter('BranchHash', 'branch_hash'),
    filter('CiStatus', 'outcome_status')
  ].join(' ');
}

function githubNormalize() {
  return [
    "| extend RunStartedAt=todatetime(column_ifexists('RunStartedAt', datetime(null)))",
    "| extend PrCreatedAt=todatetime(column_ifexists('PrCreatedAt', datetime(null)))",
    "| extend PrMergedAt=todatetime(column_ifexists('PrMergedAt', datetime(null)))",
    "| extend TimeToPrMinutes=coalesce(todouble(column_ifexists('TimeToPrMinutes', real(null))), todouble(datetime_diff('minute', PrCreatedAt, RunStartedAt)))",
    "| extend TimeToMergeMinutes=coalesce(todouble(column_ifexists('TimeToMergeMinutes', real(null))), todouble(datetime_diff('minute', PrMergedAt, RunStartedAt)))"
  ].join(' ');
}

function insightsNormalize() {
  return [
    "| extend RepoHash=tostring(column_ifexists('RepoHash', ''))",
    "| extend ModelActual=tostring(column_ifexists('ModelActual', ''))",
    "| extend TaskType=tostring(column_ifexists('TaskType', ''))",
    "| extend ToolName=tostring(column_ifexists('ToolName', ''))",
    "| extend PatternId=tostring(column_ifexists('PatternId', ''))",
    "| extend PatternKey=tostring(column_ifexists('PatternKey', ''))",
    "| extend PatternRuns=tolong(column_ifexists('PatternRuns', long(null)))",
    "| extend PatternDimension=tostring(column_ifexists('PatternDimension', ''))",
    "| extend BaselineValue=todouble(column_ifexists('BaselineValue', real(null)))",
    "| extend CurrentValue=todouble(column_ifexists('CurrentValue', real(null)))"
  ].join(' ');
}

function insightsFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('TraceId', 'trace_id'),
    filter('RepoHash', 'repo_hash'),
    filter('ModelActual', 'model'),
    filter('TaskType', 'task_type'),
    filter('ToolName', 'tool_name'),
    filter('PatternKey', 'pattern_key')
  ].join(' ');
}

function recommendationsNormalize() {
  return [
    "| extend PatternId=tostring(column_ifexists('PatternId', ''))",
    "| extend PatternKey=tostring(column_ifexists('PatternKey', ''))",
    "| extend PatternRuns=tolong(column_ifexists('PatternRuns', long(null)))",
    "| extend PatternDimension=tostring(column_ifexists('PatternDimension', ''))",
    "| extend EvalBucket=tostring(column_ifexists('EvalBucket', ''))",
    "| extend BenchmarkRunId=tostring(column_ifexists('BenchmarkRunId', ''))",
    "| extend BenchmarkDecision=tostring(column_ifexists('BenchmarkDecision', ''))",
    "| extend BenchmarkPassRatePct=todouble(column_ifexists('BenchmarkPassRatePct', real(null)))",
    "| extend BenchmarkAverageScore=todouble(column_ifexists('BenchmarkAverageScore', real(null)))",
    "| extend BenchmarkSafetyViolationCount=tolong(column_ifexists('BenchmarkSafetyViolationCount', long(null)))",
    "| extend BenchmarkArtifactAdded=tolong(column_ifexists('BenchmarkArtifactAdded', long(null)))",
    "| extend BenchmarkArtifactModified=tolong(column_ifexists('BenchmarkArtifactModified', long(null)))",
    "| extend BenchmarkArtifactDeleted=tolong(column_ifexists('BenchmarkArtifactDeleted', long(null)))",
    "| extend BenchmarkArtifactTotalChanged=tolong(column_ifexists('BenchmarkArtifactTotalChanged', long(null)))",
    "| extend BenchmarkArtifactFiles=column_ifexists('BenchmarkArtifactFiles', dynamic([]))",
    "| extend BenchmarkArtifactContentDiffs=column_ifexists('BenchmarkArtifactContentDiffs', dynamic([]))",
    "| extend BenchmarkHiddenChecksPassed=tolong(column_ifexists('BenchmarkHiddenChecksPassed', long(null)))",
    "| extend BenchmarkHiddenChecksFailed=tolong(column_ifexists('BenchmarkHiddenChecksFailed', long(null)))",
    "| extend BenchmarkHiddenCheckPacks=column_ifexists('BenchmarkHiddenCheckPacks', dynamic([]))",
    "| extend BenchmarkPolicyBlocks=tolong(column_ifexists('BenchmarkPolicyBlocks', long(null)))",
    "| extend BenchmarkPermissionProfiles=column_ifexists('BenchmarkPermissionProfiles', dynamic({}))",
    "| extend BenchmarkPolicyTasks=column_ifexists('BenchmarkPolicyTasks', dynamic([]))",
    "| extend BenchmarkSemanticCheckCount=tolong(column_ifexists('BenchmarkSemanticCheckCount', long(null)))",
    "| extend BenchmarkSemanticAverageScore=todouble(column_ifexists('BenchmarkSemanticAverageScore', real(null)))",
    "| extend BenchmarkSemanticChecks=column_ifexists('BenchmarkSemanticChecks', dynamic([]))",
    "| extend BenchmarkApprovalStatus=tostring(column_ifexists('BenchmarkApprovalStatus', ''))",
    "| extend BenchmarkApprovalCount=tolong(column_ifexists('BenchmarkApprovalCount', long(null)))",
    "| extend BenchmarkRequiredApprovals=tolong(column_ifexists('BenchmarkRequiredApprovals', long(null)))",
    "| extend BenchmarkApprovalApprovedAt=tostring(column_ifexists('BenchmarkApprovalApprovedAt', ''))",
    "| extend BenchmarkApprovalTicket=tostring(column_ifexists('BenchmarkApprovalTicket', ''))",
    "| extend BenchmarkApprovalSource=tostring(column_ifexists('BenchmarkApprovalSource', ''))",
    "| extend ChangeTargetRefs=column_ifexists('ChangeTargetRefs', dynamic([]))"
  ].join(' ');
}

function recommendationsFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('TraceId', 'trace_id'),
    filter('PatternKey', 'pattern_key'),
    evalBucketFilter()
  ].join(' ');
}

function contentFilters() {
  return [
    filter('RunId', 'run_id'),
    filter('SessionId', 'session_id'),
    filter('TraceId', 'trace_id'),
    filter('ModelActual', 'model'),
    filter('ToolName', 'tool_name')
  ].join(' ');
}

const compatWhere = [
  'AppDependencies',
  '| where TimeGenerated between ($__timeFrom() .. $__timeTo())',
  "| where tostring(Properties) has_any ('github.copilot', 'gen_ai.operation.name', 'agentops.', 'codex') or AppRoleName in ('github-copilot', 'copilot-chat', 'github-copilot-cli', 'codex', 'openai-codex', 'openai-codex-cli') or tostring(Properties['service.name']) in ('github-copilot', 'copilot-chat', 'github-copilot-cli', 'codex', 'openai-codex', 'openai-codex-cli')"
].join(' ');

const compatNormalize = [
  "| extend SessionId=case(isnotempty(tostring(Properties['agentops.session.id'])), tostring(Properties['agentops.session.id']), isnotempty(tostring(Properties['gen_ai.conversation.id'])), tostring(Properties['gen_ai.conversation.id']), isnotempty(tostring(Properties['github.copilot.interaction_id'])), tostring(Properties['github.copilot.interaction_id']), strcat(coalesce(AppRoleName, 'agent'), '_', coalesce(OperationId, 'session'), '_', format_datetime(bin(TimeGenerated, 1h), 'yyyyMMddHH')))",
  "| extend RunId=case(isnotempty(tostring(Properties['agentops.run.id'])), tostring(Properties['agentops.run.id']), strcat('compat_', SessionId))",
  "| extend TraceId=coalesce(OperationId, tostring(Properties['trace_id']), RunId)",
  "| extend Operation=tostring(Properties['gen_ai.operation.name'])",
  "| extend ToolName=tostring(Properties['gen_ai.tool.name'])",
  "| extend ModelActual=case(isnotempty(tostring(Properties['agentops.model.actual'])), tostring(Properties['agentops.model.actual']), isnotempty(tostring(Properties['gen_ai.response.model'])), tostring(Properties['gen_ai.response.model']), tostring(Properties['gen_ai.request.model']))",
  "| extend AgentName=case(isnotempty(tostring(Properties['agentops.agent.name'])), tostring(Properties['agentops.agent.name']), isnotempty(tostring(Properties['agentops.cli.agent'])), tostring(Properties['agentops.cli.agent']), isnotempty(tostring(Properties['gen_ai.agent.name'])), tostring(Properties['gen_ai.agent.name']), coalesce(AppRoleName, 'agent'))",
  "| extend SkillName=coalesce(tostring(Properties['agentops.skill.name']), tostring(Properties['github.copilot.skill.name']))",
  "| extend ParentAgentName=tostring(Properties['agentops.parent_agent.name'])",
  "| extend SubAgentName=case(isnotempty(tostring(Properties['agentops.sub_agent.name'])), tostring(Properties['agentops.sub_agent.name']), isnotempty(tostring(Properties['agentops.child_agent.name'])), tostring(Properties['agentops.child_agent.name']), isnotempty(ParentAgentName) and isnotempty(AgentName) and AgentName != ParentAgentName, AgentName, '')",
  "| extend DelegationId=tostring(Properties['agentops.delegation.id'])",
  "| extend Surface=case(isnotempty(tostring(Properties['agentops.surface'])), tostring(Properties['agentops.surface']), AppRoleName has 'codex', 'custom', AppRoleName has 'copilot', 'cli', 'cli')",
  "| extend RepoHash=tostring(Properties['agentops.repo.hash'])",
  "| extend BranchHash=tostring(Properties['agentops.branch.hash'])",
  "| extend TaskType=case(isnotempty(tostring(Properties['agentops.task.type'])), tostring(Properties['agentops.task.type']), 'unknown')",
  "| extend PrivacyMode=case(isnotempty(tostring(Properties['agentops.privacy.mode'])), tostring(Properties['agentops.privacy.mode']), 'strict')",
  "| extend ContentCaptureSignal=tostring(Properties['agentops.content_capture.signal']) =~ 'true' or tostring(Properties) has_any ('gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.prompt', 'gen_ai.completion')",
  "| extend InputTokens=todouble(Properties['gen_ai.usage.input_tokens']), OutputTokens=todouble(Properties['gen_ai.usage.output_tokens']), ReasoningTokens=todouble(Properties['gen_ai.usage.reasoning.output_tokens'])",
  "| extend CacheReadTokens=todouble(Properties['gen_ai.usage.cache_read.input_tokens']), CacheCreationTokens=todouble(Properties['gen_ai.usage.cache_creation.input_tokens']), ContextWindowPct=todouble(Properties['agentops.context.window_pct']), TokensRemoved=todouble(Properties['github.copilot.tokens_removed']), PermissionWaitMs=todouble(Properties['agentops.permission.wait_ms'])",
  "| extend EstimatedCostUsd=coalesce(todouble(Properties['agentops.cost.estimated_usd']), todouble(Properties['github.copilot.cost']) * 0.01, 0.0)",
  "| extend ErrorType=coalesce(tostring(Properties['error.type']), tostring(ResultCode))",
  "| extend Failed=Success == false or tostring(Success) =~ 'false' or isnotempty(tostring(Properties['error.type']))"
].join(' ');

function compatRunSummary() {
  return [
    compatWhere,
    compatNormalize,
    "| summarize TimeGenerated=max(TimeGenerated), Started=min(TimeGenerated), TraceId=take_any(TraceId), Surface=take_any(Surface), RepoHash=take_any(RepoHash), BranchHash=take_any(BranchHash), TaskType=take_any(TaskType), AgentName=take_any(AgentName), SkillName=take_any(SkillName), ParentAgentName=take_any(ParentAgentName), SubAgentName=take_any(SubAgentName), DelegationId=take_any(DelegationId), ModelActual=take_any(ModelActual), PrivacyMode=take_any(PrivacyMode), ContentCaptureSignal=max(toint(ContentCaptureSignal)), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), ReasoningTokens=sum(ReasoningTokens), CacheReadTokens=sum(CacheReadTokens), CacheCreationTokens=sum(CacheCreationTokens), ContextWindowPct=max(ContextWindowPct), TokensRemoved=sum(TokensRemoved), PermissionWaitMs=sum(PermissionWaitMs), EstimatedCostUsd=sum(EstimatedCostUsd), ToolCount=countif(Operation == 'execute_tool' or isnotempty(ToolName)), ToolFailureCount=countif((Operation == 'execute_tool' or isnotempty(ToolName)) and Failed), Failures=countif(Failed), ToolDeniedCount=countif(tostring(Properties['agentops.mcp.allowed']) =~ 'false'), FilesReadCount=countif(ToolName has 'read'), FilesEditedCount=countif(ToolName has_any ('edit', 'write', 'patch')), TestsRan=countif(ToolName has_any ('test', 'lint', 'typecheck')) > 0 by RunId, SessionId",
    "| extend DurationMs=datetime_diff('millisecond', TimeGenerated, Started)",
    "| extend ModelRequested=ModelActual, ContentCaptureMode=iff(ContentCaptureSignal > 0, 'signal_only', 'off'), OutcomeStatus=iff(Failures > 0, 'failed', 'success'), OutcomeReason=iff(Failures > 0, 'span_failure', 'completed'), TestsPassed=TestsRan and ToolFailureCount == 0, PrOpened=false, PrNumberHash='', CiStatus='not_run', EvalOverall=iff(Failures > 0, 50, 85), RiskScore=ToolFailureCount * 20 + ToolDeniedCount * 30 + ContentCaptureSignal * 15",
    "| project TimeGenerated, RunId, SessionId, TraceId, Surface, RepoHash, BranchHash, TaskType, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, ModelRequested, ModelActual, PrivacyMode, ContentCaptureMode, ContentCaptureSignal=ContentCaptureSignal > 0, OutcomeStatus, OutcomeReason, DurationMs, InputTokens, OutputTokens, ReasoningTokens, CacheReadTokens, CacheCreationTokens, ContextWindowPct, TokensRemoved, PermissionWaitMs, EstimatedCostUsd, ToolCount, ToolFailureCount, ToolDeniedCount, TestsRan, TestsPassed, FilesReadCount, FilesEditedCount, PrOpened, PrNumberHash, CiStatus, EvalOverall, RiskScore"
  ].join(' ');
}

function compatEvents() {
  return [
    compatWhere,
    compatNormalize,
    "| extend EventName=case(isnotempty(Operation), Operation, isnotempty(Name), Name, 'span')",
    "| extend EventType=case(Operation == 'chat', 'llm', Operation == 'execute_tool' or isnotempty(ToolName), 'tool', ContentCaptureSignal, 'content', Failed, 'error', 'span')",
    "| extend Status=iff(Failed, 'failed', 'success')",
    "| extend McpServer=case(ToolName startswith 'mcp__', extract('^mcp__([^_]+)__', 1, ToolName), ToolName contains '/', tostring(split(ToolName, '/')[0]), ToolName startswith 'azure-mcp-', 'azure-mcp', '')",
    "| project TimeGenerated, RunId, SessionId, TraceId, SpanId=Id, EventName, EventType, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, McpServer, ToolName, ModelActual, Status, DurationMs, ErrorType, OutcomeStatus=Status, Details=ResultCode, Surface, PrivacyMode, ContentCaptureSignal"
  ].join(' ');
}

function compatTools() {
  return [
    compatWhere,
    compatNormalize,
    "| where Operation == 'execute_tool' or isnotempty(ToolName)",
    "| extend ToolRisk=case(ToolName has_any ('secret', 'credential', 'token', 'ssh'), 'secret-access', ToolName has_any ('rm', 'delete', 'destroy'), 'destructive', ToolName has_any ('browser', 'playwright'), 'browser-control', ToolName has_any ('shell', 'bash', 'terminal'), 'shell', ToolName has_any ('edit', 'write', 'patch'), 'write-file', ToolName has_any ('http', 'fetch', 'curl'), 'network', 'read-only')",
    "| extend McpServer=case(ToolName startswith 'mcp__', extract('^mcp__([^_]+)__', 1, ToolName), ToolName contains '/', tostring(split(ToolName, '/')[0]), ToolName startswith 'azure-mcp-', 'azure-mcp', '')",
    "| project TimeGenerated, RunId, SessionId, TraceId, SpanId=Id, Surface, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, ModelActual, ToolName, ToolType=ToolRisk, ToolRisk, McpServer, Allowed=true, DeniedReason='', Status=iff(Failed, 'failed', 'success'), DurationMs, ErrorType, OutputSizeBytes=real(null), ArgsSchemaHash=''"
  ].join(' ');
}

function compatPrivacy() {
  return [
    compatWhere,
    compatNormalize,
    "| where ContentCaptureSignal",
    "| extend ContentKind=case(tostring(Properties) has_any ('secret', 'token', 'credential', 'api_key'), 'secret_like', tostring(Properties) has_any ('gen_ai.output.messages', 'gen_ai.completion'), 'output', tostring(Properties) has_any ('tool.call.arguments', 'tool_args'), 'tool_args', 'prompt')",
    "| project TimeGenerated, RunId, TraceId, PrivacyMode, ContentKind, Observed=true, Action='dropped', DroppedCount=1, RedactedCount=0, LeakDetected=false"
  ].join(' ');
}

function compatEvals() {
  return [
    compatRunSummary(),
    "| extend TestDiscipline=case(FilesEditedCount > 0 and TestsRan != true, 35, TestsRan == true and TestsPassed == true, 95, TestsRan == true and TestsPassed != true, 45, 70)",
    "| extend ToolEfficiency=case(ToolFailureCount > 0, 50, ToolCount > 12, 65, 85)",
    "| extend Security=case(ContentCaptureSignal == true or ToolDeniedCount > 0, 65, PrivacyMode == 'unsafe', 20, 90)",
    "| extend Reliability=case(OutcomeStatus != 'success', 45, 90)",
    "| extend CodeOutcome=case(PrOpened == true and CiStatus == 'passed', 85, PrOpened == true, 70, FilesEditedCount > 0 and TestsRan != true, 40, 60)",
    "| extend EvalOverall=toint((TestDiscipline + ToolEfficiency + Security + Reliability + CodeOutcome) / 5)",
    "| extend EvalBucket=case(EvalOverall >= 80, 'good', EvalOverall >= 60, 'review', 'poor')",
    "| extend EvalReason='compat score from existing Copilot OpenTelemetry metadata'",
    "| project TimeGenerated, RunId, TraceId, RepoHash, ModelActual, TaskType, EvalOverall, TestDiscipline, ToolEfficiency, Security, Reliability, CodeOutcome, EvalBucket, EvalReason"
  ].join(' ');
}

function compatGithubOutcomes() {
  return [
    compatRunSummary(),
    "| project TimeGenerated, RunId, RepoHash, BranchHash, PrOpened=false, PrNumberHash='', PrMerged=false, PrClosed=false, PrReverted=false, CiStatus='not_run', ReviewCommentCount=0, CommitCount=0, FilesChangedCount=FilesEditedCount"
  ].join(' ');
}

function compatInsights() {
  return [
    compatRunSummary(),
    "| where OutcomeStatus != 'success' or RiskScore > 0 or EstimatedCostUsd >= 1.0 or ToolFailureCount > 0 or ContentCaptureSignal == true",
    "| extend InsightType=case(OutcomeStatus != 'success', 'failure-anomaly', ContentCaptureSignal == true, 'privacy-signal', ToolFailureCount > 0, 'tool-failure-anomaly', EstimatedCostUsd >= 1.0, 'cost-anomaly', 'risk-signal')",
    "| extend Severity=case(OutcomeStatus != 'success' or RiskScore >= 60, 'high', RiskScore >= 20, 'medium', 'low')",
    "| extend Summary=case(OutcomeStatus != 'success', strcat('Run failed from existing Copilot OpenTelemetry: ', OutcomeReason), ContentCaptureSignal == true, 'Content-like fields were observed and represented as privacy signals.', ToolFailureCount > 0, strcat('Tool failures observed: ', tostring(ToolFailureCount)), EstimatedCostUsd >= 1.0, strcat('Estimated cost is elevated: $', tostring(round(EstimatedCostUsd, 2))), 'Risk score is elevated.')",
    "| extend SuggestedNextStep='Open Run Replay and inspect the linked metadata-only timeline.'",
    "| project TimeGenerated, InsightId=strcat('compat_', RunId, '_', InsightType), RunId, TraceId, InsightType, Severity, Title=InsightType, Summary, SuggestedNextStep, RepoHash, ModelActual, TaskType, ToolName='', BaselineValue=real(null), CurrentValue=RiskScore, ConfigHash=''"
  ].join(' ');
}

function compatRecommendations() {
  return [
    "union isfuzzy=true (AgentOpsInsights_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())),",
    `(${compatInsights()})`,
    insightsNormalize(),
    "| extend Action=case(InsightType startswith 'recurring-', 'triage_recurring_pattern', InsightType has 'test', 'run_validation', InsightType has 'tool', 'investigate_tool', InsightType has 'collector', 'check_collector', InsightType has_any ('policy', 'privacy'), 'review_policy', InsightType has_any ('cost', 'context'), 'reduce_context_or_cost', InsightType has 'ci', 'fix_ci', InsightType has_any ('eval', 'instruction', 'config'), 'compare_regression', 'investigate')",
    "| project TimeGenerated, RecommendationId=coalesce(tostring(column_ifexists('RecommendationId', '')), tostring(column_ifexists('InsightId', ''))), RunId, SessionId='', TraceId, Action, Severity, ObservedPattern=Summary, NextAction=SuggestedNextStep, PatternId, PatternKey, PatternRuns, PatternDimension, EvalOverall=real(null), EvalBucket='', BenchmarkRunId='', BenchmarkDecision='', BenchmarkPassRatePct=real(null), BenchmarkAverageScore=real(null), BenchmarkSafetyViolationCount=long(null), BenchmarkArtifactAdded=long(null), BenchmarkArtifactModified=long(null), BenchmarkArtifactDeleted=long(null), BenchmarkArtifactTotalChanged=long(null), BenchmarkArtifactFiles=dynamic([]), BenchmarkArtifactContentDiffs=dynamic([]), BenchmarkHiddenChecksPassed=long(null), BenchmarkHiddenChecksFailed=long(null), BenchmarkHiddenCheckPacks=dynamic([]), BenchmarkPolicyBlocks=long(null), BenchmarkPermissionProfiles=dynamic({}), BenchmarkPolicyTasks=dynamic([]), BenchmarkSemanticCheckCount=long(null), BenchmarkSemanticAverageScore=real(null), BenchmarkSemanticChecks=dynamic([]), BenchmarkApprovalStatus='', BenchmarkApprovalCount=long(null), BenchmarkRequiredApprovals=long(null), BenchmarkApprovalApprovedAt='', BenchmarkApprovalTicket='', BenchmarkApprovalSource='', ChangeTargetRefs=dynamic([]), DashboardTitles=dynamic(['Run Replay', 'Insights & Regressions']), DashboardCount=2, Validation=dynamic(['agentops dashboard kql-check --last 24h --json']), RollbackCondition='Rollback the agent, skill, MCP, model, instruction, or benchmark artifact change if eval score drops, failures rise, privacy drops appear unexpectedly, or CI worsens.'"
  ].join(' ');
}

function compatHealth() {
  return [
    compatWhere,
    "| summarize LastSpanReceived=max(TimeGenerated), SpanRows=count(), ExportErrors=countif(Success == false or tostring(Success) =~ 'false')",
    "| extend TimeGenerated=now(), Component='appinsights-compat', CheckName='live-ingestion', Status=iff(SpanRows > 0, 'healthy', 'empty'), Detail=strcat('Existing Application Insights telemetry rows: ', tostring(SpanRows)), PrivacyMode='strict', CollectorMode='compat', OtlpEndpoint='application-insights', AzureConfigured=true, GrafanaConfigured=true, DashboardVersion='v2', SchemaVersion='2', DroppedContentCount=0, LastExportSuccess=LastSpanReceived",
    "| project TimeGenerated, Component, CheckName, Status, Detail, PrivacyMode, CollectorMode, OtlpEndpoint, AzureConfigured, GrafanaConfigured, DashboardVersion, SchemaVersion, LastSpanReceived, LastExportSuccess, ExportErrors, DroppedContentCount"
  ].join(' ');
}

const q = {
  runSummary: `union isfuzzy=true (AgentOpsRunSummary_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatRunSummary()}) ${runNormalize()} ${runFilters()}`,
  events: `union isfuzzy=true (AgentOpsEvents_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatEvents()}) ${eventNormalize()} ${eventFilters()}`,
  tools: `union isfuzzy=true (AgentOpsToolCalls_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (AgentOpsMcpCalls_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatTools()}) ${toolNormalize()} ${toolFilters()}`,
  privacy: `union isfuzzy=true (AgentOpsPrivacy_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatPrivacy()}) ${privacyFilters()}`,
  evals: `union isfuzzy=true (AgentOpsEval_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatEvals()}) ${evalNormalize()} ${evalFilters()}`,
  github: `union isfuzzy=true (AgentOpsGithubOutcomes_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatGithubOutcomes()}) ${githubNormalize()} ${githubFilters()}`,
  insights: `union isfuzzy=true (AgentOpsInsights_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatInsights()}) ${insightsNormalize()} ${insightsFilters()}`,
  recommendations: `union isfuzzy=true (AgentOpsRecommendations_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatRecommendations()}) ${recommendationsNormalize()} ${recommendationsFilters()}`,
  savedViews: `union isfuzzy=true (AgentOpsSavedViews_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (print TimeGenerated=now(), SavedViewId='', Name='', Description='', Url='', QueryHash='', Tags=dynamic([]), SessionId='', CreatedAt='' | where false)`,
  health: `union isfuzzy=true (AgentOpsCollectorHealth_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (${compatHealth()}) | where ('$privacy_mode' == '__all' or tostring(column_ifexists('PrivacyMode', '')) == '$privacy_mode')`,
  content: `union isfuzzy=true (AgentOpsContent_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo())), (print TimeGenerated=now(), RunId='', SessionId='', TraceId='', SpanId='', TurnIndex=long(null), Role='', ContentKind='', CaptureMode='', RedactionStatus='', ModelActual='', ToolName='', PromptText='', ResponseText='', ContentHash='', ContentLength=long(null) | where false) | extend PromptText=tostring(column_ifexists('PromptText', '')), ResponseText=tostring(column_ifexists('ResponseText', '')), CaptureMode=tostring(column_ifexists('CaptureMode', '')), RedactionStatus=tostring(column_ifexists('RedactionStatus', '')) | extend MessageText=case(isnotempty(PromptText), PromptText, isnotempty(ResponseText), ResponseText, '') | extend ViewerNote=case(isempty(MessageText), 'no captured content', CaptureMode == 'full', 'explicit opt-in: full content row', CaptureMode == 'redacted', 'explicit opt-in: redacted content row', 'explicit opt-in content row') ${contentFilters()}`
};

const dashboards = {
  '01-agentops-home.json': dashboard('agentops-v2-home', 'AgentOps Home', [
    textPanel(1, 'What happened?', 0, 0, 24, 3, `## AgentOps Home\nCopilot AgentOps control room for Azure. ${emptyState}`),
    textPanel(18, 'Open latest run', 0, 3, 8, 3, "### Open latest run\nStart with the newest session, then drill into Run Replay.\n\n`agentops open latest --last 2h --json`\n\n[Run Replay](/d/agentops-v2-run-replay?${__url_time_range})"),
    textPanel(19, 'Get recommendation', 8, 3, 8, 3, "### Get recommendation\nGenerate one evidence-backed next action for the current run set.\n\n`agentops recommend latest --last 2h`\n\n[Insights](/d/agentops-v2-insights-regressions?${__url_time_range})"),
    textPanel(20, 'Ask AgentOps', 16, 3, 8, 3, "### Ask AgentOps\nBuild a metadata-only context bundle for investigation.\n\n`agentops ask-context latest --last 2h --json`\n\nExported evidence bundle:\n\n`agentops ask-context latest --last 2h --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --privacy <AgentOpsPrivacy_CL.jsonl> --github <AgentOpsGitHubOutcome_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl> --recommendations <AgentOpsRecommendations_CL.jsonl> --json`\n\nUse `docs/copilot-mcp-agentops-prompts.md` for session, tool failure, benchmark, agent, hook, and MCP regression templates.\n\n[Run Replay](/d/agentops-v2-run-replay?${__url_time_range})"),
    statPanel(2, 'Runs', 0, 6, `${q.runSummary} | summarize value=count() by bin(TimeGenerated, $__interval)`),
    statPanel(3, 'Success rate', 4, 6, `${q.runSummary} | summarize value=100.0 * countif(OutcomeStatus == 'success') / count() by bin(TimeGenerated, $__interval)`, 'percent', 'green'),
    statPanel(4, 'Failed runs', 8, 6, `${q.runSummary} | summarize value=countif(OutcomeStatus != 'success') by bin(TimeGenerated, $__interval)`, 'short', 'red'),
    statPanel(5, 'Privacy drops', 12, 6, `${q.privacy} | summarize value=sum(DroppedCount) by bin(TimeGenerated, $__interval)`, 'short', 'yellow'),
    statPanel(6, 'Estimated cost', 16, 6, `${q.runSummary} | summarize value=sum(EstimatedCostUsd) by bin(TimeGenerated, $__interval)`, 'currencyUSD', 'yellow'),
    statPanel(7, 'Collector health', 20, 6, `${q.health} | summarize value=countif(Status == 'healthy') by bin(TimeGenerated, $__interval)`, 'short', 'green'),
    statPanel(8, 'Policy blocks', 0, 10, `${q.events} | where EventType == 'policy' | summarize value=countif(Status == 'denied' or Status == 'blocked') by bin(TimeGenerated, $__interval)`, 'short', 'red'),
    statPanel(9, 'Input tokens', 4, 10, `${q.runSummary} | summarize value=sum(InputTokens) by bin(TimeGenerated, $__interval)`),
    statPanel(14, 'Output tokens', 8, 10, `${q.runSummary} | summarize value=sum(OutputTokens) by bin(TimeGenerated, $__interval)`),
    statPanel(15, 'p95 duration', 12, 10, `${q.runSummary} | summarize value=percentile(DurationMs, 95) by bin(TimeGenerated, $__interval)`, 'ms', 'yellow'),
    statPanel(16, 'Tests ran %', 16, 10, `${q.runSummary} | summarize value=100.0 * countif(TestsRan == true) / count() by bin(TimeGenerated, $__interval)`, 'percent', 'green'),
    statPanel(17, 'PRs opened', 20, 10, `${q.runSummary} | summarize value=countif(PrOpened == true) by bin(TimeGenerated, $__interval)`, 'short', 'green'),
    tablePanel(10, 'Session Health', 0, 14, 12, 9, `let LatestRecommendations = ${q.recommendations} | summarize arg_max(TimeGenerated, Severity, Action, NextAction, PatternKey, BenchmarkRunId, BenchmarkDecision) by RunId; ${q.runSummary} | join kind=leftouter LatestRecommendations on RunId | extend HealthStatus=case(OutcomeStatus != 'success', 'failed', RiskScore >= 60, 'high risk', RiskScore >= 20, 'review', ContentCaptureSignal == true, 'privacy review', 'healthy'), RootAgent=case(isnotempty(ParentAgentName), ParentAgentName, isnotempty(AgentName), AgentName, 'agent'), RecommendedNextAction=case(isnotempty(NextAction), NextAction, 'Open Run Replay and inspect the metadata timeline.'), OpenReplay='Replay' | project TimeGenerated, HealthStatus, RiskScore, RootAgent, ModelActual, ToolFailureCount, ToolDeniedCount, ContentCaptureSignal, ContextWindowPct, EvalOverall, BenchmarkRunId, BenchmarkDecision, RecommendedNextAction, RunId, SessionId, TraceId, OpenReplay | order by TimeGenerated desc | take 50`),
    tablePanel(11, 'Recommended next actions', 12, 14, 12, 9, `${q.recommendations} | extend OpenReplay='Replay', OpenPattern=iff(isnotempty(PatternKey), 'Pattern', '') | project TimeGenerated, Severity, Action, ObservedPattern, NextAction, RunId, TraceId, PatternKey, PatternRuns, BenchmarkRunId, BenchmarkDecision, ChangeTargetRefs, DashboardCount, OpenReplay, OpenPattern | order by TimeGenerated desc | take 50`),
    tablePanel(12, 'Most expensive runs', 0, 23, 12, 9, `${q.runSummary} | project TimeGenerated, RunId, RepoHash, TaskType, ModelActual, OutcomeStatus, EstimatedCostUsd, InputTokens, OutputTokens | order by EstimatedCostUsd desc | take 50`),
    tablePanel(13, 'GitHub outcomes summary', 12, 23, 12, 9, `${q.github} | project TimeGenerated, RunId, RepoHash, PrOpened, PrMerged, PrReverted, CiStatus, TimeToPrMinutes, TimeToMergeMinutes, ReviewCommentCount, FilesChangedCount | order by TimeGenerated desc | take 50`),
    tablePanel(21, 'Saved investigations', 0, 32, 24, 8, `${q.savedViews} | extend TagsText=strcat_array(Tags, ', '), OpenSavedView=iff(isnotempty(Url), 'Open', ''), OpenReplay=iff(isnotempty(SessionId), 'Replay', '') | project TimeGenerated, Name, Description, TagsText, SessionId, QueryHash, CreatedAt, Url, OpenSavedView, OpenReplay | order by TimeGenerated desc | take 100`)
  ]),

  '02-runs-explorer.json': dashboard('agentops-v2-runs-explorer', 'Runs Explorer', [
    textPanel(1, 'Find a run', 0, 0, 24, 2, `## Runs Explorer\nDatadog-style run list. ${emptyState}`),
    tablePanel(10, 'Runs', 0, 2, 24, 17, `${q.runSummary} | extend OpenReplay='Replay', OpenTrace='Trace', OpenGithub=iff(PrOpened == true or isnotempty(PrNumberHash) or CiStatus != 'not_run', 'Outcome', '') | project TimeGenerated, RunId, SessionId, TraceId, Surface, RepoHash, BranchHash, TaskType, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, ModelActual, OutcomeStatus, OutcomeReason, DurationMs, InputTokens, OutputTokens, CacheReadTokens, ContextWindowPct, TokensRemoved, PermissionWaitMs, EstimatedCostUsd, ToolCount, ToolFailureCount, ToolDeniedCount, TestsRan, TestsPassed, PrOpened, PrNumberHash, CiStatus, EvalOverall, RiskScore, OpenReplay, OpenTrace, OpenGithub | order by TimeGenerated desc | take 500`),
    timeseriesPanel(20, 'Runs by outcome', 0, 19, 12, 8, `${q.runSummary} | summarize Runs=count() by TimeGenerated=bin(TimeGenerated, $__interval), OutcomeStatus | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Cost and tokens', 12, 19, 12, 8, `${q.runSummary} | summarize Cost=sum(EstimatedCostUsd), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`)
  ]),

  '03-run-replay.json': dashboard('agentops-v2-run-replay', 'Agent Run Replay', [
    textPanel(1, 'Replay', 0, 0, 24, 2, `## Agent Run Replay\nTimeline of one Copilot run. Strict mode shows metadata only; prompt/response rows appear only when AgentOpsContent_CL is explicitly enabled. ${emptyState}`),
    tablePanel(10, 'Run summary', 0, 2, 24, 5, `${q.runSummary} | project TimeGenerated, RunId, SessionId, TraceId, Surface, RepoHash, TaskType, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, ModelActual, OutcomeStatus, OutcomeReason, DurationMs, EstimatedCostUsd, ContextWindowPct, CacheReadTokens, TokensRemoved, PermissionWaitMs, TestsRan, TestsPassed, PrOpened, CiStatus, EvalOverall, RiskScore | order by TimeGenerated desc | take 20`),
    tablePanel(20, 'Replay timeline', 0, 7, 24, 10, `${q.events} | project TimeGenerated, RunId, SessionId, TraceId, SpanId, EventName, EventType, AgentName, SkillName, ParentAgentName, SubAgentName, DelegationId, McpServer, ToolName, ModelActual, Status, DurationMs, ErrorType, OutcomeStatus, Details | order by TimeGenerated asc | take 1000`),
    tablePanel(23, 'Agent, skill, and MCP lineage', 0, 17, 24, 6, `${q.events} | extend Actor=case(isnotempty(SubAgentName), SubAgentName, isnotempty(AgentName), AgentName, 'agent'), Parent=iff(isempty(ParentAgentName), 'root', ParentAgentName), Skill=iff(isempty(SkillName), 'none', SkillName), Mcp=iff(isempty(McpServer), 'none', McpServer), Tool=iff(isempty(ToolName), 'none', ToolName) | summarize Events=count(), Tools=dcountif(Tool, Tool != 'none'), Failures=countif(Status != 'success'), P95DurationMs=percentile(DurationMs, 95), FirstSeen=min(TimeGenerated), LastSeen=max(TimeGenerated) by Parent, Actor, Skill, Mcp, Tool, DelegationId | order by FirstSeen asc | take 200`),
    tablePanel(24, 'Context and cache posture', 0, 23, 24, 4, `${q.runSummary} | project TimeGenerated, RunId, InputTokens, OutputTokens, ReasoningTokens, CacheReadTokens, CacheCreationTokens, ContextWindowPct, TokensRemoved, PermissionWaitMs, ContextState=case(ContextWindowPct >= 90 or TokensRemoved > 0, 'pressure', CacheReadTokens > 0, 'cache leverage', 'normal') | order by TimeGenerated desc | take 20`),
    tablePanel(28, 'Why this failed / next check', 0, 27, 24, 5, `${q.insights} | extend Priority=case(Severity == 'critical', 0, Severity == 'high', 1, Severity == 'medium', 2, 3) | order by Priority asc, TimeGenerated desc | project TimeGenerated, Severity, InsightType, Summary, SuggestedNextStep, RunId, TraceId, RepoHash, ModelActual, ToolName, BaselineValue, CurrentValue, ConfigHash | take 20`),
    tablePanel(31, 'Latest recommendation', 0, 32, 24, 5, `${q.recommendations} | extend Priority=case(Severity == 'critical', 0, Severity == 'high', 1, Severity == 'medium', 2, 3), RecommendationCommand=strcat('agentops recommend ', RunId, ' --last $timeRange --json'), AskContextCommand=strcat('agentops ask-context ', RunId, ' --last $timeRange --json'), OpenReplay='Replay', OpenPattern=iff(isnotempty(PatternKey), 'Pattern', '') | project TimeGenerated, RecommendationId, Severity, Action, ObservedPattern, NextAction, BenchmarkRunId, BenchmarkDecision, ChangeTargetRefs, RecommendationCommand, AskContextCommand, OpenReplay, OpenPattern | order by Priority asc, TimeGenerated desc | take 20`),
    tablePanel(29, 'Ask AgentOps context', 0, 37, 24, 5, `${q.runSummary} | extend RunReplayUrl=strcat('/d/agentops-v2-run-replay?var-run_id=', RunId, '&var-session_id=', SessionId, '&var-trace_id=', TraceId, '&\${__url_time_range}'), InvestigationKql=strcat('AgentOpsRunSummary_CL | where TimeGenerated > ago($timeRange) | where RunId == "', RunId, '" or SessionId == "', SessionId, '" | project TimeGenerated, RunId, SessionId, TraceId, OutcomeStatus, OutcomeReason'), AskContextCommand=strcat('agentops ask-context ', RunId, ' --last $timeRange --json'), BundleCommand=strcat('agentops ask-context ', RunId, ' --last $timeRange --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --privacy <AgentOpsPrivacy_CL.jsonl> --github <AgentOpsGitHubOutcome_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl> --recommendations <AgentOpsRecommendations_CL.jsonl> --json'), AskPrompt=strcat('Use the telemetry-investigator or AgentOps triage skill. Investigate AgentOps run ', RunId, '. Session ', SessionId, '. Trace ', TraceId, '. Dashboard ', RunReplayUrl, '. Start with KQL: ', InvestigationKql, '. Use only metadata in the dashboard. Return what happened, why it matters, the likely failure/cost/safety/context pattern, and one evidence-backed next action. Do not request or enable prompt, response, source code, file content, tool argument, tool result, URL, request body, response body, or secret capture.'), TriageCommand=strcat('agentops triage ', RunId, ' --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>'), OpenReplay='Replay' | project TimeGenerated, RunId, SessionId, TraceId, OutcomeStatus, OutcomeReason, RunReplayUrl, InvestigationKql, AskContextCommand, BundleCommand, AskPrompt, TriageCommand, OpenReplay | order by TimeGenerated desc | take 20`),
    tablePanel(25, 'Transcript availability', 0, 42, 24, 4, `union isfuzzy=true (${q.runSummary} | summarize Runs=dcount(RunId), ContentSignalRuns=countif(ContentCaptureSignal == true), Modes=make_set(ContentCaptureMode, 10), LatestRunId=take_any(RunId), LatestSessionId=take_any(SessionId), LatestTraceId=take_any(TraceId)), (${q.content} | summarize ContentRows=count(), FullContentRows=countif(CaptureMode == 'full'), RedactedContentRows=countif(CaptureMode == 'redacted'), ContentModes=make_set(CaptureMode, 10), RedactionStates=make_set(RedactionStatus, 10), LatestRunId=take_any(RunId), LatestSessionId=take_any(SessionId), LatestTraceId=take_any(TraceId)) | summarize Runs=sum(Runs), ContentSignalRuns=sum(ContentSignalRuns), ContentRows=sum(ContentRows), FullContentRows=sum(FullContentRows), RedactedContentRows=sum(RedactedContentRows), Modes=make_set(Modes, 10), ContentModes=make_set(ContentModes, 10), RedactionStates=make_set(RedactionStates, 10), RunId=take_anyif(LatestRunId, isnotempty(LatestRunId)), SessionId=take_anyif(LatestSessionId, isnotempty(LatestSessionId)), TraceId=take_anyif(LatestTraceId, isnotempty(LatestTraceId)) | extend Status=case(ContentRows == 0, 'strict metadata only', FullContentRows > 0, 'content viewer enabled: full opt-in', 'content viewer enabled: redacted opt-in'), SafetyNote='Content rows require explicit opt-in and restricted access.', OpenTranscript='Open viewer' | project Status, SafetyNote, OpenTranscript, ContentRows, FullContentRows, RedactedContentRows, ContentSignalRuns, Runs, RunId, SessionId, TraceId, Modes, ContentModes, RedactionStates`),
    tablePanel(26, 'Prompt and response viewer (explicit opt-in)', 0, 46, 24, 8, `${q.content} | project TimeGenerated, TurnIndex, Role, ContentKind, MessageText, CaptureMode, RedactionStatus, ViewerNote, ModelActual, ToolName, ContentHash, ContentLength, RunId, SessionId, TraceId | order by TimeGenerated asc | take 200`),
    tablePanel(30, 'Policy, privacy, tests, and GitHub outcome', 0, 54, 24, 10, `union isfuzzy=true (${q.privacy} | project TimeGenerated, RunId, TraceId, Event='privacy.signal', Status=Action, Detail=strcat(ContentKind, ': ', tostring(DroppedCount), ' dropped')), (${q.evals} | project TimeGenerated, RunId, TraceId, Event='eval.completed', Status=tostring(EvalOverall), Detail=tostring(EvalReason)), (${q.github} | project TimeGenerated, RunId, TraceId='', Event='github.outcome', Status=CiStatus, Detail=strcat('pr=', tostring(PrOpened), ' merged=', tostring(PrMerged), ' reverted=', tostring(PrReverted))) | where ('$run_id' == '__all' or RunId == '$run_id') and ('$trace_id' == '__all' or TraceId == '$trace_id') | order by TimeGenerated asc | take 500`)
  ]),

  '04-models-cost-tokens.json': dashboard('agentops-v2-models-cost-tokens', 'Models, Cost & Tokens', [
    textPanel(1, 'Model ROI', 0, 0, 24, 2, `## Models, Cost & Tokens\nAnswer whether a model is worth it for a task type. ${emptyState}`),
    tablePanel(10, 'Model ROI', 0, 2, 24, 10, `${q.runSummary} | summarize Runs=count(), Failed=countif(OutcomeStatus != 'success'), Cost=sum(EstimatedCostUsd), InputTokens=sum(InputTokens), OutputTokens=sum(OutputTokens), CacheReadTokens=sum(CacheReadTokens), AvgContextPct=avg(ContextWindowPct), ContextPressureRuns=countif(ContextWindowPct >= 90 or TokensRemoved > 0), P95DurationMs=percentile(DurationMs, 95), AvgEval=avg(EvalOverall), PRs=countif(PrOpened == true), TestPasses=countif(TestsPassed == true) by ModelActual, TaskType | extend CacheReadPct=100.0 * CacheReadTokens / iif(InputTokens == 0, real(null), InputTokens), CostPerSuccess=Cost / iif(Runs - Failed == 0, real(null), todouble(Runs - Failed)), CostPerPr=Cost / iif(PRs == 0, real(null), todouble(PRs)), CostPerTestPass=Cost / iif(TestPasses == 0, real(null), todouble(TestPasses)) | order by Cost desc`),
    timeseriesPanel(20, 'Cost by model', 0, 12, 12, 8, `${q.runSummary} | summarize Cost=sum(EstimatedCostUsd) by TimeGenerated=bin(TimeGenerated, $__interval), ModelActual | order by TimeGenerated asc`, 'currencyUSD'),
    timeseriesPanel(21, 'Failure rate by model', 12, 12, 12, 8, `${q.runSummary} | summarize FailureRate=100.0 * countif(OutcomeStatus != 'success') / count() by TimeGenerated=bin(TimeGenerated, $__interval), ModelActual | order by TimeGenerated asc`, 'percent')
  ]),

  '05-tools-mcp-risk.json': dashboard('agentops-v2-tools-mcp-risk', 'Tools & MCP Risk', [
    textPanel(1, 'Tool governance', 0, 0, 24, 2, `## Tools & MCP Risk\nReliability, denied calls, sandbox posture, and risky tools. ${emptyState}`),
    tablePanel(10, 'Tool risk table', 0, 2, 24, 12, `let Runs = ${q.runSummary} | project RunId, RunOutcomeStatus=OutcomeStatus, RunRiskScore=RiskScore; let Tools = ${q.tools}; Tools | join kind=leftouter Runs on RunId | extend OutputBytes=coalesce(todouble(column_ifexists('OutputSizeBytes', real(null))), todouble(column_ifexists('ResultSizeBytes', real(null)))) | summarize Calls=count(), Failures=countif(Status != 'success'), Denied=countif(Allowed == false), BadOutcomeRuns=countif(RunOutcomeStatus != 'success'), P95DurationMs=percentile(DurationMs, 95), AvgOutputSize=avg(OutputBytes), AvgRunRisk=avg(RunRiskScore) by ToolName, ToolType, ToolRisk, McpServer, AgentName | extend FailureRate=100.0 * Failures / Calls, DeniedRate=100.0 * Denied / Calls, BadOutcomeCorrelation=100.0 * BadOutcomeRuns / Calls | order by BadOutcomeCorrelation desc, FailureRate desc, ToolRisk asc`),
    timeseriesPanel(20, 'Tool failures', 0, 14, 12, 8, `${q.tools} | summarize Failures=countif(Status != 'success') by TimeGenerated=bin(TimeGenerated, $__interval), ToolName | order by TimeGenerated asc`),
    timeseriesPanel(21, 'Denied tools', 12, 14, 12, 8, `${q.tools} | summarize Denied=countif(Allowed == false) by TimeGenerated=bin(TimeGenerated, $__interval), ToolRisk | order by TimeGenerated asc`)
  ]),

  '06-safety-privacy-policy.json': dashboard('agentops-v2-safety-privacy-policy', 'Safety, Privacy & Policy', [
    textPanel(1, 'Trust screen', 0, 0, 24, 2, `## Safety, Privacy & Policy\nStrict privacy should be visible and reassuring. ${emptyState}`),
    statPanel(2, 'Privacy drops', 0, 2, `${q.privacy} | summarize value=sum(DroppedCount) by bin(TimeGenerated, $__interval)`, 'short', 'yellow'),
    statPanel(3, 'Secret-like drops', 4, 2, `${q.privacy} | where ContentKind == 'secret_like' | summarize value=sum(DroppedCount) by bin(TimeGenerated, $__interval)`, 'short', 'red'),
    statPanel(4, 'Unsafe attempts', 8, 2, `${q.runSummary} | summarize value=countif(PrivacyMode == 'unsafe') by bin(TimeGenerated, $__interval)`, 'short', 'red'),
    statPanel(5, 'Policy blocks', 12, 2, `${q.events} | where EventType == 'policy' | summarize value=countif(Status == 'denied' or Status == 'blocked') by bin(TimeGenerated, $__interval)`, 'short', 'red'),
    statPanel(6, 'Poison tests OK', 16, 2, `${q.health} | where CheckName == 'privacy-poison' | summarize value=countif(Status == 'ok') by bin(TimeGenerated, $__interval)`, 'short', 'green'),
    statPanel(7, 'Strict runs', 20, 2, `${q.runSummary} | summarize value=countif(PrivacyMode == 'strict') by bin(TimeGenerated, $__interval)`, 'short', 'green'),
    tablePanel(10, 'Privacy drops by kind', 0, 6, 12, 9, `${q.privacy} | summarize Drops=sum(DroppedCount), Redactions=sum(RedactedCount), Runs=dcount(RunId) by ContentKind, Action, PrivacyMode | order by Drops desc`),
    tablePanel(11, 'Runs with policy blocks or drops', 12, 6, 12, 9, `${q.runSummary} | where PrivacyMode == 'unsafe' or RiskScore > 0 or ToolDeniedCount > 0 | project TimeGenerated, RunId, RepoHash, PrivacyMode, ContentCaptureMode, ToolDeniedCount, OutcomeStatus, RiskScore | order by TimeGenerated desc | take 100`)
  ]),

  '07-code-outcomes.json': dashboard('agentops-v2-code-outcomes', 'Code Outcomes', [
    textPanel(1, 'Delivery impact', 0, 0, 24, 2, `## Code Outcomes\nShow whether Copilot produced useful software outcomes. ${emptyState}`),
    tablePanel(10, 'Runs and PR outcomes', 0, 2, 24, 12, `${q.github} | project TimeGenerated, RunId, RepoHash, BranchHash, PrOpened, PrNumberHash, PrMerged, PrClosed, PrReverted, CiStatus, TimeToPrMinutes, TimeToMergeMinutes, ReviewCommentCount, CommitCount, FilesChangedCount | order by TimeGenerated desc | take 500`),
    timeseriesPanel(20, 'PR and CI outcomes', 0, 14, 12, 8, `${q.github} | summarize PRs=countif(PrOpened == true), Merged=countif(PrMerged == true), Reverted=countif(PrReverted == true), CiFailed=countif(CiStatus == 'failed') by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    tablePanel(22, 'Delivery timing', 12, 14, 12, 8, `${q.github} | summarize PRs=countif(PrOpened == true), Merged=countif(PrMerged == true), AvgTimeToPrMinutes=avg(TimeToPrMinutes), P95TimeToPrMinutes=percentile(TimeToPrMinutes, 95), AvgTimeToMergeMinutes=avg(TimeToMergeMinutes), P95TimeToMergeMinutes=percentile(TimeToMergeMinutes, 95) by RepoHash, BranchHash | order by P95TimeToPrMinutes desc`),
    tablePanel(21, 'Edited files but no tests', 0, 22, 24, 8, `${q.runSummary} | where FilesEditedCount > 0 and TestsRan != true | project TimeGenerated, RunId, RepoHash, FilesEditedCount, TestsRan, TestsPassed, OutcomeStatus, ModelActual, AgentName, SkillName | order by TimeGenerated desc | take 100`)
  ]),

  '08-evals-quality.json': dashboard('agentops-v2-evals-quality', 'Evals & Quality', [
    textPanel(1, 'Quality over time', 0, 0, 24, 2, `## Evals & Quality\nDeterministic quality scoring for test discipline, tool efficiency, security, reliability, and code outcome. ${emptyState}`),
    tablePanel(10, 'Low-score runs', 0, 2, 24, 10, `${q.evals} | project TimeGenerated, RunId, RepoHash, ModelActual, TaskType, EvalOverall, TestDiscipline, ToolEfficiency, Security, Reliability, CodeOutcome, EvalReason | order by EvalOverall asc, TimeGenerated desc | take 100`),
    timeseriesPanel(20, 'Eval trend', 0, 12, 12, 8, `${q.evals} | summarize EvalOverall=avg(EvalOverall), TestDiscipline=avg(TestDiscipline), Security=avg(Security), Reliability=avg(Reliability) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    tablePanel(21, 'Eval score by model and task', 12, 12, 12, 8, `${q.evals} | summarize Runs=count(), AvgEval=avg(EvalOverall), AvgSecurity=avg(Security), AvgTestDiscipline=avg(TestDiscipline) by ModelActual, TaskType, RepoHash | order by AvgEval asc`),
    tablePanel(28, 'Eval scorecard by repo, model, and task', 0, 20, 12, 8, `${q.evals} | summarize Runs=count(), AvgEval=round(avg(EvalOverall), 1), PoorRuns=countif(EvalBucket == 'poor'), ReviewRuns=countif(EvalBucket == 'review'), AvgTestDiscipline=round(avg(TestDiscipline), 1), AvgToolEfficiency=round(avg(ToolEfficiency), 1), AvgSecurity=round(avg(Security), 1), AvgReliability=round(avg(Reliability), 1), AvgCodeOutcome=round(avg(CodeOutcome), 1), LastSeen=max(TimeGenerated) by RepoHash, ModelActual, TaskType | extend ScorecardStatus=case(PoorRuns > 0, 'poor', ReviewRuns > 0 or AvgEval < 80, 'review', 'ok'), ScorecardPriority=case(PoorRuns > 0, 0, ReviewRuns > 0 or AvgEval < 80, 1, 2) | order by ScorecardPriority asc, AvgEval asc, Runs desc | project ScorecardStatus, Runs, AvgEval, PoorRuns, ReviewRuns, AvgTestDiscipline, AvgToolEfficiency, AvgSecurity, AvgReliability, AvgCodeOutcome, RepoHash, ModelActual, TaskType, LastSeen`),
    tablePanel(29, 'Eval regression follow-up', 12, 20, 12, 8, `${q.recommendations} | where EvalBucket in ('poor', 'review') or Action has 'regression' or ObservedPattern has 'eval' | extend OpenReplay='Replay', OpenPattern=iff(isnotempty(PatternKey), 'Pattern', '') | project TimeGenerated, RecommendationId, Severity, Action, EvalOverall, EvalBucket, ObservedPattern, NextAction, RunId, TraceId, PatternKey, ChangeTargetRefs, OpenReplay, OpenPattern | order by TimeGenerated desc, Severity asc | take 100`),
    tablePanel(31, 'Before/after run comparison', 0, 28, 24, 8, `${q.runSummary} | project TimeGenerated, AfterRunId=RunId, SessionId, TraceId, RepoHash, ModelActual, TaskType, OutcomeStatus, EvalOverall, EstimatedCostUsd, InputTokens, OutputTokens, ToolFailureCount, RiskScore | order by RepoHash asc, ModelActual asc, TaskType asc, TimeGenerated asc | serialize BeforeRunId=prev(AfterRunId), BeforeRepoHash=prev(RepoHash), BeforeModelActual=prev(ModelActual), BeforeTaskType=prev(TaskType), BeforeOutcomeStatus=prev(OutcomeStatus), BeforeEvalOverall=prev(EvalOverall), BeforeEstimatedCostUsd=prev(EstimatedCostUsd), BeforeInputTokens=prev(InputTokens), BeforeOutputTokens=prev(OutputTokens), BeforeToolFailureCount=prev(ToolFailureCount), BeforeRiskScore=prev(RiskScore) | where BeforeRepoHash == RepoHash and BeforeModelActual == ModelActual and BeforeTaskType == TaskType | extend EvalDelta=EvalOverall - BeforeEvalOverall, CostDelta=EstimatedCostUsd - BeforeEstimatedCostUsd, TokenDelta=(InputTokens + OutputTokens) - (BeforeInputTokens + BeforeOutputTokens), ToolFailureDelta=ToolFailureCount - BeforeToolFailureCount, RiskDelta=RiskScore - BeforeRiskScore | extend ComparisonStatus=case(OutcomeStatus != 'success' and BeforeOutcomeStatus == 'success', 'regressed', EvalDelta >= 5 and CostDelta <= 0 and ToolFailureDelta <= 0 and RiskDelta <= 0, 'improved', EvalDelta < -5 or ToolFailureDelta > 0 or RiskDelta > 0, 'review', 'similar'), OpenReplay='Replay' | project TimeGenerated, ComparisonStatus, BeforeRunId, AfterRunId, RepoHash, ModelActual, TaskType, BeforeOutcomeStatus, OutcomeStatus, BeforeEvalOverall, EvalOverall, EvalDelta, CostDelta, TokenDelta, ToolFailureDelta, RiskDelta, SessionId, TraceId, OpenReplay | order by TimeGenerated desc | take 100`),
    tablePanel(22, 'Benchmark artifact diff review', 0, 36, 24, 8, `${q.recommendations} | where isnotempty(BenchmarkRunId) or BenchmarkArtifactTotalChanged > 0 | extend ReviewAction=case(BenchmarkArtifactTotalChanged > 0, 'Review artifact diff', isnotempty(BenchmarkRunId), 'Benchmark has no artifact changes', 'No benchmark evidence') | project TimeGenerated, RecommendationId, Severity, Action, RunId, BenchmarkRunId, BenchmarkDecision, BenchmarkPassRatePct, BenchmarkAverageScore, BenchmarkArtifactAdded, BenchmarkArtifactModified, BenchmarkArtifactDeleted, BenchmarkArtifactTotalChanged, ChangeTargetRefs, ReviewAction, NextAction | order by TimeGenerated desc | take 100`),
    tablePanel(24, 'Benchmark artifact files', 0, 44, 24, 8, `${q.recommendations} | mv-expand ArtifactFile=BenchmarkArtifactFiles | extend ArtifactTaskId=tostring(ArtifactFile.task_id), ArtifactChange=tostring(ArtifactFile.change), ArtifactPath=tostring(ArtifactFile.path) | where isnotempty(ArtifactPath) | project TimeGenerated, RecommendationId, RunId, BenchmarkRunId, BenchmarkDecision, ArtifactTaskId, ArtifactChange, ArtifactPath, Severity, Action, NextAction | order by TimeGenerated desc, ArtifactTaskId asc, ArtifactChange asc, ArtifactPath asc | take 200`),
    tablePanel(30, 'Benchmark artifact content diffs', 0, 52, 24, 8, `${q.recommendations} | mv-expand ArtifactDiff=BenchmarkArtifactContentDiffs | extend ArtifactTaskId=tostring(ArtifactDiff.task_id), ArtifactChange=tostring(ArtifactDiff.change), ArtifactPath=tostring(ArtifactDiff.path), DiffPreview=tostring(ArtifactDiff.diff_preview) | where isnotempty(ArtifactPath) and isnotempty(DiffPreview) | project TimeGenerated, RecommendationId, RunId, BenchmarkRunId, BenchmarkDecision, ArtifactTaskId, ArtifactChange, ArtifactPath, DiffPreview, Severity, Action, NextAction | order by TimeGenerated desc, ArtifactTaskId asc, ArtifactChange asc, ArtifactPath asc | take 100`),
    tablePanel(25, 'Benchmark hidden check packs', 0, 60, 24, 8, `${q.recommendations} | mv-expand HiddenPack=BenchmarkHiddenCheckPacks | extend HiddenTaskId=tostring(HiddenPack['task_id']), HiddenPackId=tostring(HiddenPack['id']), HiddenPackTitle=tostring(HiddenPack['title']), HiddenCommandCount=tolong(HiddenPack['command_count']) | where isnotempty(HiddenPackId) | project TimeGenerated, RecommendationId, RunId, BenchmarkRunId, BenchmarkDecision, BenchmarkHiddenChecksPassed, BenchmarkHiddenChecksFailed, HiddenTaskId, HiddenPackId, HiddenPackTitle, HiddenCommandCount, Severity, Action, NextAction | order by TimeGenerated desc, HiddenTaskId asc, HiddenPackId asc | take 200`),
    tablePanel(26, 'Benchmark policy review', 0, 68, 24, 8, `${q.recommendations} | mv-expand PolicyTask=BenchmarkPolicyTasks | extend PolicyTaskId=tostring(PolicyTask.task_id), PermissionProfile=tostring(PolicyTask.permission_profile), OsSandboxMode=tostring(PolicyTask.os_sandbox_mode), OsSandboxActive=tobool(PolicyTask.os_sandbox_active), PolicyBlocks=tolong(PolicyTask.policy_blocks), BlockedRisks=strcat_array(PolicyTask.blocked_risks, ', '), ViolationCount=tolong(PolicyTask.violation_count), ViolationRisks=strcat_array(PolicyTask.violation_risks, ', ') | where isnotempty(PolicyTaskId) or isnotempty(PermissionProfile) or isnotnull(PolicyBlocks) | project TimeGenerated, RecommendationId, RunId, BenchmarkRunId, BenchmarkDecision, BenchmarkPolicyBlocks, BenchmarkPermissionProfiles, PolicyTaskId, PermissionProfile, OsSandboxMode, OsSandboxActive, PolicyBlocks, BlockedRisks, ViolationCount, ViolationRisks, Severity, Action, NextAction | order by TimeGenerated desc, PolicyBlocks desc, PolicyTaskId asc | take 200`),
    tablePanel(27, 'Benchmark semantic checks', 0, 76, 24, 8, `${q.recommendations} | mv-expand SemanticCheck=BenchmarkSemanticChecks | extend SemanticTaskId=tostring(SemanticCheck.task_id), SemanticCheckId=tostring(SemanticCheck.id), SemanticAdapter=tostring(SemanticCheck.adapter), SemanticFile=tostring(SemanticCheck.file), SemanticOk=tobool(SemanticCheck.ok), SemanticScore=todouble(SemanticCheck.score), SemanticDetail=tostring(SemanticCheck.detail) | where isnotempty(SemanticCheckId) | project TimeGenerated, RecommendationId, RunId, BenchmarkRunId, BenchmarkDecision, BenchmarkSemanticCheckCount, BenchmarkSemanticAverageScore, SemanticTaskId, SemanticCheckId, SemanticAdapter, SemanticFile, SemanticOk, SemanticScore, SemanticDetail, Severity, Action, NextAction | order by TimeGenerated desc, SemanticOk asc, SemanticScore asc, SemanticTaskId asc | take 200`),
    tablePanel(23, 'Benchmark promotion approvals', 0, 84, 24, 8, `${q.recommendations} | where isnotempty(BenchmarkRunId) or isnotempty(BenchmarkApprovalStatus) or isnotnull(BenchmarkRequiredApprovals) | extend ApprovalAction=case(BenchmarkRequiredApprovals > BenchmarkApprovalCount, 'Collect required approval evidence', BenchmarkApprovalStatus == 'rejected', 'Do not promote', BenchmarkApprovalStatus == 'approved', 'Approval evidence present', isnotnull(BenchmarkRequiredApprovals), 'Review approval evidence', 'No approval gate') | project TimeGenerated, RecommendationId, Severity, Action, RunId, BenchmarkRunId, BenchmarkDecision, BenchmarkApprovalStatus, BenchmarkApprovalCount, BenchmarkRequiredApprovals, BenchmarkApprovalApprovedAt, BenchmarkApprovalTicket, BenchmarkApprovalSource, ApprovalAction, NextAction | order by TimeGenerated desc | take 100`)
  ]),

  '09-insights-regressions.json': dashboard('agentops-v2-insights-regressions', 'Insights & Regressions', [
    textPanel(1, 'What changed?', 0, 0, 24, 2, `## Insights & Regressions\nCost, latency, failure, policy, eval, model, and instruction/config regressions. ${emptyState}`),
    tablePanel(10, 'Latest insights', 0, 2, 24, 10, `${q.insights} | project TimeGenerated, InsightType, Severity, Summary, RunId, RepoHash, ModelActual, ToolName, BaselineValue, CurrentValue, ConfigHash, PatternRuns, SuggestedNextStep | order by TimeGenerated desc | take 500`),
    tablePanel(11, 'Recurring patterns', 0, 12, 24, 8, `${q.insights} | where isnotempty(PatternId) or InsightType startswith 'recurring-' | extend OpenPattern='Pattern', OpenReplay='Replay' | project TimeGenerated, InsightType, Severity, PatternRuns, PatternDimension, PatternKey, Summary, SuggestedNextStep, OpenPattern, OpenReplay, RunId, RepoHash, ModelActual, ToolName, CurrentValue | order by PatternRuns desc, TimeGenerated desc | take 100`),
    timeseriesPanel(20, 'Insight volume', 0, 20, 12, 8, `${q.insights} | summarize Insights=count() by TimeGenerated=bin(TimeGenerated, $__interval), Severity | order by TimeGenerated asc`),
    tablePanel(21, 'Regression evidence', 12, 20, 12, 8, `${q.insights} | where InsightType has 'regression' or InsightType has 'anomaly' | project TimeGenerated, InsightType, Severity, RepoHash, ModelActual, ToolName, BaselineValue, CurrentValue, ConfigHash, Summary | order by TimeGenerated desc | take 100`),
    tablePanel(23, 'Eval regression queue', 0, 28, 24, 8, `union isfuzzy=true (${q.insights} | where InsightType has_any ('eval', 'regression', 'anomaly') | project TimeGenerated, Source='insight', Severity, Action=InsightType, RunId, TraceId, RepoHash, ModelActual, TaskType, EvalOverall=real(null), EvalBucket='', BaselineValue, CurrentValue, PatternKey, Summary, NextAction=SuggestedNextStep), (${q.recommendations} | where EvalBucket in ('poor', 'review') or Action has 'regression' or ObservedPattern has 'eval' | project TimeGenerated, Source='recommendation', Severity, Action, RunId, TraceId, RepoHash='', ModelActual='', TaskType='', EvalOverall, EvalBucket, BaselineValue=real(null), CurrentValue=EvalOverall, PatternKey, Summary=ObservedPattern, NextAction) | extend OpenReplay='Replay', OpenPattern=iff(isnotempty(PatternKey), 'Pattern', '') | project TimeGenerated, Source, Severity, Action, EvalOverall, EvalBucket, BaselineValue, CurrentValue, Summary, NextAction, RunId, TraceId, RepoHash, ModelActual, TaskType, PatternKey, OpenReplay, OpenPattern | order by TimeGenerated desc | take 200`),
    tablePanel(22, 'Recommendation artifacts', 0, 36, 24, 8, `${q.recommendations} | extend OpenReplay='Replay', OpenPattern=iff(isnotempty(PatternKey), 'Pattern', '') | project TimeGenerated, RecommendationId, Severity, Action, ObservedPattern, NextAction, RunId, TraceId, PatternKey, PatternRuns, PatternDimension, EvalOverall, EvalBucket, BenchmarkRunId, BenchmarkDecision, BenchmarkPassRatePct, BenchmarkAverageScore, BenchmarkSafetyViolationCount, BenchmarkArtifactAdded, BenchmarkArtifactModified, BenchmarkArtifactDeleted, BenchmarkArtifactTotalChanged, BenchmarkArtifactFiles, BenchmarkHiddenChecksPassed, BenchmarkHiddenChecksFailed, BenchmarkHiddenCheckPacks, BenchmarkPolicyBlocks, BenchmarkPermissionProfiles, BenchmarkPolicyTasks, BenchmarkSemanticCheckCount, BenchmarkSemanticAverageScore, BenchmarkSemanticChecks, BenchmarkApprovalStatus, BenchmarkApprovalCount, BenchmarkRequiredApprovals, ChangeTargetRefs, DashboardCount, OpenReplay, OpenPattern | order by TimeGenerated desc | take 200`)
  ]),

  '10-collector-health.json': dashboard('agentops-v2-collector-health', 'Collector Health', [
    textPanel(1, 'Supportability', 0, 0, 24, 2, `## Collector Health\nLocal collector, export, privacy poison, Azure, Grafana, schema, and dashboard version status. ${emptyState}`),
    tablePanel(10, 'Collector checks', 0, 2, 24, 12, `${q.health} | project TimeGenerated, CheckName, Status, Detail, PrivacyMode, CollectorMode, OtlpEndpoint, AzureConfigured, GrafanaConfigured, DashboardVersion, SchemaVersion | order by TimeGenerated desc | take 500`),
    timeseriesPanel(20, 'Export errors and drops', 0, 14, 12, 8, `${q.health} | summarize ExportErrors=sum(ExportErrors), DroppedContent=sum(DroppedContentCount) by TimeGenerated=bin(TimeGenerated, $__interval) | order by TimeGenerated asc`),
    tablePanel(21, 'Last received/exported', 12, 14, 12, 8, `${q.health} | summarize LastSpanReceived=max(LastSpanReceived), LastExportSuccess=max(LastExportSuccess), LatestStatus=arg_max(TimeGenerated, Status) by CollectorMode, PrivacyMode, OtlpEndpoint | order by LastSpanReceived desc`)
  ])
};

fs.mkdirSync(outDir, { recursive: true });
for (const [fileName, content] of Object.entries(dashboards)) {
  fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify(content, null, 2)}\n`);
  console.log(`wrote grafana/dashboards/v2/${fileName}`);
}

fs.mkdirSync(provisioningDashboardsDir, { recursive: true });
fs.writeFileSync(path.join(provisioningDashboardsDir, 'agentops-v2.yaml'), [
  'apiVersion: 1',
  'providers:',
  '  - name: AgentOps for Azure V2',
  '    orgId: 1',
  '    folder: AgentOps for Azure',
  '    type: file',
  '    disableDeletion: false',
  '    editable: true',
  '    updateIntervalSeconds: 30',
  '    options:',
  '      path: /var/lib/grafana/dashboards/agentops-v2',
  ''
].join('\n'));

fs.mkdirSync(provisioningDatasourcesDir, { recursive: true });
fs.writeFileSync(path.join(provisioningDatasourcesDir, 'azure-monitor.yaml'), [
  'apiVersion: 1',
  'datasources:',
  '  - name: Azure Monitor',
  '    type: grafana-azure-monitor-datasource',
  `    uid: ${datasource.uid}`,
  '    access: proxy',
  '    jsonData:',
  '      cloudName: azuremonitor',
  '      subscriptionId: ${AZURE_SUBSCRIPTION_ID}',
  '      tenantId: ${AZURE_TENANT_ID}',
  '      clientId: ${AZURE_CLIENT_ID}',
  '      azureAuthType: msi',
  ''
].join('\n'));
