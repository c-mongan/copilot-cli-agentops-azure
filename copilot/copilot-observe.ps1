$env:COPILOT_OTEL_ENABLED = if ($env:COPILOT_OTEL_ENABLED) { $env:COPILOT_OTEL_ENABLED } else { "true" }
$env:COPILOT_OTEL_EXPORTER_TYPE = if ($env:COPILOT_OTEL_EXPORTER_TYPE) { $env:COPILOT_OTEL_EXPORTER_TYPE } else { "otlp-http" }
$env:OTEL_EXPORTER_OTLP_ENDPOINT = if ($env:OTEL_EXPORTER_OTLP_ENDPOINT) { $env:OTEL_EXPORTER_OTLP_ENDPOINT } else { "http://127.0.0.1:4318" }
$env:OTEL_SERVICE_NAME = if ($env:OTEL_SERVICE_NAME) { $env:OTEL_SERVICE_NAME } else { "github-copilot-cli" }
$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = if ($env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT) { $env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT } else { "false" }
$env:COPILOT_OTEL_SOURCE_NAME = if ($env:COPILOT_OTEL_SOURCE_NAME) { $env:COPILOT_OTEL_SOURCE_NAME } else { "github.copilot" }

$repoUrl = git remote get-url origin 2>$null
if (-not $repoUrl) { $repoUrl = "unknown" }
$sha = [System.Security.Cryptography.SHA256]::Create()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($repoUrl)
$repoHash = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
$branch = git branch --show-current 2>$null
if (-not $branch) { $branch = "unknown" }
$commit = git rev-parse --short HEAD 2>$null
if (-not $commit) { $commit = "unknown" }
$version = if ($env:AGENTOPS_PACK_VERSION) { $env:AGENTOPS_PACK_VERSION } else { "0.1.0" }
$profile = if ($env:AGENTOPS_PROFILE) { $env:AGENTOPS_PROFILE } else { "safe-default" }
$experiment = if ($env:AGENTOPS_EXPERIMENT) { $env:AGENTOPS_EXPERIMENT } else { "baseline" }
$cliMode = "interactive"
$cliModel = if ($env:COPILOT_MODEL) { $env:COPILOT_MODEL } else { "" }
$cliRemote = "default"
$cliOutputFormat = "text"
$cliAgent = ""
$cliEffort = ""
$cliStream = ""
$allowAll = "false"
$allowAllTools = "false"
$allowAllPaths = "false"
$allowAllUrls = "false"
$acpEnabled = "false"
$cwdChanged = "false"
$sessionIdProvided = "false"
$shareEnabled = "false"
$shareGistEnabled = "false"
$allowToolCount = 0
$allowUrlCount = 0
$denyToolCount = 0
$denyUrlCount = 0
$availableToolCount = 0
$excludedToolCount = 0
$secretEnvCount = 0
$attachmentCount = 0
$pluginDirCount = 0
$additionalMcpConfigCount = 0
$disabledMcpServerCount = 0
$githubMcpToolCount = 0
$githubMcpToolsetCount = 0
$additionalMcpConfigNames = @()
$additionalMcpConfigServers = @()
$disabledMcpServers = @()
$githubMcpTools = @()
$githubMcpToolsets = @()
$captureContentEnabled = if ($env:AGENTOPS_CAPTURE_CONTENT) { $env:AGENTOPS_CAPTURE_CONTENT.ToLowerInvariant() } else { "false" }
$captureContentScope = "default-off"

function Safe-AttrValue($value) {
	return ([string]$value) -replace "[,=`r`n`t ]", "_"
}

function Add-UniqueValue([ref]$values, $value) {
	if (-not $value) { return }
	$safe = Safe-AttrValue $value
	if ($values.Value -notcontains $safe) {
		$values.Value += $safe
	}
}

function Join-AttrValues($values) {
	return ($values -join "|")
}

function List-ContainsValue($list, $candidate) {
	if (-not $list -or -not $candidate) { return $false }
	$values = ([string]$list) -split "[,\| ]+"
	foreach ($value in $values) {
		if (-not $value) { continue }
		if ($value -eq "*" -or $value -eq $candidate) { return $true }
	}
	return $false
}

