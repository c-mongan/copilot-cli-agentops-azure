const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAlertCommand } = require('../src/lib/alert-command');
const { createBenchmarkCommand } = require('../src/lib/benchmark-command');
const { createCustomTelemetryCommand } = require('../src/lib/custom-telemetry-command');
const { createObservabilityQueryCommand } = require('../src/lib/observability-query-command');
const { createPluginAssetCommand } = require('../src/lib/plugin-asset-command');
const { createSmokeCommand } = require('../src/lib/smoke-command');
const { createValidationCommand } = require('../src/lib/validation-command');
const { optionValue, optionValues } = require('../src/lib/cli-options');

function createOutput() {
  let text = '';
  return {
    stdout: {
      write(chunk) {
        text += String(chunk);
        return true;
      }
    },
    text() {
      return text;
    }
  };
}

test('command wrapper tests use shared option helpers', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(source, /^function optionValue\(/m);
  assert.doesNotMatch(source, /^function optionValues\(/m);
});

test('smoke command writes rendered output and exit code through injected dependencies', async () => {
  const output = createOutput();
  let exitCode = null;
  const { smokeCommand, smokeCommandNames } = createSmokeCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    parseSmokeArgs(args) {
      return { json: false, args };
    },
    async agentopsSmoke(options) {
      return { ok: false, checked: options.args };
    },
    renderSmoke(result) {
      return `smoke:${result.checked.join(',')}`;
    }
  });

  assert.ok(smokeCommandNames.includes('smoke'));

  await smokeCommand('smoke', ['--real-copilot']);

  assert.equal(output.text(), 'smoke:--real-copilot');
  assert.equal(exitCode, 1);
});

test('validation command writes JSON and exit code through injected dependencies', async () => {
  const output = createOutput();
  let exitCode = null;
  const { validationCommand, validationCommandNames } = createValidationCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    parseLastArg(args, fallback) {
      assert.deepEqual(args, ['--json', '--last', '3h']);
      assert.equal(fallback, '2h');
      return '3h';
    },
    validateAzure(options) {
      assert.deepEqual(options, {
        last: '3h',
        importDashboards: false,
        verifyDashboardContent: false,
        production: false,
        readinessProfile: '',
        remediationPlan: false
      });
      return { ok: true, command: 'validate-azure' };
    },
    renderValidateAzure() {
      throw new Error('JSON validation output should not call renderer');
    }
  });

  assert.ok(validationCommandNames.includes('validate-azure'));

  await validationCommand('validate-azure', ['--json', '--last', '3h']);

  assert.deepEqual(JSON.parse(output.text()), { ok: true, command: 'validate-azure' });
  assert.equal(exitCode, 0);
});

test('custom telemetry command resolves import file and writes injected exit code', async () => {
  const output = createOutput();
  let exitCode = null;
  const { customTelemetryCommand, customTelemetryCommandNames } = createCustomTelemetryCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    parseCustomArgs(args) {
      assert.deepEqual(args, ['import', '--file', 'events.jsonl']);
      return { subcommand: 'import', file: 'events.jsonl', json: false };
    },
    async agentopsCustomImport(file, options) {
      assert.equal(path.basename(file), 'events.jsonl');
      return { ok: false, file, subcommand: options.subcommand };
    },
    renderCustom(result) {
      return `custom:${result.subcommand}`;
    }
  });

  assert.ok(customTelemetryCommandNames.includes('custom'));

  await customTelemetryCommand('custom', ['import', '--file', 'events.jsonl']);

  assert.equal(output.text(), 'custom:import');
  assert.equal(exitCode, 1);
});

test('plugin asset command writes list output through injected stdout', () => {
  const output = createOutput();
  const { pluginAssetCommand, pluginAssetCommandNames } = createPluginAssetCommand({
    stdout: output.stdout,
    parseSkillsArgs(args) {
      assert.deepEqual(args, ['list']);
      return { subcommand: 'list' };
    },
    listDefaultAgents() {
      return [{ name: 'agentops-orchestrator' }];
    }
  });

  assert.ok(pluginAssetCommandNames.includes('agents'));

  pluginAssetCommand('agents', ['list']);

  assert.deepEqual(JSON.parse(output.text()), {
    agents: [{ name: 'agentops-orchestrator' }]
  });
});

