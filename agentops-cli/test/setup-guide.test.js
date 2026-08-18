const assert = require('node:assert/strict');
const test = require('node:test');

const { createSetupGuide } = require('../src/lib/setup-guide');

function createGuide() {
  return createSetupGuide({
    commandCandidates: name => [`/usr/local/bin/${name}`],
    configFromEnvValues: values => values,
    configuredCloudValues: () => ({
      resourceGroup: '',
      workspaceId: '',
      workspaceName: '',
      grafanaBaseUrl: '',
      grafanaName: '',
      appInsightsName: ''
    }),
    defaultInstallDir: '/tmp/agentops-bin',
    grafanaDashboardImportCommand: () => 'agentops dashboard import',
    installedShimStatus: () => ({
      agentops_cli_installed: true,
      copilot_agentops_installed: false,
      plain_copilot_observed: false
    }),
    isConfiguredValue: (value, placeholderPattern) => Boolean(value) && !placeholderPattern.test(value),
    parseEnvAssignments: text => Object.fromEntries(
      String(text)
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => line.split('='))
    ),
    realCopilotSmokeCommand: () => 'copilot -p "Reply with exactly: agentops smoke."'
  });
}

test('setup guide helpers render read-only first-run guidance', () => {
  const { agentopsSetupGuide, parseSetupArgs, renderSetupGuide } = createGuide();

  const result = agentopsSetupGuide({
    azdValues: [
      'workspaceId=11111111-1111-1111-1111-111111111111',
      'grafanaBaseUrl=https://agentops.grafana.azure.com'
    ].join('\n')
  });

  assert.deepEqual(parseSetupArgs(['--json']), { json: true });
  assert.equal(result.mode, 'guide');
  assert.equal(result.mutates, false);
  assert.equal(result.azd.ok, true);
  assert.equal(result.phases[0].status, 'ready-to-import');
  assert.ok(result.next.includes('agentops configure import-azd'));
  assert.match(renderSetupGuide(result), /This command is read-only/);
});

test('resource-group status is read-only and fails closed when the configured target is absent', () => {
  const { azureResourceGroupStatus } = createGuide();
  const calls = [];
  const result = azureResourceGroupStatus({
    resourceGroup: 'rg-agentops-dev',
    subscriptionId: 'sub-approved',
    spawnSync: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: 'false\n', stderr: '' };
    }
  }, true);

  assert.equal(result.checked, true);
  assert.equal(result.exists, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'missing');
  assert.deepEqual(calls, [[
    'az',
    ['group', 'exists', '--name', 'rg-agentops-dev', '--subscription', 'sub-approved']
  ]]);
});
