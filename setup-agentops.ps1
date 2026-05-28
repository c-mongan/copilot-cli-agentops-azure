$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startCollector = $true
foreach ($arg in $args) {
  if ($arg -eq "-NoCollector" -or $arg -eq "--no-collector") {
    $startCollector = $false
  }
}

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

if ($startCollector) {
  Write-Host ""
  & node (Join-Path $scriptDir "agentops-cli/src/index.js") collector start --mode auto --privacy strict
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Collector is running."
  } else {
    Write-Host "Collector did not start yet. Check Azure config with: agentops configure import-azd"
  }
}

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") doctor

Write-Host "Next: make sure ~/.local/bin is on PATH for this shell:"
Write-Host '  $env:PATH = "$HOME/.local/bin;$env:PATH"'
Write-Host ""
Write-Host "Then run Copilot normally:"
Write-Host '  copilot --no-ask-user --no-remote --add-dir . --allow-tool="shell(pwd)" --allow-tool="shell(ls:*)" -p "Do not edit files. Run pwd and ls docs | head, then summarize."'
Write-Host ""
Write-Host "Useful checks:"
Write-Host "  agentops latest --last 2h"
Write-Host "  agentops open"
Write-Host "  agentops validate-azure --last 24h"
Write-Host ""
Write-Host "Optional plugin helpers:"
Write-Host "  agentops plugin install"
Write-Host ""
Write-Host "If configure import-azd did not find Azure outputs, run:"
Write-Host "  az login"
Write-Host "  azd provision"
Write-Host "  agentops configure import-azd"
