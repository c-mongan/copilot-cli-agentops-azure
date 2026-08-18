const { writeJson } = require('./command-output');

function createObservabilityQueryCommand(dependencies = {}) {
  const {
    attributionUsageQuery,
    buildLink,
    collectorHealthQuery,
    contextPressureQuery,
    fieldCatalogQuery,
    kqlFileQuery,
    otelCompatibilityQuery,
    parseLastArg,
    stdout = process.stdout,
    tokenRollupAuditQuery,
    workspaceId
  } = dependencies;
  const queryCommandSpecs = {
    fields: {
      defaultLast: '7d',
      query: fieldCatalogQuery
    },
    context: {
      defaultLast: '7d',
      query: contextPressureQuery
    },
    'token-rollup-audit': {
      defaultLast: '7d',
      query: tokenRollupAuditQuery
    },
    'collector-health': {
      defaultLast: '24h',
      query: collectorHealthQuery
    },
    'compat-check': {
      defaultLast: '2h',
      query: otelCompatibilityQuery
    },
    attribution: {
      defaultLast: '7d',
      query: attributionUsageQuery
    },
    'permission-friction': {
      defaultLast: '7d',
      query: last => kqlFileQuery('17-permission-friction.kql', last)
    },
    lineage: {
      defaultLast: '24h',
      query: last => kqlFileQuery('19-agent-flow-lineage.kql', last)
    },
    policy: {
      defaultLast: '7d',
      query: last => kqlFileQuery('15-policy-governance.kql', last)
    },
    mcp: {
      defaultLast: '7d',
      query: last => kqlFileQuery('16-mcp-tool-usage.kql', last)
    }
  };
  const queryCommandNames = Object.freeze(['link', ...Object.keys(queryCommandSpecs)]);

  function queryCommand(command, args) {
    if (command === 'link') {
      const [kind, id, ...linkArgs] = args;
      if (!kind || !id) throw new Error('link requires a kind and id, for example: link session <conversation>');
      const last = parseLastArg(linkArgs, '24h');
      writeJson(buildLink(kind, id, { last }), stdout);
      return;
    }

    const spec = queryCommandSpecs[command];
    if (!spec) throw new Error(`Unknown query command: ${command}`);
    const last = parseLastArg(args, spec.defaultLast);
    const query = spec.query(last);
    writeJson({ workspace_id: workspaceId, query }, stdout);
  }

  return {
    queryCommand,
    queryCommandNames
  };
}

module.exports = {
  createObservabilityQueryCommand
};
