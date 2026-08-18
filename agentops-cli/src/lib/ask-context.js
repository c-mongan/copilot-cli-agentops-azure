function createAskContext(dependencies = {}) {
  const {
    buildLink,
    latestSessionAzureQuery,
    latestSummaryFromArgs,
    parseLastArg,
    portalLogsUrl,
    sessionsGrafanaDashboardUrl,
    validateKqlDuration,
    workspaceId
  } = dependencies;

  function askAgentOpsContext(options = {}) {
    const last = validateKqlDuration(options.last || '24h');
    const target = options.sessionId || 'latest';
    let session = null;
    let link = null;
    let dataMissing = [];

    if (target === 'latest') {
      const summary = options.summary || latestSummaryFromArgs(options.args || [], last);
      session = summary.session;
      dataMissing = summary.data_missing || [];
      if (session?.id && session.id !== 'unknown-session') {
        link = buildLink('session', session.id, { last });
      }
    } else {
      session = { id: target };
      link = buildLink('session', target, { last });
    }

    const sessionId = session?.id || 'unknown-session';
    const prompt = [
      'Use the telemetry-investigator agent with read-only Azure MCP and Grafana MCP.',
      '',
      `Investigate AgentOps session ${sessionId} over the last ${last}.`,
      `Grafana session URL: ${link?.grafana_url || sessionsGrafanaDashboardUrl}`,
      `Log Analytics workspace: ${workspaceId}`,
      '',
      'Start from the KQL query in this context bundle. Return only evidence-backed findings.',
      'For each recommendation include: evidence query or dashboard link, observed pattern, proposed file(s), expected metric movement, validation benchmark or query, and rollback condition.',
      'Do not edit files yet. Do not request prompt, response, tool argument, tool result, secret, URL content, or file-content capture.'
    ].join('\n');

    return {
      ok: Boolean(link),
      session: sessionId,
      last,
      dashboard: link?.grafana_url || sessionsGrafanaDashboardUrl,
      azure_portal_url: link?.azure_portal_url || portalLogsUrl,
      workspace_id: workspaceId,
      query: link?.query || latestSessionAzureQuery(last),
      mcp_configs: [
        'copilot/mcp.azure-monitor.sample.json',
        'copilot/mcp.grafana.sample.json'
      ],
      prompt,
      data_missing: dataMissing
    };
  }

  function parseAskContextArgs(args) {
    const sessionId = args[0] || 'latest';
    return {
      sessionId,
      last: parseLastArg(args.slice(1), '24h'),
      json: args.includes('--json'),
      args: args.slice(1)
    };
  }

  function renderAskContext(context) {
    const lines = [
      'AgentOps ask context',
      '',
      `Session: ${context.session}`,
      `Dashboard: ${context.dashboard}`,
      `Workspace: ${context.workspace_id}`,
      `MCP configs: ${context.mcp_configs.join(', ')}`,
      ''
    ];

    if (context.data_missing.length > 0) {
      lines.push(`Data missing: ${context.data_missing.join(', ')}.`, '');
    }

    lines.push('KQL:', context.query, '', 'Prompt:', context.prompt);
    return `${lines.join('\n')}\n`;
  }

  return {
    askAgentOpsContext,
    parseAskContextArgs,
    renderAskContext
  };
}

module.exports = {
  createAskContext
};
