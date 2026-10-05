targetScope = 'resourceGroup'

@description('Exact existing metadata LAW name in the selected deployment resource group. No workspace writes occur.')
param workspaceName string
@description('Exact existing metadata-only DCR name in the selected resource group. Verify its destinations and streams before any publisher grant.')
param metadataDcrName string
@description('Exact existing DCE name in the selected resource group.')
param dataCollectionEndpointName string
@description('Exact existing Application Insights name; its workspace binding is read, never changed.')
param applicationInsightsName string
@description('Workbook region, matching the existing LAW/DCR/DCE region.')
param location string
param workbookDisplayName string = 'AgentOps Diagnostic Pilot'
param workbookName string = guid(resourceGroup().id, workspaceName, 'agentops-diagnostic-pilot')

type principal = {
  objectId: string
  principalType: 'Group' | 'ServicePrincipal' | 'User'
}
@description('Approved Workbook observers. Unknown principals stay omitted.')
param observers principal[] = []
@description('Approved Workbook editors. Workbook Contributor also permits deleting this Workbook.')
param editors principal[] = []
@description('Approved metadata-only DCR publishers. Does not grant content-DCR access.')
param publishers principal[] = []
@description('Approved metadata readers. Explicitly include query users. Workspace-scoped Data Reader is constrained by a mandatory fixed metadata-table condition.')
param metadataReaders principal[] = []

@description('Create a monthly RG budget only after currency, amount and start date are approved. A budget is an alert, not a spending limit.')
param deployBudget bool = false
@minValue(1)
param monthlyBudgetAmount int = 10
@description('Approved first day of month in UTC; required when deployBudget is true.')
param budgetStartDate string = ''
@description('Approved budget contact addresses. Empty means no notification; no contacts are inferred.')
param budgetContactEmails string[] = []
@description('Optional approved email-only action group. Empty recipients or false omit it.')
param deployActionGroup bool = false
param actionGroupContactEmails string[] = []
@description('Optional ingestion-health proposal. Always disabled until a separate fault/notification qualification approves enablement.')
param deployHealthRule bool = false

var tags = {
  app: 'copilot-cli-agentops-azure'
  managedBy: 'agentops-additive-bicep'
  telemetryContent: 'metadata-only'
  deploymentPurpose: 'synthetic-qualification'
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}
resource metadataDcr 'Microsoft.Insights/dataCollectionRules@2022-06-01' existing = {
  name: metadataDcrName
}
resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' existing = {
  name: dataCollectionEndpointName
}
resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}

module workbook 'enterprise-workbook.bicep' = {
  name: 'enterprise-workbook'
  params: {
    name: workbookName
    displayName: workbookDisplayName
    location: location
    workspaceResourceId: workspace.id
    tags: tags
  }
}
module workbookAccess 'enterprise-workbook-rbac.bicep' = {
  name: 'enterprise-workbook-access'
  params: {
    workbookName: workbookName
    observers: observers
    editors: editors
  }
  dependsOn: [workbook]
}
// Workspace scope supplies query/read; mandatory ABAC condition limits table data.
module tableAccess 'enterprise-table-rbac.bicep' = if (!empty(metadataReaders)) {
  name: 'enterprise-metadata-readers'
  params: {
    workspaceName: workspaceName
    principals: metadataReaders
  }
}
module publisherAccess 'enterprise-publisher-rbac.bicep' = if (!empty(publishers)) {
  name: 'enterprise-publisher-access'
  params: {
    metadataDcrName: metadataDcrName
    principals: publishers
  }
}
module budget 'enterprise-budget.bicep' = if (deployBudget) {
  name: 'enterprise-budget'
  params: {
    amount: monthlyBudgetAmount
    startDate: budgetStartDate
    contactEmails: budgetContactEmails
  }
}
module actionGroup 'enterprise-action-group.bicep' = if (deployActionGroup && !empty(actionGroupContactEmails)) {
  name: 'enterprise-action-group'
  params: {
    contactEmails: actionGroupContactEmails
    tags: tags
  }
}
module healthRule 'enterprise-health-rule.bicep' = if (deployHealthRule) {
  name: 'enterprise-health-rule'
  params: {
    location: location
    workspaceResourceId: workspace.id
    tags: tags
    actionGroupResourceIds: deployActionGroup && !empty(actionGroupContactEmails) ? [actionGroup!.outputs.resourceId] : []
  }
}

output WORKBOOK_RESOURCE_ID string = workbook.outputs.resourceId
output WORKSPACE_RESOURCE_ID string = workspace.id
output METADATA_DCR_RESOURCE_ID string = metadataDcr.id
output METADATA_DCR_IMMUTABLE_ID string = metadataDcr.properties.immutableId
output LOGS_INGESTION_ENDPOINT string = endpoint.properties.logsIngestion.endpoint
output APPLICATIONINSIGHTS_RESOURCE_ID string = appInsights.id
output PRESERVED_APPLICATIONINSIGHTS_WORKSPACE_ID string = appInsights.properties.WorkspaceResourceId
output BUDGET_DEPLOYED bool = deployBudget
output ACTION_GROUP_DEPLOYED bool = deployActionGroup && !empty(actionGroupContactEmails)
output HEALTH_RULE_DEPLOYED bool = deployHealthRule
output HEALTH_RULE_ENABLED bool = false
