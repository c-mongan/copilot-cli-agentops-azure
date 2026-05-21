$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$composeFile = Join-Path $repoRoot "collector/docker-compose.azuremonitor.yaml"
$collectorScript = Join-Path $repoRoot "scripts/collector-azuremonitor-up.ps1"
$copilotObserve = Join-Path $repoRoot "copilot/copilot-observe.ps1"

$collectorRunning = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $services = docker compose -f $composeFile ps --status running --services 2>$null
  $collectorRunning = $services -contains "otelcol"
}

if (-not $collectorRunning) {
  & $collectorScript | Out-Null
}

if (-not $env:COPILOT_CLI_BIN -and -not (Get-Command copilot -ErrorAction SilentlyContinue)) {
  throw "copilot CLI was not found on PATH."
}

& $copilotObserve @args
exit $LASTEXITCODE