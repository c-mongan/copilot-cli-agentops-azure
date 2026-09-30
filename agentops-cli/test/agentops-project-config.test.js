const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  agentopsConfigure,
  configuredCloudValues,
  parseConfigureArgs,
  readAgentOpsConfig
} = require('../src/lib/agentops-config');

test('project-scoped AgentOps config overrides user defaults without changing them', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-project-config-'));
  const repoRoot = path.join(tempDir, 'repo');
  const nested = path.join(repoRoot, 'subdir');
  const homeDir = path.join(tempDir, 'home');
  const globalConfigPath = path.join(homeDir, '.agentops', 'config.json');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
  fs.writeFileSync(globalConfigPath, JSON.stringify({
    resourceGroup: 'rg-global',
    workspaceName: 'law-global',
    grafanaName: 'graf-global',
    dcrImmutableId: 'dcr-global'
  }));

  try {
    const projectOnlyBeforeBinding = configuredCloudValues({
      configPath: globalConfigPath,
      cwd: nested,
      homeDir,
      env: {},
      projectOnly: true
    });
    assert.equal(projectOnlyBeforeBinding.resourceGroup, '');
    assert.equal(projectOnlyBeforeBinding.workspaceId, '');

    const result = agentopsConfigure({
      subcommand: 'set',
      scope: 'project',
      configPath: globalConfigPath,
      cwd: nested,
      homeDir,
      values: { resourceGroup: 'rg-project', workspaceName: 'law-project' }
    });

    assert.notEqual(result.path, globalConfigPath);
    assert.match(result.path, /\.agentops[\/]projects[\/][a-f0-9]+\.json$/);
    assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
    assert.deepEqual(readAgentOpsConfig({ configPath: globalConfigPath }).values, {
      resourceGroup: 'rg-global',
      workspaceName: 'law-global',
      grafanaName: 'graf-global',
      dcrImmutableId: 'dcr-global'
    });

    const effective = configuredCloudValues({
      configPath: globalConfigPath,
      cwd: nested,
      homeDir,
      env: {}
    });
    assert.equal(effective.resourceGroup, 'rg-project');
    assert.equal(effective.workspaceName, 'law-project');
    assert.equal(effective.grafanaName, '');
    assert.equal(effective.dcrImmutableId, '');

    const shownEffective = agentopsConfigure({
      subcommand: 'show',
      configPath: globalConfigPath,
      cwd: nested,
      homeDir
    });
    assert.equal(shownEffective.scope, 'project');
    assert.equal(shownEffective.values.resourceGroup, 'rg-project');

    const shownUser = agentopsConfigure({
      subcommand: 'show',
      scope: 'user',
      configPath: globalConfigPath,
      cwd: nested,
      homeDir
    });
    assert.equal(shownUser.scope, 'user');
    assert.equal(shownUser.values.resourceGroup, 'rg-global');

    const envOverride = configuredCloudValues({
      configPath: globalConfigPath,
      cwd: nested,
      homeDir,
      env: { AGENTOPS_AZURE_RESOURCE_GROUP: 'rg-explicit-env' }
    });
    assert.equal(envOverride.resourceGroup, 'rg-explicit-env');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('configure parser accepts --project without adding it to stored values', () => {
  const parsed = parseConfigureArgs([
    'set', '--project', '--resource-group', 'rg-project',
    '--python-runtime', 'python3.12', '--node-runtime', 'node22.23', '--typescript-loader', 'tsx4.23'
  ]);

  assert.equal(parsed.scope, 'project');
  assert.deepEqual(parsed.values, {
    resourceGroup: 'rg-project', pythonRuntime: 'python3.12', nodeRuntime: 'node22.23', typescriptLoader: 'tsx4.23'
  });
});

test('runtime profile labels reject executable paths and shell arguments', () => {
  assert.throws(() => parseConfigureArgs(['set', '--project', '--typescript-loader', '/usr/local/bin/tsx']), /short label/);
  assert.throws(() => parseConfigureArgs(['set', '--project', '--python-runtime', 'python3.12 --unsafe']), /short label/);
});

test('configure parser accepts --user for explicit global settings', () => {
  const parsed = parseConfigureArgs(['set', '--user', '--resource-group', 'rg-global']);

  assert.equal(parsed.scope, 'user');
  assert.deepEqual(parsed.values, { resourceGroup: 'rg-global' });
});

test('CLI help documents project runtime profile labels', () => {
  const { usage: cliSurfaceUsage } = require('../src/lib/cli-surface');
  const { usage } = require('../src/lib/usage');
  assert.match(cliSurfaceUsage(), /--python-runtime <label>/);
  assert.match(cliSurfaceUsage(), /--typescript-loader <label\|unknown>/);
  assert.match(usage(), /--node-runtime <label>/);
});

test('project-scoped azd import writes private config without touching user config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-project-azd-'));
  const repoRoot = path.join(tempDir, 'repo');
  const homeDir = path.join(tempDir, 'home');
  const globalConfigPath = path.join(homeDir, '.agentops', 'config.json');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
  fs.writeFileSync(globalConfigPath, JSON.stringify({ resourceGroup: 'rg-global' }));

  try {
    const result = agentopsConfigure({
      subcommand: 'import-azd',
      scope: 'project',
      configPath: globalConfigPath,
      cwd: repoRoot,
      homeDir,
      spawnSync: () => ({
        status: 0,
        stdout: 'AZURE_RESOURCE_GROUP=rg-project\nAGENTOPS_LOG_ANALYTICS_WORKSPACE_ID=workspace-project\n',
        stderr: ''
      })
    });

    assert.equal(result.ok, true);
    assert.notEqual(result.path, globalConfigPath);
    assert.equal(fs.statSync(result.path).mode & 0o777, 0o600);
    assert.equal(readAgentOpsConfig({ configPath: globalConfigPath }).values.resourceGroup, 'rg-global');
    assert.equal(readAgentOpsConfig({ configPath: result.path }).values.resourceGroup, 'rg-project');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
