targetScope = 'resourceGroup'

@description('Deployment environment name.')
param environmentName string = 'dev'

@description('Azure region for AgentOps resources.')
param location string = resourceGroup().location

@description('Base resource name used for generated Azure resource names.')
param baseName string = 'copilot-agentops'

@allowed([
  'dev'
  'team'
  'enterprise'
])
@description('Security and cost posture preset. dev and team stay cost-capped; enterprise increases retention but keeps ingestion capped unless explicitly overridden.')
param deploymentProfile string = 'team'

@description('Log Analytics retention in days. Use 0 to accept the deployment profile default.')
@minValue(0)
@maxValue(730)
param logRetentionDays int = 0

@description('Log Analytics daily ingestion cap in GB. Use 0 to accept the deployment profile default. Use -1 only when an external budget controls ingestion.')
@minValue(-1)
@maxValue(100)
param dailyIngestionCapGb int = 0

@description('Deploy the placeholder Azure Function actioner. Disabled by default for v0.1 validation because it is not required for the core telemetry loop.')
param deployActioner bool = false

@description('Deploy disabled proposal-only Azure Monitor scheduled query alert rules for AgentOps telemetry. Rules are disabled by default until thresholds are tuned.')
param deployAlerts bool = false

@description('Enable AgentOps Azure Monitor scheduled query alert rules. Only used when deployAlerts is true.')
param enableAlerts bool = false

@description('Assign least-privilege Azure RBAC to Microsoft Entra security groups. Requires Owner or User Access Administrator at the resource group scope.')
param deployRbacAssignments bool = false

@description('Microsoft Entra security group object IDs for read-only AgentOps observers.')
param observerPrincipalIds array = []

@description('Microsoft Entra security group object IDs for AgentOps operators who maintain dashboards and monitor health.')
param operatorPrincipalIds array = []

@description('Microsoft Entra security group object IDs for break-glass AgentOps admins. Keep this empty for most pilots.')
param adminPrincipalIds array = []

@description('Deploy a resource-group monthly Azure Consumption budget for the AgentOps pilot.')
param deployBudget bool = false

@description('Monthly budget amount in the billing currency for the subscription.')
@minValue(1)
param monthlyBudgetAmount int = 100

@description('Email addresses for budget notifications. Use a team-owned distribution list.')
param budgetContactEmails array = []

@description('Budget start date in ISO 8601 UTC format.')
param budgetStartDate string = utcNow('yyyy-MM-ddTHH:mm:ssZ')

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  managedBy: 'azd-bicep'
  deploymentProfile: deploymentProfile
  telemetryContent: 'metadata-only'
}
var compactBaseName = replace(baseName, '-', '')
var defaultLogRetentionDays = deploymentProfile == 'enterprise' ? 90 : 30
var effectiveLogRetentionDays = logRetentionDays == 0 ? defaultLogRetentionDays : logRetentionDays
var defaultDailyIngestionCapGb = deploymentProfile == 'enterprise' ? 5 : deploymentProfile == 'team' ? 2 : 1
var effectiveDailyIngestionCapGb = dailyIngestionCapGb == 0 ? defaultDailyIngestionCapGb : dailyIngestionCapGb
var effectiveDeployBudget = deployBudget && !empty(budgetContactEmails)
var costTags = union(tags, {
  costControl: effectiveDailyIngestionCapGb == -1 ? 'uncapped' : 'daily-cap-${effectiveDailyIngestionCapGb}gb'
})

module logAnalytics 'log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    location: location
    name: 'law-${baseName}-${environmentName}'
    tags: costTags
    retentionInDays: effectiveLogRetentionDays
    dailyQuotaGb: effectiveDailyIngestionCapGb
  }
}

module appInsights 'app-insights.bicep' = {
  name: 'app-insights'
  params: {
    location: location
    name: 'appi-${baseName}-${environmentName}'
    workspaceResourceId: logAnalytics.outputs.resourceId
    tags: costTags
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

module rbac 'rbac.bicep' = if (deployRbacAssignments) {
  name: 'enterprise-rbac'
  params: {
    logAnalyticsWorkspaceName: logAnalytics.outputs.name
    grafanaName: grafana.outputs.name
    observerPrincipalIds: observerPrincipalIds
    operatorPrincipalIds: operatorPrincipalIds
    adminPrincipalIds: adminPrincipalIds
  }
}

module budget 'budget.bicep' = if (effectiveDeployBudget) {
  name: 'pilot-budget'
  params: {
    name: 'budget-${baseName}-${environmentName}'
    amount: monthlyBudgetAmount
    contactEmails: budgetContactEmails
    startDate: budgetStartDate
  }
}

output APPLICATIONINSIGHTS_NAME string = appInsights.outputs.name
output APPLICATIONINSIGHTS_RESOURCE_ID string = appInsights.outputs.resourceId
output BUDGET_DEPLOYED bool = effectiveDeployBudget
output DEPLOYMENT_PROFILE string = deploymentProfile
output LOG_ANALYTICS_RETENTION_DAYS int = logAnalytics.outputs.retentionInDays
output LOG_ANALYTICS_DAILY_QUOTA_GB int = logAnalytics.outputs.dailyQuotaGb
output RBAC_ASSIGNMENTS_ENABLED bool = deployRbacAssignments
output LOG_ANALYTICS_WORKSPACE_ID string = logAnalytics.outputs.customerId
output LOG_ANALYTICS_WORKSPACE_NAME string = logAnalytics.outputs.name
output AZURE_MONITOR_WORKSPACE_ID string = monitorWorkspace.outputs.resourceId
output GRAFANA_ENDPOINT string = grafana.outputs.endpoint
output GRAFANA_RESOURCE_ID string = grafana.outputs.resourceId
output GRAFANA_NAME string = grafana.outputs.name
output KEY_VAULT_RESOURCE_ID string = keyVault.outputs.resourceId
