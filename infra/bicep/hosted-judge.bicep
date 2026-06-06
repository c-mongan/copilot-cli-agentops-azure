@description('Azure region for the hosted judge resources.')
param location string = resourceGroup().location

@description('Container Apps environment name.')
param environmentName string = 'agentops-judge-env'

@description('Hosted judge Container App name.')
param containerAppName string = 'agentops-hosted-judge'

@description('Container image for benchmark-judges/hosted-judge.')
param image string

@secure()
@description('Bearer token required by POST /score.')
param judgeToken string

@secure()
@description('OpenAI-compatible provider API key used by the hosted judge.')
param openAiApiKey string

@description('OpenAI-compatible chat completions endpoint.')
param openAiBaseUrl string = 'https://api.openai.com/v1/chat/completions'

@description('Model name sent to the OpenAI-compatible judge provider.')
param openAiModel string = 'gpt-4o-mini'

@description('Maximum HTTP request body bytes accepted by the judge.')
param maxBodyBytes int = 131072

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'judge-token'
          value: judgeToken
        }
        {
          name: 'openai-api-key'
          value: openAiApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'hosted-judge'
          image: image
          env: [
            {
              name: 'AGENTOPS_JUDGE_TOKEN'
              secretRef: 'judge-token'
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
            }
            {
              name: 'OPENAI_BASE_URL'
              value: openAiBaseUrl
            }
            {
              name: 'OPENAI_MODEL'
              value: openAiModel
            }
            {
              name: 'AGENTOPS_JUDGE_MAX_BODY_BYTES'
              value: string(maxBodyBytes)
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 30
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

output judgeEndpoint string = 'https://${app.properties.configuration.ingress.fqdn}/score'
output healthEndpoint string = 'https://${app.properties.configuration.ingress.fqdn}/health'
