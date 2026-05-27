targetScope = 'resourceGroup'

@description('Log Analytics workspace name created by the AgentOps deployment.')
param logAnalyticsWorkspaceName string

@description('Azure Managed Grafana resource name created by the AgentOps deployment.')
param grafanaName string

@description('Microsoft Entra security group object IDs for read-only AgentOps observers.')
param observerPrincipalIds array = []

@description('Microsoft Entra security group object IDs for AgentOps operators who maintain dashboards and monitor health.')
param operatorPrincipalIds array = []

@description('Microsoft Entra security group object IDs for break-glass AgentOps admins. Keep this empty for most pilots.')
param adminPrincipalIds array = []

var logAnalyticsDataReaderRoleDefinitionId = '3b03c2da-16b3-4a49-8834-0f8130efdd3b'
var monitoringReaderRoleDefinitionId = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'
var grafanaViewerRoleDefinitionId = '60921a7e-fef1-4a43-9b16-a26c52ad4769'
var grafanaEditorRoleDefinitionId = 'a79a5197-3a5c-4973-a920-486035ffd60f'
var grafanaAdminRoleDefinitionId = '22926164-76b3-42b3-bc55-97df8dab3e41'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource grafana 'Microsoft.Dashboard/grafana@2023-09-01' existing = {
  name: grafanaName
}

resource observerLogAnalyticsDataReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in observerPrincipalIds: {
  name: guid(workspace.id, principalId, logAnalyticsDataReaderRoleDefinitionId)
  scope: workspace
  properties: {
    principalId: principalId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', logAnalyticsDataReaderRoleDefinitionId)
  }
}]

resource observerGrafanaViewer 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in observerPrincipalIds: {
  name: guid(grafana.id, principalId, grafanaViewerRoleDefinitionId)
  scope: grafana
  properties: {
    principalId: principalId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', grafanaViewerRoleDefinitionId)
  }
}]

resource operatorMonitoringReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in operatorPrincipalIds: {
  name: guid(resourceGroup().id, principalId, monitoringReaderRoleDefinitionId)
  properties: {
    principalId: principalId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringReaderRoleDefinitionId)
  }
}]

resource operatorGrafanaEditor 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in operatorPrincipalIds: {
  name: guid(grafana.id, principalId, grafanaEditorRoleDefinitionId)
  scope: grafana
  properties: {
    principalId: principalId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', grafanaEditorRoleDefinitionId)
  }
}]

resource adminGrafanaAdmin 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in adminPrincipalIds: {
  name: guid(grafana.id, principalId, grafanaAdminRoleDefinitionId)
  scope: grafana
  properties: {
    principalId: principalId
    principalType: 'Group'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', grafanaAdminRoleDefinitionId)
  }
}]

output observerAssignmentCount int = length(observerPrincipalIds) * 2
output operatorAssignmentCount int = length(operatorPrincipalIds) * 2
output adminAssignmentCount int = length(adminPrincipalIds)
