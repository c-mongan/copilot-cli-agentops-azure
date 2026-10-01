const { writeJson } = require('./command-output');
const { optionValue } = require('./args');

// `queryCommandSpecs` below builds KQL TEXT ONLY — every entry targets Azure
// Monitor Logs (a Log Analytics workspace), not an Azure Data Explorer Kusto
// cluster/database; see the doc comment at the top of observability-queries.js
// for why those are not interchangeable even though both speak KQL. The
// `localCommandSpecs` section further down is unrelated: those canned
// questions never leave the machine — they read a local run/session ledger
// and return already-computed rows, not a query string to run elsewhere.
function createObservabilityQueryCommand(dependencies = {}) {
  const {
    attributionUsageQuery,
    buildLink,
    coActivationQuery,
    collectorHealthQuery,
    contextPressureQuery,
    fieldCatalogQuery,
    kqlFileQuery,
    logAnalyticsTargetWarning,
    otelCompatibilityQuery,
    parseLastArg,
    readOrderQuery,
    repeatedToolsQuery,
    slowScriptsQuery,
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
    // Canned alias for the "model/token totals" investigation question.
    // token-rollup-audit already computes per-session model sets and
    // input/output token totals (with a de-duplicated "recommended" total
    // alongside the raw all-span sum) — this is a name, not new KQL.
    'model-tokens': {
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
  // Canned questions answered from a LOCAL ledger, not KQL: "read order in
  // failed run" replays Task 2's sessionWaterfall() over the local session
  // event ledger; "slow scripts"/"repeated tools"/"co-activation" call Task
  // 6's architecture metrics directly over the local architecture ledger.
  const localCommandNames = ['read-order', 'slow-scripts', 'repeated-tools', 'co-activation'];
  const queryCommandNames = Object.freeze(['link', ...localCommandNames, ...Object.keys(queryCommandSpecs)]);

  function queryCommand(command, args) {
    if (command === 'link') {
      const [kind, id, ...linkArgs] = args;
      if (!kind || !id) throw new Error('link requires a kind and id, for example: link session <conversation>');
      const last = parseLastArg(linkArgs, '24h');
      writeJson(buildLink(kind, id, { last }), stdout);
      return;
    }

    if (command === 'read-order') {
      const [runId, ...rest] = args;
      if (!runId) throw new Error('read-order requires a run id, for example: read-order run-123');
      const sessionId = optionValue(rest, '--session');
      writeJson(readOrderQuery(runId, { sessionId }), stdout);
      return;
    }

    if (command === 'slow-scripts' || command === 'repeated-tools' || command === 'co-activation') {
      const ledgerDir = optionValue(args, '--ledger');
      if (!ledgerDir) throw new Error(`${command} requires --ledger <dir> pointing to the architecture run ledger (see: agentops architecture --help)`);
      const topArg = optionValue(args, '--top');
      const top = topArg ? Number.parseInt(topArg, 10) : undefined;
      const queryFn = command === 'slow-scripts' ? slowScriptsQuery : command === 'repeated-tools' ? repeatedToolsQuery : coActivationQuery;
      writeJson(queryFn(ledgerDir, { top }), stdout);
      return;
    }

    const spec = queryCommandSpecs[command];
    if (!spec) throw new Error(`Unknown query command: ${command}`);
    const last = parseLastArg(args, spec.defaultLast);
    const query = spec.query(last);
    const targetWarning = typeof logAnalyticsTargetWarning === 'function' ? logAnalyticsTargetWarning(workspaceId) : null;
    writeJson({ workspace_id: workspaceId, query, target_warning: targetWarning }, stdout);
  }

  return {
    queryCommand,
    queryCommandNames
  };
}

module.exports = {
  createObservabilityQueryCommand
};
