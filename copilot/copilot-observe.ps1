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

$agentopsResourceAttributes = "service.namespace=copilot-agentops,service.name=github-copilot-cli,agent.framework=github-copilot,agent.runtime=github-copilot-cli,agentops.profile=$profile,agentops.experiment=$experiment,agentops.pack.version=$version,agentops.repo.hash=$repoHash,git.branch=$branch,git.commit=$commit"
if ($env:OTEL_RESOURCE_ATTRIBUTES) {
	$env:OTEL_RESOURCE_ATTRIBUTES = "$agentopsResourceAttributes,$env:OTEL_RESOURCE_ATTRIBUTES"
} else {
	$env:OTEL_RESOURCE_ATTRIBUTES = $agentopsResourceAttributes
}

$copilotBin = if ($env:COPILOT_CLI_BIN) { $env:COPILOT_CLI_BIN } else { "copilot" }
& $copilotBin @args
exit $LASTEXITCODE
