$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "scripts/install-copilot-agentops-shim.ps1") -ShadowCopilot @args
exit $LASTEXITCODE