function Track-McpConfig($rawPath) {
	if (-not $rawPath) { return }
	$configPath = ([string]$rawPath).TrimStart("@")
	Add-UniqueValue ([ref]$additionalMcpConfigNames) ([System.IO.Path]::GetFileName($configPath))
	if (-not (Test-Path $configPath)) { return }
	try {
		$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
		if ($config.mcpServers) {
			$config.mcpServers.PSObject.Properties.Name | ForEach-Object {
				Add-UniqueValue ([ref]$additionalMcpConfigServers) $_
			}
		}
	} catch {
		return
	}
}

function Find-AgentFile($agentName) {
	if (-not $agentName) { return "" }
	$candidates = @()
	if ($env:COPILOT_HOME) {
		$candidates += Join-Path $env:COPILOT_HOME "agents/$agentName.agent.md"
		$candidates += Join-Path $env:COPILOT_HOME "agents/$agentName.md"
	}
	$candidates += ".copilot/agents/$agentName.agent.md"
	$candidates += ".copilot/agents/$agentName.md"
	$candidates += "agents/$agentName.agent.md"
	$candidates += "agents/$agentName.md"
	foreach ($candidate in $candidates) {
		if (Test-Path $candidate) { return $candidate }
	}
	return ""
}

function Get-FileSha256($filePath) {
	$sha = [System.Security.Cryptography.SHA256]::Create()
	$stream = [System.IO.File]::OpenRead((Resolve-Path $filePath))
	try {
		return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
	} finally {
		$stream.Dispose()
	}
}

function Has-NextValue($values, $index) {
	return ($index + 1 -lt $values.Count) -and (-not $values[$index + 1].StartsWith("-"))
}

