const { stableHash } = require('./privacy');

const safeEventFields = new Set([
  'TimeGenerated', 'Sequence', 'EventId', 'ParentEventId', 'RunId', 'SessionId',
  'TraceId', 'Surface', 'SchemaVersion', 'EventName', 'SpanName', 'Status',
  'AgentName', 'ParentAgentName', 'SubAgentName', 'SkillName', 'ToolName',
  'McpServerName', 'McpToolName', 'ModelRequested', 'ModelActual', 'Provider',
  'InputTokens', 'OutputTokens',
  'ReasoningTokens', 'CacheReadTokens', 'CacheWriteTokens', 'TotalTokens',
  'TotalToolCalls', 'CopilotCost', 'EstimatedCostUsd', 'DurationMs',
  'PermissionKind', 'PermissionDecision', 'ErrorType', 'PremiumRequests',
  'TotalNanoAiu', 'ApiDurationMs', 'LinesAdded', 'LinesRemoved', 'FilesModified',
  'ContentCaptureSignal', 'ContentDroppedBytes', 'ContentKind', 'ContentAction',
  'SecretLike', 'PrivacyMode', 'ContentCaptureMode', 'RepoHash', 'BranchHash',
  'WorkingDirectoryHash', 'CommandName', 'ScriptName', 'PromptHash',
  'PromptSizeBytes', 'ArgsSchemaHash', 'ArgsSizeBytes', 'ResultSizeBytes',
  'ErrorSizeBytes'
]);

const otelAttributeMap = {
  RunId: 'agentops.run.id', SessionId: 'agentops.session.id', Surface: 'agentops.surface',
  SchemaVersion: 'agentops.schema.version', PrivacyMode: 'agentops.privacy.mode',
  ContentCaptureMode: 'agentops.content_capture.mode', ContentCaptureSignal: 'agentops.content_capture.signal',
  ContentDroppedBytes: 'agentops.content.dropped_bytes', ContentKind: 'agentops.content.kind',
  ContentAction: 'agentops.content.action', SecretLike: 'agentops.content.secret_like',
  EventId: 'agentops.custom_event_id', ParentEventId: 'agentops.parent_event_id',
  Sequence: 'agentops.event.sequence', EventName: 'agentops.event.name',
  AgentName: 'agentops.agent.name', ParentAgentName: 'agentops.parent_agent.name',
  SubAgentName: 'agentops.sub_agent.name', SkillName: 'agentops.skill.name',
  ToolName: 'gen_ai.tool.name', McpServerName: 'agentops.mcp.server', McpToolName: 'agentops.mcp.tool',
  ModelRequested: 'gen_ai.request.model', ModelActual: 'gen_ai.response.model', Provider: 'gen_ai.provider.name',
  InputTokens: 'gen_ai.usage.input_tokens',
  OutputTokens: 'gen_ai.usage.output_tokens', ReasoningTokens: 'gen_ai.usage.reasoning.output_tokens',
  CacheReadTokens: 'gen_ai.usage.cache_read.input_tokens', CacheWriteTokens: 'gen_ai.usage.cache_creation.input_tokens',
  TotalTokens: 'gen_ai.usage.total_tokens', TotalToolCalls: 'agentops.tools.count',
  CopilotCost: 'github.copilot.cost', EstimatedCostUsd: 'agentops.cost.estimated_usd',
  DurationMs: 'agentops.duration.ms', PermissionKind: 'agentops.permission.kind',
  PermissionDecision: 'agentops.permission.decision', ErrorType: 'error.type',
  PremiumRequests: 'github.copilot.premium_requests', TotalNanoAiu: 'github.copilot.aiu.nano',
  ApiDurationMs: 'agentops.api.duration_ms', LinesAdded: 'agentops.lines.added',
  LinesRemoved: 'agentops.lines.removed', FilesModified: 'agentops.files.edited_count',
  RepoHash: 'agentops.repo.hash', BranchHash: 'agentops.branch.hash',
  WorkingDirectoryHash: 'agentops.workspace.hash', Status: 'agentops.outcome',
  CommandName: 'agentops.command.name', ScriptName: 'agentops.script.name',
  PromptHash: 'agentops.prompt.hash', PromptSizeBytes: 'agentops.prompt.size_bytes',
  ArgsSchemaHash: 'agentops.tool.args_schema_hash', ArgsSizeBytes: 'agentops.tool.args_size_bytes',
  ResultSizeBytes: 'agentops.tool.result_size_bytes', ErrorSizeBytes: 'agentops.error.size_bytes'
};

function createSafeEventNormalizer(options = {}) {
  let sequence = 0;
  const context = options.context || {};
  return function normalizeEvent(input = {}) {
    const source = { ...context, ...input };
    const next = Number.isInteger(source.Sequence) && source.Sequence > sequence ? source.Sequence : sequence + 1;
    sequence = next;
    const parsed = new Date(source.TimeGenerated || Date.now());
    const time = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    const name = String(source.EventName || 'agentops.event').slice(0, 200);
    const normalized = {
      ...source,
      TimeGenerated: time,
      Sequence: next,
      EventId: source.EventId || stableHash(`${source.SessionId || 'session'}:${next}:${name}:${time}`, 'event'),
      ParentEventId: source.ParentEventId || '',
      SchemaVersion: '2',
      EventName: name,
      SpanName: String(source.SpanName || name).slice(0, 200)
    };
    return Object.fromEntries(Object.entries(normalized).filter(([key, value]) => (
      safeEventFields.has(key) && value !== undefined && value !== null
    )));
  };
}

module.exports = { createSafeEventNormalizer, otelAttributeMap, safeEventFields };
