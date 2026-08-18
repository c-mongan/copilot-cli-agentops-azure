const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { dashboardImportPlan, runDashboardImport } = require('../src/lib/dashboard-import');
const TEST_APPROVED_SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';

test('dashboard import library plans and runs managed Grafana imports', () => {
  const plan = dashboardImportPlan([], {
    env: {
      AZURE_RESOURCE_GROUP: 'rg-agentops-dev',
      GRAFANA_NAME: 'graf-agentops-dev'
    }
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.dry_run, true);
  assert.equal(plan.v2_only, true);
  assert.equal(plan.folder, 'AgentOps for Azure');
  assert.ok(plan.files.every(file => file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`)));

  const calls = [];
  const result = runDashboardImport(['--yes', '--resource-group', 'rg-agentops-dev', '--grafana-name', 'graf-agentops-dev'], {
    env: { AGENTOPS_AZURE_SUBSCRIPTION_ID: TEST_APPROVED_SUBSCRIPTION_ID, AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: TEST_APPROVED_SUBSCRIPTION_ID },
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'az') return { status: 0, stdout: `${TEST_APPROVED_SUBSCRIPTION_ID}\n`, stderr: '' };
      return { status: 0, stdout: 'imported\n', stderr: '' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'az');
  assert.match(calls[1].command, /grafana-import-dashboard\.sh$/);
  assert.equal(calls[1].options.env.AGENTOPS_V2_ONLY, 'true');
  assert.equal(calls[1].options.env.GRAFANA_NAME, 'graf-agentops-dev');
});

test('dashboard import refuses execution when the active subscription differs', () => {
  const calls = [];
  const result = runDashboardImport(['--yes'], {
    env: { AGENTOPS_AZURE_SUBSCRIPTION_ID: TEST_APPROVED_SUBSCRIPTION_ID, AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: TEST_APPROVED_SUBSCRIPTION_ID },
    spawnSync(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: 'wrong-sub\n', stderr: '' };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.match(result.errors[0], /refused the write/);
  assert.equal(calls.length, 1);
});
