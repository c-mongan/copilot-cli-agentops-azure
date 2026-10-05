type principal = {
  objectId: string
  principalType: 'Group' | 'ServicePrincipal' | 'User'
}
param metadataDcrName string
param principals principal[]
var publisherRole = '3913510d-42f4-4e42-8a64-420c390055eb'
resource metadataDcr 'Microsoft.Insights/dataCollectionRules@2022-06-01' existing = {
  name: metadataDcrName
}
resource assignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in principals: {
  name: guid(metadataDcr.id, principal.objectId, publisherRole)
  scope: metadataDcr
  properties: {
    principalId: principal.objectId
    principalType: principal.principalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', publisherRole)
  }
}]
