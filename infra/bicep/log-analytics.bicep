param location string
param name string
param tags object

@description('Retention in days. main.bicep resolves profile defaults before passing this value.')
@minValue(0)
@maxValue(730)
param retentionInDays int = 30

@description('Daily ingestion cap in GB. Use -1 to disable the cap, but keep the default capped for cost safety.')
@minValue(-1)
@maxValue(100)
param dailyQuotaGb int = 1

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

output name string = workspace.name
output resourceId string = workspace.id
output customerId string = workspace.properties.customerId
output retentionInDays int = retentionInDays
output dailyQuotaGb int = dailyQuotaGb