for ($i = 0; $i -lt $args.Count; $i++) {
	$arg = $args[$i]
	switch -Regex ($arg) {
		"^--mode=(.+)$" { $cliMode = $Matches[1]; continue }
		"^--model=(.+)$" { $cliModel = $Matches[1]; continue }
		"^--effort=(.+)$" { $cliEffort = $Matches[1]; continue }
		"^--reasoning-effort=(.+)$" { $cliEffort = $Matches[1]; continue }
		"^--output-format=(.+)$" { $cliOutputFormat = $Matches[1]; continue }
		"^--agent=(.+)$" { $cliAgent = $Matches[1]; continue }
		"^--stream=(.+)$" { $cliStream = $Matches[1]; continue }
		"^--session-id=" { $sessionIdProvided = "true"; continue }
		"^--share=" { $shareEnabled = "true"; continue }
		"^--attachment=" { $attachmentCount++; continue }
		"^--plugin-dir=" { $pluginDirCount++; continue }
		"^--additional-mcp-config=(.+)$" { $additionalMcpConfigCount++; Track-McpConfig $Matches[1]; continue }
		"^--disable-mcp-server=(.+)$" { $disabledMcpServerCount++; Add-UniqueValue ([ref]$disabledMcpServers) $Matches[1]; continue }
		"^--add-github-mcp-tool=(.+)$" { $githubMcpToolCount++; Add-UniqueValue ([ref]$githubMcpTools) $Matches[1]; continue }
		"^--add-github-mcp-toolset=(.+)$" { $githubMcpToolsetCount++; Add-UniqueValue ([ref]$githubMcpToolsets) $Matches[1]; continue }
		"^--allow-tool=" { $allowToolCount++; continue }
		"^--allow-url=" { $allowUrlCount++; continue }
		"^--deny-tool=" { $denyToolCount++; continue }
		"^--deny-url=" { $denyUrlCount++; continue }
		"^--available-tools=" { $availableToolCount++; continue }
		"^--excluded-tools=" { $excludedToolCount++; continue }
		"^--secret-env-vars=" { $secretEnvCount++; continue }
	}

	switch ($arg) {
		"--mode" { if ($i + 1 -lt $args.Count) { $cliMode = $args[$i + 1]; $i++ } }
		"--plan" { $cliMode = "plan" }
		"--autopilot" { $cliMode = "autopilot" }
		"--model" { if ($i + 1 -lt $args.Count) { $cliModel = $args[$i + 1]; $i++ } }
		"--effort" { if ($i + 1 -lt $args.Count) { $cliEffort = $args[$i + 1]; $i++ } }
		"--reasoning-effort" { if ($i + 1 -lt $args.Count) { $cliEffort = $args[$i + 1]; $i++ } }
		"--output-format" { if ($i + 1 -lt $args.Count) { $cliOutputFormat = $args[$i + 1]; $i++ } }
		"--remote" { $cliRemote = "enabled" }
		"--no-remote" { $cliRemote = "disabled" }
		"--agent" { if ($i + 1 -lt $args.Count) { $cliAgent = $args[$i + 1]; $i++ } }
		"--stream" { if ($i + 1 -lt $args.Count) { $cliStream = $args[$i + 1]; $i++ } }
		"--acp" { $acpEnabled = "true" }
		"-C" { $cwdChanged = "true"; if (Has-NextValue $args $i) { $i++ } }
		"--session-id" { $sessionIdProvided = "true"; if (Has-NextValue $args $i) { $i++ } }
		"--share" { $shareEnabled = "true"; if (Has-NextValue $args $i) { $i++ } }
		"--share-gist" { $shareGistEnabled = "true" }
		"--attachment" { $attachmentCount++; if (Has-NextValue $args $i) { $i++ } }
		"--plugin-dir" { $pluginDirCount++; if (Has-NextValue $args $i) { $i++ } }
		"--additional-mcp-config" { $additionalMcpConfigCount++; if (Has-NextValue $args $i) { Track-McpConfig $args[$i + 1]; $i++ } }
		"--disable-mcp-server" { $disabledMcpServerCount++; if (Has-NextValue $args $i) { Add-UniqueValue ([ref]$disabledMcpServers) $args[$i + 1]; $i++ } }
		"--add-github-mcp-tool" { $githubMcpToolCount++; if (Has-NextValue $args $i) { Add-UniqueValue ([ref]$githubMcpTools) $args[$i + 1]; $i++ } }
		"--add-github-mcp-toolset" { $githubMcpToolsetCount++; if (Has-NextValue $args $i) { Add-UniqueValue ([ref]$githubMcpToolsets) $args[$i + 1]; $i++ } }
		"--enable-all-github-mcp-tools" { $githubMcpToolCount++ }
		"--disable-builtin-mcps" { $disabledMcpServerCount++ }
		"--allow-all" { $allowAll = "true"; $allowAllTools = "true"; $allowAllPaths = "true"; $allowAllUrls = "true" }
		"--yolo" { $allowAll = "true"; $allowAllTools = "true"; $allowAllPaths = "true"; $allowAllUrls = "true" }
		"--allow-all-tools" { $allowAllTools = "true" }
		"--allow-all-paths" { $allowAllPaths = "true" }
		"--allow-all-urls" { $allowAllUrls = "true" }
		"--allow-tool" { $allowToolCount++; if (Has-NextValue $args $i) { $i++ } }
		"--allow-url" { $allowUrlCount++; if (Has-NextValue $args $i) { $i++ } }
		"--deny-tool" { $denyToolCount++; if (Has-NextValue $args $i) { $i++ } }
		"--deny-url" { $denyUrlCount++; if (Has-NextValue $args $i) { $i++ } }
		"--available-tools" { $availableToolCount++; if (Has-NextValue $args $i) { $i++ } }
		"--excluded-tools" { $excludedToolCount++; if (Has-NextValue $args $i) { $i++ } }
		"--secret-env-vars" { $secretEnvCount++; if (Has-NextValue $args $i) { $i++ } }
	}
}

