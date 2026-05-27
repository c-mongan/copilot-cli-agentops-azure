targetScope = 'resourceGroup'

@description('Monthly budget resource name.')
param name string

@description('Monthly budget amount in the billing currency for the subscription.')
@minValue(1)
param amount int

@description('Email addresses for budget notifications. Use a team-owned distribution list for internal pilots.')
param contactEmails array

@description('Budget start date in ISO 8601 UTC format.')
param startDate string

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: name
  properties: {
    amount: amount
    category: 'Cost'
    notifications: {
      Actual_GreaterThan_80_Percent: {
        contactEmails: contactEmails
        contactGroups: []
        contactRoles: []
        enabled: true
        locale: 'en-us'
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
      }
      Actual_GreaterThan_100_Percent: {
        contactEmails: contactEmails
        contactGroups: []
        contactRoles: []
        enabled: true
        locale: 'en-us'
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
      }
    }
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
  }
}

output name string = budget.name
output amount int = amount
