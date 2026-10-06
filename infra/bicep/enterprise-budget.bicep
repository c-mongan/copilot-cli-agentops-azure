@minValue(1)
param amount int
@minLength(20)
param startDate string
param contactEmails string[] = []
var notification = {
  contactEmails: contactEmails
  contactGroups: []
  contactRoles: []
  enabled: true
  locale: 'en-us'
  operator: 'GreaterThan'
}
resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'budget-agentops-diagnostic-pilot'
  properties: {
    amount: amount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: empty(contactEmails) ? {} : {
      Actual_80_Percent: union(notification, { threshold: 80, thresholdType: 'Actual' })
      Actual_100_Percent: union(notification, { threshold: 100, thresholdType: 'Actual' })
      Forecasted_100_Percent: union(notification, { threshold: 100, thresholdType: 'Forecasted' })
    }
  }
}
output resourceId string = budget.id
