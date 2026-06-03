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
  'agentops.schema.version',
  'agentops.run.id',
  'agentops.session.id',
  'agentops.surface',
  'agentops.privacy.mode',
  'agentops.content_capture.mode',
  'agentops.custom_event_id',
  'agentops.event.name',
  'agentops.agent.name',
  'agentops.agent.hash',
  'agentops.parent_agent.name',
  'agentops.sub_agent.name',
  'agentops.delegation.id',
  'agentops.skill.name',
  'agentops.skill.hash',
  'agentops.workflow.name',
  'agentops.step.name',
  'agentops.outcome',
  'agentops.mcp.server',
  'agentops.mcp.tool',
  'agentops.mcp.server.hash',
  'agentops.mcp.allowed',
  'agentops.mcp.tool.risk',
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

const sensitiveKeyFamilyPattern = /(prompt|completion|message|instruction|argument|result|body|secret|password|credential|cookie|url|filepath|file_path|path|token)/i;

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

function classifyContentLikeKey(key) {
  const normalized = String(key || '');
  if (!normalized) return null;
  if (contentLikeKeys.includes(normalized)) {
    return { key: normalized, reason: 'exact-content-key', action: 'drop' };
  }
  if (safeAttributeKeys.includes(normalized)) return null;
  if (sensitiveKeyFamilyPattern.test(normalized)) {
    return { key: normalized, reason: 'sensitive-key-family', action: 'review-or-drop' };
  }
  return null;
}

function fieldNameFromCatalogRow(row) {
  if (typeof row === 'string') return row;
  if (!row || typeof row !== 'object') return '';
  return row.field || row.Field || row.name || row.Name || row.key || row.Key || '';
}

function detectContentLikeFieldCatalog(fields = []) {
  const suspicious = [];
  const seen = new Set();
  for (const row of fields) {
    const field = fieldNameFromCatalogRow(row);
    const classified = classifyContentLikeKey(field);
    if (!classified || seen.has(classified.key)) continue;
    seen.add(classified.key);
    suspicious.push(classified);
  }
  suspicious.sort((a, b) => a.key.localeCompare(b.key));
  return {
    ok: suspicious.length === 0,
    suspicious
  };
}

function sanitizeAttributesStrict(attributes = {}) {
  const observedContent = Object.keys(attributes).some(key => (
    classifyContentLikeKey(key)
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
  classifyContentLikeKey,
  contentLikeKeys,
  detectContentLikeFieldCatalog,
  envLooksSecret,
  makePoisonAttributes,
  poisonCheck,
  redactedEnvSummary,
  safeAttributeKeys,
  sanitizeAttributesStrict
};
