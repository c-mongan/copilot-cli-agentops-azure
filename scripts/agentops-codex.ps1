param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodexArgs
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$composeFile = Join-Path $repoRoot "collector/docker-compose.azuremonitor.yaml"

$collectorRunning = $false
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  $services = docker compose -f $composeFile ps --status running --services 2>$null
  $collectorRunning = $services -contains "otelcol"
}

if (-not $collectorRunning) {
  & (Join-Path $repoRoot "scripts/collector-azuremonitor-up.ps1") | Out-Null
}

$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
  throw "codex CLI was not found on PATH."
}

if (-not $env:OTEL_EXPORTER_OTLP_ENDPOINT) {
  $env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
}
if (-not $env:OTEL_EXPORTER_OTLP_PROTOCOL) {
  $env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
}
if (-not $env:OTEL_SERVICE_NAME) {
  $env:OTEL_SERVICE_NAME = "codex"
}
if (-not $env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT) {
  $env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "false"
}

& $codex.Source @CodexArgs
exit $LASTEXITCODE
