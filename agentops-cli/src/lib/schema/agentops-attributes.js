const AGENTOPS_SCHEMA_VERSION = '2';

const requiredAgentOpsAttributes = [
  'agentops.schema.version',
  'agentops.run.id',
  'agentops.session.id',
  'agentops.surface',
  'agentops.privacy.mode',
  'agentops.content_capture.mode',
  'agentops.content_capture.signal',
  'agentops.repo.hash',
  'agentops.branch.hash',
  'agentops.task.type',
  'agentops.outcome.status',
  'agentops.duration.ms'
];

const optionalAgentOpsAttributes = [
  'agentops.workspace.hash',
  'agentops.command.hash',
  'agentops.agent.name',
  'agentops.parent_agent.name',
  'agentops.sub_agent.name',
  'agentops.delegation.id',
  'agentops.skill.name',
  'agentops.model.requested',
  'agentops.model.actual',
  'agentops.outcome.reason',
  'agentops.error.type',
  'agentops.retry.count',
  'agentops.tools.count',
  'agentops.tools.failed_count',
  'agentops.tools.denied_count',
  'agentops.tests.ran',
  'agentops.tests.passed',
  'agentops.tests.command_hash',
  'agentops.files.read_count',
  'agentops.files.edited_count',
  'agentops.files.sensitive_touched',
  'agentops.pr.opened',
  'agentops.pr.number_hash',
  'agentops.ci.status',
  'agentops.cost.estimated_usd',
  'agentops.context.window_pct',
  'agentops.context.tokens_removed',
  'agentops.cache.read_input_tokens',
  'agentops.cache.creation_input_tokens',
  'agentops.permission.wait_ms',
  'agentops.risk.score',
  'agentops.eval.overall',
  'agentops.eval.test_discipline',
  'agentops.eval.security',
  'agentops.eval.tool_efficiency'
];

const requiredGenAiAttributes = [
  'gen_ai.operation.name',
  'gen_ai.provider.name',
  'gen_ai.conversation.id'
];

const recommendedGenAiAttributes = [
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.reasoning.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'error.type',
  'server.address'
];

const requiredMcpAttributes = [
  'mcp.method.name',
  'mcp.session.id',
  'mcp.transport',
  'gen_ai.operation.name',
  'gen_ai.tool.name'
];

const agentOpsEnums = {
  'agentops.surface': ['cli', 'sdk', 'vscode_mcp', 'github_action', 'cloud_agent', 'custom'],
  'agentops.privacy.mode': ['strict', 'compat', 'unsafe'],
  'agentops.content_capture.mode': ['off', 'signal_only', 'redacted', 'full'],
  'agentops.task.type': ['explain', 'review', 'test', 'fix', 'refactor', 'docs', 'debug_ci', 'unknown'],
  'agentops.outcome.status': ['success', 'failed', 'cancelled', 'blocked', 'unknown']
};

const sensitiveContentAttributes = [
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.prompt',
  'gen_ai.completion',
  'http.request.body.content',
  'http.response.body.content',
  'url.full',
  'code.filepath'
];

const runChildSpanNames = [
  'agentops.session',
  'gen_ai.chat',
  'gen_ai.execute_tool',
  'mcp.tools.call',
  'agentops.tool.shell',
  'agentops.file.edit',
  'agentops.test.run',
  'agentops.policy.decision',
  'agentops.privacy.signal',
  'github.pr.outcome',
  'agentops.eval'
];

module.exports = {
  AGENTOPS_SCHEMA_VERSION,
  agentOpsEnums,
  optionalAgentOpsAttributes,
  recommendedGenAiAttributes,
  requiredAgentOpsAttributes,
  requiredGenAiAttributes,
  requiredMcpAttributes,
  runChildSpanNames,
  sensitiveContentAttributes
};
