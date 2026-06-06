@description('Azure region for V2 ingestion resources.')
param location string = resourceGroup().location

@description('Log Analytics workspace name that receives AgentOps V2 custom-table rows.')
param workspaceName string

@description('Base resource name used for the DCE and DCR.')
param baseName string = 'copilot-agentops'

@description('Deployment environment name.')
param environmentName string = 'dev'

@description('Retention in days for AgentOps V2 custom tables.')
@maxValue(730)
param retentionInDays int = 30

@description('Tags applied to V2 ingestion resources.')
param tags object = {}

var destinationName = 'agentops-log-analytics'
var tablePlan = 'Analytics'
var effectiveRetentionInDays = retentionInDays < 4 ? 4 : retentionInDays
var v2Tables = [
  {
    name: 'AgentOpsRunSummary_CL'
    stream: 'Custom-AgentOpsRunSummary_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'SessionId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'OutcomeStatus', type: 'string' }
      { name: 'OutcomeReason', type: 'string' }
      { name: 'AgentName', type: 'string' }
      { name: 'SkillName', type: 'string' }
      { name: 'SubAgentName', type: 'string' }
      { name: 'ParentAgentName', type: 'string' }
      { name: 'ModelRequested', type: 'string' }
      { name: 'ModelActual', type: 'string' }
      { name: 'InputTokens', type: 'long' }
      { name: 'OutputTokens', type: 'long' }
      { name: 'ReasoningTokens', type: 'long' }
      { name: 'CacheReadTokens', type: 'long' }
      { name: 'CacheCreationTokens', type: 'long' }
      { name: 'EstimatedCostUsd', type: 'real' }
      { name: 'DurationMs', type: 'long' }
      { name: 'ToolCount', type: 'long' }
      { name: 'ToolFailureCount', type: 'long' }
      { name: 'ToolDeniedCount', type: 'long' }
      { name: 'TestsRan', type: 'boolean' }
      { name: 'TestsPassed', type: 'boolean' }
      { name: 'PrOpened', type: 'boolean' }
      { name: 'CiStatus', type: 'string' }
      { name: 'ContentCaptureSignal', type: 'boolean' }
      { name: 'ContentCaptureMode', type: 'string' }
      { name: 'PrivacyMode', type: 'string' }
      { name: 'RepoHash', type: 'string' }
      { name: 'BranchHash', type: 'string' }
      { name: 'PrNumberHash', type: 'string' }
      { name: 'Surface', type: 'string' }
      { name: 'TaskType', type: 'string' }
      { name: 'ScenarioName', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsEvents_CL'
    stream: 'Custom-AgentOpsEvents_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'SessionId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'EventName', type: 'string' }
      { name: 'SpanName', type: 'string' }
      { name: 'Status', type: 'string' }
      { name: 'ToolName', type: 'string' }
      { name: 'AgentName', type: 'string' }
      { name: 'SkillName', type: 'string' }
      { name: 'SubAgentName', type: 'string' }
      { name: 'ParentAgentName', type: 'string' }
      { name: 'ModelActual', type: 'string' }
      { name: 'InputTokens', type: 'long' }
      { name: 'OutputTokens', type: 'long' }
      { name: 'DurationMs', type: 'long' }
      { name: 'EstimatedCostUsd', type: 'long' }
      { name: 'ContentCaptureSignal', type: 'boolean' }
      { name: 'PrivacyMode', type: 'string' }
      { name: 'Surface', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsToolCalls_CL'
    stream: 'Custom-AgentOpsToolCalls_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'SpanId', type: 'string' }
      { name: 'ToolName', type: 'string' }
      { name: 'ToolType', type: 'string' }
      { name: 'ToolRisk', type: 'string' }
      { name: 'Status', type: 'string' }
      { name: 'Allowed', type: 'boolean' }
      { name: 'DeniedReason', type: 'string' }
      { name: 'DurationMs', type: 'long' }
      { name: 'OutputSizeBytes', type: 'long' }
      { name: 'ArgsSchemaHash', type: 'string' }
      { name: 'AgentName', type: 'string' }
      { name: 'Surface', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsMcpCalls_CL'
    stream: 'Custom-AgentOpsMcpCalls_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'SpanId', type: 'string' }
      { name: 'McpServerName', type: 'string' }
      { name: 'McpServerHash', type: 'string' }
      { name: 'McpClientName', type: 'string' }
      { name: 'McpSessionId', type: 'string' }
      { name: 'McpTransport', type: 'string' }
      { name: 'ToolName', type: 'string' }
      { name: 'ToolRisk', type: 'string' }
      { name: 'Status', type: 'string' }
      { name: 'Allowed', type: 'boolean' }
      { name: 'Sandboxed', type: 'boolean' }
      { name: 'DurationMs', type: 'long' }
      { name: 'ResultSizeBytes', type: 'long' }
      { name: 'ArgsSchemaHash', type: 'string' }
      { name: 'AgentName', type: 'string' }
      { name: 'Surface', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsPrivacy_CL'
    stream: 'Custom-AgentOpsPrivacy_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'ContentKind', type: 'string' }
      { name: 'Action', type: 'string' }
      { name: 'Observed', type: 'boolean' }
      { name: 'LeakDetected', type: 'boolean' }
      { name: 'DroppedCount', type: 'long' }
      { name: 'RedactedCount', type: 'long' }
      { name: 'PrivacyMode', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsEval_CL'
    stream: 'Custom-AgentOpsEval_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'RepoHash', type: 'string' }
      { name: 'TaskType', type: 'string' }
      { name: 'ModelActual', type: 'string' }
      { name: 'EvalOverall', type: 'long' }
      { name: 'EvalBucket', type: 'string' }
      { name: 'Reliability', type: 'long' }
      { name: 'Security', type: 'long' }
      { name: 'TestDiscipline', type: 'long' }
      { name: 'ToolEfficiency', type: 'long' }
      { name: 'ContextEfficiency', type: 'long' }
      { name: 'CodeOutcome', type: 'long' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsGithubOutcomes_CL'
    stream: 'Custom-AgentOpsGithubOutcomes_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RunId', type: 'string' }
      { name: 'RepoHash', type: 'string' }
      { name: 'BranchHash', type: 'string' }
      { name: 'PrNumberHash', type: 'string' }
      { name: 'PrOpened', type: 'boolean' }
      { name: 'PrClosed', type: 'boolean' }
      { name: 'PrMerged', type: 'boolean' }
      { name: 'PrReverted', type: 'boolean' }
      { name: 'CiStatus', type: 'string' }
      { name: 'CommitCount', type: 'long' }
      { name: 'FilesChangedCount', type: 'long' }
      { name: 'ReviewCommentCount', type: 'long' }
      { name: 'RunStartedAt', type: 'datetime' }
      { name: 'PrCreatedAt', type: 'datetime' }
      { name: 'PrMergedAt', type: 'datetime' }
      { name: 'TimeToPrMinutes', type: 'long' }
      { name: 'TimeToMergeMinutes', type: 'long' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsInsights_CL'
    stream: 'Custom-AgentOpsInsights_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'InsightId', type: 'string' }
      { name: 'InsightType', type: 'string' }
      { name: 'Severity', type: 'string' }
      { name: 'RunId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'Title', type: 'string' }
      { name: 'Summary', type: 'string' }
      { name: 'SuggestedNextStep', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsRecommendations_CL'
    stream: 'Custom-AgentOpsRecommendations_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'RecommendationId', type: 'string' }
      { name: 'Action', type: 'string' }
      { name: 'Severity', type: 'string' }
      { name: 'ObservedPattern', type: 'string' }
      { name: 'NextAction', type: 'string' }
      { name: 'RunId', type: 'string' }
      { name: 'SessionId', type: 'string' }
      { name: 'TraceId', type: 'string' }
      { name: 'EvalOverall', type: 'long' }
      { name: 'EvalBucket', type: 'string' }
      { name: 'DashboardCount', type: 'long' }
      { name: 'DashboardTitles', type: 'dynamic' }
      { name: 'ChangeTargetRefs', type: 'dynamic' }
      { name: 'Validation', type: 'dynamic' }
      { name: 'ExpectedMetricMovement', type: 'dynamic' }
      { name: 'BeforeTelemetry', type: 'dynamic' }
      { name: 'AfterTelemetry', type: 'dynamic' }
      { name: 'ObservedMetricMovement', type: 'dynamic' }
      { name: 'BenchmarkArtifactFiles', type: 'dynamic' }
      { name: 'BenchmarkArtifactContentDiffs', type: 'dynamic' }
      { name: 'BenchmarkSemanticChecks', type: 'dynamic' }
      { name: 'BenchmarkHiddenCheckPacks', type: 'dynamic' }
      { name: 'BenchmarkPermissionProfiles', type: 'dynamic' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
  {
    name: 'AgentOpsCollectorHealth_CL'
    stream: 'Custom-AgentOpsCollectorHealth_CL'
    columns: [
      { name: 'TimeGenerated', type: 'datetime' }
      { name: 'Component', type: 'string' }
      { name: 'Status', type: 'string' }
      { name: 'CheckName', type: 'string' }
      { name: 'Detail', type: 'string' }
      { name: 'CollectorMode', type: 'string' }
      { name: 'PrivacyMode', type: 'string' }
      { name: 'OtlpEndpoint', type: 'string' }
      { name: 'AzureConfigured', type: 'boolean' }
      { name: 'GrafanaConfigured', type: 'boolean' }
      { name: 'PrivacyPoisonOk', type: 'boolean' }
      { name: 'DroppedContentCount', type: 'long' }
      { name: 'ExportErrors', type: 'long' }
      { name: 'ExportFailureReason', type: 'string' }
      { name: 'ExportFailureAction', type: 'string' }
      { name: 'LastExportSuccess', type: 'datetime' }
      { name: 'LastSpanReceived', type: 'datetime' }
      { name: 'DashboardVersion', type: 'string' }
      { name: 'SchemaVersion', type: 'string' }
    ]
  }
]

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource tables 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = [for table in v2Tables: {
  parent: workspace
  name: table.name
  properties: {
    plan: tablePlan
    retentionInDays: effectiveRetentionInDays
    totalRetentionInDays: effectiveRetentionInDays
    schema: {
      name: table.name
      columns: table.columns
    }
  }
}]

resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' = {
  name: 'dce-${baseName}-${environmentName}'
  location: location
  tags: tags
  properties: {
    networkAcls: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource rule 'Microsoft.Insights/dataCollectionRules@2022-06-01' = {
  name: 'dcr-${baseName}-${environmentName}-v2'
  location: location
  tags: tags
  properties: {
    dataCollectionEndpointId: endpoint.id
    streamDeclarations: toObject(v2Tables, table => table.stream, table => {
      columns: table.columns
    })
    destinations: {
      logAnalytics: [
        {
          name: destinationName
          workspaceResourceId: workspace.id
        }
      ]
    }
    dataFlows: [for table in v2Tables: {
      streams: [
        table.stream
      ]
      destinations: [
        destinationName
      ]
      outputStream: table.stream
    }]
  }
  dependsOn: [
    tables
  ]
}

output dataCollectionEndpointName string = endpoint.name
output dataCollectionEndpointResourceId string = endpoint.id
output logsIngestionEndpoint string = endpoint.properties.logsIngestion.endpoint
output dataCollectionRuleName string = rule.name
output dataCollectionRuleResourceId string = rule.id
output dataCollectionRuleImmutableId string = rule.properties.immutableId
output tableCount int = length(v2Tables)
output streams array = [for table in v2Tables: table.stream]