$agentopsResourceAttributes = "service.namespace=copilot-agentops,service.name=github-copilot-cli,agent.framework=github-copilot,agent.runtime=github-copilot-cli,agentops.profile=$profile,agentops.experiment=$experiment,agentops.pack.version=$version,agentops.repo.hash=$repoHash,git.branch=$branch,git.commit=$commit,agentops.cli.mode=$cliMode,agentops.cli.remote=$cliRemote,agentops.cli.output_format=$cliOutputFormat,agentops.cli.allow_all=$allowAll,agentops.cli.allow_all_tools=$allowAllTools,agentops.cli.allow_all_paths=$allowAllPaths,agentops.cli.allow_all_urls=$allowAllUrls,agentops.cli.acp=$acpEnabled,agentops.cli.cwd_changed=$cwdChanged,agentops.cli.session_id_provided=$sessionIdProvided,agentops.cli.share=$shareEnabled,agentops.cli.share_gist=$shareGistEnabled,agentops.cli.allow_tool.count=$allowToolCount,agentops.cli.allow_url.count=$allowUrlCount,agentops.cli.deny_tool.count=$denyToolCount,agentops.cli.deny_url.count=$denyUrlCount,agentops.cli.available_tools.count=$availableToolCount,agentops.cli.excluded_tools.count=$excludedToolCount,agentops.cli.secret_env_vars.count=$secretEnvCount,agentops.cli.attachment.count=$attachmentCount,agentops.cli.plugin_dir.count=$pluginDirCount,agentops.cli.additional_mcp_config.count=$additionalMcpConfigCount,agentops.cli.disabled_mcp_server.count=$disabledMcpServerCount,agentops.cli.github_mcp_tool.count=$githubMcpToolCount,agentops.cli.github_mcp_toolset.count=$githubMcpToolsetCount"
if ($cliModel) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.cli.model=$cliModel"
}
if ($cliAgent) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.cli.agent=$cliAgent,agentops.agent.name=$cliAgent"
	$agentFile = Find-AgentFile $cliAgent
	if ($agentFile) {
		$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.agent.file=$(Safe-AttrValue ([System.IO.Path]::GetFileName($agentFile))),agentops.agent.hash=$(Get-FileSha256 $agentFile)"
	}
}
if ($captureContentEnabled -ne "true" -and $cliAgent -and (List-ContainsValue $env:AGENTOPS_CAPTURE_CONTENT_AGENTS $cliAgent)) {
	$captureContentEnabled = "true"
	$captureContentScope = "agent:$cliAgent"
}
if ($captureContentEnabled -ne "true" -and $env:AGENTOPS_ACTIVE_SKILLS) {
	$activeSkills = ([string]$env:AGENTOPS_ACTIVE_SKILLS) -split "[,\| ]+"
	foreach ($activeSkill in $activeSkills) {
		if (List-ContainsValue $env:AGENTOPS_CAPTURE_CONTENT_SKILLS $activeSkill) {
			$captureContentEnabled = "true"
			$captureContentScope = "skill:$activeSkill"
			break
		}
	}
}
if ($captureContentEnabled -eq "true" -and $env:AGENTOPS_ALLOW_CONTENT_CAPTURE -eq "1") {
	$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "true"
	$env:COPILOT_OTEL_CAPTURE_CONTENT = "true"
	if ($captureContentScope -eq "default-off") {
		$captureContentScope = "explicit"
	}
} else {
	$captureContentEnabled = "false"
	if ($captureContentScope -ne "default-off") {
		$captureContentScope = "blocked-by-default"
	}
	$env:OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "false"
	$env:COPILOT_OTEL_CAPTURE_CONTENT = "false"
}
$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.content_capture.enabled=$captureContentEnabled,agentops.content_capture.scope=$(Safe-AttrValue $captureContentScope)"
if ($cliEffort) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.cli.reasoning_effort=$cliEffort"
}
if ($cliStream) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.cli.stream=$cliStream"
}
if ($additionalMcpConfigNames.Count -gt 0) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.mcp.config.files=$(Join-AttrValues $additionalMcpConfigNames)"
}
if ($additionalMcpConfigServers.Count -gt 0) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.mcp.config.servers=$(Join-AttrValues $additionalMcpConfigServers)"
}
if ($disabledMcpServers.Count -gt 0) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.mcp.disabled.servers=$(Join-AttrValues $disabledMcpServers)"
}
if ($githubMcpTools.Count -gt 0) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.mcp.github.tools=$(Join-AttrValues $githubMcpTools)"
}
if ($githubMcpToolsets.Count -gt 0) {
	$agentopsResourceAttributes = "$agentopsResourceAttributes,agentops.mcp.github.toolsets=$(Join-AttrValues $githubMcpToolsets)"
}
if ($env:OTEL_RESOURCE_ATTRIBUTES) {
	$env:OTEL_RESOURCE_ATTRIBUTES = "$agentopsResourceAttributes,$env:OTEL_RESOURCE_ATTRIBUTES"
} else {
	$env:OTEL_RESOURCE_ATTRIBUTES = $agentopsResourceAttributes
}

$copilotBin = if ($env:COPILOT_CLI_BIN) { $env:COPILOT_CLI_BIN } else { "copilot" }
& $copilotBin @args
exit $LASTEXITCODE
