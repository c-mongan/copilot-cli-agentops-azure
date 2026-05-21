targetScope = 'resourceGroup'

@description('Deployment environment name.')
param environmentName string = 'dev'

@description('Azure region for AgentOps resources.')
param location string = resourceGroup().location

@description('Base resource name used for generated Azure resource names.')
param baseName string = 'copilot-agentops'

@description('Deploy the placeholder Azure Function actioner. Disabled by default for v0.1 validation because it is not required for the core telemetry loop.')
param deployActioner bool = false

@description('Deploy disabled proposal-only Azure Monitor scheduled query alert rules for AgentOps telemetry. Rules are disabled by default until thresholds are tuned.')
param deployAlerts bool = false

@description('Enable AgentOps Azure Monitor scheduled query alert rules. Only used when deployAlerts is true.')
param enableAlerts bool = false

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  managedBy: 'azd-bicep'
}
var compactBaseName = replace(baseName, '-', '')

module logAnalytics 'log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    location: location
    name: 'law-${baseName}-${environmentName}'
    tags: tags
  }
}

module appInsights 'app-insights.bicep' = {
  name: 'app-insights'
  params: {
    location: location
    name: 'appi-${baseName}-${environmentName}'
    workspaceResourceId: logAnalytics.outputs.resourceId
    tags: tags
  }
}

module monitorWorkspace 'azure-monitor-workspace.bicep' = {
  name: 'azure-monitor-workspace'
  params: {
    location: location
    name: 'amw-${baseName}-${environmentName}'
    tags: tags
  }
}

module grafana 'grafana.bicep' = {
  name: 'grafana'
  params: {
    location: location
    name: take('graf-${compactBaseName}-${environmentName}', 23)
    tags: tags
  }
}

module keyVault 'key-vault.bicep' = {
  name: 'key-vault'
  params: {
    location: location
    name: take('kv-${replace(baseName, '-', '')}-${environmentName}-${uniqueString(resourceGroup().id)}', 24)
    tags: tags
  }
}

module actioner 'actioner-function.bicep' = if (deployActioner) {
  name: 'actioner-function'
  params: {
    location: location
    appName: take('func-${baseName}-actioner-${environmentName}', 60)
    storageName: take('stagentops${environmentName}${uniqueString(resourceGroup().id)}', 24)
    appInsightsConnectionString: appInsights.outputs.connectionString
    tags: tags
  }
}

module alerts 'alerts.bicep' = if (deployAlerts) {
  name: 'agentops-alerts'
  params: {
    location: location
    baseName: baseName
    environmentName: environmentName
    logAnalyticsWorkspaceResourceId: logAnalytics.outputs.resourceId
    enabled: enableAlerts
    tags: union(tags, {
      mode: 'proposal-only'
    })
  }
}

output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.outputs.connectionString
output APPLICATIONINSIGHTS_RESOURCE_ID string = appInsights.outputs.resourceId
output LOG_ANALYTICS_WORKSPACE_ID string = logAnalytics.outputs.customerId
output LOG_ANALYTICS_WORKSPACE_NAME string = logAnalytics.outputs.name
output AZURE_MONITOR_WORKSPACE_ID string = monitorWorkspace.outputs.resourceId
output GRAFANA_ENDPOINT string = grafana.outputs.endpoint
output GRAFANA_RESOURCE_ID string = grafana.outputs.resourceId
output GRAFANA_NAME string = grafana.outputs.name
output KEY_VAULT_RESOURCE_ID string = keyVault.outputs.resourceId
