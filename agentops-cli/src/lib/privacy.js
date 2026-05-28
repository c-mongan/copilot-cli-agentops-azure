const crypto = require('node:crypto');

const safeAttributeKeys = [
  'service.name',
  'service.namespace',
  'service.version',
  'telemetry.sdk.name',
  'telemetry.sdk.language',
  'telemetry.sdk.version',
  'agent.framework',
  'agent.runtime',
  'agentops.profile',
  'agentops.experiment',
  'agentops.e2e.id',
  'agentops.pack.version',
  'agentops.repo.hash',
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
  'agentops.content_capture.enabled',
  'agentops.content_capture.scope',
  'agentops.content_capture.signal',
  'agentops.poison_id',
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.conversation.id',
  'gen_ai.tool.name',
  'gen_ai.tool.type',
  'gen_ai.tool.call.id',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'github.copilot.cost',
  'github.copilot.aiu',
  'github.copilot.turn_count',
  'github.copilot.hook.type',
  'github.copilot.hook.invocation_id',
  'github.copilot.skill.name',
  'github.copilot.skill.plugin_name',
  'github.copilot.skill.plugin_version',
  'error.type',
  'exception.type',
  'http.status_code'
];

const contentLikeKeys = [
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.input',
  'gen_ai.tool.output',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'github.copilot.message',
  'http.request.body.content',
  'http.response.body.content',
  'url.full',
  'code.filepath'
];

function redacted(value) {
  if (value === undefined || value === null) return value;
  return '[REDACTED]';
}

function envLooksSecret(key) {
  return /(KEY|TOKEN|PAT|SECRET|PASSWORD|CONNECTION_STRING|AUTH|CREDENTIAL|COOKIE)/i.test(key);
}

function redactedEnvSummary(env = process.env) {
  return Object.fromEntries(Object.entries(env)
    .filter(([key]) => /^AGENTOPS_|^AZURE_|^APPLICATIONINSIGHTS_|^COPILOT_|^OTEL_|^GITHUB_|^OPENAI_/.test(key))
    .map(([key, value]) => [key, envLooksSecret(key) ? redacted(value) : value]));
}

function makePoisonAttributes(id = `agentops-poison-${crypto.randomBytes(4).toString('hex')}`) {
  return {
    'agentops.poison_id': id,
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': 'poison-model',
    'gen_ai.usage.input_tokens': 11,
    'gen_ai.usage.output_tokens': 7,
    'gen_ai.input.messages': 'SECRET_PROMPT_SHOULD_NOT_LEAVE',
    'gen_ai.output.messages': 'SECRET_RESPONSE_SHOULD_NOT_LEAVE',
    'gen_ai.prompt': 'SECRET_PROMPT_SHOULD_NOT_LEAVE',
    'gen_ai.completion': 'SECRET_RESPONSE_SHOULD_NOT_LEAVE',
    'gen_ai.system_instructions': 'SECRET_SYSTEM_SHOULD_NOT_LEAVE',
    'gen_ai.tool.call.arguments': 'SECRET_TOOL_ARGS_SHOULD_NOT_LEAVE',
    'gen_ai.tool.call.result': 'SECRET_TOOL_RESULT_SHOULD_NOT_LEAVE',
    'http.request.body.content': 'SECRET_BODY_SHOULD_NOT_LEAVE',
    'http.response.body.content': 'SECRET_BODY_SHOULD_NOT_LEAVE',
    'url.full': 'https://example.test/path?token=SECRET_URL_SHOULD_NOT_LEAVE',
    'code.filepath': '/Users/conor/private/customer/repo/file.ts',
    'unknown.future.content.field': 'SECRET_UNKNOWN_SHOULD_NOT_LEAVE'
  };
}

function sanitizeAttributesStrict(attributes = {}) {
  const observedContent = Object.keys(attributes).some(key => (
    contentLikeKeys.includes(key)
    || /content|message|prompt|completion|instruction|argument|result|body|secret|token|password|filepath|url/i.test(key)
  ));
  const sanitized = {};

  for (const key of safeAttributeKeys) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) sanitized[key] = attributes[key];
  }

  if (observedContent) sanitized['agentops.content_capture.signal'] = true;
  return sanitized;
}

function poisonCheck() {
  const input = makePoisonAttributes();
  const sanitized = sanitizeAttributesStrict(input);
  const output = JSON.stringify(sanitized);
  const leaked = output.match(/SECRET_[A-Z_]+/g) || [];
  return {
    ok: leaked.length === 0
      && sanitized['agentops.content_capture.signal'] === true
      && sanitized['gen_ai.operation.name'] === 'chat'
      && sanitized['gen_ai.request.model'] === 'poison-model',
    poison_id: input['agentops.poison_id'],
    leaked,
    safe_fields_present: {
      operation: sanitized['gen_ai.operation.name'] === 'chat',
      model: sanitized['gen_ai.request.model'] === 'poison-model',
      input_tokens: sanitized['gen_ai.usage.input_tokens'] === 11,
      output_tokens: sanitized['gen_ai.usage.output_tokens'] === 7,
      scrub_signal: sanitized['agentops.content_capture.signal'] === true
    },
    sanitized
  };
}

module.exports = {
  contentLikeKeys,
  envLooksSecret,
  makePoisonAttributes,
  poisonCheck,
  redactedEnvSummary,
  safeAttributeKeys,
  sanitizeAttributesStrict
};
