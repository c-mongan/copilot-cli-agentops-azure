param location string
param baseName string
param environmentName string
param logAnalyticsWorkspaceResourceId string
param enabled bool = false
param tags object

resource highAiuAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'sqr-${baseName}-${environmentName}-high-aiu'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Copilot AgentOps high AIU usage'
    description: 'Proposal-only alert for unusually high GitHub Copilot AIU usage in wrapped CLI sessions.'
    severity: 3
    enabled: enabled
    scopes: [
      logAnalyticsWorkspaceResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: '''
AppDependencies
| where TimeGenerated > ago(1h)
| where Properties has 'github.copilot' and Properties has 'github-copilot-cli'
| summarize TotalAiu=sum(todouble(Properties['github.copilot.aiu']))
'''
          timeAggregation: 'Total'
          metricMeasureColumn: 'TotalAiu'
          operator: 'GreaterThan'
          threshold: 50000000000
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: []
      customProperties: {
        mode: 'proposal-only'
      }
    }
  }
}

resource failureAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'sqr-${baseName}-${environmentName}-failures'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Copilot AgentOps failed spans'
    description: 'Proposal-only alert for failed Copilot CLI spans exported through the local collector.'
    severity: 3
    enabled: enabled
    scopes: [
      logAnalyticsWorkspaceResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: '''
AppDependencies
| where TimeGenerated > ago(1h)
| where Properties has 'github.copilot' and Properties has 'github-copilot-cli'
| where Success == false or tostring(Properties['error.type']) != ''
| summarize FailedSpans=count()
'''
          timeAggregation: 'Total'
          metricMeasureColumn: 'FailedSpans'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: []
      customProperties: {
        mode: 'proposal-only'
      }
    }
  }
}

resource contentCaptureAlert 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: 'sqr-${baseName}-${environmentName}-content-capture'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Copilot AgentOps content capture detector'
    description: 'Proposal-only alert that detects accidental GenAI prompt, completion, or message content attributes.'
    severity: 2
    enabled: enabled
    scopes: [
      logAnalyticsWorkspaceResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: '''
union isfuzzy=true AppDependencies, AppTraces
| where TimeGenerated > ago(1h)
| where tostring(Properties) has_any ('gen_ai.input.messages', 'gen_ai.output.messages', 'gen_ai.prompt', 'gen_ai.completion', 'github.copilot.message')
| summarize ContentCaptureSignals=count()
'''
          timeAggregation: 'Total'
          metricMeasureColumn: 'ContentCaptureSignals'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: []
      customProperties: {
        mode: 'proposal-only'
      }
    }
  }
}

output highAiuAlertResourceId string = highAiuAlert.id
output failureAlertResourceId string = failureAlert.id
output contentCaptureAlertResourceId string = contentCaptureAlert.id