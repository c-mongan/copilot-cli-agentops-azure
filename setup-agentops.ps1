$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptDir "install-agentops.ps1") @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") status

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") init --dry-run

Write-Host ""
& node (Join-Path $scriptDir "agentops-cli/src/index.js") workflows show latest-run

Write-Host ""
Write-Host "Next: make sure ~/.local/bin is on PATH for this shell:"
Write-Host '  $env:PATH = "$HOME/.local/bin;$env:PATH"'
Write-Host ""
Write-Host "Then run:"
Write-Host "  agentops configure set --resource-group <resource-group> --workspace-id <workspace-id> --grafana-url https://<your-grafana>.grafana.azure.com --grafana-name <grafana-resource-name> --app-insights-name <app-insights-name>"
Write-Host "  agentops validate-azure"
Write-Host "  agentops smoke --wait 2m --poll 10s"
