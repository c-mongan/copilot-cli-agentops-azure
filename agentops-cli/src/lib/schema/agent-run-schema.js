const {
  AGENTOPS_SCHEMA_VERSION,
  agentOpsEnums,
  optionalAgentOpsAttributes,
  recommendedGenAiAttributes,
  requiredAgentOpsAttributes,
  requiredGenAiAttributes,
  requiredMcpAttributes,
  runChildSpanNames,
  sensitiveContentAttributes
} = require('./agentops-attributes');

function hasValue(value) {
  return value !== undefined && value !== null && String(value) !== '';
}

function missingAttributes(attributes, required) {
  return required.filter(key => !hasValue(attributes[key]));
}

function enumViolations(attributes) {
  return Object.entries(agentOpsEnums)
    .filter(([key, allowed]) => hasValue(attributes[key]) && !allowed.includes(String(attributes[key])))
    .map(([key, allowed]) => ({ key, value: attributes[key], allowed }));
}

function contentViolations(attributes, { privacyMode = attributes['agentops.privacy.mode'] || 'strict' } = {}) {
  if (privacyMode !== 'strict') return [];
  return sensitiveContentAttributes.filter(key => hasValue(attributes[key]));
}

function validateAgentRun(input = {}) {
  const attributes = input.attributes || input;
  const errors = [];
  const warnings = [];

  for (const key of missingAttributes(attributes, requiredAgentOpsAttributes)) {
    errors.push(`missing required AgentOps attribute: ${key}`);
  }

  for (const key of missingAttributes(attributes, requiredGenAiAttributes)) {
    warnings.push(`missing recommended GenAI run attribute: ${key}`);
  }

  for (const violation of enumViolations(attributes)) {
    errors.push(`${violation.key}=${violation.value} must be one of ${violation.allowed.join(', ')}`);
  }

  for (const key of contentViolations(attributes)) {
    errors.push(`strict privacy mode must not export content attribute: ${key}`);
  }

  if (hasValue(attributes['agentops.schema.version']) && String(attributes['agentops.schema.version']) !== AGENTOPS_SCHEMA_VERSION) {
    warnings.push(`schema version is ${attributes['agentops.schema.version']}; expected ${AGENTOPS_SCHEMA_VERSION}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function validateMcpSpan(input = {}) {
  const attributes = input.attributes || input;
  const errors = missingAttributes(attributes, requiredMcpAttributes)
    .map(key => `missing required MCP attribute: ${key}`);
  if (attributes['gen_ai.operation.name'] && attributes['gen_ai.operation.name'] !== 'execute_tool') {
    errors.push('MCP tool spans must map to gen_ai.operation.name=execute_tool');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

function exampleAgentRunAttributes() {
  return {
    'agentops.schema.version': AGENTOPS_SCHEMA_VERSION,
    'agentops.run.id': 'run_demo_001',
    'agentops.session.id': 'session_demo_001',
    'agentops.surface': 'cli',
    'agentops.privacy.mode': 'strict',
    'agentops.content_capture.mode': 'off',
    'agentops.content_capture.signal': false,
    'agentops.repo.hash': 'repohash_demo',
    'agentops.branch.hash': 'branchhash_demo',
    'agentops.task.type': 'fix',
    'agentops.outcome.status': 'success',
    'agentops.duration.ms': 12345,
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'github.copilot',
    'gen_ai.conversation.id': 'session_demo_001',
    'gen_ai.request.model': 'copilot-default',
    'gen_ai.usage.input_tokens': 1000,
    'gen_ai.usage.output_tokens': 200
  };
}

function schemaDocument() {
  return {
    version: AGENTOPS_SCHEMA_VERSION,
    trace: {
      root_span: 'agentops.run',
      child_spans: runChildSpanNames
    },
    required_agentops_attributes: requiredAgentOpsAttributes,
    optional_agentops_attributes: optionalAgentOpsAttributes,
    required_genai_attributes: requiredGenAiAttributes,
    recommended_genai_attributes: recommendedGenAiAttributes,
    required_mcp_attributes: requiredMcpAttributes,
    strict_mode_forbidden_content_attributes: sensitiveContentAttributes,
    enums: agentOpsEnums
  };
}

module.exports = {
  exampleAgentRunAttributes,
  schemaDocument,
  validateAgentRun,
  validateMcpSpan
};
