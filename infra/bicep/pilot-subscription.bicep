targetScope = 'subscription'

@description('New or AgentOps-owned EVAL resource group. Existing unowned groups are refused by the CLI before deployment.')
param resourceGroupName string

@description('Azure region for the isolated synthetic pilot.')
param location string = 'northeurope'

@description('Short environment suffix used in globally scoped resource names.')
@minLength(2)
@maxLength(12)
param environmentName string = 'pilot'

@description('Table retention for the synthetic pilot.')
@minValue(4)
@maxValue(30)
param retentionInDays int = 7

@description('Hard daily ingestion cap in GB for the synthetic pilot workspace.')
@minValue(1)
@maxValue(1)
param dailyQuotaGb int = 1

@description('Microsoft Entra object ID allowed to send telemetry to the two pilot DCRs.')
param ingestionPrincipalId string

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
  managedBy: 'agentops-cli'
  deploymentProfile: 'pilot'
}

resource pilotResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module content './eval-content.bicep' = {
  name: 'agentops-pilot-content-${environmentName}'
  scope: pilotResourceGroup
  params: {
    location: location
    environmentName: environmentName
    retentionInDays: retentionInDays
    dailyQuotaGb: dailyQuotaGb
    ingestionPrincipalId: ingestionPrincipalId
    ingestionPrincipalType: ingestionPrincipalType
  }
}

var applicationInsightsTags = union(tags, {
  managedBy: 'agentops-bicep'
  telemetryContent: 'metadata-only'
})

module appInsights './app-insights.bicep' = {
  name: 'agentops-pilot-app-insights-${environmentName}'
  scope: pilotResourceGroup
  params: {
    location: location
    name: 'appi-copilot-agentops-eval-${environmentName}'
    workspaceResourceId: content.outputs.workspaceResourceId
    tags: applicationInsightsTags
  }
}

module metadata './v2-ingestion.bicep' = {
  name: 'agentops-pilot-metadata-${environmentName}'
  scope: pilotResourceGroup
  params: {
    location: location
    workspaceName: 'law-copilot-agentops-eval-${environmentName}'
    baseName: 'copilot-agentops'
    environmentName: environmentName
    retentionInDays: retentionInDays
    tags: tags
    ingestionPrincipalId: ingestionPrincipalId
    ingestionPrincipalType: ingestionPrincipalType
  }
  dependsOn: [content]
}

output resourceGroupName string = pilotResourceGroup.name
output workspaceResourceId string = content.outputs.workspaceResourceId
output workspaceCustomerId string = content.outputs.workspaceCustomerId
output APPLICATIONINSIGHTS_NAME string = appInsights.outputs.name
output APPLICATIONINSIGHTS_RESOURCE_ID string = appInsights.outputs.resourceId
output contentDataCollectionRuleResourceId string = content.outputs.dataCollectionRuleResourceId
output contentDataCollectionRuleImmutableId string = content.outputs.dataCollectionRuleImmutableId
output contentLogsIngestionEndpoint string = content.outputs.logsIngestionEndpoint
output metadataDataCollectionEndpointResourceId string = metadata.outputs.dataCollectionEndpointResourceId
output metadataDataCollectionRuleResourceId string = metadata.outputs.dataCollectionRuleResourceId
output metadataDataCollectionRuleImmutableId string = metadata.outputs.dataCollectionRuleImmutableId
output metadataLogsIngestionEndpoint string = metadata.outputs.logsIngestionEndpoint
output metadataTableCount int = metadata.outputs.tableCount
output ingestionPrincipalId string = ingestionPrincipalId
output ingestionPrincipalType string = ingestionPrincipalType
