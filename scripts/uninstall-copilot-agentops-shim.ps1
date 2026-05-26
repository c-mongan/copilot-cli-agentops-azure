param(
  [switch]$KeepAgentopsCommand,
  [string]$InstallDir = $(if ($env:AGENTOPS_BIN_DIR) { $env:AGENTOPS_BIN_DIR } else { Join-Path $HOME ".local/bin" })
)

$ErrorActionPreference = "Stop"

$shadowCmd = Join-Path $InstallDir "copilot.cmd"
$agentopsCliCmd = Join-Path $InstallDir "agentops.cmd"
$agentopsCmd = Join-Path $InstallDir "copilot-agentops.cmd"

if (Test-Path $shadowCmd) {
  Remove-Item $shadowCmd -Force
  Write-Host "Removed plain copilot shadow shim:"
  Write-Host "  $shadowCmd"
} else {
  Write-Host "No plain copilot shadow shim found at:"
  Write-Host "  $shadowCmd"
}

if (-not $KeepAgentopsCommand) {
  if (Test-Path $agentopsCliCmd) {
    Remove-Item $agentopsCliCmd -Force
    Write-Host "Removed explicit agentops command:"
    Write-Host "  $agentopsCliCmd"
  } else {
    Write-Host "No agentops command found at:"
    Write-Host "  $agentopsCliCmd"
  }

  if (Test-Path $agentopsCmd) {
    Remove-Item $agentopsCmd -Force
    Write-Host "Removed explicit copilot-agentops command:"
    Write-Host "  $agentopsCmd"
  } else {
    Write-Host "No copilot-agentops command found at:"
    Write-Host "  $agentopsCmd"
  }
}

Write-Host ""
Write-Host "Stop the Azure Monitor collector with:"
Write-Host "  docker compose -f collector/docker-compose.azuremonitor.yaml down"