test('benchmark command writes list output through injected stdout', () => {
  const output = createOutput();
  const { benchmarkCommand } = createBenchmarkCommand({
    stdout: output.stdout,
    listBenchmarks() {
      return [{ id: 'quickstart' }];
    }
  });

  benchmarkCommand(['list']);

  assert.deepEqual(JSON.parse(output.text()), [{ id: 'quickstart' }]);
});

test('observability query command writes links through injected stdout', () => {
  const output = createOutput();
  const { queryCommand, queryCommandNames } = createObservabilityQueryCommand({
    stdout: output.stdout,
    parseLastArg(args, fallback) {
      assert.deepEqual(args, ['--last', '1h']);
      assert.equal(fallback, '24h');
      return '1h';
    },
    buildLink(kind, id, options) {
      return { kind, id, options };
    }
  });

  assert.ok(queryCommandNames.includes('link'));

  queryCommand('link', ['session', 'abc123', '--last', '1h']);

  assert.deepEqual(JSON.parse(output.text()), {
    kind: 'session',
    id: 'abc123',
    options: { last: '1h' }
  });
});

test('observability query command dispatches read-order to the local-ledger query with an optional session id', () => {
  const output = createOutput();
  let seenArgs = null;
  const { queryCommand, queryCommandNames } = createObservabilityQueryCommand({
    stdout: output.stdout,
    readOrderQuery(runId, options) {
      seenArgs = { runId, options };
      return { ok: true, question: 'read-order', run_id: runId };
    }
  });

  assert.ok(queryCommandNames.includes('read-order'));

  queryCommand('read-order', ['run-123', '--session', 'session-abc']);

  assert.deepEqual(seenArgs, { runId: 'run-123', options: { sessionId: 'session-abc' } });
  assert.deepEqual(JSON.parse(output.text()), { ok: true, question: 'read-order', run_id: 'run-123' });
});

test('observability query command requires a run id for read-order', () => {
  const { queryCommand } = createObservabilityQueryCommand({
    stdout: createOutput().stdout,
    readOrderQuery: () => { throw new Error('should not be called'); }
  });

  assert.throws(() => queryCommand('read-order', []), /read-order requires a run id/);
});

for (const [command, dependencyName] of [
  ['slow-scripts', 'slowScriptsQuery'],
  ['repeated-tools', 'repeatedToolsQuery'],
  ['co-activation', 'coActivationQuery']
]) {
  test(`observability query command dispatches ${command} to its architecture-ledger query with --ledger and --top`, () => {
    const output = createOutput();
    let seenArgs = null;
    const dependencies = {
      stdout: output.stdout,
      [dependencyName](ledgerDir, options) {
        seenArgs = { ledgerDir, options };
        return { ok: true, question: command };
      }
    };
    const { queryCommand, queryCommandNames } = createObservabilityQueryCommand(dependencies);

    assert.ok(queryCommandNames.includes(command));

    queryCommand(command, ['--ledger', '/tmp/ledger-dir', '--top', '5', '--repo', '/tmp/fixture-repo']);

    assert.deepEqual(seenArgs, { ledgerDir: '/tmp/ledger-dir', options: { top: 5, repoRoot: '/tmp/fixture-repo' } });
    assert.deepEqual(JSON.parse(output.text()), { ok: true, question: command });
  });

  test(`observability query command requires --ledger for ${command}`, () => {
    const { queryCommand } = createObservabilityQueryCommand({
      stdout: createOutput().stdout,
      [dependencyName]: () => { throw new Error('should not be called'); }
    });

    assert.throws(() => queryCommand(command, []), new RegExp(`${command} requires --ledger`));
  });
}

test('observability query command aliases model-tokens to the token-rollup-audit query without duplicating logic', () => {
  const output = createOutput();
  let calls = 0;
  const { queryCommand, queryCommandNames } = createObservabilityQueryCommand({
    stdout: output.stdout,
    parseLastArg(args, fallback) {
      assert.equal(fallback, '7d');
      return fallback;
    },
    tokenRollupAuditQuery(last) {
      calls += 1;
      return `token-rollup-query-for-${last}`;
    },
    workspaceId: '11111111-1111-1111-1111-111111111111'
  });

  assert.ok(queryCommandNames.includes('model-tokens'));

  queryCommand('model-tokens', []);

  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(output.text()), {
    workspace_id: '11111111-1111-1111-1111-111111111111',
    query: 'token-rollup-query-for-7d',
    target_warning: null
  });
});

