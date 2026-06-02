param location string
param name string
@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'
@allowed([
  'Enabled'
  'Disabled'
])
param zoneRedundancy string = 'Disabled'
param tags object

resource grafana 'Microsoft.Dashboard/grafana@2023-09-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    apiKey: 'Disabled'
    deterministicOutboundIP: 'Disabled'
    publicNetworkAccess: publicNetworkAccess
    zoneRedundancy: zoneRedundancy
  }
}

output name string = grafana.name
output resourceId string = grafana.id
output endpoint string = grafana.properties.endpoint
output grafanaName string = grafana.name
output publicNetworkAccess string = publicNetworkAccess
output zoneRedundancy string = zoneRedundancy
