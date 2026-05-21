param location string
param name string
param tags object

resource workspace 'Microsoft.Monitor/accounts@2023-04-03' = {
  name: name
  location: location
  tags: tags
  properties: {}
}

output name string = workspace.name
output resourceId string = workspace.id