test('observability query command surfaces a Log Analytics vs Kusto target warning on canned KQL queries', () => {
  const output = createOutput();
  const { queryCommand } = createObservabilityQueryCommand({
    stdout: output.stdout,
    parseLastArg: (args, fallback) => fallback,
    fieldCatalogQuery: () => 'the-query',
    logAnalyticsTargetWarning(workspaceId) {
      assert.equal(workspaceId, 'https://mycluster.kusto.windows.net');
      return 'looks like a Kusto cluster, not Log Analytics';
    },
    workspaceId: 'https://mycluster.kusto.windows.net'
  });

  queryCommand('fields', []);

  assert.deepEqual(JSON.parse(output.text()), {
    workspace_id: 'https://mycluster.kusto.windows.net',
    query: 'the-query',
    target_warning: 'looks like a Kusto cluster, not Log Analytics'
  });
});

test('alert command writes recommendation output through injected stdout', () => {
  const output = createOutput();
  const { alertCommand } = createAlertCommand({
    stdout: output.stdout,
    parseLastArg(args, fallback) {
      assert.deepEqual(args, ['--last', '4h']);
      assert.equal(fallback, '14d');
      return '4h';
    },
    alertRecommendations(last) {
      return { last, rules: ['failed-spans'] };
    }
  });

  alertCommand(['recommend', '--last', '4h']);

  assert.deepEqual(JSON.parse(output.text()), {
    last: '4h',
    rules: ['failed-spans']
  });
});

test('alert command resolves route-plan events from injected cwd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agentops-alert-${process.pid}-`));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"event":"fired"}\n');
  const output = createOutput();
  const { alertCommand } = createAlertCommand({
    stdout: output.stdout,
    cwd: dir,
    optionValue,
    optionValues,
    parseLastArg(args, fallback) {
      assert.equal(fallback, '24h');
      return optionValue(args, ['--last']) || fallback;
    },
    configuredCloudValues() {
      return { resourceGroup: 'rg-agentops' };
    },
    readJsonlRows(file) {
      assert.equal(file, path.join(dir, 'events.jsonl'));
      return [{ event: 'loaded' }];
    },
    alertRoutePlan(options) {
      return options;
    }
  });

  alertCommand([
    'route-plan',
    '--rule', 'failed-spans',
    '--conversation', 'session-1',
    '--owner', 'alice@example.com',
    '--target', 'github',
    '--service', 'agentops',
    '--tz', 'Europe/Dublin',
    '--events', 'events.jsonl',
    '--last', '6h'
  ]);

  assert.deepEqual(JSON.parse(output.text()), {
    rule: 'failed-spans',
    session: 'session-1',
    last: '6h',
    owners: ['alice@example.com'],
    service: 'agentops',
    timezone: 'Europe/Dublin',
    targets: ['github'],
    resourceGroup: 'rg-agentops',
    events: [{ event: 'loaded' }]
  });
});

test('workflow command renders selected workflow through injected stdout', () => {
  const { createWorkflowCommand } = require('../src/lib/workflow-command');
  const output = createOutput();
  const { workflowCommand } = createWorkflowCommand({
    stdout: output.stdout,
    parseWorkflowsArgs(args) {
      assert.deepEqual(args, ['show', 'setup']);
      return { subcommand: 'show', name: 'setup', json: false };
    },
    agentopsWorkflows() {
      return [{ name: 'setup', prompt: 'Set up AgentOps' }];
    },
    renderWorkflow(workflow) {
      return `workflow:${workflow.name}`;
    }
  });

  workflowCommand(['show', 'setup']);

  assert.equal(output.text(), 'workflow:setup');
});

