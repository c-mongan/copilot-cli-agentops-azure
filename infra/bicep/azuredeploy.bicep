// Deploy to Azure entry point. Compiled to ../azuredeploy.json for the README button:
//   az bicep build --file infra/bicep/azuredeploy.bicep --outfile infra/azuredeploy.json
// Deploys the metadata-only AgentOps ingestion path: Log Analytics, the AgentOps custom tables,
// a Data Collection Endpoint and Rule, the AgentOps Workbook and a small monthly budget.
targetScope = 'resourceGroup'

@description('Azure region. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Base name used for generated resource names.')
@minLength(3)
@maxLength(30)
param baseName string = 'copilot-agentops'

@description('Short environment name appended to resource names.')
@minLength(1)
@maxLength(10)
param environmentName string = 'dev'

@description('Log Analytics and custom-table retention in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Log Analytics daily ingestion cap in GB. Cost safeguard, not a precise spending limit; excess ingestion can still be billed.')
@minValue(1)
@maxValue(100)
param dailyIngestionCapGb int = 1

@description('Deploy the AgentOps Azure Workbook bound to the new workspace.')
param deployWorkbook bool = true

@description('Give the identity running this deployment permission to upload AgentOps metadata (Monitoring Metrics Publisher on the DCR). Needs Owner or User Access Administrator on the resource group.')
param grantDeployerUpload bool = false

@description('Allow public ingestion and workspace query access. Disabled by default; private access requires separately configured Azure Monitor Private Link.')
param allowPublicNetworkAccess bool = false

@description('Optional extra Microsoft Entra object ID (user, group or service principal) allowed to upload AgentOps metadata.')
param uploaderPrincipalId string = ''

@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
@description('Principal type of uploaderPrincipalId.')
param uploaderPrincipalType string = 'User'

@description('Deploy a monthly Azure Consumption budget scoped to this resource group.')
param deployBudget bool = true

@description('Monthly budget amount, in the billing currency of the subscription (for example EUR or USD).')
@minValue(1)
param monthlyBudgetAmount int = 5

@description('Email for budget alerts at 80% and 100% of actual spend. Leave blank to notify effective Owners at this resource-group scope instead. No action group is created.')
param budgetAlertEmail string = ''

@description('Budget start date, which must be the first day of a month (yyyy-MM-dd). Defaults to the current month. When redeploying in a later month, pass the original value: Azure does not allow changing a budget start date.')
param budgetStartDate string = utcNow('yyyy-MM-01')

var tags = {
  app: 'copilot-cli-agentops-azure'
  environment: environmentName
  managedBy: 'deploy-to-azure'
  telemetryContent: 'metadata-only'
  costControl: 'daily-cap-${dailyIngestionCapGb}gb'
}
var deployerObjectId = deployer().objectId
var metricsPublisherRoleDefinitionId = '3913510d-42f4-4e42-8a64-420c390055eb'

module logAnalytics 'log-analytics.bicep' = {
  name: 'agentops-log-analytics'
  params: {
    location: location
    name: 'law-${baseName}-${environmentName}'
    tags: tags
    retentionInDays: retentionInDays
    dailyQuotaGb: dailyIngestionCapGb
    allowPublicNetworkAccess: allowPublicNetworkAccess
  }
}

// Metadata tables only. Prompt/response content tables (eval-content.bicep) are not deployed.
module ingestion 'v2-ingestion.bicep' = {
  name: 'agentops-v2-ingestion'
  params: {
    location: location
    workspaceName: logAnalytics.outputs.name
    baseName: baseName
    environmentName: environmentName
    retentionInDays: retentionInDays
    tags: tags
    metadataOnly: true
    allowPublicNetworkAccess: allowPublicNetworkAccess
    ingestionPrincipalId: uploaderPrincipalId
    ingestionPrincipalType: uploaderPrincipalType
  }
}

resource dcr 'Microsoft.Insights/dataCollectionRules@2022-06-01' existing = {
  name: 'dcr-${baseName}-${environmentName}-v2'
}

resource deployerUpload 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (grantDeployerUpload && deployerObjectId != uploaderPrincipalId) {
  name: guid(resourceGroup().id, 'dcr-${baseName}-${environmentName}-v2', deployerObjectId, metricsPublisherRoleDefinitionId)
  scope: dcr
  properties: {
    principalId: deployerObjectId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', metricsPublisherRoleDefinitionId)
  }
  dependsOn: [
    ingestion
  ]
}

module workbook 'enterprise-workbook.bicep' = if (deployWorkbook) {
  name: 'agentops-workbook'
  params: {
    name: guid(resourceGroup().id, 'agentops-workbook', baseName, environmentName)
    displayName: 'Copilot CLI AgentOps (${environmentName})'
    location: location
    workspaceResourceId: logAnalytics.outputs.resourceId
    tags: tags
  }
}

module budget 'budget.bicep' = if (deployBudget) {
  name: 'agentops-budget'
  params: {
    name: 'budget-${baseName}-${environmentName}'
    amount: monthlyBudgetAmount
    contactEmails: empty(budgetAlertEmail) ? [] : [budgetAlertEmail]
    contactRoles: empty(budgetAlertEmail) ? ['Owner'] : []
    startDate: budgetStartDate
  }
}

output TELEMETRY_CONTENT string = 'metadata-only'
output LOG_ANALYTICS_WORKSPACE_NAME string = logAnalytics.outputs.name
output LOG_ANALYTICS_WORKSPACE_ID string = logAnalytics.outputs.customerId
output AGENTOPS_LOGS_INGESTION_ENDPOINT string = ingestion.outputs.logsIngestionEndpoint
output AGENTOPS_DCR_IMMUTABLE_ID string = ingestion.outputs.dataCollectionRuleImmutableId
output AGENTOPS_DCR_RESOURCE_ID string = ingestion.outputs.dataCollectionRuleResourceId
output AGENTOPS_TABLE_COUNT int = ingestion.outputs.tableCount
output WORKBOOK_DEPLOYED bool = deployWorkbook
output BUDGET_DEPLOYED bool = deployBudget
output UPLOAD_COMMAND string = 'agentops azure-ingest logs-upload --dir <run-directory> --events-only --endpoint ${ingestion.outputs.logsIngestionEndpoint} --dcr-immutable-id ${ingestion.outputs.dataCollectionRuleImmutableId} --max-publish-bytes-per-day 5000000 --yes'
output UPLOAD_SPANS_COMMAND string = 'agentops azure-ingest logs-upload --dir <run-directory> --spans-only --endpoint ${ingestion.outputs.logsIngestionEndpoint} --dcr-immutable-id ${ingestion.outputs.dataCollectionRuleImmutableId} --max-publish-bytes-per-day 5000000 --yes'
