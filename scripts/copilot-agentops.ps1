$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$composeFile = Join-Path $repoRoot "collector/docker-compose.azuremonitor.yaml"
$collectorScript = Join-Path $repoRoot "scripts/collector-azuremonitor-up.ps1"
$copilotObserve = Join-Path $repoRoot "copilot/copilot-observe.ps1"

function Invoke-CopilotWithoutObservation {
  param(
    [string]$Reason = "collector setup failed",
    [object[]]$CopilotArgs = @()
  )

  Write-Warning "AgentOps Azure Monitor collector was not started: $Reason"
  Write-Warning "Launching Copilot without AgentOps telemetry."

  if ($env:COPILOT_CLI_BIN) {
    & $env:COPILOT_CLI_BIN @CopilotArgs
    exit $LASTEXITCODE
  }

  if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
    throw "copilot CLI was not found on PATH."
  }

  & copilot @CopilotArgs
  exit $LASTEXITCODE
}

$collectorRunning = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $services = docker compose -f $composeFile ps --status running --services 2>$null
  $collectorRunning = $services -contains "otelcol"
}

if (-not $collectorRunning) {
  try {
    $collectorOutput = & $collectorScript 2>&1
    if ($LASTEXITCODE -ne 0) {
      $reason = ($collectorOutput | Where-Object { $_ } | Select-Object -Last 1)
      Invoke-CopilotWithoutObservation -Reason $reason -CopilotArgs $args
    }
  } catch {
    Invoke-CopilotWithoutObservation -Reason $_.Exception.Message -CopilotArgs $args
  }
}

if (-not $env:COPILOT_CLI_BIN -and -not (Get-Command copilot -ErrorAction SilentlyContinue)) {
  throw "copilot CLI was not found on PATH."
}

& $copilotObserve @args
exit $LASTEXITCODE
