const { escapeKqlString, validateKqlDuration } = require('./kql');
const { numberValue, roundNumber } = require('./benchmark-scoring');

function benchmarkAzureTelemetryQuery(runId, last = '24h') {
  const lookback = validateKqlDuration(last);
  const escapedRunId = escapeKqlString(runId);
  return `AppDependencies
| where TimeGenerated > ago(${lookback})
| where Properties has "${escapedRunId}"
| extend run_id=tostring(Properties["agentops.benchmark.run_id"]),
    suite=tostring(Properties["agentops.benchmark.suite"]),
    task_id=tostring(Properties["agentops.benchmark.task_id"]),
    variant=tostring(Properties["agentops.benchmark.variant"]),
    hypothesis=tostring(Properties["agentops.hypothesis.id"]),
    repeat_id=tostring(Properties["agentops.benchmark.repeat"]),
    conversation=tostring(Properties["gen_ai.conversation.id"]),
    operation=tostring(Properties["gen_ai.operation.name"]),
    model=tostring(Properties["gen_ai.request.model"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    error=tostring(Properties["error.type"]),
    InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]),
    OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]),
    CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]),
    CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]),
    Credits=todouble(Properties["github.copilot.cost"]),
    AIU=todouble(Properties["github.copilot.aiu"])
| where run_id == "${escapedRunId}"
| summarize Started=min(TimeGenerated),
    Ended=max(TimeGenerated),
    Spans=count(),
    ChatSpans=countif(operation == "chat"),
    AgentSpans=countif(operation == "invoke_agent"),
    ToolCalls=countif(operation == "execute_tool" or isnotempty(tool)),
    ToolFailures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
    Failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
    ChatInputTokens=sumif(InputTokens, operation == "chat"),
    ChatOutputTokens=sumif(OutputTokens, operation == "chat"),
    ChatCacheRead=sumif(CacheRead, operation == "chat"),
    ChatCacheWrite=sumif(CacheWrite, operation == "chat"),
    ChatCredits=sumif(Credits, operation == "chat"),
    ChatAIU=sumif(AIU, operation == "chat"),
    AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"),
    AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"),
    AgentCacheRead=maxif(CacheRead, operation == "invoke_agent"),
    AgentCacheWrite=maxif(CacheWrite, operation == "invoke_agent"),
    AgentCredits=maxif(Credits, operation == "invoke_agent"),
    AgentAIU=maxif(AIU, operation == "invoke_agent"),
    Models=make_set_if(model, isnotempty(model), 5),
    Tools=make_set_if(tool, isnotempty(tool), 10),
    Conversations=make_set_if(conversation, isnotempty(conversation), 5),
    Operations=make_set_if(operation, isnotempty(operation), 10)
    by run_id, suite, task_id, variant, hypothesis, repeat_id
| extend InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens),
    OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens),
    CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead),
    CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite),
    Credits=iff(ChatSpans > 0, ChatCredits, AgentCredits),
    AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)
| order by task_id asc, repeat_id asc`;
}

function arrayFromAzureValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeAiuValue(value) {
  const aiu = numberValue(value);
  return Math.abs(aiu) >= 1000000 ? roundNumber(aiu / 1000000000, 3) : aiu;
}

function normalizeBenchmarkTelemetryRow(row) {
  const credits = numberValue(row.Credits);
  const aiuRaw = numberValue(row.AIU);
  return {
    runId: row.run_id || row.RunId || row.runId,
    suite: row.suite || row.Suite || '',
    taskId: row.task_id || row.taskId || '',
    variant: row.variant || row.Variant || '',
    hypothesis: row.hypothesis || row.Hypothesis || '',
    repeat: row.repeat_id || row.repeat || '',
    startedAt: row.Started || row.startedAt || null,
    endedAt: row.Ended || row.endedAt || null,
    spans: numberValue(row.Spans),
    toolCalls: numberValue(row.ToolCalls),
    toolFailures: numberValue(row.ToolFailures),
    failures: numberValue(row.Failures),
    inputTokens: numberValue(row.InputTokens),
    outputTokens: numberValue(row.OutputTokens),
    cacheReadTokens: numberValue(row.CacheRead),
    cacheWriteTokens: numberValue(row.CacheWrite),
    credits,
    cost: roundNumber(credits * 0.01, 4),
    aiu: normalizeAiuValue(aiuRaw),
    aiuRaw,
    models: arrayFromAzureValue(row.Models),
    tools: arrayFromAzureValue(row.Tools),
    conversations: arrayFromAzureValue(row.Conversations),
    operations: arrayFromAzureValue(row.Operations)
  };
}

