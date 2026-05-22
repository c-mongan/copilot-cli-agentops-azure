const path = require('node:path');

function createTelemetry({
  optionValue,
  parseLastArg,
  readJsonlRows,
  validateKqlDuration,
  latestSessionAzureQuery,
  runAzureLogAnalyticsQuery,
  rowAttributes,
  operationFromRow,
  attributeValue,
  numberAttribute,
  isFailedRow,
  sessionFromRow,
  numberValue,
  roundNumber
}) {
  function spanRowsFromSource(args, fallbackLast = '7d') {
    const filePath = optionValue(args, ['--file', '--jsonl']);
    if (filePath) {
      return {
        mode: 'local',
        file: path.resolve(filePath),
        rows: readJsonlRows(path.resolve(filePath)),
        query: null,
        error: null
      };
    }

    const last = validateKqlDuration(parseLastArg(args, fallbackLast));
    const query = latestSessionAzureQuery(last);
    const result = runAzureLogAnalyticsQuery(query);
    return {
      mode: 'azure',
      last,
      rows: result.ok ? result.rows : [],
      query,
      error: result.ok ? null : result.error
    };
  }

  function timelineEventFromRow(row) {
    const attrs = rowAttributes(row);
    const operation = operationFromRow(row, attrs);
    const tool = attributeValue(attrs, ['gen_ai.tool.name', 'tool']);
    const model = attributeValue(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
    const error = attributeValue(attrs, ['error.type', 'exception.type', 'error']);
    const message = `${row.Message || row.message || row.Name || row.name || ''} ${JSON.stringify(attrs)}`;
    const failed = isFailedRow(row, attrs);
    const inputTokens = numberAttribute(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens']);
    const outputTokens = numberAttribute(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens']);
    const credits = numberAttribute(attrs, ['github.copilot.cost', 'Credits', 'credits']);
    const tokensRemoved = numberAttribute(attrs, ['github.copilot.tokens_removed', 'tokens_removed']);
    const policy = /preToolUse|policy|blocked|denied/i.test(message);
    const context = /truncation|compaction|too much context/i.test(message) || tokensRemoved > 0;

    const eventType = policy
        ? 'policy'
        : context
          ? 'context'
          : operation === 'invoke_agent'
            ? 'agent'
            : operation === 'chat'
              ? 'llm'
              : operation === 'execute_tool' || tool
                ? 'tool'
                : failed
                  ? 'error'
                  : 'span';

    return {
      time: row.TimeGenerated || row.timestamp || row.time || row.startTime || null,
      session: sessionFromRow(row, attrs),
      type: eventType,
      event: operation,
      name: row.Name || row.name || operation,
      operationId: row.OperationId || row.operationId || row.trace_id || '',
      spanId: row.Id || row.id || row.span_id || '',
      parentId: row.ParentId || row.parentId || row.parent_id || '',
      tool: tool || '',
      model: model || '',
      durationMs: numberValue(row.DurationMs ?? row.durationMs ?? row.duration_ms),
      success: !failed,
      error: error || '',
      inputTokens,
      outputTokens,
      credits,
      estUsd: roundNumber(credits * 0.01, 4),
      tokensRemoved
    };
  }

  function replayTimeline(rows, options = {}) {
    const sessionId = options.sessionId || null;
    let currentSessionId = null;
    const events = rows
      .map(row => {
        const event = timelineEventFromRow(row);
        if (event.session === 'unknown-session' && currentSessionId) {
          event.session = currentSessionId;
        }
        if (event.session !== 'unknown-session') currentSessionId = event.session;
        return event;
      })
      .filter(event => !sessionId || sessionId === 'latest' || event.session === sessionId)
      .sort((left, right) => String(left.time || '').localeCompare(String(right.time || '')));

    const selectedSession = sessionId && sessionId !== 'latest'
      ? sessionId
      : [...events].reverse().find(event => event.session && event.session !== 'unknown-session')?.session || 'unknown-session';
    const selectedEvents = events.filter(event => selectedSession === 'unknown-session' || event.session === selectedSession);

    const usageEvents = selectedEvents.filter(event => event.inputTokens || event.outputTokens || event.credits || event.estUsd);
    const chatUsageEvents = usageEvents.filter(event => event.event === 'chat' || event.type === 'llm');
    const primaryUsageEvents = chatUsageEvents.length > 0 ? chatUsageEvents : usageEvents;
    const usage = primaryUsageEvents.reduce((totals, event) => ({
      inputTokens: totals.inputTokens + event.inputTokens,
      outputTokens: totals.outputTokens + event.outputTokens,
      credits: totals.credits + event.credits
    }), { inputTokens: 0, outputTokens: 0, credits: 0 });

    return {
      session: selectedSession,
      events: selectedEvents,
      summary: selectedEvents.length > 0 ? {
        id: selectedSession,
        source: options.source || 'local',
        spans: selectedEvents.length,
        tool_calls: selectedEvents.filter(event => event.type === 'tool').length,
        failed_tools: selectedEvents.filter(event => event.type === 'tool' && !event.success).length,
        failures: selectedEvents.filter(event => !event.success).length,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        credits: usage.credits,
        est_usd: roundNumber(usage.credits * 0.01, 4),
        policy_blocks: selectedEvents.filter(event => event.type === 'policy').length,
        tokens_removed: selectedEvents.reduce((total, event) => total + event.tokensRemoved, 0)
      } : null
    };
  }

  function renderReplay(timeline, options = {}) {
    const limit = options.limit || 50;
    const lines = [
      `Session replay: ${timeline.session}`,
      ''
    ];

    if (!timeline.events.length) {
      lines.push('No privacy-safe span or runtime events were found for that session.');
      return `${lines.join('\n')}\n`;
    }

    if (timeline.summary) {
      lines.push(`Events: ${timeline.events.length}. Tools: ${timeline.summary.tool_calls}. Failures: ${timeline.summary.failures}. Est. USD: $${timeline.summary.est_usd.toFixed(4)}.`);
      lines.push('');
    }

    for (const [index, event] of timeline.events.slice(-limit).entries()) {
      const time = event.time ? new Date(event.time).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z') : `event-${String(index + 1).padStart(4, '0')}`;
      const subject = event.tool || event.model || event.name || event.event;
      const status = event.success ? 'ok' : 'failed';
      const tokens = event.inputTokens || event.outputTokens ? ` tokens=${event.inputTokens}/${event.outputTokens}` : '';
      const cost = event.estUsd ? ` usd=${event.estUsd}` : '';
      const removed = event.tokensRemoved ? ` removed=${event.tokensRemoved}` : '';
      const error = event.error ? ` error=${event.error}` : '';
      lines.push(`${time}  ${event.type.padEnd(7)} ${status.padEnd(6)} ${String(subject || '').slice(0, 80)}${tokens}${cost}${removed}${error}`);
    }

    return `${lines.join('\n')}\n`;
  }

  function liveViewFromArgs(args) {
    const source = spanRowsFromSource(args, '2h');
    if (source.error) {
      return {
        ok: false,
        source,
        timeline: { session: 'unknown-session', events: [], summary: null }
      };
    }

    const timeline = replayTimeline(source.rows, { sessionId: 'latest', source: source.mode });
    return { ok: true, source, timeline };
  }

  function renderLive(view) {
    if (!view.ok) {
      return `AgentOps live\n\nCould not read live telemetry: ${view.source.error}\n`;
    }

    const lines = ['AgentOps live', ''];
    lines.push(`Source: ${view.source.mode}${view.source.last ? `, lookback ${view.source.last}` : ''}.`);
    lines.push(renderReplay(view.timeline, { limit: 20 }).trim());
    return `${lines.join('\n')}\n`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    liveViewFromArgs,
    replayTimeline,
    renderLive,
    renderReplay,
    sleep,
    spanRowsFromSource
  };
}

module.exports = {
  createTelemetry
};
