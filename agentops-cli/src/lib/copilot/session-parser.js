function properties(row = {}) {
  if (row.Properties && typeof row.Properties === 'object') return row.Properties;
  if (typeof row.Properties === 'string') {
    try {
      return JSON.parse(row.Properties);
    } catch {
      return {};
    }
  }
  return row;
}

function sessionIdForRow(row = {}) {
  const props = properties(row);
  return row.SessionId
    || props['agentops.session.id']
    || props['gen_ai.conversation.id']
    || props['github.copilot.interaction_id']
    || row.OperationId
    || '';
}

function runIdForRow(row = {}) {
  const props = properties(row);
  return row.RunId || props['agentops.run.id'] || sessionIdForRow(row) || '';
}

function parseCopilotSessionRows(rows = []) {
  const sessions = new Map();
  for (const row of rows) {
    const sessionId = sessionIdForRow(row);
    if (!sessionId) continue;
    const props = properties(row);
    const entry = sessions.get(sessionId) || {
      sessionId,
      runIds: new Set(),
      rows: 0,
      failures: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: row.TimeGenerated || '',
      endedAt: row.TimeGenerated || ''
    };
    const operation = row.Operation || props['gen_ai.operation.name'] || '';
    const toolName = row.ToolName || props['gen_ai.tool.name'] || '';
    const failed = row.Success === false || String(row.Success).toLowerCase() === 'false' || Boolean(row.ErrorType || props['error.type']);
    entry.runIds.add(runIdForRow(row));
    entry.rows += 1;
    entry.failures += failed ? 1 : 0;
    entry.toolCalls += operation === 'execute_tool' || toolName ? 1 : 0;
    entry.inputTokens += Number(row.InputTokens || props['gen_ai.usage.input_tokens'] || 0);
    entry.outputTokens += Number(row.OutputTokens || props['gen_ai.usage.output_tokens'] || 0);
    if (row.TimeGenerated && (!entry.startedAt || row.TimeGenerated < entry.startedAt)) entry.startedAt = row.TimeGenerated;
    if (row.TimeGenerated && (!entry.endedAt || row.TimeGenerated > entry.endedAt)) entry.endedAt = row.TimeGenerated;
    sessions.set(sessionId, entry);
  }
  return [...sessions.values()].map(session => ({
    ...session,
    runIds: [...session.runIds].filter(Boolean)
  }));
}

module.exports = {
  parseCopilotSessionRows,
  properties,
  runIdForRow,
  sessionIdForRow
};
