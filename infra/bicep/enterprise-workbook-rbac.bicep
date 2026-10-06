type principal = {
  objectId: string
  principalType: 'Group' | 'ServicePrincipal' | 'User'
}
param workbookName string
param observers principal[] = []
param editors principal[] = []
var readerRole = 'b279062a-9be3-42a0-92ae-8b3cf002ec4d'
var editorRole = 'e8ddcd69-c73f-4f9f-9844-4100522f16ad'
resource workbook 'Microsoft.Insights/workbooks@2022-04-01' existing = {
  name: workbookName
}
resource readerAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in observers: {
  name: guid(workbook.id, principal.objectId, readerRole)
  scope: workbook
  properties: {
    principalId: principal.objectId
    principalType: principal.principalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRole)
  }
}]
resource editorAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in editors: {
  name: guid(workbook.id, principal.objectId, editorRole)
  scope: workbook
  properties: {
    principalId: principal.objectId
    principalType: principal.principalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', editorRole)
  }
}]
