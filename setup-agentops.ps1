$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptDir "install-agentops.ps1") @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") setup

Write-Host ""
if (Get-Command azd -ErrorAction SilentlyContinue) {
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") configure import-azd
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Imported Azure deployment outputs from azd."
  } else {
    Write-Host "No usable azd AgentOps outputs found yet. Run azd provision, then agentops configure import-azd."
  }
} else {
  Write-Host "azd not found. Configure Azure values manually or install azd and run azd provision."
}

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") init --dry-run

Write-Host "Next: make sure ~/.local/bin is on PATH for this shell:"
Write-Host '  $env:PATH = "$HOME/.local/bin;$env:PATH"'
Write-Host ""
Write-Host "Then run:"
Write-Host "  agentops validate-enterprise"
Write-Host "  agentops validate-azure"
Write-Host "  agentops smoke --wait 2m --poll 10s"
Write-Host '  agentops copilot -p "Reply with exactly: agentops smoke."'
Write-Host "  agentops latest --last 2h"
Write-Host "  agentops open"
Write-Host ""
Write-Host "If configure import-azd did not find Azure outputs, run:"
Write-Host "  az login"
Write-Host "  azd provision"
Write-Host "  agentops configure import-azd"
