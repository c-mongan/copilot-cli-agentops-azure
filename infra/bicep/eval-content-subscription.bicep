targetScope = 'subscription'

@description('North Europe by default, matching the existing development Application Insights.')
param location string = 'northeurope'

@description('Isolated synthetic EVAL environment suffix.')
param environmentName string = 'dev'

resource evalResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-copilot-agentops-eval-${environmentName}'
  location: location
  tags: {
    app: 'copilot-cli-agentops-azure'
    environment: environmentName
    telemetryContent: 'synthetic-eval'
    managedBy: 'bicep'
  }
}

module evalContent './eval-content.bicep' = {
  name: 'agentops-eval-content-${environmentName}'
  scope: evalResourceGroup
  params: {
    location: location
    environmentName: environmentName
  }
}

output resourceGroupName string = evalResourceGroup.name
output workspaceResourceId string = evalContent.outputs.workspaceResourceId
output workspaceCustomerId string = evalContent.outputs.workspaceCustomerId
output dataCollectionRuleResourceId string = evalContent.outputs.dataCollectionRuleResourceId
output dataCollectionRuleImmutableId string = evalContent.outputs.dataCollectionRuleImmutableId
output logsIngestionEndpoint string = evalContent.outputs.logsIngestionEndpoint
