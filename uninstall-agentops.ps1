$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir "scripts/uninstall-copilot-agentops-shim.ps1") @args
exit $LASTEXITCODE
