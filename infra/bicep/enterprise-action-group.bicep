@minLength(1)
param contactEmails string[]
param tags object
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-agentops-diagnostic-pilot'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'AgentOps'
    enabled: false
    emailReceivers: [for (email, index) in contactEmails: {
      name: 'approved-contact-${index}'
      emailAddress: email
      useCommonAlertSchema: true
    }]
  }
}
output resourceId string = actionGroup.id
