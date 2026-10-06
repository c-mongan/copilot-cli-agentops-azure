targetScope = 'resourceGroup'

@description('Existing isolated EVAL workspace name. AgentOpsSpans_CL must already exist with the additive schema applied.')
param workspaceName string = 'law-copilot-agentops-eval-dev'

@description('Existing isolated EVAL Data Collection Endpoint name.')
param endpointName string = 'dce-copilot-agentops-eval-dev'

@description('Base resource name used for the dedicated spans DCR.')
param baseName string = 'copilot-agentops'

@description('Environment label applied to the DCR.')
param environmentName string = 'dev'

@description('Azure region for the new DCR.')
param location string = 'northeurope'

var spanColumns = [
  { name: 'TimeGenerated', type: 'datetime' }
  { name: 'RunId', type: 'string' }
  { name: 'SessionId', type: 'string' }
  { name: 'TraceId', type: 'string' }
  { name: 'SpanId', type: 'string' }
  { name: 'ParentSpanId', type: 'string' }
  { name: 'SpanName', type: 'string' }
  { name: 'OperationName', type: 'string' }
  { name: 'AgentName', type: 'string' }
  { name: 'ToolName', type: 'string' }
  { name: 'ToolCallId', type: 'string' }
  { name: 'ScriptName', type: 'string' }
  { name: 'ScriptRuntimeName', type: 'string' }
  { name: 'ScriptRuntimeVersion', type: 'string' }
  { name: 'ScriptRuntimeImplementation', type: 'string' }
  { name: 'ScriptLoaderName', type: 'string' }
  { name: 'StepName', type: 'string' }
  { name: 'EventName', type: 'string' }
  { name: 'SkillName', type: 'string' }
  { name: 'LinkType', type: 'string' }
  { name: 'Outcome', type: 'string' }
  { name: 'ErrorType', type: 'string' }
  { name: 'DurationMs', type: 'long' }
  { name: 'DurationNs', type: 'long' }
  { name: 'Model', type: 'string' }
  { name: 'ModelRequested', type: 'string' }
  { name: 'ModelActual', type: 'string' }
  { name: 'Provider', type: 'string' }
  { name: 'InputTokens', type: 'long' }
  { name: 'OutputTokens', type: 'long' }
  { name: 'CacheReadTokens', type: 'long' }
  { name: 'CacheWriteTokens', type: 'long' }
  { name: 'SchemaVersion', type: 'string' }
  { name: 'ParentToolCallId', type: 'string' }
  { name: 'McpServerName', type: 'string' }
  { name: 'McpToolName', type: 'string' }
]

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  telemetryContent: 'synthetic-eval'
  managedBy: 'bicep'
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' existing = {
  name: endpointName
}

resource spansRule 'Microsoft.Insights/dataCollectionRules@2022-06-01' = {
  name: 'dcr-${baseName}-${environmentName}-spans'
  location: location
  tags: tags
  properties: {
    dataCollectionEndpointId: endpoint.id
    streamDeclarations: {
      'Custom-AgentOpsSpans_CL': { columns: spanColumns }
    }
    destinations: {
      logAnalytics: [
        { name: 'agentops-eval-spans', workspaceResourceId: workspace.id }
      ]
    }
    dataFlows: [
      {
        streams: ['Custom-AgentOpsSpans_CL']
        destinations: ['agentops-eval-spans']
        transformKql: 'source | project TimeGenerated, RunId, SessionId, TraceId, SpanId, ParentSpanId, SpanName, OperationName, AgentName, ToolName, ToolCallId, ScriptName, ScriptRuntimeName=tostring(ScriptRuntimeName), ScriptRuntimeVersion=tostring(ScriptRuntimeVersion), ScriptRuntimeImplementation=tostring(ScriptRuntimeImplementation), ScriptLoaderName=tostring(ScriptLoaderName), StepName, EventName, SkillName, LinkType, Outcome, ErrorType, DurationMs, DurationNs, Model, ModelRequested, ModelActual, Provider, InputTokens, OutputTokens, CacheReadTokens, CacheWriteTokens, SchemaVersion, ParentToolCallId, McpServerName, McpToolName'
        outputStream: 'Custom-AgentOpsSpans_CL'
      }
    ]
  }
}

output workspaceResourceId string = workspace.id
output dataCollectionEndpointResourceId string = endpoint.id
output dataCollectionRuleResourceId string = spansRule.id
output dataCollectionRuleImmutableId string = spansRule.properties.immutableId
output logsIngestionEndpoint string = endpoint.properties.logsIngestion.endpoint
