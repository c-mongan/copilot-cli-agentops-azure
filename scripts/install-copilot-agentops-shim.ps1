param(
  [switch]$ShadowCopilot,
  [string]$InstallDir = $(if ($env:AGENTOPS_BIN_DIR) { $env:AGENTOPS_BIN_DIR } else { Join-Path $HOME ".local/bin" })
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$agentopsScript = Join-Path $repoRoot "scripts/copilot-agentops.ps1"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$agentopsCmd = Join-Path $InstallDir "copilot-agentops.cmd"
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$agentopsScript" %*
"@ | Set-Content -Path $agentopsCmd -Encoding ASCII

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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$agentopsScript" %*
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