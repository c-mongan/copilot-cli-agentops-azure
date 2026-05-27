param location string
param name string
param workspaceResourceId string
param tags object

resource component 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceResourceId
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output name string = component.name
output resourceId string = component.id
output connectionString string = component.properties.ConnectionString
output instrumentationKey string = component.properties.InstrumentationKey
