const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dashboardKqlCheck,
  substituteGrafanaMacros,
  v2KqlSmokePanels
} = require('../src/lib/dashboard-kql-check');

test('empty recommendation, insight, and privacy tables remain valid no-data states', () => {
  for (const panel of [
    ['agentops-v2-home', 'Recommended next actions'],
    ['agentops-v2-run-replay', 'Why this failed / next check'],
    ['agentops-v2-safety-privacy-policy', 'Blocked or redacted items by kind'],
    ['agentops-v2-insights-regressions', 'Latest insights']
  ]) {
    assert.equal(v2KqlSmokePanels.find(item => item.uid === panel[0] && item.panel === panel[1])?.requireRows, false);
  }
});

test('dashboard KQL helpers substitute Grafana macros and variables', () => {
  const query = substituteGrafanaMacros(
    'AgentOpsRunSummary_CL | where TimeGenerated between ($__timeFrom() .. $__timeTo()) | where RunId == "$run_id" and Model == "${model}" | summarize count() by $__interval',
    { last: '2h' }
  );

  assert.match(query, /ago\(2h\)/);
  assert.match(query, /now\(\)/);
  assert.match(query, /RunId == "__all"/);
  assert.match(query, /Model == "__all"/);
  assert.match(query, /summarize count\(\) by 1h/);
  assert.match(query, /\| take 5$/);
});

test('dashboard KQL check supports injected dashboard bodies and query runner', () => {
  const result = dashboardKqlCheck(['--require-rows', '--workspace-id', '12345678-1234-1234-1234-123456789abc'], {
    dashboardBodies: () => [{
      body: {
        uid: 'agentops-v2-home',
        panels: [{
          title: 'Session Health',
          targets: [{ query: 'AgentOpsRunSummary_CL | where RunId == "$run_id"' }]
        }]
      }
    }],
    smokePanels: [{ uid: 'agentops-v2-home', panel: 'Session Health', requireRows: true }],
    runQuery: (query, options) => ({
      ok: query.includes('__all') && options.workspaceId === '12345678-1234-1234-1234-123456789abc',
      rows: [{ ok: true }]
    })
  });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.checks.length, 1);
  assert.deepEqual(result.checks[0], {
    uid: 'agentops-v2-home',
    panel: 'Session Health',
    ok: true,
    rows: 1,
    require_rows: true,
    error: ''
  });
});

const fixture = {
  dashboardBodies: () => [{ body: { uid: 'fixture', panels: [{ title: 'Query', targets: [{ query: 'Events | where TimeGenerated between ($__timeFrom() .. $__timeTo())' }] }] } }],
  smokePanels: [{ uid: 'fixture', panel: 'Query', requireRows: true }]
};

test('help returns before dashboard dependencies and Azure calls', () => {
  for (const flag of ['--help', '-h']) {
    const result = dashboardKqlCheck([flag], {
      dashboardBodies: () => { throw new Error('must not load dashboards'); },
      runQuery: () => { throw new Error('must not query Azure'); },
      spawnSync: () => { throw new Error('must not spawn'); }
    });
    assert.equal(result.mode, 'help');
    assert.match(result.usage, /--local-only/);
  }
});

test('local-only returns bounded rendered queries without cloud dependencies', () => {
  let calls = 0;
  const result = dashboardKqlCheck(['--local-only', '--last=2h', '--json'], {
    ...fixture,
    runQuery: () => { calls += 1; throw new Error('must not query Azure'); },
    spawnSync: () => { calls += 1; throw new Error('must not spawn'); }
  });
  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'local-only');
  assert.equal(result.evidenceTier, 'local-query-render');
  assert.match(result.checks[0].query, /ago\(2h\)/);
  assert.match(result.checks[0].query, /\| take 5$/);
  assert.equal(Object.hasOwn(result.checks[0], 'rows'), false);
});

test('invalid arguments reject before any dashboard loading or Azure calls', () => {
  const options = {
    dashboardBodies: () => { throw new Error('unexpected dashboard load'); },
    runQuery: () => { throw new Error('unexpected Azure query'); },
    spawnSync: () => { throw new Error('unexpected spawn'); }
  };
  for (const args of [
    ['--unknown'], ['--local-onyl'], ['extra'], ['--last'], ['--last='],
    ['--last', '--json'], ['--workspace-id'], ['--workspace-id='],
    ['--workspace-id', 'bad'], ['--last', '0h'], ['--last', '31d'],
    ['--last', '1h | take 99'], ['--local-only=true'],
    ['--local-only', '--require-rows'], ['--local-only', '--live']
  ]) {
    assert.throws(() => dashboardKqlCheck(args, options), /Unknown|requires|must|cannot/);
  }
});

test('explicit live smoke uses injected queries and identifies its evidence mode', () => {
  let calls = 0;
  const result = dashboardKqlCheck(['--live', '--last', '30d', '--require-rows'], {
    ...fixture,
    runQuery: query => { calls += 1; assert.match(query, /ago\(30d\)/); return { ok: true, rows: [{}] }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'live');
  assert.equal(result.evidenceTier, 'live-azure-query');
  assert.equal(calls, 1);
});

test('dashboard command dispatches KQL help and local-only without Azure spawning', () => {
  const { dashboardCommand } = require('../src/lib/dashboard-command');
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawnSync;
  const originalWrite = process.stdout.write;
  const output = [];
  childProcess.spawnSync = () => { throw new Error('unexpected Azure spawn'); };
  process.stdout.write = text => { output.push(text); return true; };
  try {
    for (const args of [['kql-check', '--help'], ['kql-check', '-h'], ['kql-check', '--local-only']]) dashboardCommand(args);
  } finally {
    childProcess.spawnSync = originalSpawn;
    process.stdout.write = originalWrite;
  }
  const results = output.map(text => JSON.parse(text));
  assert.deepEqual(results.map(result => result.mode), ['help', 'help', 'local-only']);
  assert.equal(results[2].ok, true, results[2].errors.join('\n'));
});


test('CLI main routes KQL help and local rendering without Azure access', async () => {
  const { main } = require('../src/index');
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawnSync;
  const originalWrite = process.stdout.write;
  const output = [];
  childProcess.spawnSync = () => { throw new Error('unexpected Azure spawn'); };
  process.stdout.write = text => { output.push(text); return true; };
  try {
    await main(['dashboard', 'kql-check', '--help']);
    await main(['dashboard', 'kql-check', '--local-only', '--json']);
    await assert.rejects(() => main(['dashboard', 'kql-check', '--local-onyl']), /Unknown/);
  } finally {
    childProcess.spawnSync = originalSpawn;
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(output.map(text => JSON.parse(text).mode), ['help', 'local-only']);
});
