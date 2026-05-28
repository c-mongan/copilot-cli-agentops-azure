param(
  [switch]$KeepPlugin,
  [switch]$KeepCollector,
  [switch]$KeepBinary,
  [switch]$Purge,
  [switch]$KeepAgentopsCommand
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $KeepPlugin) {
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") plugin uninstall
}

if (-not $KeepCollector) {
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") collector stop --mode auto --json
}

if (-not $KeepBinary) {
  $binaryArgs = @("collector", "uninstall-binary", "--json")
  if ($Purge) {
    $binaryArgs += "--purge"
  }
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") @binaryArgs
}

$shimArgs = @()
if ($KeepAgentopsCommand) {
  $shimArgs += "-KeepAgentopsCommand"
}
& (Join-Path $scriptDir "scripts/uninstall-copilot-agentops-shim.ps1") @shimArgs

Write-Host ""
Write-Host "AgentOps uninstall finished."
Write-Host "Reinstall later with:"
Write-Host "  ./setup-agentops.ps1"
