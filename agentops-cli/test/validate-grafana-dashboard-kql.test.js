const assert = require('node:assert/strict');
const test = require('node:test');

const { parseVars, substituteQuery } = require('../../scripts/validate-grafana-dashboard-kql');

test('Grafana KQL validator expands time macros and dashboard variables for Azure queries', () => {
  const vars = parseVars([
    'run_id=synthetic-run',
    'session_id=synthetic-session',
    'trace_id=__all'
  ]);
  const query = substituteQuery(
    "AgentOpsEvents_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo()) | where '$run_id' == '__all' or RunId == '$run_id' | where '$session_id' == '__all' or SessionId == '$session_id' | where '$surface' == '__all' or Surface == '$surface'",
    { last: '2h', interval: '5m', workspaceResource: '', vars }
  );

  assert.match(query, /TimeGenerated between \(ago\(2h\) \.\. now\(\)\)/);
  assert.match(query, /RunId == 'synthetic-run'/);
  assert.match(query, /SessionId == 'synthetic-session'/);
  assert.match(query, /'__all' == '__all' or Surface == '__all'/);
  assert.doesNotMatch(query, /\$__timeFrom|\$__timeTo|\$run_id|\$session_id/);
});
