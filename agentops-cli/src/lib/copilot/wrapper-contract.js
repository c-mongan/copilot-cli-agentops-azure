const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('../paths');

const wrapperFiles = [
  'copilot/copilot-observe',
  'copilot/copilot-observe.ps1'
];

const sharedTerms = [
  'COPILOT_OTEL_ENABLED',
  'COPILOT_OTEL_EXPORTER_TYPE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
  'COPILOT_OTEL_SOURCE_NAME',
  'AGENTOPS_PACK_VERSION',
  'AGENTOPS_WRAPPER_RUN_ID',
  'AGENTOPS_WRAPPER_SESSION_ID',
  'AGENTOPS_WRAPPER_FALLBACK_UNOBSERVED',
  'AGENTOPS_PROFILE',
  'AGENTOPS_EXPERIMENT',
  'AGENTOPS_CAPTURE_CONTENT',
  'AGENTOPS_CAPTURE_CONTENT_AGENTS',
  'AGENTOPS_ACTIVE_SKILLS',
  'AGENTOPS_CAPTURE_CONTENT_SKILLS',
  'AGENTOPS_ALLOW_CONTENT_CAPTURE',
  'COPILOT_OTEL_CAPTURE_CONTENT',
  'OTEL_RESOURCE_ATTRIBUTES',
  'service.namespace=copilot-agentops',
  'agent.framework=github-copilot',
  'agent.runtime=github-copilot-cli',
  'agentops.wrapper.fallback_unobserved',
  'agentops.wrapper.run_id',
  'agentops.wrapper.session_id',
  'agentops.content_capture.enabled',
  'agentops.content_capture.scope',
  'agentops.cli.mode',
  'agentops.cli.remote',
  'agentops.cli.output_format',
  'agentops.cli.allow_all',
  'agentops.cli.allow_all_tools',
  'agentops.cli.allow_all_paths',
  'agentops.cli.allow_all_urls',
  'agentops.cli.acp',
  'agentops.cli.cwd_changed',
  'agentops.cli.session_id_provided',
  'agentops.cli.share',
  'agentops.cli.share_gist',
  'agentops.cli.allow_tool.count',
  'agentops.cli.allow_url.count',
  'agentops.cli.deny_tool.count',
  'agentops.cli.deny_url.count',
  'agentops.cli.available_tools.count',
  'agentops.cli.excluded_tools.count',
  'agentops.cli.secret_env_vars.count',
  'agentops.cli.attachment.count',
  'agentops.cli.plugin_dir.count',
  'agentops.cli.additional_mcp_config.count',
  'agentops.cli.disabled_mcp_server.count',
  'agentops.cli.github_mcp_tool.count',
  'agentops.cli.github_mcp_toolset.count',
  'agentops.cli.model',
  'agentops.cli.agent',
  'agentops.agent.name',
  'agentops.agent.file',
  'agentops.agent.hash',
  'agentops.cli.reasoning_effort',
  'agentops.cli.stream',
  'agentops.mcp.config.files',
  'agentops.mcp.config.servers',
  'agentops.mcp.disabled.servers',
  'agentops.mcp.github.tools',
  'agentops.mcp.github.toolsets',
  '--mode',
  '--plan',
  '--autopilot',
  '--model',
  '--effort',
  '--reasoning-effort',
  '--output-format',
  '--remote',
  '--no-remote',
  '--agent',
  '--stream',
  '--acp',
  '-C',
  '--session-id',
  '--share',
  '--share-gist',
  '--attachment',
  '--plugin-dir',
  '--additional-mcp-config',
  '--disable-mcp-server',
  '--add-github-mcp-tool',
  '--add-github-mcp-toolset',
  '--enable-all-github-mcp-tools',
  '--disable-builtin-mcps',
  '--allow-all',
  '--yolo',
  '--allow-all-tools',
  '--allow-all-paths',
  '--allow-all-urls',
  '--allow-tool',
  '--allow-url',
  '--deny-tool',
  '--deny-url',
  '--available-tools',
  '--excluded-tools',
  '--secret-env-vars'
];

function validateWrapperContract(root = repoRoot) {
  const missing = [];
  const files = [];

  for (const relativePath of wrapperFiles) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      missing.push(relativePath);
      continue;
    }
    files.push(relativePath);
    const body = fs.readFileSync(absolutePath, 'utf8');
    for (const term of sharedTerms) {
      if (!body.includes(term)) missing.push(`${relativePath}: ${term}`);
    }
  }

  return {
    ok: missing.length === 0,
    files,
    missing,
    terms: sharedTerms
  };
}

module.exports = {
  sharedTerms,
  validateWrapperContract,
  wrapperFiles
};
