param location string
param appName string
param storageName string
param appInsightsConnectionString string
param tags object

@description('Optional shared storage blob service URI for metadata-only saved-view/recommendation writes.')
param sharedStoreBlobServiceUri string = ''

@description('Shared storage container for metadata-only saved-view/recommendation writes.')
param sharedStoreContainerName string = 'agentops-shared'

@description('Blob prefix for metadata-only hosted saved-view/recommendation writes.')
param sharedStorePrefix string = 'agentops-shared'

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'AGENTOPS_SHARED_STORE_CONTAINER'
          value: sharedStoreContainerName
        }
        {
          name: 'AGENTOPS_SHARED_STORE_PREFIX'
          value: sharedStorePrefix
        }
        {
          name: 'AgentOpsSharedStorage__blobServiceUri'
          value: sharedStoreBlobServiceUri
        }
      ]
    }
  }
}

output name string = functionApp.name
output resourceId string = functionApp.id
output defaultHostName string = functionApp.properties.defaultHostName
output principalId string = functionApp.identity.principalId
