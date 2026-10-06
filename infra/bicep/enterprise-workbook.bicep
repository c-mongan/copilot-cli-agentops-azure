param name string
param displayName string
param location string
param workspaceResourceId string
param tags object

var workbookTemplate = loadJsonContent('../../workbooks/agentops-enterprise-workbook.json')
// Saved Workbooks opened from Azure Monitor do not always inherit LAW context.
// Bind the single resource picker explicitly while preserving every other item.
var boundItems = map(workbookTemplate.items, item => item.name == 'enterprise-parameters' ? union(item, {
  content: union(item.content, {
    parameters: map(item.content.parameters, parameter => parameter.name == 'Workspace' ? union(parameter, {
      value: workspaceResourceId
    }) : parameter)
  })
}) : item)
var boundWorkbook = union(workbookTemplate, {
  items: boundItems
  fallbackResourceIds: [workspaceResourceId]
  defaultResourceIds: [workspaceResourceId]
})

resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: name
  location: location
  kind: 'shared'
  tags: tags
  properties: {
    displayName: displayName
    category: 'workbook'
    sourceId: workspaceResourceId
    serializedData: string(boundWorkbook)
    version: '1.0'
  }
}
output resourceId string = workbook.id
