param(
  [string]$SubscriptionId = $(if ($env:AZURE_SUBSCRIPTION_ID) { $env:AZURE_SUBSCRIPTION_ID } else { "" }),
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-agentops-dev" }),
  [string]$ApplicationInsightsName = $(if ($env:APPLICATIONINSIGHTS_NAME) { $env:APPLICATIONINSIGHTS_NAME } else { "appi-agentops-dev" })
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$composeFile = Join-Path $repoRoot "collector/docker-compose.azuremonitor.yaml"

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId | Out-Null
}

$connectionString = az monitor app-insights component show `
  --resource-group $ResourceGroup `
  --app $ApplicationInsightsName `
  --query connectionString `
  -o tsv

if (-not $connectionString) {
  throw "Application Insights connection string lookup returned an empty value."
}

$env:APPLICATIONINSIGHTS_CONNECTION_STRING = $connectionString
docker compose -f $composeFile up -d --force-recreate

Write-Host "Azure Monitor collector started on 127.0.0.1:4318 and 127.0.0.1:4317."
Write-Host "Connection string was retrieved at runtime and not written to disk."
Write-Host ""
Write-Host "Check status:"
Write-Host "  docker compose -f collector/docker-compose.azuremonitor.yaml ps"
Write-Host ""
Write-Host "Stop it:"
Write-Host "  docker compose -f collector/docker-compose.azuremonitor.yaml down"
