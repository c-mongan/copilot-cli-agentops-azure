const path = require('node:path');

const { readJsonlRows, rollupSpanRows } = require('../rollup/span-to-agentops-tables');

const defaultExpected = {
  runs: 1,
  events: 2,
  tools: 1,
  mcp_calls: 1,
  privacy_rows: 0,
  run: {
    RunId: 'wrapper_run_snapshot',
    SessionId: 'wrapper_session_snapshot',
    TraceId: 'trace-copilot-snapshot',
    Surface: 'cli',
    AgentName: 'telemetry-investigator',
    ModelRequested: 'gpt-5-mini',
    ModelActual: 'gpt-5-mini',
    InputTokens: 1200,
    OutputTokens: 180,
    PrivacyMode: 'strict',
    ContentCaptureMode: 'off',
    ContentCaptureSignal: false,
    OutcomeStatus: 'success',
    ToolCount: 1,
    ToolFailureCount: 0,
    ToolDeniedCount: 0
  },
  tool: {
    ToolName: 'mcp__azure__monitor_query',
    ToolType: 'read-only',
    ToolRisk: 'read-only',
    Allowed: true,
    Status: 'success',
    OutputSizeBytes: 2048
  },
  mcp: {
    McpServerName: 'azure',
    McpTransport: 'stdio',
    ToolName: 'monitor_query',
    Allowed: true,
    ResultSizeBytes: 2048
  }
};

function mismatchesForObject(actual = {}, expected = {}, prefix = '') {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      mismatches.push(`${prefix}${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
    }
  }
  return mismatches;
}

function validateCopilotOtelFixtureContract(options = {}) {
  const fixturePath = path.resolve(options.fixturePath || path.join(__dirname, '..', '..', '..', '..', 'tests', 'sample-otel', 'copilot-cli-wrapper-snapshot.jsonl'));
  const expected = options.expected || defaultExpected;
  const rows = readJsonlRows(fixturePath);
  const result = rollupSpanRows(rows, { baseTime: '2026-06-01T12:00:00.000Z' });
  const run = result.tables.AgentOpsRunSummary_CL[0] || {};
  const tool = result.tables.AgentOpsToolCalls_CL[0] || {};
  const mcp = result.tables.AgentOpsMcpCalls_CL[0] || {};
  const mismatches = [
    ...mismatchesForObject({
      runs: result.runs,
      events: result.tables.AgentOpsEvents_CL.length,
      tools: result.tables.AgentOpsToolCalls_CL.length,
      mcp_calls: result.tables.AgentOpsMcpCalls_CL.length,
      privacy_rows: result.tables.AgentOpsPrivacy_CL.length
    }, {
      runs: expected.runs,
      events: expected.events,
      tools: expected.tools,
      mcp_calls: expected.mcp_calls,
      privacy_rows: expected.privacy_rows
    }),
    ...mismatchesForObject(run, expected.run, 'run.'),
    ...mismatchesForObject(tool, expected.tool, 'tool.'),
    ...mismatchesForObject(mcp, expected.mcp, 'mcp.')
  ];

  return {
    ok: mismatches.length === 0,
    fixture: fixturePath,
    rows: rows.length,
    table_counts: result.table_counts,
    mismatches,
    contract: expected
  };
}

module.exports = {
  defaultExpected,
  validateCopilotOtelFixtureContract
};
