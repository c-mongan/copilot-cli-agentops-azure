targetScope = 'resourceGroup'

@description('Region for the isolated synthetic EVAL content workspace.')
param location string = resourceGroup().location

@description('Name suffix that prevents collision with existing AgentOps resources.')
param environmentName string = 'dev'

@description('Table-level retention for synthetic EVAL content. The workspace default remains at the SKU minimum of 30 days.')
@minValue(4)
@maxValue(30)
param retentionInDays int = 7

@description('Log Analytics daily ingestion cap in GB. A hard cap is required for this development workspace.')
@minValue(1)
@maxValue(5)
param dailyQuotaGb int = 1

@description('Microsoft Entra object ID allowed to send synthetic content to the content DCR.')
param ingestionPrincipalId string = ''

@description('Microsoft Entra principal type for the telemetry sender.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param ingestionPrincipalType string = 'User'

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  telemetryContent: 'synthetic-eval'
  managedBy: 'bicep'
}
var columns = [
  { name: 'TimeGenerated', type: 'datetime' }
  { name: 'RunId', type: 'string' }
  { name: 'SessionId', type: 'string' }
  { name: 'TraceId', type: 'string' }
  { name: 'SpanId', type: 'string' }
  { name: 'TurnIndex', type: 'long' }
  { name: 'Role', type: 'string' }
  { name: 'ContentKind', type: 'string' }
  { name: 'CaptureMode', type: 'string' }
  { name: 'PromptText', type: 'string' }
  { name: 'ResponseText', type: 'string' }
  { name: 'ToolName', type: 'string' }
  { name: 'ToolCallId', type: 'string' }
  { name: 'ModelActual', type: 'string' }
  { name: 'RedactionStatus', type: 'string' }
  { name: 'ContentHash', type: 'string' }
  { name: 'ContentLength', type: 'long' }
  { name: 'SchemaVersion', type: 'string' }
]

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-copilot-agentops-eval-${environmentName}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: dailyQuotaGb }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource contentTable 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = {
  parent: workspace
  name: 'AgentOpsContent_CL'
  properties: {
    plan: 'Analytics'
    retentionInDays: retentionInDays
    totalRetentionInDays: retentionInDays
    schema: {
      name: 'AgentOpsContent_CL'
      columns: columns
    }
  }
}

resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' = {
  name: 'dce-copilot-agentops-eval-${environmentName}'
  location: location
  tags: tags
  properties: {
    networkAcls: { publicNetworkAccess: 'Enabled' }
  }
}

resource rule 'Microsoft.Insights/dataCollectionRules@2022-06-01' = {
  name: 'dcr-copilot-agentops-eval-${environmentName}'
  location: location
  tags: tags
  properties: {
    dataCollectionEndpointId: endpoint.id
    streamDeclarations: {
      'Custom-AgentOpsContent_CL': { columns: columns }
    }
    destinations: {
      logAnalytics: [
        { name: 'eval-content', workspaceResourceId: workspace.id }
      ]
    }
    dataFlows: [
      {
        streams: ['Custom-AgentOpsContent_CL']
        destinations: ['eval-content']
        transformKql: 'source'
        outputStream: 'Custom-AgentOpsContent_CL'
      }
    ]
  }
  dependsOn: [contentTable]
}

var metricsPublisherRoleDefinitionId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource contentDcrSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (ingestionPrincipalId != '') {
  name: guid(rule.id, ingestionPrincipalId, metricsPublisherRoleDefinitionId)
  scope: rule
  properties: {
    principalId: ingestionPrincipalId
    principalType: ingestionPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', metricsPublisherRoleDefinitionId)
  }
}

output workspaceResourceId string = workspace.id
output workspaceCustomerId string = workspace.properties.customerId
output dataCollectionRuleResourceId string = rule.id
output dataCollectionRuleImmutableId string = rule.properties.immutableId
output logsIngestionEndpoint string = endpoint.properties.logsIngestion.endpoint
