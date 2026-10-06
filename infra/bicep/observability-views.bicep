targetScope = 'resourceGroup'

@description('Existing Log Analytics workspace to connect to AgentOps views. This template never modifies the workspace.')
param workspaceName string

@description('Azure region for the Application Insights component and optional Managed Grafana.')
param location string = resourceGroup().location

@description('Environment suffix used for resource names and tags.')
param environmentName string = 'eval930'

@description('Base name used for the Application Insights and Managed Grafana resource names.')
param baseName string = 'copilot-agentops-eval'

@description('Deploy Azure Managed Grafana Standard. This is an explicitly selected, chargeable service.')
param deployGrafana bool = false

@allowed([
  'Enabled'
  'Disabled'
])
@description('Public access for synthetic EVAL Grafana. Enterprise deployment needs reviewed private connectivity before disabling this endpoint.')
param grafanaPublicNetworkAccess string = 'Enabled'

@allowed([
  'Enabled'
  'Disabled'
])
@description('Zone redundancy for Managed Grafana. Confirm regional/SKU support before enabling.')
param grafanaZoneRedundancy string = 'Disabled'

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  managedBy: 'agentops-bicep'
  telemetryContent: 'metadata-only'
}
var compactBaseName = replace(baseName, '-', '')
var grafanaName = take('graf-${compactBaseName}-${environmentName}', 23)

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${baseName}-${environmentName}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource grafana 'Microsoft.Dashboard/grafana@2023-09-01' = if (deployGrafana) {
  name: grafanaName
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
    publicNetworkAccess: grafanaPublicNetworkAccess
    zoneRedundancy: grafanaZoneRedundancy
  }
}

output APPLICATIONINSIGHTS_NAME string = appInsights.name
output APPLICATIONINSIGHTS_RESOURCE_ID string = appInsights.id
output GRAFANA_DEPLOYED bool = deployGrafana
output GRAFANA_NAME string = deployGrafana ? grafana!.name : ''
output GRAFANA_RESOURCE_ID string = deployGrafana ? grafana!.id : ''
output GRAFANA_PUBLIC_NETWORK_ACCESS string = deployGrafana ? grafanaPublicNetworkAccess : ''
