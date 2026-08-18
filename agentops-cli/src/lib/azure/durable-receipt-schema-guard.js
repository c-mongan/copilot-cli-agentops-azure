const durableReceiptSchema = Object.freeze({
  TimeGenerated: 'datetime',
  Sequence: 'long',
  EventId: 'string',
  ParentEventId: 'string',
  RunId: 'string', SessionId: 'string', TraceId: 'string', Surface: 'string',
  EventName: 'string', SpanName: 'string', Status: 'string',
  AgentName: 'string', ParentAgentName: 'string', SubAgentName: 'string', SkillName: 'string',
  CommandName: 'string', ScriptName: 'string', ToolName: 'string', McpServerName: 'string', McpToolName: 'string',
  ModelActual: 'string',
  InputTokens: 'long', OutputTokens: 'long', ReasoningTokens: 'long', CacheReadTokens: 'long', CacheWriteTokens: 'long', TotalTokens: 'long',
  // Azure custom-table column types are immutable. Keep the deployed legacy
  // integer column and use an additive real column for precise receipt cost.
  EstimatedCostUsd: 'long', EstimatedCostUsdReal: 'real', CopilotCost: 'real', PremiumRequests: 'long', TotalNanoAiu: 'long', ApiDurationMs: 'long',
  PermissionDecision: 'string', PermissionKind: 'string', ErrorType: 'string', TotalToolCalls: 'long', DurationMs: 'long',
  LinesAdded: 'long', LinesRemoved: 'long', FilesModified: 'long',
  PrivacyMode: 'string', ContentCaptureMode: 'string', ContentCaptureSignal: 'boolean', ContentAction: 'string',
  ContentDroppedBytes: 'long', SecretLike: 'boolean', RepoHash: 'string', BranchHash: 'string', WorkingDirectoryHash: 'string',
  SchemaVersion: 'string'
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

function columnsFromTable(payload) {
  return asArray(payload?.properties?.schema?.columns || payload?.schema?.columns || payload?.columns);
}

function columnsFromDcr(payload) {
  return asArray(payload?.properties?.streamDeclarations?.['Custom-AgentOpsEvents_CL']?.columns
    || payload?.streamDeclarations?.['Custom-AgentOpsEvents_CL']?.columns);
}

function compareColumns(columns, expected = durableReceiptSchema) {
  const observed = new Map(columns.map(column => [String(column?.name || ''), String(column?.type || '').toLowerCase()]));
  const drift = Object.entries(expected).flatMap(([name, type]) => {
    const actual = observed.get(name);
    if (!actual) return [{ column: name, expected: type, actual: null, issue: 'missing' }];
    if (actual !== type) return [{ column: name, expected: type, actual, issue: 'type_mismatch' }];
    return [];
  });
  return {
    ok: drift.length === 0,
    expected,
    observed: Object.fromEntries(Object.keys(expected).map(name => [name, observed.get(name) || null])),
    drift
  };
}

function immutableId(resource) {
  return resource?.properties?.immutableId || resource?.immutableId || '';
}

function validateDurableReceiptAzureSchema(options = {}) {
  const { runAz, resourceGroup, workspaceName, dcrImmutableId } = options;
  if (typeof runAz !== 'function') throw new TypeError('validateDurableReceiptAzureSchema requires a read-only Azure runner');
  if (!resourceGroup || !workspaceName || !dcrImmutableId) {
    return {
      ok: true,
      skipped: true,
      detail: 'Configure workspace name and DCR immutable ID to validate the live durable receipt schema.',
      table: null,
      dcr: null
    };
  }

  const tableResult = runAz([
    'monitor', 'log-analytics', 'workspace', 'table', 'show',
    '--resource-group', resourceGroup,
    '--workspace-name', workspaceName,
    '--name', 'AgentOpsEvents_CL',
    '-o', 'json'
  ]);
  const tablePayload = tableResult.status === 0 ? safeJson(tableResult.stdout) : null;
  const table = tableResult.status === 0
    ? compareColumns(columnsFromTable(tablePayload))
    : { ok: false, drift: [], error: errorDetail(tableResult, 'could not read AgentOpsEvents_CL schema') };

  const listResult = runAz([
    'monitor', 'data-collection', 'rule', 'list',
    '--resource-group', resourceGroup,
    '-o', 'json'
  ]);
  const rules = listResult.status === 0 ? asArray(safeJson(listResult.stdout)) : [];
  const matchingRule = rules.find(rule => immutableId(rule) === dcrImmutableId);
  const dcr = listResult.status !== 0
    ? { ok: false, drift: [], error: errorDetail(listResult, 'could not list data collection rules') }
    : !matchingRule
      ? { ok: false, drift: [], error: `DCR ${dcrImmutableId} was not found in resource group ${resourceGroup}` }
      : compareColumns(columnsFromDcr(matchingRule));

  return {
    ok: table.ok && dcr.ok,
    skipped: false,
    contract: durableReceiptSchema,
    table,
    dcr,
    dcr_name: matchingRule?.name || null,
    detail: table.ok && dcr.ok
      ? 'live AgentOpsEvents_CL and DCR stream match the durable receipt schema contract'
      : 'live durable receipt schema drift detected; preserve EstimatedCostUsd as long and add the durable receipt columns before relying on exact ordered Azure proof'
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

function errorDetail(result, fallback) {
  return String(result?.stderr || result?.stdout || fallback).trim();
}

module.exports = {
  columnsFromDcr,
  columnsFromTable,
  compareColumns,
  durableReceiptSchema,
  validateDurableReceiptAzureSchema
};
