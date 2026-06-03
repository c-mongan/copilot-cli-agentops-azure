param location string
param storageName string
param tags object

@description('Azure Blob container for metadata-only AgentOps recommendation and saved-view artifacts.')
param containerName string = 'agentops-shared'

@allowed([
  'Enabled'
  'Disabled'
])
@description('Public network access for the storage account. Disable only after private access has been designed and tested.')
param publicNetworkAccess string = 'Enabled'

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  tags: union(tags, {
    agentopsData: 'metadata-only'
  })
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: publicNetworkAccess
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource sharedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

output name string = storage.name
output resourceId string = storage.id
output containerName string = sharedContainer.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
