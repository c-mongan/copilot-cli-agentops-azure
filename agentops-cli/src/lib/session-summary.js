const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { numberValue } = require('./benchmark-scoring');
const { readJsonlRows } = require('./json');
const { validateKqlDuration } = require('./kql');
const {
  baseFilter,
  directSessionKey,
  encodeGrafanaValue,
  fallbackSessionKey
} = require('./observability-queries');
const {
  attributeValue,
  booleanAttribute,
  isFailedRow,
  isSpanTelemetryRow,
  numberAttribute,
  operationFromRow,
  rowAttributes,
  sessionFromRow,
  telemetryTime
} = require('./session-row-utils');

function createSessionSummary(config = {}) {
  const {
    buildLink,
    appInsightsResourceUrl = '',
    agentsViewUrl = '',
    cloudVerified = false,
    configuredWorkspaceId = '',
    mainGrafanaDashboardUrl,
    optionValue,
    parseLastArg,
    sessionsGrafanaDashboardUrl,
    v2HomeGrafanaDashboardUrl,
    v2ReplayGrafanaDashboardUrl,
    v2RunsGrafanaDashboardUrl,
    workspaceId
  } = config;

  function summarizeSession(sessionId, spans, source = 'local') {
    const spanRows = spans.filter(isSpanTelemetryRow);
    const tools = new Set();
    const models = new Set();
    const agents = new Set();
    const skills = new Set();
    const subagents = new Set();
    const mcpServers = new Set();
    const cliTools = new Set();
    const scripts = new Set();
    const outcomes = new Set();
    const ciStatuses = new Set();
    const e2eIds = new Set();
    const allUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
    const chatUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
    let estimatedUsd = 0;
    let toolCalls = 0;
    let failedTools = 0;
    let failures = 0;
    let policyBlocks = 0;
    let declaredDeniedTools = 0;
    let observedDeniedTools = 0;
    let privacyBlockedCount = 0;
    let testsRan = false;
    let testsPassed = null;
    let prOpened = false;
    let tokensRemoved = 0;
    let contentCaptureWarning = false;
    let contentDroppedSignal = false;
    let runSummaryRows = 0;
    let declaredDurationMs = 0;
    let latestTime = null;
    let earliestTime = null;

    for (const row of spanRows) {
      const attrs = rowAttributes(row);
      const operation = operationFromRow(row, attrs);
      const tool = row.ToolName || attributeValue(attrs, ['gen_ai.tool.name', 'tool']);
      const model = row.ModelActual || row.ModelRequested || attributeValue(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'model']);
      const agent = row.AgentName || attributeValue(attrs, ['gen_ai.agent.name', 'gen_ai.agent.id', 'agent']);
      const skill = row.SkillName || attributeValue(attrs, ['agentops.skill.name', 'github.copilot.skill.name']);
      const subagent = row.SubAgentName || attributeValue(attrs, ['agentops.sub_agent.name', 'agentops.child_agent.name']);
      const mcpServer = row.McpServerName || attributeValue(attrs, ['agentops.mcp.server', 'mcp.server.name']);
      const cliTool = row.CliName || attributeValue(attrs, ['agentops.cli.name']);
      const script = row.ScriptName || attributeValue(attrs, ['agentops.script.name']);
      const outcome = row.OutcomeStatus || attributeValue(attrs, ['agentops.outcome']);
      const ciStatus = row.CiStatus || attributeValue(attrs, ['agentops.ci.status', 'github.ci.status']);
      const e2eId = attributeValue(attrs, ['agentops.e2e.id']);
      const eventName = String(row.EventName || row.event || row.Name || row.name || '');
      const failed = isFailedRow(row, attrs);
      const timeValue = telemetryTime(row.TimeGenerated || row.timestamp || row.time || row.startTime);
      const time = timeValue ? new Date(timeValue) : null;
      const contentCaptureMode = String(row.ContentCaptureMode || attributeValue(attrs, ['agentops.content_capture.mode']) || '').toLowerCase();
      const contentCaptureSignal = row.ContentCaptureSignal === true || String(row.ContentCaptureSignal || '').toLowerCase() === 'true';

      if (tool) tools.add(String(tool));
      if (model) models.add(String(model));
      if (agent) agents.add(String(agent));
      if (skill) skills.add(String(skill));
      if (subagent) subagents.add(String(subagent));
      if (mcpServer) mcpServers.add(String(mcpServer));
      if (cliTool) cliTools.add(String(cliTool));
      if (script) scripts.add(String(script));
      if (outcome) outcomes.add(String(outcome));
      if (ciStatus) ciStatuses.add(String(ciStatus));
      if (e2eId) e2eIds.add(String(e2eId));
      if (operation === 'execute_tool' || tool) {
        toolCalls += 1;
        if (failed) failedTools += 1;
      }
      toolCalls += numberValue(row.ToolCount);
      failedTools += numberValue(row.ToolFailureCount);
      if (failed) failures += 1;
      const policyBlocked = attributeValue(attrs, ['agentops.policy.blocked']);
      const mcpAllowed = attributeValue(attrs, ['agentops.mcp.allowed']);
      const rowDeniedCount = numberValue(row.ToolDeniedCount);
      declaredDeniedTools += rowDeniedCount;
      if (row.Allowed === false || String(row.Allowed).toLowerCase() === 'false' || mcpAllowed === false || String(mcpAllowed).toLowerCase() === 'false') {
        observedDeniedTools += 1;
      }
      const policySignal = /^(?:preToolUse|permissionRequest|policy)(?:\.|$)/i.test(eventName)
        || policyBlocked === true
        || String(policyBlocked).toLowerCase() === 'true'
        || mcpAllowed === false
        || String(mcpAllowed).toLowerCase() === 'false'
        || rowDeniedCount > 0;
      if (policySignal) policyBlocks += rowDeniedCount || 1;
      privacyBlockedCount += numberValue(row.DroppedCount || row.PrivacyBlockedCount);
      if (row.TestsRan === true || String(row.TestsRan).toLowerCase() === 'true') testsRan = true;
      if (row.TestsPassed === false || String(row.TestsPassed).toLowerCase() === 'false') testsPassed = false;
      else if (row.TestsPassed === true || String(row.TestsPassed).toLowerCase() === 'true') testsPassed ??= true;
      if (row.PrOpened === true || String(row.PrOpened).toLowerCase() === 'true') prOpened = true;
      if (/truncation|compaction|too much context/i.test(eventName)) tokensRemoved += 1;
      if (row.RunId && row.OutcomeStatus) runSummaryRows += 1;
      declaredDurationMs = Math.max(declaredDurationMs, numberValue(row.DurationMs));
      if (booleanAttribute(attrs, ['content.capture.enabled', 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'])) contentCaptureWarning = true;
      if (attributeValue(attrs, ['gen_ai.prompt', 'gen_ai.completion', 'prompt', 'completion'])) contentCaptureWarning = true;
      if (contentCaptureSignal && ['signal_only', 'off'].includes(contentCaptureMode)) contentDroppedSignal = true;
      if (contentCaptureSignal && !['signal_only', 'off'].includes(contentCaptureMode)) contentCaptureWarning = true;

      const inputTokenValue = numberValue(row.InputTokens) || numberAttribute(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens']);
      const outputTokenValue = numberValue(row.OutputTokens) || numberAttribute(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens']);
      const creditValue = numberAttribute(attrs, ['github.copilot.cost', 'Credits', 'credits']);
      const estimatedUsdValue = numberValue(row.EstimatedCostUsd);
      if (estimatedUsdValue) estimatedUsd += estimatedUsdValue;
      if (inputTokenValue || outputTokenValue || creditValue || estimatedUsdValue) {
        allUsage.inputTokens += inputTokenValue;
        allUsage.outputTokens += outputTokenValue;
        allUsage.credits += creditValue;
        allUsage.count += 1;
        if (operation === 'chat') {
          chatUsage.inputTokens += inputTokenValue;
          chatUsage.outputTokens += outputTokenValue;
          chatUsage.credits += creditValue;
          chatUsage.count += 1;
        }
      }
      tokensRemoved += numberAttribute(attrs, ['github.copilot.tokens_removed', 'tokens_removed']);

      if (time && !Number.isNaN(time.getTime())) {
        if (!latestTime || time > latestTime) latestTime = time;
        if (!earliestTime || time < earliestTime) earliestTime = time;
      }
    }

    const primaryUsage = chatUsage.count > 0 ? chatUsage : allUsage;
    const inputTokens = primaryUsage.inputTokens;
    const outputTokens = primaryUsage.outputTokens;
    const credits = primaryUsage.credits;

    const dataMissing = [];
    if (source === 'local') dataMissing.push('live Azure query');
    if (!latestTime) dataMissing.push('timestamps');
    if (inputTokens === 0 && outputTokens === 0) dataMissing.push('token totals');
    if (credits === 0 && estimatedUsd === 0) dataMissing.push('cost');
    const observedDurationMs = earliestTime && latestTime ? Math.max(0, latestTime - earliestTime) : null;
    const durationMs = declaredDurationMs || observedDurationMs;

    return {
      id: sessionId,
      source,
      started: earliestTime ? earliestTime.toISOString() : null,
      ended: latestTime ? latestTime.toISOString() : null,
      duration_ms: durationMs,
      spans: spanRows.length,
      run_summary_rows: runSummaryRows,
      tool_calls: toolCalls,
      failed_tools: failedTools,
      failures,
      tools: [...tools],
      models: [...models],
      agents: [...agents],
      e2e_id: [...e2eIds][0] || null,
      e2e_ids: [...e2eIds],
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      credits,
      est_usd: estimatedUsd || credits * 0.01,
      policy_blocks: policyBlocks,
      denied_tool_calls: Math.max(declaredDeniedTools, observedDeniedTools),
      privacy_blocked_count: privacyBlockedCount,
      skills: [...skills],
      subagents: [...subagents],
      mcp_servers: [...mcpServers],
      cli_tools: [...cliTools],
      scripts: [...scripts],
      outcomes: [...outcomes],
      tests_ran: testsRan,
      tests_passed: testsRan ? testsPassed : null,
      pr_opened: prOpened,
      ci_statuses: [...ciStatuses],
      tokens_removed: tokensRemoved,
      content_capture_warning: contentCaptureWarning,
      content_dropped_signal: contentDroppedSignal,
      grafana_url: sessionId === 'unknown-session' ? null : buildLink('session', sessionId).grafana_url,
      data_missing: dataMissing
    };
  }

  function latestSessionAzureQuery(last = '7d') {
    const lookback = validateKqlDuration(last);
    return `let base = AppDependencies
  | where TimeGenerated > ago(${lookback})
  | where ${baseFilter}
  | extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};
  let operation_sessions = base
  | where isnotempty(direct_session)
  | summarize operation_session=take_any(direct_session) by OperationId;
  let enriched = base
  | join kind=leftouter operation_sessions on OperationId
  | extend conversation=iff(isnotempty(operation_session), operation_session, iff(isnotempty(direct_session), direct_session, fallback_session));
  let latest_session = toscalar(enriched | summarize Ended=max(TimeGenerated) by conversation | top 1 by Ended desc | project conversation);
  enriched
  | where conversation == latest_session
  | project TimeGenerated, conversation, Name, Success, ResultCode, DurationMs, OperationId, ParentId, Id, Properties
  | order by TimeGenerated asc`;
  }

  function runAzureLogAnalyticsQuery(query, options = {}) {
    const spawnSync = options.spawnSync || childProcess.spawnSync;
    const effectiveWorkspaceId = options.workspaceId || workspaceId;

    if (!options.workspaceId && !configuredWorkspaceId && !options.spawnSync) {
      return {
        ok: false,
        rows: [],
        error: 'Set AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID or LOG_ANALYTICS_WORKSPACE_ID before running live Azure telemetry queries.'
      };
    }

    const result = spawnSync('az', [
      'monitor',
      'log-analytics',
      'query',
      '--workspace',
      effectiveWorkspaceId,
      '--analytics-query',
      query,
      '-o',
      'json'
    ], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });

    if (result.error) return { ok: false, rows: [], error: result.error.message };
    if (result.status !== 0) {
      return {
        ok: false,
        rows: [],
        error: (result.stderr || result.stdout || `az exited with status ${result.status}`).trim()
      };
    }

    try {
      return { ok: true, rows: JSON.parse(result.stdout || '[]'), error: null };
    } catch (error) {
      return { ok: false, rows: [], error: `Could not parse Azure query JSON: ${error.message}` };
    }
  }

  function latestAzureSessionSummary(options = {}) {
    const last = validateKqlDuration(options.last || '7d');
    const query = latestSessionAzureQuery(last);
    const result = runAzureLogAnalyticsQuery(query, options);

    if (!result.ok) {
      return {
        mode: 'azure',
        last,
        query,
        session: null,
        error: result.error,
        data_missing: ['live Azure query failed']
      };
    }

    if (!Array.isArray(result.rows) || result.rows.length === 0) {
      return {
        mode: 'azure',
        last,
        query,
        session: null,
        data_missing: [`no Copilot telemetry found in Azure for last ${last}`]
      };
    }

    return {
      ...latestSessionSummary({ rows: result.rows, source: 'azure' }),
      last,
      query
    };
  }

  function latestSessionSummary({ filePath = null, rows = null, source = null } = {}) {
    if (!filePath && !rows) {
      return {
        mode: 'missing-live',
        session: null,
        data_missing: ['live Azure query', 'local JSONL file', 'latest session id', 'token totals', 'cost']
      };
    }

    const sourceRows = rows || readJsonlRows(filePath);
    const summarySource = source || (filePath ? 'local' : 'azure');
    const sessions = new Map();
    const order = [];
    let currentSessionId = null;

    for (const row of sourceRows) {
      const attrs = rowAttributes(row);
      let sessionId = sessionFromRow(row, attrs);
      if (sessionId === 'unknown-session' && currentSessionId) sessionId = currentSessionId;
      if (sessionId !== 'unknown-session') currentSessionId = sessionId;
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, []);
        order.push(sessionId);
      }
      sessions.get(sessionId).push(row);
    }

    const summaries = order.map(sessionId => summarizeSession(sessionId, sessions.get(sessionId), summarySource));
    const withTime = summaries.filter(summary => summary.ended);
    const session = withTime.length > 0
      ? withTime.sort((a, b) => new Date(b.ended) - new Date(a.ended))[0]
      : summaries.at(-1) || null;

    return {
      mode: summarySource,
      file: filePath,
      session,
      data_missing: session ? session.data_missing : ['local JSONL rows']
    };
  }

  function listOrMissing(values, missing = 'not in this data') {
    return values.length > 0 ? values.join(', ') : missing;
  }

  function readableDuration(durationMs) {
    if (!Number.isFinite(durationMs)) return 'not in this data';
    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.round((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  function renderLatest(summary = latestSessionSummary()) {
    const lines = ['AgentOps receipt', 'Latest Copilot session', ''];

    if (!summary.session) {
      if (summary.mode === 'azure' && summary.error) {
        lines.push('I could not read live Azure telemetry.');
        lines.push(`Azure error: ${summary.error}`);
        lines.push('Use --file <jsonl> to summarize a local or fixture export.');
      } else if (summary.mode === 'azure') {
        lines.push(`No Copilot sessions were found in Azure for the last ${summary.last || '7d'}.`);
        lines.push('Run Copilot through AgentOps, then try again.');
      } else {
        lines.push('Use --file <jsonl> to summarize a local or fixture export, or run with Azure CLI access for live telemetry.');
      }
      lines.push(`Missing data: ${summary.data_missing.join(', ')}.`);
      lines.push(`Main dashboard: ${mainGrafanaDashboardUrl}`);
      return `${lines.join('\n')}\n`;
    }

    const session = summary.session;
    lines.push(`Result: ${session.failures > 0 ? 'Needs attention' : 'Completed'}`);
    lines.push(`Run: ${session.id}`);
    lines.push(`Time: ${readableDuration(session.duration_ms)}`);
    const workUnit = session.run_summary_rows > 0 ? 'run summary' : 'recorded step';
    lines.push(`Work: ${session.spans} ${workUnit}${session.spans === 1 ? '' : workUnit === 'run summary' ? ' rows' : 's'}, ${session.tool_calls} tool call${session.tool_calls === 1 ? '' : 's'}, ${session.failures} failure${session.failures === 1 ? '' : 's'}`);
    lines.push(`Used: agent ${listOrMissing(session.agents)}; model ${listOrMissing(session.models)}; tools ${listOrMissing(session.tools)}`);
    lines.push(`Agent work: skills ${listOrMissing(session.skills)}; subagents ${listOrMissing(session.subagents)}; MCP ${listOrMissing(session.mcp_servers)}`);
    lines.push(`Automation: CLI ${listOrMissing(session.cli_tools)}; scripts ${listOrMissing(session.scripts)}`);
    lines.push(`Outcome: ${listOrMissing(session.outcomes)}; tests ${session.tests_ran ? session.tests_passed === false ? 'failed' : 'passed' : 'not run'}; PR ${session.pr_opened ? 'opened' : 'not opened'}; CI ${listOrMissing(session.ci_statuses, 'not run')}`);
    lines.push(`Safety: ${session.denied_tool_calls} denied tool call${session.denied_tool_calls === 1 ? '' : 's'}; ${session.privacy_blocked_count} privacy field${session.privacy_blocked_count === 1 ? '' : 's'} blocked`);
    lines.push(`Tokens: ${session.input_tokens.toLocaleString('en-US')} in, ${session.output_tokens.toLocaleString('en-US')} out`);
    if (session.credits > 0) lines.push(`Copilot credits: ${session.credits.toLocaleString('en-US')}`);
    lines.push(session.est_usd > 0 ? `Estimated cost: $${session.est_usd.toFixed(2)}` : 'Estimated cost: not in this data');
    if (session.source === 'azure') {
      lines.push('Delivery: Visible in Azure');
      lines.push(`Coverage: ${session.run_summary_rows > 0 ? 'AgentOps managed' : 'Native best effort'}`);
    } else {
      lines.push('Delivery: Local evidence only · Azure not confirmed');
      lines.push('Coverage: Local export');
    }
    lines.push(session.content_capture_warning
      ? 'Privacy: content capture may be on. Do not share this export until reviewed.'
      : session.content_dropped_signal
        ? 'Privacy: sensitive fields were detected and dropped; prompts, answers, code, and tool arguments were not retained.'
        : 'Privacy: prompts, answers, code, and tool arguments were not recorded.');
    if (session.grafana_url) lines.push(`Open team view: ${session.grafana_url}`);
    if (session.data_missing.length > 0) lines.push(`Not available here: ${session.data_missing.join(', ')}.`);

    return `${lines.join('\n')}\n`;
  }

  function explainLatest(summary = latestSessionSummary()) {
    const session = summary.session;
    if (!session) {
      return {
        classification: 'unknown',
        headline: 'Not enough data yet',
        detail: summary.mode === 'azure' && summary.error
          ? `The Azure query failed: ${summary.error}`
          : 'No local JSONL rows or live Azure rows were available.',
        session: null
      };
    }

    if (session.content_capture_warning) {
      return {
        classification: 'content_capture_warning',
        headline: 'Content capture warning',
        detail: 'Prompts or code may have been recorded. Review the export before sharing it.',
        session
      };
    }

    if (session.policy_blocks > 0) {
      return {
        classification: 'policy_blocked',
        headline: 'No risky commands were allowed through',
        detail: `${session.policy_blocks} policy signal${session.policy_blocks === 1 ? '' : 's'} appeared in this session.`,
        session
      };
    }

    if (session.failed_tools > 0) {
      return {
        classification: 'failed_tool',
        headline: 'Tools kept failing',
        detail: `${session.failed_tools} tool call${session.failed_tools === 1 ? '' : 's'} failed. Check the tool waterfall in Grafana.`,
        session
      };
    }

    if (session.input_tokens >= 30000 || session.tokens_removed > 0) {
      return {
        classification: 'too_much_context',
        headline: 'Copilot had too much to remember',
        detail: 'The session shows high context use or compaction/truncation signals.',
        session
      };
    }

    if (session.est_usd >= 1) {
      return {
        classification: 'high_cost',
        headline: 'This session looked expensive',
        detail: `Estimated cost was $${session.est_usd.toFixed(2)}.`,
        session
      };
    }

    if (session.spans > 0 && session.failures === 0) {
      return {
        classification: 'success',
        headline: 'This session looks successful',
        detail: 'No failed tools, policy blocks, high context, or high cost signals were found.',
        session
      };
    }

    return {
      classification: 'unknown',
      headline: 'The issue is unclear',
      detail: 'The local data does not include enough signals to classify the session.',
      session
    };
  }

  function renderExplanation(explanation = explainLatest()) {
    const lines = ['Likely issue', '', explanation.headline, explanation.detail];
    if (explanation.session?.grafana_url) lines.push(`Open in Grafana: ${explanation.session.grafana_url}`);
    return `${lines.join('\n')}\n`;
  }

  function openLinksSummary(summary = latestSessionSummary()) {
    const latestSessionUrl = summary.session?.grafana_url || null;
    const primaryInvestigationUrl = agentsViewUrl || appInsightsResourceUrl || v2HomeGrafanaDashboardUrl;
    const primaryInvestigationLabel = agentsViewUrl
      ? 'Azure Monitor Agents view'
      : appInsightsResourceUrl
      ? 'Application Insights (open Agents)'
      : 'Grafana Today';
    return {
      primary_investigation_url: primaryInvestigationUrl,
      primary_investigation_label: primaryInvestigationLabel,
      cloud_verified: cloudVerified,
      azure_agents_view_url: agentsViewUrl || null,
      application_insights_url: appInsightsResourceUrl || null,
      main_dashboard_url: mainGrafanaDashboardUrl,
      sessions_dashboard_url: sessionsGrafanaDashboardUrl,
      v2_home_url: v2HomeGrafanaDashboardUrl,
      v2_runs_url: v2RunsGrafanaDashboardUrl,
      v2_replay_url: latestSessionUrl
        ? `${v2ReplayGrafanaDashboardUrl}?var-session_id=${encodeGrafanaValue(summary.session.id)}`
        : v2ReplayGrafanaDashboardUrl,
      latest_session_url: latestSessionUrl,
      missing_latest_reason: latestSessionUrl
        ? null
        : summary.session
        ? 'that session did not include a usable session id'
        : 'latest session was not found in the selected local file or Azure lookback window'
    };
  }

  function latestSummaryFromArgs(args, fallbackLast = '7d') {
    const filePath = optionValue(args, ['--file', '--jsonl']);
    if (filePath) return latestSessionSummary({ filePath: path.resolve(filePath) });

    return latestAzureSessionSummary({ last: parseLastArg(args, fallbackLast) });
  }


  return {
    attributeValue,
    explainLatest,
    isFailedRow,
    isSpanTelemetryRow,
    latestAzureSessionSummary,
    latestSessionAzureQuery,
    latestSessionSummary,
    latestSummaryFromArgs,
    numberAttribute,
    openLinksSummary,
    operationFromRow,
    readJsonlRows,
    renderExplanation,
    renderLatest,
    rowAttributes,
    runAzureLogAnalyticsQuery,
    sessionFromRow,
    summarizeSession,
    telemetryTime
  };
}

module.exports = {
  createSessionSummary
};
