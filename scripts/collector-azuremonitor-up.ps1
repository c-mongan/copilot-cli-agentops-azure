param(
  [string]$SubscriptionId = $(if ($env:AGENTOPS_AZURE_SUBSCRIPTION_ID) { $env:AGENTOPS_AZURE_SUBSCRIPTION_ID } else { "" }),
  [string]$ApprovedSubscriptionIds = $(if ($env:AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS) { $env:AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS } else { "" }),
  [string]$ResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-agentops-dev" }),
  [string]$ApplicationInsightsName = $(if ($env:APPLICATIONINSIGHTS_NAME) { $env:APPLICATIONINSIGHTS_NAME } else { "appi-agentops-dev" })
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$composeFile = Join-Path $repoRoot "collector/docker-compose.azuremonitor.yaml"
if (-not $SubscriptionId) {
  throw "Set AGENTOPS_AZURE_SUBSCRIPTION_ID before any Azure write or privileged lookup."
}
if (-not $ApprovedSubscriptionIds) {
  throw "Set AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS before any Azure write or privileged lookup."
}
$approved = @($ApprovedSubscriptionIds -split '[,\s]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$approvedMatch = $approved | Where-Object { $_.Equals($SubscriptionId, [System.StringComparison]::OrdinalIgnoreCase) }
if (-not $approvedMatch) {
  throw "Azure subscription guard refused this operation. Configured subscription $SubscriptionId is not in AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS."
}

$activeSubscriptionId = (az account show --query id -o tsv).Trim()
if (-not $activeSubscriptionId) {
  throw "Could not verify the active Azure subscription. Run az login, then retry."
}
if (-not $activeSubscriptionId.Equals($SubscriptionId, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Azure subscription guard refused this operation. Expected $SubscriptionId; active $activeSubscriptionId."
}
Write-Host "Azure subscription guard: verified $activeSubscriptionId"

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
