type principal = {
  objectId: string
  principalType: 'Group' | 'ServicePrincipal' | 'User'
}
param workspaceName string
param principals principal[]
var readerRole = '3b03c2da-16b3-4a49-8834-0f8130efdd3b'
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}
// Official restrictive ABAC grammar: granular-rbac-log-analytics and granular-rbac-use-case.
// Fixed allowlist: new/unlisted tables (including content) receive no data grant.
var metadataTableCondition = '''
(
  !(ActionMatches{'Microsoft.OperationalInsights/workspaces/tables/data/read'})
  OR
  @Resource[Microsoft.OperationalInsights/workspaces/tables:name] ForAllOfAnyValues:StringEquals {'AgentOpsRunSummary_CL', 'AgentOpsEvents_CL', 'AgentOpsSpans_CL', 'AgentOpsToolCalls_CL', 'AgentOpsMcpCalls_CL', 'AgentOpsPrivacy_CL', 'AgentOpsEval_CL', 'AgentOpsGithubOutcomes_CL', 'AgentOpsInsights_CL', 'AgentOpsRecommendations_CL', 'AgentOpsCollectorHealth_CL'}
)
'''
resource assignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in principals: {
  name: guid(workspace.id, principal.objectId, readerRole, 'agentops-metadata-table-allowlist-v1')
  scope: workspace
  properties: {
    principalId: principal.objectId
    principalType: principal.principalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRole)
    conditionVersion: '2.0'
    condition: metadataTableCondition
  }
}]
