targetScope = 'resourceGroup'

@description('Existing metadata DCR name.')
param dataCollectionRuleName string

@description('Location read from the existing metadata DCR.')
param location string

@description('Tags read from the existing AgentOps metadata DCR.')
param tags object

@description('Existing DCR endpoint resource ID.')
param dataCollectionEndpointId string

@description('Existing DCR destinations, preserved verbatim.')
param destinations object

@description('Existing DCR stream declarations, with only the script span stream extended.')
param currentStreamDeclarations object

@description('Existing DCR data flows, with only the script span projection extended.')
param currentDataFlows array

@description('Existing Log Analytics workspace name.')
param workspaceName string

@description('Existing AgentOpsSpans_CL table plan.')
@allowed(['Analytics', 'Basic'])
param tablePlan string

@description('Existing AgentOpsSpans_CL table retention.')
param retentionInDays int

@description('Existing AgentOpsSpans_CL total retention.')
param totalRetentionInDays int

@description('Existing AgentOpsSpans_CL columns, preserved verbatim.')
param currentTableColumns array

@description('Existing AgentOpsSpans_CL schema metadata, preserved verbatim.')
param currentTableSchema object

var spansStream = 'Custom-AgentOpsSpans_CL'
var runtimeColumns = [
  { name: 'ScriptRuntimeName', type: 'string' }
  { name: 'ScriptRuntimeVersion', type: 'string' }
  { name: 'ScriptRuntimeImplementation', type: 'string' }
  { name: 'ScriptLoaderName', type: 'string' }
]
var runtimeColumnNames = [for column in runtimeColumns: column.name]
var spansTransformKql = 'source | project TimeGenerated, RunId, SessionId, TraceId, SpanId, ParentSpanId, SpanName, OperationName, AgentName, ToolName, ToolCallId, ToolCallEvidence, ScriptName, ScriptRuntimeName=tostring(ScriptRuntimeName), ScriptRuntimeVersion=tostring(ScriptRuntimeVersion), ScriptRuntimeImplementation=tostring(ScriptRuntimeImplementation), ScriptLoaderName=tostring(ScriptLoaderName), StepName, EventName, SkillName, LinkType, Outcome, ErrorType, DurationMs, DurationNs, Model, InputTokens, OutputTokens, SchemaVersion, ParentToolCallId, McpServerName, McpToolName'

var additiveDcrColumns = concat(
  filter(currentStreamDeclarations[spansStream].columns, column => !contains(runtimeColumnNames, column.name)),
  runtimeColumns
)
var additiveTableColumns = concat(
  filter(currentTableColumns, column => !contains(runtimeColumnNames, column.name)),
  runtimeColumns
)
var updatedTableSchema = {
  name: currentTableSchema.name
  columns: additiveTableColumns
  // Match the existing ingestion template so Azure preserves its table troubleshooting setting.
  #disable-next-line BCP037
  isTroubleshootingAllowed: true
}
var updatedFlows = [for flow in currentDataFlows: contains(flow.streams, spansStream)
  ? union(flow, { transformKql: spansTransformKql })
  : flow]

resource metadataDcr 'Microsoft.Insights/dataCollectionRules@2022-06-01' = {
  name: dataCollectionRuleName
  location: location
  tags: tags
  properties: {
    dataCollectionEndpointId: dataCollectionEndpointId
    destinations: destinations
    streamDeclarations: union(currentStreamDeclarations, {
      'Custom-AgentOpsSpans_CL': union(currentStreamDeclarations[spansStream], { columns: additiveDcrColumns })
    })
    dataFlows: updatedFlows
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource spansTable 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = {
  parent: workspace
  name: 'AgentOpsSpans_CL'
  properties: {
    plan: tablePlan
    retentionInDays: retentionInDays
    totalRetentionInDays: totalRetentionInDays
    schema: updatedTableSchema
  }
}

output dcrResourceId string = metadataDcr.id
output spansTableResourceId string = spansTable.id
output addedColumnNames array = runtimeColumnNames
