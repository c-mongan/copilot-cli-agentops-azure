param(
  [switch]$ShadowCopilot,
  [switch]$NoShadowCopilot,
  [switch]$NoCollector,
  [string]$CollectorVersion = $env:AGENTOPS_OTELCOL_VERSION,
  [switch]$ForceCollector,
  [switch]$Plugin
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $CollectorVersion) {
  $CollectorVersion = "0.151.0"
}

$installShadow = $true
if ($NoShadowCopilot) {
  $installShadow = $false
}

if (-not $NoCollector) {
  $collectorArgs = @("collector", "install-binary", "--privacy", "strict", "--version", $CollectorVersion)
  if ($ForceCollector) {
    $collectorArgs += "--force"
  }
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") @collectorArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$shimArgs = @()
if ($installShadow -or $ShadowCopilot) {
  $shimArgs += "-ShadowCopilot"
}
& (Join-Path $scriptDir "scripts/install-copilot-agentops-shim.ps1") @shimArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Plugin) {
  Write-Host ""
  Write-Host "Installing AgentOps plugin files into COPILOT_HOME. Remove with: agentops plugin uninstall"
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") plugin install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Next:"
Write-Host '  $env:PATH = "$HOME/.local/bin;$env:PATH"'
Write-Host "  agentops configure import-azd"
Write-Host "  agentops collector start --mode auto --privacy strict"
Write-Host '  copilot -p "Say AGENTOPS_READY in one short sentence."'
Write-Host ""
Write-Host "Remove later with:"
Write-Host "  ./uninstall-agentops.ps1"
