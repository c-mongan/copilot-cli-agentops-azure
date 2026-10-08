const assert = require('node:assert/strict');
const test = require('node:test');

const { createSetupGuide } = require('../src/lib/setup-guide');
const { signedOutCliSpawnSync } = require('./support/cli-stubs');

function createGuide(projectCloud = {}) {
  return createSetupGuide({
    commandCandidates: name => [`/usr/local/bin/${name}`],
    configFromEnvValues: values => values,
    configuredCloudValues: () => ({
      resourceGroup: '',
      workspaceId: '',
      workspaceName: '',
      subscriptionId: '',
      logsIngestionEndpoint: '',
      dcrImmutableId: '',
      grafanaBaseUrl: '',
      grafanaName: '',
      appInsightsName: '',
      ...projectCloud
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
    spawnSync: signedOutCliSpawnSync(),
    azdValues: [
      'workspaceId=11111111-1111-1111-1111-111111111111',
      'grafanaBaseUrl=https://agentops.grafana.azure.com'
    ].join('\n')
  });

  assert.deepEqual(parseSetupArgs(['--json']), { json: true });
  assert.equal(result.mode, 'guide');
  assert.equal(result.mutates, false);
  assert.equal(result.local_ready, true, 'the process-scoped launcher must not require the optional global shim');
  assert.equal(result.azd.ok, true);
  assert.match(result.phases[0].name, /Review and attach/);
  assert.match(result.phases[1].name, /runtime profile/);
  assert.match(result.phases[2].name, /Provision Azure/);
  assert.equal(result.phases.find(phase => phase.name.includes('Provision Azure')).status, 'ready-to-import');
  assert.ok(result.next.includes('agentops configure import-azd --project'));
  assert.match(renderSetupGuide(result), /This command is read-only/);
});

test('setup guide points fresh Azure setup at explicit-subscription preview-first provisioning', () => {
  const { agentopsSetupGuide, renderSetupGuide } = createGuide();
  const result = agentopsSetupGuide({
    commandAvailability: { node: true, az: true, azd: false, docker: true, copilot: true },
    azureAccount: { id: 'active-subscription', name: 'Synthetic subscription' }
  });
  const preview = 'agentops provision azure --subscription <subscription-id> --resource-group <new-agentops-rg> --profile pilot';

  assert.ok(result.phases.find(phase => phase.name.includes('Provision Azure')).commands.includes(preview));
  assert.ok(result.next.indexOf('agentops attach --repo .') < result.next.indexOf(preview));
  assert.equal(result.first_run.azure_provision_preview_command, preview);
  assert.equal(result.first_run.guided_command, 'agentops attach --repo .');
  assert.equal(result.first_run.observe_command, 'agentops copilot-session launch --repo . -- --agent <agent-name>');
  assert.equal(result.first_run.upload_command, 'agentops copilot-session launch --repo . --upload --yes -- --agent <agent-name>');
  assert.equal(result.first_run.runtime_profile_command, 'agentops configure set --project --python-runtime <version> --node-runtime <version> --typescript-loader <loader-or-unknown>');
  assert.equal(result.first_run.coverage_command, 'agentops coverage --repo . --json');
  assert.equal(result.first_run.azure_validation_command, 'agentops validate-azure --profile personal --json');
  assert.match(result.first_run.bind_command, /agentops configure set --project/);
  assert.ok(!result.next.includes('azd provision'));
  assert.match(renderSetupGuide(result), /--resource-group <new-agentops-rg> --profile pilot/);
  assert.match(renderSetupGuide(result), /review the Azure what-if/i);
  assert.match(renderSetupGuide(result), /agentops attach --repo \. --yes/);
  assert.match(renderSetupGuide(result), /Record runtime labels: agentops configure set --project/);
  assert.match(renderSetupGuide(result), /Labels are private setup metadata, not execution proof/);
  assert.match(renderSetupGuide(result), /Process-scoped observed run: agentops copilot-session launch/);
  assert.match(renderSetupGuide(result), /Plain copilot sessions remain uninstrumented/);
  assert.doesNotMatch(renderSetupGuide(result), /export PATH=.*local\/bin/);
  assert.doesNotMatch(renderSetupGuide(result), /Everyday observed use: agentops copilot /);
  assert.doesNotMatch(renderSetupGuide(result), /agentops init --full --yes/);
});

test('setup guide recognizes a project-scoped ingestion target without requiring Grafana', () => {
  const { agentopsSetupGuide } = createGuide({
    subscriptionId: 'sub-pilot',
    resourceGroup: 'rg-agentops-pilot',
    workspaceId: '11111111-1111-1111-1111-111111111111',
    logsIngestionEndpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-example'
  });
  const result = agentopsSetupGuide({
    commandAvailability: { node: true, az: true, azd: false, docker: true, copilot: true },
    azureAccount: { id: 'sub-pilot', name: 'Synthetic subscription' },
    resourceGroupExists: true
  });

  assert.equal(result.cloud_ready, true);
  assert.equal(result.cloud.grafana_url_configured, false);
  assert.equal(result.cloud.agents_view_url_configured, false);
  assert.equal(result.cloud.binding_status, 'ready');
  assert.ok(result.next.includes('agentops validate-azure --profile personal --json'));
  assert.match(result.next.at(-1), /Upload only after validation passes/);
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
