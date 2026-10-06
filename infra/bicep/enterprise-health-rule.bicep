param location string
param workspaceResourceId string
param tags object
param actionGroupResourceIds string[] = []
resource healthRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'alert-agentops-ingestion-health'
  location: location
  kind: 'LogAlert'
  tags: tags
  properties: {
    displayName: 'AgentOps ingestion health (disabled proposal)'
    description: 'Collector-reported degraded status. Absence of rows does not prove healthy ingestion or detect a silent outage.'
    enabled: false
    severity: 3
    scopes: [workspaceResourceId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      allOf: [{
        query: '''
AgentOpsCollectorHealth_CL
| where TimeGenerated > ago(15m)
| where Status in~ ('error', 'failed', 'degraded', 'unhealthy')
| summarize UnhealthyReceipts=count()
'''
        timeAggregation: 'Total'
        metricMeasureColumn: 'UnhealthyReceipts'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: {
          numberOfEvaluationPeriods: 1
          minFailingPeriodsToAlert: 1
        }
      }]
    }
    actions: {
      actionGroups: actionGroupResourceIds
    }
  }
}
