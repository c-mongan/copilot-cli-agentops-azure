param(
  [switch]$ShadowCopilot,
  [string]$InstallDir = $(if ($env:AGENTOPS_BIN_DIR) { $env:AGENTOPS_BIN_DIR } else { Join-Path $HOME ".local/bin" })
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$agentopsScript = Join-Path $repoRoot "scripts/copilot-agentops.ps1"
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
$powershell = if ($pwsh) { $pwsh.Source } else { "powershell.exe" }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$agentopsCmd = Join-Path $InstallDir "copilot-agentops.cmd"
@"
@echo off
"$powershell" -NoProfile -ExecutionPolicy Bypass -File "$agentopsScript" %*
"@ | Set-Content -Path $agentopsCmd -Encoding ASCII

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source (Join-Path $repoRoot "agentops-cli/src/index.js") skills install
} else {
  Write-Warning "node was not found, so AgentOps Copilot skills were not installed. Install Node.js, then run: node $(Join-Path $repoRoot 'agentops-cli/src/index.js') skills install"
}

if ($ShadowCopilot) {
  $installDirFull = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $commands = Get-Command copilot -All -ErrorAction SilentlyContinue
  $realCopilot = $commands |
    Where-Object {
      $_.Source -and
      (-not [System.IO.Path]::GetFullPath($_.Source).StartsWith($installDirFull, [System.StringComparison]::OrdinalIgnoreCase))
    } |
    Select-Object -First 1

  if (-not $realCopilot) {
    throw "Could not find the real copilot CLI outside $InstallDir."
  }

  $shadowCmd = Join-Path $InstallDir "copilot.cmd"
  @"
@echo off
set "COPILOT_CLI_BIN=$($realCopilot.Source)"
"$powershell" -NoProfile -ExecutionPolicy Bypass -File "$agentopsScript" %*
"@ | Set-Content -Path $shadowCmd -Encoding ASCII
}

Write-Host "Installed:"
Write-Host "  $agentopsCmd"

if ($ShadowCopilot) {
  Write-Host "  $(Join-Path $InstallDir 'copilot.cmd')"
  Write-Host ""
  Write-Host "Plain copilot will be observed when $InstallDir appears before the real Copilot CLI on PATH."
} else {
  Write-Host ""
  Write-Host "Run observed Copilot sessions with:"
  Write-Host "  copilot-agentops"
  Write-Host ""
  Write-Host "To make plain copilot observed too, rerun:"
  Write-Host "  ./scripts/install-copilot-agentops-shim.ps1 -ShadowCopilot"
}

Write-Host ""
Write-Host "Make sure your shell can see $InstallDir. For PowerShell:"
Write-Host "  `$env:PATH = `"$InstallDir;`$env:PATH`""