test('workflow command writes list JSON through injected stdout', () => {
  const { createWorkflowCommand } = require('../src/lib/workflow-command');
  const output = createOutput();
  const { workflowCommand } = createWorkflowCommand({
    stdout: output.stdout,
    parseWorkflowsArgs(args) {
      assert.deepEqual(args, ['list', '--json']);
      return { subcommand: 'list', json: true };
    },
    agentopsWorkflows() {
      return [{ name: 'setup' }, { name: 'operations' }];
    },
    renderWorkflowsList() {
      throw new Error('JSON workflow output should not call renderer');
    }
  });

  workflowCommand(['list', '--json']);

  assert.deepEqual(JSON.parse(output.text()), {
    workflows: [{ name: 'setup' }, { name: 'operations' }]
  });
});

test('utility command writes doctor checks and exit code through injected dependencies', () => {
  const { createUtilityCommand } = require('../src/lib/utility-command');
  const output = createOutput();
  let exitCode = null;
  const { utilityCommand, utilityCommandNames } = createUtilityCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    doctor(options) {
      assert.deepEqual(options, { localOnly: true });
      return [{ name: 'azure-login', ok: false }];
    }
  });

  assert.ok(utilityCommandNames.includes('doctor'));

  utilityCommand('doctor', ['--local-only']);

  assert.deepEqual(JSON.parse(output.text()), {
    checks: [{ name: 'azure-login', ok: false }],
    ok: false
  });
  assert.equal(exitCode, 1);
});

test('utility command resolves import-jsonl path and writes JSON through injected stdout', () => {
  const { createUtilityCommand } = require('../src/lib/utility-command');
  const output = createOutput();
  const { utilityCommand } = createUtilityCommand({
    stdout: output.stdout,
    importJsonl(file) {
    assert.equal(path.basename(file), 'events.jsonl');
      return { imported: 2, file };
    }
  });

  utilityCommand('import-jsonl', ['events.jsonl']);

  const result = JSON.parse(output.text());
  assert.equal(result.imported, 2);
    assert.equal(path.basename(result.file), 'events.jsonl');
});

test('core command writes setup JSON and exit code through injected dependencies', () => {
  const { createCoreCommand } = require('../src/lib/core-command');
  const output = createOutput();
  let exitCode = null;
  const { coreCommand, coreCommandNames } = createCoreCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    parseSetupArgs(args) {
      assert.deepEqual(args, ['--json']);
      return { json: true };
    },
    agentopsSetupGuide(options) {
      return { ok: true, command: 'setup', json: options.json };
    },
    renderSetupGuide() {
      throw new Error('JSON setup output should not call renderer');
    }
  });

  assert.ok(coreCommandNames.includes('setup'));

  coreCommand('setup', ['--json']);

  assert.deepEqual(JSON.parse(output.text()), { ok: true, command: 'setup', json: true });
  assert.equal(exitCode, 0);
});

test('core command preserves configure alias exit-code behavior', () => {
  const { createCoreCommand } = require('../src/lib/core-command');
  const output = createOutput();
  let exitCode = null;
  const { coreCommand, coreCommandNames } = createCoreCommand({
    stdout: output.stdout,
    setExitCode(code) {
      exitCode = code;
    },
    parseConfigureArgs(args) {
      assert.deepEqual(args, ['set']);
      return { json: false };
    },
    agentopsConfigure() {
      return { ok: false, reason: 'missing value' };
    },
    renderConfigure(result) {
      return `configure:${result.reason}`;
    }
  });

  assert.ok(coreCommandNames.includes('config'));

  coreCommand('config', ['set']);

  assert.equal(output.text(), 'configure:missing value');
  assert.equal(exitCode, 1);
});

test('planned command delegates lifecycle plans through injected runner', () => {
  const { createPlannedCommand } = require('../src/lib/planned-command');
  const calls = [];
  const { plannedCommand, plannedCommandNames } = createPlannedCommand({
    commandPlan(command, args) {
      calls.push(['commandPlan', command, args]);
      return { command, args, steps: ['run'] };
    },
    runPlannedCommand(plan) {
      calls.push(['runPlannedCommand', plan]);
    }
  });

  assert.ok(plannedCommandNames.includes('collector'));

  plannedCommand('collector', ['start']);

  assert.deepEqual(calls, [
    ['commandPlan', 'collector', ['start']],
    ['runPlannedCommand', { command: 'collector', args: ['start'], steps: ['run'] }]
  ]);
});