function benchmarkTelemetryKey(taskId, repeat) {
  return `${taskId || ''}::${repeat === undefined || repeat === null ? '' : String(repeat)}`;
}

function benchmarkAzureTelemetry(runId, options = {}) {
  if (!options.runAzureLogAnalyticsQuery) {
    throw new Error('benchmark Azure telemetry requires runAzureLogAnalyticsQuery');
  }

  const last = validateKqlDuration(options.last || '24h');
  const query = benchmarkAzureTelemetryQuery(runId, last);
  const result = options.runAzureLogAnalyticsQuery(query, options);

  if (!result.ok) {
    return {
      requested: true,
      ok: false,
      last,
      query,
      error: result.error,
      rows: [],
      matchedSpans: 0,
      matchedTasks: 0
    };
  }

  const rows = Array.isArray(result.rows) ? result.rows.map(normalizeBenchmarkTelemetryRow) : [];
  return {
    requested: true,
    ok: rows.length > 0,
    last,
    query,
    rows,
    matchedSpans: rows.reduce((total, row) => total + row.spans, 0),
    matchedTasks: rows.filter(row => row.taskId).length,
    data_missing: rows.length > 0 ? [] : ['azure benchmark telemetry']
  };
}

function enrichBenchmarkSummariesWithAzure(runId, summaries, options = {}) {
  const telemetry = benchmarkAzureTelemetry(runId, options);
  if (!telemetry.ok) return { summaries, azureTelemetry: telemetry };

  const byTaskAndRepeat = new Map();
  const byTask = new Map();
  for (const row of telemetry.rows) {
    byTaskAndRepeat.set(benchmarkTelemetryKey(row.taskId, row.repeat), row);
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, []);
    byTask.get(row.taskId).push(row);
  }

  const enriched = summaries.map(summary => {
    const repeat = summary.repeat === undefined || summary.repeat === null ? '' : summary.repeat;
    const exact = byTaskAndRepeat.get(benchmarkTelemetryKey(summary.taskId, repeat));
    const taskRows = byTask.get(summary.taskId) || [];
    const row = exact || (taskRows.length === 1 ? taskRows[0] : null);
    if (!row) return { ...summary, telemetryMatched: false };

    return {
      ...summary,
      telemetryMatched: true,
      telemetrySource: 'azure',
      azureSpans: row.spans,
      azureToolCalls: row.toolCalls,
      azureFailures: row.failures,
      startedAt: summary.startedAt || row.startedAt,
      endedAt: summary.endedAt || row.endedAt,
      toolFailures: Math.max(numberValue(summary.toolFailures), row.toolFailures),
      hypothesis: summary.hypothesis || row.hypothesis || null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      credits: row.credits,
      cost: row.cost,
      aiu: row.aiu,
      aiuRaw: row.aiuRaw,
      models: row.models,
      tools: row.tools,
      conversations: row.conversations,
      operations: row.operations,
      errorCategory: summary.errorCategory || (row.toolFailures > 0 ? 'tool_failure' : null)
    };
  });

  return {
    summaries: enriched,
    azureTelemetry: {
      requested: true,
      ok: true,
      last: telemetry.last,
      matchedSpans: telemetry.matchedSpans,
      matchedTasks: enriched.filter(summary => summary.telemetryMatched).length,
      unmatchedTasks: enriched.filter(summary => !summary.telemetryMatched).map(summary => summary.taskId),
      query: telemetry.query
    }
  };
}

module.exports = {
  arrayFromAzureValue,
  benchmarkAzureTelemetry,
  benchmarkAzureTelemetryQuery,
  benchmarkTelemetryKey,
  enrichBenchmarkSummariesWithAzure,
  normalizeAiuValue,
  normalizeBenchmarkTelemetryRow
};
