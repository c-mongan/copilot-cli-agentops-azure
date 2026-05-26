const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.AGENTOPS_CONFIG_PATH = path.join(os.tmpdir(), `agentops-test-config-${process.pid}.json`);

const {
  agentopsAttributionSmoke,
  agentopsInit,
  agentopsConfigure,
  agentopsSmoke,
  agentopsStatusSummary,
  agentopsWorkflows,
  alertRecommendationQuery,
  alertRecommendations,
  askAgentOpsContext,
  attributionUsageQuery,
  benchmarkCheatSignals,
  benchmarkAzureTelemetryQuery,
  benchmarkReport,
  benchmarkRunBaseDir,
  benchmarkRunPlan,
  buildOtelSetup,
  buildLink,
  commandPlan,
  compareBenchmarkRuns,
  collectorHealthQuery,
  compactConfig,
  contextPressureQuery,
  copilotPrimitivesInventory,
  doctor,
  durationToMs,
  explainLatest,
  fieldCatalogQuery,
  configFromEnvValues,
  importJsonl,
  installedShimStatus,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  kqlFileQuery,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  listDefaultAgents,
  listDefaultSkills,
  listGrafanaDashboardFiles,
  listBenchmarks,
  loadBenchmarkSummaries,
  liveViewFromArgs,
  openLinksSummary,
  otlpAttributionSmokeTracePayload,
  otelCompatibilityQuery,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  parseConfigureArgs,
  parseEnvAssignments,
  parseOtelSetupArgs,
  parseFrontmatter,
  parseSavedViewArgs,
  parseSmokeArgs,
  replayTimeline,
  renderExplanation,
  renderAskContext,
  renderConfigure,
  renderInit,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderOtelSetup,
  renderRecommendation,
  renderReplay,
  renderSmoke,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  renderStatus,
  renderValidateAzure,
  renderWorkflow,
  renderWorkflowsList,
  recommendationForExplanation,
  readAgentOpsConfig,
  runBenchmarkSuite,
  savedViewCommand,
  scan,
  spanRowsFromSource,
  tokenRollupAuditQuery,
  validateAzure,
  validateKqlDuration,
  validateBenchmarkTask,
  uninstallPlugin,
  writeAgentOpsConfig,
  verifySmokeInAzure
} = require('../src/index.js');

const root = path.resolve(__dirname, '..', '..');
const benchmarkSummariesDir = path.join(__dirname, 'fixtures', 'benchmark-runs');

test('scan finds plugin agents and skills', () => {
  const result = scan();
  assert.ok(result.agents.length >= 5);
  assert.ok(result.skills.length >= 4);
  assert.ok(result.mcp_servers.includes('azure-mcp'));
});

test('default skills list exposes user-friendly AgentOps workflows', () => {
  const skills = listDefaultSkills();
  const names = skills.map(skill => skill.name);

  assert.ok(names.includes('agentops-setup'));
  assert.ok(names.includes('agentops-attribution'));
  assert.ok(names.includes('agentops-live-triage'));
  assert.ok(names.includes('agentops-benchmark-gate'));
  assert.ok(names.includes('agentops-dashboard-ops'));
  assert.ok(names.includes('agentops-operations'));
  assert.ok(skills.every(skill => skill.source.endsWith(path.join(skill.name, 'SKILL.md'))));
});

test('default agents list exposes the orchestrator and specialist agents', () => {
  const agents = listDefaultAgents();
  const names = agents.map(agent => agent.name);

  assert.ok(names.includes('agentops-orchestrator'));
  assert.ok(names.includes('telemetry-investigator'));
  assert.ok(names.includes('agent-optimizer'));
  assert.ok(agents.every(agent => agent.source.endsWith(agent.file)));
});

test('default agents install copies bundled agents into Copilot home', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-agents-'));
  try {
    const result = installDefaultAgents({ copilotHome: tempDir });
    const orchestrator = path.join(tempDir, 'agents', 'agentops-orchestrator.agent.md');

    assert.equal(result.copilotHome, tempDir);
    assert.equal(result.targetDir, path.join(tempDir, 'agents'));
    assert.ok(result.installed >= 2);
    assert.equal(fs.existsSync(orchestrator), true);
    assert.match(fs.readFileSync(orchestrator, 'utf8'), /agentops-orchestrator/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default agents install does not overwrite existing agents unless forced', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-agents-preserve-'));
  const customAgent = path.join(tempDir, 'agents', 'agentops-orchestrator.agent.md');
  try {
    fs.mkdirSync(path.dirname(customAgent), { recursive: true });
    fs.writeFileSync(customAgent, 'local edit\n');

    const preserved = installDefaultAgents({ copilotHome: tempDir });
    assert.equal(fs.readFileSync(customAgent, 'utf8'), 'local edit\n');
    assert.ok(preserved.skipped.some(agent => agent.name === 'agentops-orchestrator'));

    const forced = installDefaultAgents({ copilotHome: tempDir, force: true });
    assert.match(fs.readFileSync(customAgent, 'utf8'), /agentops-orchestrator/);
    assert.ok(forced.updated.some(agent => agent.name === 'agentops-orchestrator'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default agents install renderer points users at the orchestrator', () => {
  const output = renderAgentsInstall({
    copilotHome: '/tmp/copilot-home',
    targetDir: '/tmp/copilot-home/agents',
    installed: 2,
    updated: [],
    skipped: [{ name: 'agentops-orchestrator' }],
    agents: [
      { name: 'agentops-orchestrator' },
      { name: 'telemetry-investigator' }
    ]
  });

  assert.match(output, /Installed AgentOps agents/);
  assert.match(output, /agentops-orchestrator/);
  assert.match(output, /Ask Copilot: Use agentops-orchestrator/);
  assert.match(output, /skipped 1 existing agent/);
});

test('default skills install copies bundled skills into Copilot home', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-skills-'));
  try {
    const result = installDefaultSkills({ copilotHome: tempDir });
    const liveSkill = path.join(tempDir, 'skills', 'agentops-live-triage', 'SKILL.md');
    const benchmarkSkill = path.join(tempDir, 'skills', 'agentops-benchmark-gate', 'SKILL.md');

    assert.equal(result.copilotHome, tempDir);
    assert.equal(result.targetDir, path.join(tempDir, 'skills'));
    assert.ok(result.installed >= 2);
    assert.equal(fs.existsSync(liveSkill), true);
    assert.equal(fs.existsSync(benchmarkSkill), true);
    assert.match(fs.readFileSync(liveSkill, 'utf8'), /what happened in the latest Copilot CLI session/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default skills install does not overwrite existing skills unless forced', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-skills-preserve-'));
  const customSkill = path.join(tempDir, 'skills', 'agentops-live-triage', 'SKILL.md');
  try {
    fs.mkdirSync(path.dirname(customSkill), { recursive: true });
    fs.writeFileSync(customSkill, 'local edit\n');

    const preserved = installDefaultSkills({ copilotHome: tempDir });
    assert.equal(fs.readFileSync(customSkill, 'utf8'), 'local edit\n');
    assert.ok(preserved.skipped.some(skill => skill.name === 'agentops-live-triage'));

    const forced = installDefaultSkills({ copilotHome: tempDir, force: true });
    assert.match(fs.readFileSync(customSkill, 'utf8'), /agentops-live-triage/);
    assert.ok(forced.updated.some(skill => skill.name === 'agentops-live-triage'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('default skills install renderer points users at natural language workflows', () => {
  const output = renderSkillsInstall({
    copilotHome: '/tmp/copilot-home',
    targetDir: '/tmp/copilot-home/skills',
    installed: 2,
    updated: [],
    skipped: [{ name: 'agentops-live-triage' }],
    skills: [
      { name: 'agentops-live-triage' },
      { name: 'agentops-benchmark-gate' }
    ]
  });

  assert.match(output, /Installed AgentOps skills/);
  assert.match(output, /agentops-live-triage/);
  assert.match(output, /Ask Copilot: Use agentops-live-triage/);
  assert.match(output, /skipped 1 existing skill/);
});

test('plugin install and uninstall manage only bundled AgentOps files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-plugin-'));
  const unrelatedSkill = path.join(tempDir, 'skills', 'my-own-skill', 'SKILL.md');
  const unrelatedAgent = path.join(tempDir, 'agents', 'my-own-agent.agent.md');

  try {
    fs.mkdirSync(path.dirname(unrelatedSkill), { recursive: true });
    fs.writeFileSync(unrelatedSkill, 'keep me\n');
    fs.mkdirSync(path.dirname(unrelatedAgent), { recursive: true });
    fs.writeFileSync(unrelatedAgent, 'keep me\n');

    const installed = installPlugin({ copilotHome: tempDir });
    assert.ok(installed.agents.installed >= 2);
    assert.ok(installed.skills.installed >= 2);
    assert.match(renderPluginInstall(installed), /Remove later with `agentops plugin uninstall`/);

    const removed = uninstallPlugin({ copilotHome: tempDir });
    assert.ok(removed.agents.removed.some(agent => agent.name === 'agentops-orchestrator'));
    assert.ok(removed.skills.removed.some(skill => skill.name === 'agentops-live-triage'));
    assert.match(renderPluginUninstall(removed), /Removed AgentOps Copilot plugin files/);
    assert.equal(fs.existsSync(unrelatedSkill), true);
    assert.equal(fs.existsSync(unrelatedAgent), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('agent and skill uninstall renderers summarize removed files', () => {
  assert.match(renderAgentsUninstall({ targetDir: '/tmp/agents', removed: [{ name: 'a' }], missing: [] }), /1 agent removed/);
  assert.match(renderSkillsUninstall({ targetDir: '/tmp/skills', removed: [{ name: 's' }], missing: [] }), /1 skill removed/);
});

test('workflows map README goals to invocable skills and commands', () => {
  const workflows = agentopsWorkflows();
  const byName = Object.fromEntries(workflows.map(workflow => [workflow.name, workflow]));

  assert.ok(byName.setup.commands.includes('./setup-agentops.sh'));
  assert.equal(byName.setup.skill, 'agentops-setup');
  assert.ok(byName.setup.commands.includes('node agentops-cli/src/index.js plugin install'));
  assert.equal(byName.orchestrate.skill, 'agentops-orchestrator');
  assert.ok(byName.orchestrate.commands.includes('node agentops-cli/src/index.js workflows show attribution'));
  assert.ok(byName['latest-run'].commands.includes('node agentops-cli/src/index.js explain latest --last 7d'));
  assert.equal(byName.attribution.skill, 'agentops-attribution');
  assert.ok(byName.attribution.commands.includes('node agentops-cli/src/index.js attribution --last 7d'));
  assert.equal(byName['science-mode'].skill, 'agentops-benchmark-gate');
  assert.ok(byName['offline-test'].commands.includes('node agentops-cli/src/index.js live --file tests/sample-otel/tool-failure.jsonl'));
  assert.ok(byName['analyst-mode'].commands.includes('node agentops-cli/src/index.js alert recommend --last 14d'));
  assert.ok(byName.operations.commands.includes('node agentops-cli/src/index.js plugin uninstall'));
  assert.ok(byName.operations.commands.includes('node agentops-cli/src/index.js uninstall'));
});

test('workflow renderers show prompts and command details', () => {
  const workflows = agentopsWorkflows();
  const listOutput = renderWorkflowsList(workflows);
  const setupOutput = renderWorkflow(workflows.find(workflow => workflow.name === 'setup'));

  assert.match(listOutput, /AgentOps workflows/);
  assert.match(listOutput, /agentops-live-triage/);
  assert.match(setupOutput, /Ask Copilot: Use agentops-setup/);
  assert.match(setupOutput, /\.\/setup-agentops\.sh/);
});

test('configure stores non-secret Azure and Grafana settings once', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-config-'));
  const configPath = path.join(tempDir, 'config.json');
  try {
    const result = agentopsConfigure({
      subcommand: 'set',
      configPath,
      values: {
        resourceGroup: 'rg-agentops-dev',
        workspaceId: 'workspace-123',
        grafanaBaseUrl: 'https://grafana.example',
        grafanaName: 'graf-agentops-dev'
      }
    });
    const output = renderConfigure(result);
    const stored = readAgentOpsConfig({ configPath });

    assert.equal(result.values.resourceGroup, 'rg-agentops-dev');
    assert.equal(stored.values.workspaceId, 'workspace-123');
    assert.match(output, /agentops validate-azure/);
    assert.match(fs.readFileSync(configPath, 'utf8'), /graf-agentops-dev/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('configure import-azd maps azd env values into AgentOps config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-config-azd-'));
  const configPath = path.join(tempDir, 'config.json');
  try {
    const result = agentopsConfigure({
      subcommand: 'import-azd',
      configPath,
      spawnSync: () => ({
        status: 0,
        stdout: [
          'AZURE_SUBSCRIPTION_ID="sub-123"',
          'AZURE_RESOURCE_GROUP="rg-agentops-dev"',
          'AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID="workspace-123"',
          'AGENTOPS_GRAFANA_BASE_URL="https://grafana.example"',
          'GRAFANA_NAME="graf-agentops-dev"',
          'APPLICATIONINSIGHTS_NAME="appi-agentops-dev"'
        ].join('\n'),
        stderr: ''
      })
    });

    assert.equal(result.ok, true);
    assert.equal(result.values.subscriptionId, 'sub-123');
    assert.equal(result.values.grafanaBaseUrl, 'https://grafana.example');
    assert.equal(result.values.appInsightsName, 'appi-agentops-dev');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('configure parsers normalize env assignment values and CLI flags', () => {
  const envValues = parseEnvAssignments('AZURE_RESOURCE_GROUP="rg-a"\nAGENTOPS_GRAFANA_BASE_URL=https://grafana.example\n');
  const configValues = configFromEnvValues(envValues);
  const parsed = parseConfigureArgs(['set', '--resource-group', 'rg-b', '--workspace-id', 'workspace-b']);

  assert.equal(configValues.resourceGroup, 'rg-a');
  assert.equal(configValues.grafanaBaseUrl, 'https://grafana.example');
  assert.deepEqual(parsed.values, { resourceGroup: 'rg-b', workspaceId: 'workspace-b' });
  assert.deepEqual(compactConfig({ resourceGroup: 'rg-c', workspaceId: '' }), { resourceGroup: 'rg-c' });
});

test('otel setup renders VS Code, Copilot CLI, and SDK configuration', () => {
  const options = parseOtelSetupArgs(['--endpoint', 'http://localhost:4318', '--service-name', 'copilot-chat']);
  const setup = buildOtelSetup(options);
  const output = renderOtelSetup(setup, options);

  assert.equal(setup.vscode['github.copilot.chat.otel.enabled'], true);
  assert.equal(setup.vscode['github.copilot.chat.otel.otlpEndpoint'], 'http://localhost:4318');
  assert.equal(setup.env.COPILOT_OTEL_ENABLED, 'true');
  assert.equal(setup.env.COPILOT_OTEL_ENDPOINT, 'http://localhost:4318');
  assert.equal(setup.env.COPILOT_OTEL_CAPTURE_CONTENT, 'false');
  assert.equal(setup.env.OTEL_SERVICE_NAME, 'copilot-chat');
  assert.equal(setup.fileExport.env.COPILOT_OTEL_FILE_EXPORTER_PATH, './copilot-otel.jsonl');
  assert.match(output, /github\.copilot\.chat\.otel\.enabled/);
  assert.match(output, /export OTEL_EXPORTER_OTLP_ENDPOINT='http:\/\/localhost:4318'/);
  assert.match(output, /new CopilotClient/);
  assert.match(output, /Optional JSONL file export/);
  assert.match(output, /agentops compat-check --last 2h/);
});

test('otel setup supports json and powershell renderers', () => {
  const jsonOptions = parseOtelSetupArgs(['--shell', 'json']);
  const jsonOutput = renderOtelSetup(buildOtelSetup(jsonOptions), jsonOptions);
  assert.equal(JSON.parse(jsonOutput).env.COPILOT_OTEL_EXPORTER_TYPE, 'otlp-http');

  const psOptions = parseOtelSetupArgs(['--shell', 'powershell']);
  const psOutput = renderOtelSetup(buildOtelSetup(psOptions), psOptions);
  assert.match(psOutput, /\$env:COPILOT_OTEL_ENABLED = "true"/);
});

test('compatibility query accepts current Copilot service names', () => {
  const query = otelCompatibilityQuery('2h');
  assert.match(query, /copilot-chat/);
  assert.match(query, /github-copilot/);
  assert.match(query, /gen_ai\.operation\.name/);
  assert.match(query, /AppMetrics/);
  assert.match(query, /copilot_chat\.tool\.call\.count/);
  assert.match(query, /github\.copilot\.tool\.call\.count/);
  assert.match(query, /AppEvents/);
  assert.match(query, /Status=case/);
});

test('attribution query groups agents skills MCP servers and scripts', () => {
  const query = attributionUsageQuery('7d');
  assert.match(query, /agentops\.agent\.name/);
  assert.match(query, /agentops\.skill\.name/);
  assert.match(query, /agentops\.mcp\.server/);
  assert.match(query, /agentops\.script\.name/);
  assert.match(query, /AttributionKind/);
  assert.match(query, /script_or_hook/);
});

test('init workflow installs skills in dry-run mode and returns first-run next steps', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-init-'));
  try {
    const result = agentopsInit({
      dryRun: true,
      copilotHome: tempDir,
      env: {},
      workspaceId: '',
      grafanaBaseUrl: '',
      installDir: path.join(tempDir, 'bin')
    });
    const output = renderInit(result);

    assert.equal(result.mode, 'dry-run');
    assert.equal(result.skills.dryRun, true);
    assert.equal(result.agents.dryRun, true);
    assert.equal(result.cloud.workspace_id_configured, false);
    assert.equal(result.cloud.grafana_url_configured, false);
    assert.ok(result.next.includes('node agentops-cli/src/index.js validate-azure'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js ask-context latest --last 2h'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js plugin uninstall'));
    assert.match(output, /AgentOps init/);
    assert.match(output, /Agents:/);
    assert.match(output, /Skills:/);
    assert.match(output, /Cloud config: workspace=missing, grafana=missing/);
    assert.match(output, /agentops plugin uninstall/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('smoke dry run creates a privacy-safe OTLP plan and Azure verification query', async () => {
  const result = await agentopsSmoke({
    dryRun: true,
    id: 'agentops-smoke-test',
    endpoint: 'http://127.0.0.1:4318',
    last: '30m',
    workspaceId: 'workspace-123'
  });
  const output = renderSmoke(result);

  assert.equal(result.ok, true);
  assert.equal(result.smoke_id, 'agentops-smoke-test');
  assert.equal(result.payload_preview.content_capture_enabled, false);
  assert.match(result.azure_query, /ago\(30m\)/);
  assert.match(result.azure_query, /agentops-smoke-test/);
  assert.match(output, /AgentOps smoke/);
  assert.match(output, /POST http:\/\/127\.0\.0\.1:4318\/v1\/traces/);
});

test('attribution smoke emits agent skill mcp and script dimensions', async () => {
  const payload = otlpAttributionSmokeTracePayload('agentops-attribution-smoke-test', Date.parse('2026-05-26T12:00:00Z'));
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  const attrs = spans.flatMap(span => span.attributes.map(attr => attr.key));
  const attrValues = JSON.stringify(payload);

  assert.equal(spans.length, 4);
  assert.ok(attrs.includes('agentops.agent.name'));
  assert.ok(attrs.includes('agentops.skill.name'));
  assert.ok(attrs.includes('agentops.mcp.server'));
  assert.ok(attrs.includes('agentops.script.name'));
  assert.match(attrValues, /azure-mcp/);
  assert.match(attrValues, /agentops-kitchen-sink-smoke/);

  const result = await agentopsAttributionSmoke({
    dryRun: true,
    id: 'agentops-attribution-smoke-test',
    workspaceId: 'workspace-123'
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload_preview.agent, 'agentops-kitchen-sink-smoke');
  assert.equal(result.payload_preview.skill, 'agentops-attribution');
  assert.ok(result.next.some(command => command.includes('attribution --last 2h')));
});

test('smoke live mode verifies synthetic telemetry in Azure', async () => {
  let postedUrl = null;
  const result = await agentopsSmoke({
    id: 'agentops-smoke-verified',
    endpoint: 'http://collector.example',
    last: '30m',
    workspaceId: 'workspace-123',
    waitMs: 0,
    postJson: async (url, payload) => {
      postedUrl = url;
      assert.equal(payload.resourceSpans[0].resource.attributes.some(attr => attr.key === 'agentops.smoke_id'), true);
      return { ok: true, statusCode: 200, body: '' };
    },
    runQuery: query => {
      assert.match(query, /agentops-smoke-verified/);
      return { ok: true, rows: [{ Name: 'agentops.smoke.agentops-smoke-verified' }] };
    }
  });
  const output = renderSmoke(result);

  assert.equal(postedUrl, 'http://collector.example/v1/traces');
  assert.equal(result.ok, true);
  assert.equal(result.verification.ok, true);
  assert.match(output, /Azure verification: found 1 row/);
});

test('smoke live mode fails closed when Azure ingestion is not observed', async () => {
  const result = await agentopsSmoke({
    id: 'agentops-smoke-missing',
    endpoint: 'http://collector.example',
    workspaceId: 'workspace-123',
    waitMs: 0,
    postJson: async () => ({ ok: true, statusCode: 200, body: '' }),
    runQuery: () => ({ ok: true, rows: [] })
  });

  assert.equal(result.ok, false);
  assert.equal(result.collector_response.ok, true);
  assert.equal(result.verification.status, 'not_found');
});

test('smoke args parse verification wait and poll durations', () => {
  const args = parseSmokeArgs(['--id', 'smoke-a', '--wait', '5s', '--poll', '500ms', '--no-verify', '--json']);

  assert.equal(args.id, 'smoke-a');
  assert.equal(args.verify, false);
  assert.equal(args.waitMs, 5000);
  assert.equal(args.pollMs, 500);
  assert.equal(args.json, true);
  assert.equal(durationToMs('2m'), 120000);
});

test('validateAzure reports missing local Azure prerequisites without mutating Azure', () => {
  const result = validateAzure({
    azAvailable: false,
    workspaceId: '',
    grafanaBaseUrl: '',
    last: '2h'
  });
  const output = renderValidateAzure(result);
  const byName = Object.fromEntries(result.checks.map(check => [check.name, check]));

  assert.equal(result.ok, false);
  assert.equal(byName['az-cli'].ok, false);
  assert.equal(byName['log-analytics-workspace-id'].ok, false);
  assert.equal(byName['grafana-base-url'].ok, false);
  assert.ok(result.next.includes('agentops configure set --workspace-id "<workspace-id>"'));
  assert.match(output, /Azure validation is incomplete/);
});

test('validateAzure runs read-only Azure checks with mocked az output', () => {
  const calls = [];
  const expectedDashboards = [
    { uid: 'copilot-agentops', title: 'Overview' },
    { uid: 'agentops-sessions', title: 'Sessions' }
  ];
  const result = validateAzure({
    workspaceId: 'workspace-123',
    resourceGroup: 'rg-agentops-dev',
    grafanaBaseUrl: 'https://grafana.example',
    grafanaName: 'graf-agentops-dev',
    appInsightsName: 'appi-agentops-dev',
    expectedDashboards,
    last: '1h',
    spawnSync: (command, args) => {
      calls.push([command, args]);
      if (args.includes('account') && args.includes('show')) {
        return { status: 0, stdout: JSON.stringify({ id: 'sub-123', name: 'Demo Sub' }), stderr: '' };
      }
      if (args.includes('group') && args.includes('exists')) {
        return { status: 0, stdout: 'true\n', stderr: '' };
      }
      if (args.includes('log-analytics') && args.includes('query')) {
        return { status: 0, stdout: JSON.stringify([{ Rows: 3 }]), stderr: '' };
      }
      if (args.includes('data-source') && args.includes('list')) {
        return { status: 0, stdout: JSON.stringify([{ uid: 'azure-monitor-oob', name: 'Azure Monitor' }]), stderr: '' };
      }
      if (args.includes('dashboard') && args.includes('list')) {
        return { status: 0, stdout: JSON.stringify(expectedDashboards), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ name: args[args.length - 3] || 'ok' }), stderr: '' };
    }
  });
  const byName = Object.fromEntries(result.checks.map(check => [check.name, check]));

  assert.equal(result.ok, true);
  assert.equal(byName['azure-account'].ok, true);
  assert.equal(byName['resource-group'].ok, true);
  assert.equal(byName['log-analytics-query'].rows, 3);
  assert.equal(byName['application-insights'].ok, true);
  assert.equal(byName['grafana-resource'].ok, true);
  assert.equal(byName['grafana-datasource'].ok, true);
  assert.equal(byName['grafana-dashboards'].ok, true);
  assert.ok(calls.some(([, args]) => args.includes('log-analytics') && args.includes('query')));
});

test('validateAzure reports missing Grafana dashboards with import guidance', () => {
  const result = validateAzure({
    workspaceId: 'workspace-123',
    resourceGroup: 'rg-agentops-dev',
    grafanaBaseUrl: 'https://grafana.example',
    grafanaName: 'graf-agentops-dev',
    appInsightsName: 'appi-agentops-dev',
    expectedDashboards: [{ uid: 'agentops-sessions', title: 'Sessions' }],
    last: '1h',
    spawnSync: (command, args) => {
      if (args.includes('account') && args.includes('show')) {
        return { status: 0, stdout: JSON.stringify({ id: 'sub-123', name: 'Demo Sub' }), stderr: '' };
      }
      if (args.includes('group') && args.includes('exists')) {
        return { status: 0, stdout: 'true\n', stderr: '' };
      }
      if (args.includes('log-analytics') && args.includes('query')) {
        return { status: 0, stdout: JSON.stringify([{ Rows: 0 }]), stderr: '' };
      }
      if (args.includes('data-source') && args.includes('list')) {
        return { status: 0, stdout: JSON.stringify([{ uid: 'azure-monitor-oob' }]), stderr: '' };
      }
      if (args.includes('dashboard') && args.includes('list')) {
        return { status: 0, stdout: JSON.stringify([]), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ name: 'ok' }), stderr: '' };
    }
  });
  const byName = Object.fromEntries(result.checks.map(check => [check.name, check]));

  assert.equal(result.ok, false);
  assert.deepEqual(byName['grafana-dashboards'].missing, ['agentops-sessions']);
  assert.ok(result.next.some(command => command.includes('./scripts/grafana-import-dashboard.sh')));
});

test('Grafana dashboard inventory reads stable dashboard UIDs from repo', () => {
  const dashboards = listGrafanaDashboardFiles();
  const uids = dashboards.map(dashboard => dashboard.uid);

  assert.ok(uids.includes('agentops-sessions'));
  assert.ok(uids.includes('agentops-session-detail'));
  assert.ok(uids.includes('agentops-attribution'));
});

test('Grafana dashboards use Copilot OTel compatibility filters', () => {
  const dashboards = listGrafanaDashboardFiles();
  const combined = dashboards
    .map(dashboard => fs.readFileSync(path.join(root, dashboard.file), 'utf8'))
    .join('\n');

  assert.doesNotMatch(combined, /Properties has ['"]github\.copilot['"] and Properties has ['"]github-copilot-cli['"]/);
  assert.match(combined, /copilot-chat/);
  assert.match(combined, /agentops_agent/);
});

test('verifySmokeInAzure returns query failure details', async () => {
  const result = await verifySmokeInAzure('agentops-smoke-query-error', {
    workspaceId: 'workspace-123',
    waitMs: 0,
    runQuery: () => ({ ok: false, rows: [], error: 'not logged in' })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'query_failed');
  assert.equal(result.attempts[0].error, 'not logged in');
});

test('collector health query summarizes collector and smoke signals', () => {
  const query = collectorHealthQuery('12h');

  assert.match(query, /let lookback = 12h/);
  assert.match(query, /SmokeSpans/);
  assert.match(query, /collector_errors/);
});

test('benchmark anti-cheat signals block unsafe promotion', () => {
  const result = benchmarkCheatSignals([
    {
      success: true,
      filesChanged: 1,
      checksPassed: 2,
      forbiddenFilesChanged: 1,
      policyBlocks: 0,
      contentCaptureDetected: false
    }
  ]);

  assert.equal(result.status, 'blocked');
  assert.equal(result.signals[0].signal, 'forbidden_files_changed');
});

test('ask context builds a safe telemetry-investigator prompt for a known session', () => {
  const context = askAgentOpsContext({ sessionId: 'conv-ask', last: '2h' });
  const output = renderAskContext(context);

  assert.equal(context.ok, true);
  assert.equal(context.session, 'conv-ask');
  assert.match(context.dashboard, /agentops-session-detail/);
  assert.match(context.query, /selected_session = "conv-ask"/);
  assert.match(context.prompt, /telemetry-investigator/);
  assert.match(context.prompt, /Do not edit files yet/);
  assert.match(output, /MCP configs: copilot\/mcp\.azure-monitor\.sample\.json/);
});

test('primitives inventory reports configured and runtime Copilot surfaces', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-primitives-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'agents', 'sample.agent.md'), '---\nname: sample\ndescription: sample agent\ntools: ["agent", "demo/*"]\n---\n');
    fs.mkdirSync(path.join(tempDir, 'skills', 'sample'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'skills', 'sample', 'SKILL.md'), '---\nname: sample-skill\ndescription: sample skill\n---\n');
    fs.mkdirSync(path.join(tempDir, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'hooks', 'hooks.json'), JSON.stringify({ version: 1, hooks: { preToolUse: [], subagentStop: [] } }));
    fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { type: 'stdio', command: 'demo' } } }));
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Instructions\n');
    fs.mkdirSync(path.join(tempDir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'workflows', 'sample.md'), '---\nname: Sample Workflow\n---\n');
    fs.writeFileSync(path.join(tempDir, 'plugin.json'), JSON.stringify({ name: 'sample-plugin', lspServers: { sample: { command: 'sample-lsp' } } }));

    const result = copilotPrimitivesInventory(['--root', tempDir, '--last', '12h']);
    const byName = Object.fromEntries(result.primitives.map(item => [item.primitive, item]));

    assert.equal(result.last, '12h');
    assert.match(result.observed_query, /let lookback = 12h;/);
    assert.equal(byName.custom_agents.status, 'configured');
    assert.equal(byName.skills.status, 'configured');
    assert.equal(byName.hooks.status, 'configured');
    assert.equal(byName.subagents.status, 'configured');
    assert.equal(byName.mcp_servers.evidence.includes('demo'), true);
    assert.equal(byName.instructions.status, 'configured');
    assert.equal(byName.workflows_commands.status, 'configured');
    assert.equal(byName.lsp_servers.status, 'configured');
    assert.equal(byName.mcp_tools.status, 'observed_query');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('doctor local checks pass', () => {
  const checks = doctor({ localOnly: true });
  assert.equal(checks.every(check => check.ok), true);
  assert.ok(checks.some(check => check.name === 'plain-copilot-shadow'));
});

test('installed shim status reports expected paths', () => {
  const status = installedShimStatus(path.join(root, 'tmp-bin'));
  assert.match(status.shadow_path, /copilot/);
  assert.match(status.copilot_agentops_path, /copilot-agentops/);
  assert.equal(status.plain_copilot_observed, false);
});

test('copilot-agentops falls back to real copilot when collector setup fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-copilot-fallback-'));
  const fakeCopilot = path.join(tempDir, 'copilot');
  try {
    fs.writeFileSync(fakeCopilot, '#!/usr/bin/env bash\nprintf "real copilot %s\\n" "$*"\n');
    fs.chmodSync(fakeCopilot, 0o755);

    const result = spawnSync(path.join(root, 'scripts', 'copilot-agentops'), ['--help'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: '/bin:/usr/bin',
        COPILOT_CLI_BIN: fakeCopilot,
        AZURE_RESOURCE_GROUP: 'rg-agentops-definitely-missing',
        APPLICATIONINSIGHTS_NAME: 'appi-agentops-definitely-missing'
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /real copilot --help/);
    assert.match(result.stderr, /Launching Copilot without AgentOps telemetry/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('status renders beginner-first privacy and setup checks from fixtures', () => {
  const summary = agentopsStatusSummary({
    checks: [
      { name: 'exists:copilot/copilot-observe', ok: true },
      { name: 'exists:collector/otelcol.local.yaml', ok: false },
      { name: 'content-capture-disabled', ok: true },
      { name: 'collector-http-localhost', ok: true },
      { name: 'collector-grpc-localhost', ok: true },
      { name: 'copilot-agentops-command', ok: true, status: 'installed' },
      { name: 'plain-copilot-shadow', ok: true, status: 'observed' }
    ]
  });
  const output = renderStatus(summary);

  assert.match(output, /Required files: 1 of 2 found/);
  assert.match(output, /Prompts\/code were not recorded/);
  assert.match(output, /localhost/);
  assert.match(output, /plain copilot is routed through AgentOps/);
});

test('import-jsonl summarizes operations', () => {
  const result = importJsonl(path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl'));
  assert.equal(result.rows, 2);
  assert.equal(result.operations.invoke_agent, 1);
  assert.equal(result.operations.execute_tool, 1);
});

test('frontmatter parser extracts simple fields', () => {
  const data = parseFrontmatter(path.join(root, 'plugin', 'agents', 'telemetry-investigator.agent.md'));
  assert.equal(data.name, 'telemetry-investigator');
  assert.match(data.description, /Investigates GitHub Copilot CLI telemetry/);
});

test('benchmark schema validation accepts starter task files', () => {
  const result = listBenchmarks();
  const suite = result.suites.find(item => item.id === 'starter');

  assert.ok(suite);
  assert.equal(suite.tasks.length, 1);
  assert.equal(suite.tasks[0].id, 'create-note');
  assert.deepEqual(suite.tasks[0].tags, ['starter', 'safe', 'filesystem']);
});

test('benchmark schema validation rejects a missing fixture', () => {
  const suiteDir = path.join(root, 'benchmarks', 'starter');
  const task = {
    id: 'missing-fixture',
    title: 'Missing fixture',
    fixture: 'fixtures/nope',
    prompt: 'Do nothing.',
    copilotArgs: [],
    successCommands: [],
    expectedFiles: [],
    forbiddenFiles: [],
    timeoutSec: 10,
    tags: []
  };

  assert.throws(() => validateBenchmarkTask(task, suiteDir, 'test-task'), /fixture does not exist/);
});

test('benchmark schema validation rejects invalid timeout', () => {
  const suiteDir = path.join(root, 'benchmarks', 'starter');
  const task = {
    id: 'bad-timeout',
    title: 'Bad timeout',
    fixture: 'fixtures/tiny-repo',
    prompt: 'Do nothing.',
    copilotArgs: [],
    successCommands: [],
    expectedFiles: [],
    forbiddenFiles: [],
    timeoutSec: 0,
    tags: []
  };

  assert.throws(() => validateBenchmarkTask(task, suiteDir, 'test-task'), /timeoutSec must be a positive integer/);
});

test('benchmark dry run plans fixture copy, Copilot args, labels, checks, and timeout', () => {
  const plan = benchmarkRunPlan('starter', {
    variant: 'baseline',
    repeat: 2,
    hypothesis: 'shorter-prompt',
    dryRun: true,
    runId: 'bench-test'
  });

  assert.equal(plan.runId, 'bench-test');
  assert.equal(plan.hypothesis, 'shorter-prompt');
  assert.equal(plan.wouldMutateRepo, false);
  assert.equal(plan.wouldExecuteCopilot, false);
  assert.equal(plan.runs.length, 2);
  assert.match(plan.runs[0].copiedFixturePath.from, /benchmarks\/starter\/fixtures\/tiny-repo$/);
  assert.match(plan.runs[0].copiedFixturePath.to, /agentops-benchmark-runs\/bench-test\/create-note\/repeat-1\/workspace$/);
  assert.deepEqual(plan.runs[0].copilot.args, ['--allow-all']);
  assert.match(plan.runs[0].copilot.prompt, /notes\/hello\.txt/);
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.variant'], 'baseline');
  assert.equal(plan.runs[0].otelLabels['agentops.hypothesis.id'], 'shorter-prompt');
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.task_id'], 'create-note');
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.task'], undefined);
  assert.deepEqual(plan.runs[0].successChecks.expectedFiles, ['notes/hello.txt']);
  assert.deepEqual(plan.runs[0].successChecks.forbiddenFiles, ['.env', 'secrets.txt']);
  assert.equal(plan.runs[0].timeoutSec, 30);
});

test('benchmark run args support hypothesis labels', () => {
  assert.deepEqual(parseBenchmarkRunArgs(['starter', '--variant', 'candidate', '--repeat', '2', '--hypothesis', 'less-context']), {
    suite: 'starter',
    variant: 'candidate',
    repeat: 2,
    hypothesis: 'less-context',
    dryRun: false
  });
});

test('benchmark dry run generates isolated COPILOT_HOME paths', () => {
  const plan = benchmarkRunPlan('starter', {
    variant: 'baseline',
    repeat: 2,
    dryRun: true,
    runId: 'bench-isolated'
  });

  assert.ok(plan.runs[0].copilotHome.startsWith(benchmarkRunBaseDir));
  assert.ok(plan.runs[1].copilotHome.startsWith(benchmarkRunBaseDir));
  assert.equal(plan.runs[0].environment.COPILOT_HOME, plan.runs[0].copilotHome);
  assert.notEqual(plan.runs[0].copilotHome, plan.runs[1].copilotHome);
  assert.equal(plan.runs[0].copilotHome.startsWith(root), false);
  assert.equal(plan.runs[0].copiedFixturePath.to.startsWith(root), false);
});

test('benchmark run executes Copilot in an isolated fixture copy and writes a summary', () => {
  const runId = `bench-exec-${Date.now()}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-bench-test-'));
  let copilotCall = null;

  try {
    const result = runBenchmarkSuite('starter', {
      variant: 'baseline',
      repeat: 1,
      runId,
      summariesDir: path.join(tempDir, 'summaries'),
      spawnSync: (command, args, options = {}) => {
        if (command === 'copilot') {
          copilotCall = { args, options };
          fs.mkdirSync(path.join(options.cwd, 'notes'), { recursive: true });
          fs.writeFileSync(path.join(options.cwd, 'notes', 'hello.txt'), 'hello agentops\n');
          return { status: 0, stdout: 'created note', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.wouldExecuteCopilot, true);
    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0].success, true);
    assert.deepEqual(result.summaries[0].changedFiles, ['notes/hello.txt']);
    assert.equal(result.report.recommendation.action, 'keep');
    assert.equal(result.report.promotion.decision, 'promote');
    assert.equal(fs.existsSync(result.summariesPath), true);
    assert.ok(copilotCall.options.cwd.startsWith(benchmarkRunBaseDir));
    assert.match(copilotCall.options.env.OTEL_RESOURCE_ATTRIBUTES, /agentops\.benchmark\.task_id=create-note/);
    assert.deepEqual(copilotCall.args.slice(-2), ['-p', 'Create notes/hello.txt containing the text hello agentops.']);
  } finally {
    fs.rmSync(path.join(benchmarkRunBaseDir, runId), { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('benchmark run rejects forbidden files created by Copilot', () => {
  const runId = `bench-safety-${Date.now()}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-bench-test-'));

  try {
    const result = runBenchmarkSuite('starter', {
      variant: 'candidate',
      repeat: 1,
      runId,
      summariesDir: path.join(tempDir, 'summaries'),
      spawnSync: (command, args, options = {}) => {
        if (command === 'copilot') {
          fs.mkdirSync(path.join(options.cwd, 'notes'), { recursive: true });
          fs.writeFileSync(path.join(options.cwd, 'notes', 'hello.txt'), 'hello agentops\n');
          fs.writeFileSync(path.join(options.cwd, 'secrets.txt'), 'nope\n');
          return { status: 0, stdout: 'created note', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }
    });

    assert.equal(result.summaries[0].success, false);
    assert.equal(result.summaries[0].forbiddenFilesChanged, 1);
    assert.equal(result.summaries[0].errorCategory, 'safety_violation');
    assert.equal(result.report.recommendation.action, 'reject');
  } finally {
    fs.rmSync(path.join(benchmarkRunBaseDir, runId), { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('benchmark report scores a passing stored run', () => {
  const summaries = loadBenchmarkSummaries('pass-run', { summariesDir: benchmarkSummariesDir });
  const report = benchmarkReport('pass-run', summaries);

  assert.equal(report.runId, 'pass-run');
  assert.equal(report.passRatePct, 100);
  assert.equal(report.averageScore, 100);
  assert.equal(report.recommendation.action, 'keep');
  assert.match(report.recommendation.message, /^keep:/);
});

test('benchmark report enriches stored summaries with Azure telemetry', () => {
  const summaries = loadBenchmarkSummaries('pass-run', { summariesDir: benchmarkSummariesDir });
  let capturedQuery = null;
  const rows = [
    {
      run_id: 'pass-run',
      suite: 'fixture-suite',
      task_id: 'edit-small-file',
      variant: 'baseline',
      repeat_id: '',
      Started: '2026-05-22T09:00:01.000Z',
      Ended: '2026-05-22T09:00:08.000Z',
      Spans: 4,
      ToolCalls: 2,
      ToolFailures: 1,
      Failures: 1,
      InputTokens: 10000,
      OutputTokens: 500,
      CacheRead: 2000,
      CacheWrite: 1000,
      Credits: 3,
      AIU: 200000000,
      Models: ['gpt-5.5'],
      Tools: ['bash'],
      Conversations: ['conv-a'],
      Operations: ['chat', 'execute_tool']
    },
    {
      run_id: 'pass-run',
      suite: 'fixture-suite',
      task_id: 'add-test',
      variant: 'baseline',
      repeat_id: '',
      Started: '2026-05-22T09:02:01.000Z',
      Ended: '2026-05-22T09:02:08.000Z',
      Spans: 3,
      ToolCalls: 0,
      ToolFailures: 0,
      Failures: 0,
      InputTokens: 8000,
      OutputTokens: 700,
      CacheRead: 1000,
      CacheWrite: 500,
      Credits: 2,
      AIU: 100000000,
      Models: ['gpt-5.5'],
      Tools: [],
      Conversations: ['conv-b'],
      Operations: ['chat']
    }
  ];
  const report = benchmarkReport('pass-run', summaries, {
    azure: true,
    last: '2h',
    spawnSync: (command, args) => {
      assert.equal(command, 'az');
      capturedQuery = args[args.indexOf('--analytics-query') + 1];
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    }
  });

  assert.match(capturedQuery, /ago\(2h\)/);
  assert.match(capturedQuery, /run_id == "pass-run"/);
  assert.equal(report.azureTelemetry.ok, true);
  assert.equal(report.azureTelemetry.matchedTasks, 2);
  assert.equal(report.azureTelemetry.matchedSpans, 7);
  assert.equal(report.inputTokens, 18000);
  assert.equal(report.outputTokens, 1200);
  assert.equal(report.aiu, 0.3);
  assert.equal(report.cost, 0.05);
  assert.equal(report.toolFailures, 1);
  assert.equal(report.recommendation.action, 'investigate');
  assert.equal(report.tasks.every(task => task.telemetryMatched), true);
  assert.equal(report.tasks.find(task => task.taskId === 'edit-small-file').azureSpans, 4);
  assert.deepEqual(report.tasks.find(task => task.taskId === 'edit-small-file').models, ['gpt-5.5']);
});

test('benchmark report keeps local scores when Azure query fails', () => {
  const summaries = loadBenchmarkSummaries('pass-run', { summariesDir: benchmarkSummariesDir });
  const report = benchmarkReport('pass-run', summaries, {
    azure: true,
    last: '2h',
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'not logged in' })
  });

  assert.equal(report.azureTelemetry.ok, false);
  assert.match(report.azureTelemetry.error, /not logged in/);
  assert.equal(report.passRatePct, 100);
  assert.equal(report.cost, 0.45);
  assert.equal(report.recommendation.action, 'keep');
});

test('benchmark report args support optional Azure lookback', () => {
  assert.deepEqual(parseBenchmarkReportArgs(['pass-run', '--azure', '--last', '2h']), {
    runId: 'pass-run',
    azure: true,
    last: '2h'
  });
  assert.deepEqual(parseBenchmarkCompareArgs(['before-run', 'after-run', '--azure', '--last', '12h']), {
    beforeRunId: 'before-run',
    afterRunId: 'after-run',
    azure: true,
    last: '12h'
  });
  assert.throws(() => parseBenchmarkReportArgs(['pass-run', '--azure', '--last', 'forever']), /duration/);
});

test('benchmark Azure telemetry query filters by run id and lookback', () => {
  const query = benchmarkAzureTelemetryQuery('bench-"quoted"', '12h');

  assert.match(query, /ago\(12h\)/);
  assert.match(query, /agentops\.benchmark\.run_id/);
  assert.match(query, /run_id == "bench-\\"quoted\\""/);
  assert.match(query, /ChatInputTokens=sumif/);
  assert.match(query, /AgentInputTokens=maxif/);
  assert.match(query, /InputTokens=iff\(ChatSpans > 0/);
  assert.match(query, /make_set_if\(tool/);
});

test('benchmark report rejects a failing stored run', () => {
  const summaries = loadBenchmarkSummaries('failed-run', { summariesDir: benchmarkSummariesDir });
  const report = benchmarkReport('failed-run', summaries);

  assert.equal(report.passRatePct, 0);
  assert.equal(report.recommendation.action, 'reject');
  assert.ok(report.averageScore < 60);
  assert.deepEqual(report.topFailureCategories[0], { category: 'checks_failed', count: 4 });
});

test('benchmark report applies major penalties for safety violations', () => {
  const summaries = loadBenchmarkSummaries('safety-run', { summariesDir: benchmarkSummariesDir });
  const report = benchmarkReport('safety-run', summaries);

  assert.equal(report.passRatePct, 100);
  assert.equal(report.safetyViolationCount, 1);
  assert.equal(report.forbiddenFilesChanged, 1);
  assert.equal(report.contentCaptureDetected, true);
  assert.equal(report.recommendation.action, 'reject');
});

test('benchmark compare rejects an after run that regresses', () => {
  const summaries = [
    ...loadBenchmarkSummaries('pass-run', { summariesDir: benchmarkSummariesDir }),
    ...loadBenchmarkSummaries('regress-run', { summariesDir: benchmarkSummariesDir })
  ];
  const comparison = compareBenchmarkRuns('pass-run', 'regress-run', summaries);

  assert.equal(comparison.before.passRatePct, 100);
  assert.equal(comparison.after.passRatePct, 50);
  assert.ok(comparison.averageScoreDelta < 0);
  assert.equal(comparison.toolFailuresDelta, 3);
  assert.ok(comparison.tokenDelta > 0);
  assert.ok(comparison.costDelta > 0);
  assert.equal(comparison.recommendation.action, 'reject');
});

test('benchmark compare keeps an after run that improves', () => {
  const summaries = [
    ...loadBenchmarkSummaries('regress-run', { summariesDir: benchmarkSummariesDir }),
    ...loadBenchmarkSummaries('pass-run', { summariesDir: benchmarkSummariesDir })
  ];
  const comparison = compareBenchmarkRuns('regress-run', 'pass-run', summaries);

  assert.equal(comparison.before.passRatePct, 50);
  assert.equal(comparison.after.passRatePct, 100);
  assert.ok(comparison.averageScoreDelta > 0);
  assert.equal(comparison.toolFailuresDelta, -3);
  assert.equal(comparison.safetyRegressionWarnings.length, 0);
  assert.equal(comparison.recommendation.action, 'keep');
});

test('benchmark compare returns a clear placeholder when summaries are absent', () => {
  const comparison = compareBenchmarkRuns('missing-before', 'missing-after', []);

  assert.equal(comparison.ok, false);
  assert.equal(comparison.beforeRunId, 'missing-before');
  assert.equal(comparison.afterRunId, 'missing-after');
  assert.match(comparison.message, /missing before run summaries/);
  assert.match(comparison.message, /missing after run summaries/);
});

test('benchmark report returns a clear placeholder when summaries are absent', () => {
  const report = benchmarkReport('missing-run', []);

  assert.equal(report.runId, 'missing-run');
  assert.equal(report.ok, false);
  assert.match(report.message, /no benchmark summaries/);
});

test('link session builds Grafana URL and KQL', () => {
  const result = buildLink('session', 'abc-123', { last: '2h' });
  assert.equal(result.kind, 'session');
  assert.match(result.grafana_url, /agentops-session-detail/);
  assert.match(result.grafana_url, /var-conversation=abc-123/);
  assert.match(result.query, /ago\(2h\)/);
  assert.match(result.query, /selected_session = "abc-123"/);
  assert.match(result.query, /linked_to_selected/);
  assert.match(result.query, /github\.copilot\.interaction_id/);
});

test('link trace builds OperationId query', () => {
  const result = buildLink('trace', 'op-456');
  assert.equal(result.kind, 'trace');
  assert.match(result.grafana_url, /agentops-traces-spans/);
  assert.match(result.query, /OperationId == "op-456"/);
});

test('latest summarizes a fixture session in plain language', () => {
  const summary = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl') });
  const output = renderLatest(summary);

  assert.equal(summary.session.id, 'conv-tool-failure');
  assert.match(output, /Latest Copilot session/);
  assert.match(output, /1 tool call/);
  assert.match(output, /Tools: shell/);
  assert.match(output, /Grafana session:/);
  assert.match(output, /Data missing: live Azure query/);
});

test('latest summarizes Azure query rows with Properties JSON strings', () => {
  const rows = [
    {
      TimeGenerated: '2026-05-21T11:59:59.000Z',
      Name: 'invoke_agent',
      Success: 'True',
      ResultCode: '0',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.conversation.id': 'live-conv',
        'gen_ai.request.model': 'gpt-5.5',
        'gen_ai.usage.input_tokens': '1000',
        'gen_ai.usage.output_tokens': '40',
        'github.copilot.cost': '2'
      })
    },
    {
      TimeGenerated: '2026-05-21T12:00:00.000Z',
      Name: 'chat',
      Success: 'True',
      ResultCode: '0',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'chat',
        'gen_ai.conversation.id': 'live-conv',
        'gen_ai.request.model': 'gpt-5.5',
        'gen_ai.usage.input_tokens': '1000',
        'gen_ai.usage.output_tokens': '40',
        'github.copilot.cost': '2'
      })
    },
    {
      TimeGenerated: '2026-05-21T12:00:05.000Z',
      Name: 'execute_tool',
      Success: 'True',
      ResultCode: '0',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.conversation.id': 'live-conv',
        'gen_ai.tool.name': 'azure-mcp/monitor'
      })
    }
  ];

  const summary = latestSessionSummary({ rows, source: 'azure' });
  const output = renderLatest(summary);

  assert.equal(summary.mode, 'azure');
  assert.equal(summary.session.id, 'live-conv');
  assert.equal(summary.session.input_tokens, 1000);
  assert.equal(summary.session.output_tokens, 40);
  assert.equal(summary.session.credits, 2);
  assert.equal(summary.session.data_missing.includes('live Azure query'), false);
  assert.match(output, /Tools: azure-mcp\/monitor/);
  assert.match(output, /Estimated cost: \$0\.02/);
  assert.doesNotMatch(output, /live Azure query/);
});

test('latest treats capitalized Azure Success strings as failures', () => {
  const summary = latestSessionSummary({
    source: 'azure',
    rows: [{
      TimeGenerated: '2026-05-21T12:00:00.000Z',
      Name: 'execute_tool',
      Success: 'False',
      ResultCode: '500',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.conversation.id': 'live-failed-conv',
        'gen_ai.tool.name': 'azure-mcp/monitor'
      })
    }]
  });

  assert.equal(summary.session.failures, 1);
  assert.equal(summary.session.failed_tools, 1);
  assert.equal(explainLatest(summary).classification, 'failed_tool');
});

test('latest Azure summary runs az query with a validated lookback', () => {
  let capturedCommand = null;
  let capturedArgs = null;
  const rows = [
    {
      TimeGenerated: '2026-05-21T12:00:00.000Z',
      Name: 'chat',
      Success: 'True',
      ResultCode: '0',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'chat',
        'gen_ai.conversation.id': 'live-conv',
        'gen_ai.request.model': 'gpt-5.5',
        'gen_ai.usage.input_tokens': '10',
        'gen_ai.usage.output_tokens': '2',
        'github.copilot.cost': '1'
      })
    }
  ];

  const summary = latestAzureSessionSummary({
    last: '2h',
    spawnSync: (command, args) => {
      capturedCommand = command;
      capturedArgs = args;
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    }
  });
  const query = capturedArgs[capturedArgs.indexOf('--analytics-query') + 1];

  assert.equal(capturedCommand, 'az');
  assert.ok(capturedArgs.includes('--workspace'));
  assert.match(query, /ago\(2h\)/);
  assert.match(query, /latest_session/);
  assert.match(query, /operation_sessions/);
  assert.match(query, /direct_session/);
  assert.equal(summary.mode, 'azure');
  assert.equal(summary.session.id, 'live-conv');
});

test('latest groups tool spans by inferred Azure conversation column', () => {
  const summary = latestSessionSummary({
    source: 'azure',
    rows: [
      {
        TimeGenerated: '2026-05-21T12:00:00.000Z',
        conversation: 'live-conv',
        Name: 'chat',
        Success: 'True',
        ResultCode: '0',
        Properties: JSON.stringify({
          'gen_ai.operation.name': 'chat',
          'gen_ai.conversation.id': 'live-conv'
        })
      },
      {
        TimeGenerated: '2026-05-21T12:00:01.000Z',
        conversation: 'live-conv',
        Name: 'execute_tool azure-mcp-subscription_list',
        Success: 'True',
        ResultCode: '0',
        Properties: JSON.stringify({
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': 'azure-mcp-subscription_list'
        })
      }
    ]
  });

  assert.equal(summary.session.id, 'live-conv');
  assert.equal(summary.session.tool_calls, 1);
  assert.deepEqual(summary.session.tools, ['azure-mcp-subscription_list']);
});

test('latest Azure summary reports empty live data clearly', () => {
  const summary = latestAzureSessionSummary({
    last: '1d',
    spawnSync: () => ({ status: 0, stdout: '[]', stderr: '' })
  });
  const output = renderLatest(summary);

  assert.equal(summary.mode, 'azure');
  assert.equal(summary.session, null);
  assert.match(output, /No Copilot sessions were found in Azure for the last 1d/);
  assert.match(output, /no Copilot telemetry found in Azure/);
});

test('latest Azure query rejects unsafe lookback values before spawning az', () => {
  let called = false;

  assert.equal(validateKqlDuration('30m'), '30m');
  assert.match(latestSessionAzureQuery('7d'), /ago\(7d\)/);
  assert.throws(() => latestAzureSessionSummary({
    last: 'ago(7d)',
    spawnSync: () => {
      called = true;
      return { status: 0, stdout: '[]', stderr: '' };
    }
  }), /--last must be a duration/);
  assert.equal(called, false);
});

test('explain latest classifies fixture sessions with simple labels', () => {
  const failed = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl') });
  const failedOutput = renderExplanation(explainLatest(failed));
  assert.match(failedOutput, /Tools kept failing/);

  const success = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'simple-success.jsonl') });
  const successExplanation = explainLatest(success);
  assert.equal(successExplanation.classification, 'success');
  assert.match(renderExplanation(successExplanation), /This session looks successful/);
});

test('recommendation contract turns latest failure into evidence-backed next actions', () => {
  const failed = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl') });
  const recommendation = recommendationForExplanation(explainLatest(failed), { last: '7d' });
  const output = renderRecommendation(recommendation);

  assert.equal(recommendation.action, 'investigate');
  assert.equal(recommendation.classification, 'failed_tool');
  assert.ok(recommendation.proposed_files.includes('plugin/scripts/post-tool-failure-hints.js'));
  assert.match(recommendation.evidence.query, /ago\(7d\)/);
  assert.match(recommendation.evidence.query, /selected_session = "conv-tool-failure"/);
  assert.match(output, /Expected metric movement/);
  assert.match(output, /Rollback condition/);
});

test('open prints main Grafana and latest fixture session links', () => {
  const summary = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'simple-success.jsonl') });
  const output = renderOpenLinks(openLinksSummary(summary));

  assert.match(output, /Main dashboard:/);
  assert.match(output, /copilot-cli-agentops/);
  assert.match(output, /Latest session:/);
  assert.match(output, /var-conversation=conv-success/);
});

test('replay renders a compact privacy-safe session timeline', () => {
  const rows = [
    {
      TimeGenerated: '2026-05-22T12:00:00.000Z',
      Name: 'invoke_agent',
      Success: 'True',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.conversation.id': 'conv-replay',
        'gen_ai.agent.name': 'agent-optimizer',
        'gen_ai.request.model': 'gpt-5.5'
      })
    },
    {
      TimeGenerated: '2026-05-22T12:00:02.000Z',
      Name: 'execute_tool',
      Success: 'False',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'bash',
        'error.type': 'command_failed'
      })
    },
    {
      TimeGenerated: '2026-05-22T12:00:03.000Z',
      Name: 'policy',
      Message: 'AgentOps preToolUse policy blocked command',
      Success: 'True',
      Properties: JSON.stringify({
        'gen_ai.conversation.id': 'conv-replay'
      })
    }
  ];

  const timeline = replayTimeline(rows, { sessionId: 'latest', source: 'azure' });
  const output = renderReplay(timeline);

  assert.equal(timeline.session, 'conv-replay');
  assert.equal(timeline.events.length, 3);
  assert.match(output, /agent/);
  assert.match(output, /tool/);
  assert.match(output, /policy/);
  assert.match(output, /command_failed/);
});

test('replay summary avoids double counting parent agent usage when chat usage exists', () => {
  const rows = [
    {
      TimeGenerated: '2026-05-22T12:00:00.000Z',
      Name: 'invoke_agent',
      Success: 'True',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.conversation.id': 'conv-usage',
        'gen_ai.usage.input_tokens': '1000',
        'gen_ai.usage.output_tokens': '40',
        'github.copilot.cost': '2'
      })
    },
    {
      TimeGenerated: '2026-05-22T12:00:01.000Z',
      Name: 'chat',
      Success: 'True',
      Properties: JSON.stringify({
        'gen_ai.operation.name': 'chat',
        'gen_ai.conversation.id': 'conv-usage',
        'gen_ai.usage.input_tokens': '1000',
        'gen_ai.usage.output_tokens': '40',
        'github.copilot.cost': '2'
      })
    }
  ];

  const timeline = replayTimeline(rows, { sessionId: 'latest', source: 'azure' });

  assert.equal(timeline.summary.input_tokens, 1000);
  assert.equal(timeline.summary.output_tokens, 40);
  assert.equal(timeline.summary.credits, 2);
  assert.equal(timeline.summary.est_usd, 0.02);
});

test('live view can render from a local JSONL export', () => {
  const view = liveViewFromArgs(['--file', path.join(root, 'tests', 'sample-otel', 'tool-failure.jsonl')]);
  const output = renderLive(view);

  assert.equal(view.ok, true);
  assert.match(output, /AgentOps live/);
  assert.match(output, /conv-tool-failure/);
  assert.match(output, /shell/);
});

test('span source reads local JSONL without Azure access', () => {
  const source = spanRowsFromSource(['--file', path.join(root, 'tests', 'sample-otel', 'simple-success.jsonl')]);

  assert.equal(source.mode, 'local');
  assert.equal(source.rows.length, 2);
  assert.equal(source.error, null);
});

test('saved views add, list, show, and open durable investigations', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-views-test-'));
  const viewsPath = path.join(tempDir, 'views.json');

  try {
    const addOptions = parseSavedViewArgs([
      'add',
      'cost-spike',
      '--url',
      'https://grafana.example/d/agentops-session-detail',
      '--description',
      'High-cost run',
      '--tag',
      'cost'
    ]);
    const added = savedViewCommand(addOptions, viewsPath);
    const listed = savedViewCommand(parseSavedViewArgs(['list']), viewsPath);
    const shown = savedViewCommand(parseSavedViewArgs(['show', 'cost-spike']), viewsPath);
    const opened = savedViewCommand(parseSavedViewArgs(['open', 'cost-spike']), viewsPath);

    assert.equal(added.saved.name, 'cost-spike');
    assert.equal(listed.views.length, 1);
    assert.deepEqual(shown.view.tags, ['cost']);
    assert.equal(opened.url, 'https://grafana.example/d/agentops-session-detail');
    assert.equal(fs.existsSync(viewsPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('field catalog query discovers Properties keys', () => {
  const query = fieldCatalogQuery('14d');
  assert.match(query, /ago\(14d\)/);
  assert.match(query, /bag_keys\(Properties\)/);
  assert.match(query, /example_values/);
});

test('context pressure query ranks inefficient sessions', () => {
  const query = contextPressureQuery('3d');
  assert.match(query, /ago\(3d\)/);
  assert.match(query, /OutputYieldPct/);
  assert.match(query, /CacheLeveragePct/);
  assert.match(query, /high_context/);
});

test('token rollup audit compares all-span totals against chat rollups', () => {
  const query = tokenRollupAuditQuery('30d');
  assert.match(query, /ago\(30d\)/);
  assert.match(query, /ChatInputTokens/);
  assert.match(query, /AgentInputTokens/);
  assert.match(query, /TokenOvercountRatio/);
  assert.match(query, /invoke_agent_fallback/);
});

test('command plan exposes shadow and collector lifecycle commands', () => {
  const install = commandPlan('install', [], 'darwin');
  assert.match(install.command, /install-copilot-agentops-shim\.sh$/);
  assert.deepEqual(install.args, []);

  const installShadow = commandPlan('install', ['--shadow-copilot'], 'darwin');
  assert.deepEqual(installShadow.args, ['--shadow-copilot']);

  const enable = commandPlan('enable-shadow', [], 'darwin');
  assert.match(enable.command, /install-copilot-agentops-shim\.sh$/);
  assert.deepEqual(enable.args, ['--shadow-copilot']);

  const disable = commandPlan('disable-shadow', [], 'darwin');
  assert.match(disable.command, /uninstall-copilot-agentops-shim\.sh$/);
  assert.deepEqual(disable.args, ['--keep-agentops-command']);

  const stop = commandPlan('collector', ['stop'], 'darwin');
  assert.equal(stop.command, 'docker');
  assert.deepEqual(stop.args.slice(0, 3), ['compose', '-f', path.join(root, 'collector', 'docker-compose.azuremonitor.yaml')]);
  assert.equal(stop.args.at(-1), 'down');
  assert.equal(stop.env.AZURE_RESOURCE_GROUP, 'rg-agentops-dev');
  assert.equal(stop.env.APPLICATIONINSIGHTS_NAME, 'appi-agentops-dev');

  const startAlias = commandPlan('start', [], 'darwin');
  assert.match(startAlias.command, /collector-azuremonitor-up\.sh$/);

  const stopAlias = commandPlan('stop', [], 'darwin');
  assert.equal(stopAlias.command, 'docker');

  const copilot = commandPlan('copilot', ['-p', 'hello'], 'darwin');
  assert.match(copilot.command, /copilot-agentops$/);
  assert.deepEqual(copilot.args, ['-p', 'hello']);

  const codex = commandPlan('codex', ['--help'], 'darwin');
  assert.match(codex.command, /agentops-codex$/);
  assert.deepEqual(codex.args, ['--help']);
});

test('windows command plan prefers PowerShell Core wrappers', () => {
  const install = commandPlan('install', ['--shadow-copilot'], 'win32');
  assert.equal(install.command, 'pwsh');
  assert.ok(install.args.includes('-ShadowCopilot'));
  assert.match(install.args.at(-2), /install-copilot-agentops-shim\.ps1$/);

  const enable = commandPlan('enable-shadow', [], 'win32');
  assert.equal(enable.command, 'pwsh');
  assert.ok(enable.args.includes('-ShadowCopilot'));
  assert.match(enable.args.at(-2), /install-copilot-agentops-shim\.ps1$/);

  const disable = commandPlan('disable-shadow', [], 'win32');
  assert.equal(disable.command, 'pwsh');
  assert.ok(disable.args.includes('-KeepAgentopsCommand'));
  assert.match(disable.args.at(-2), /uninstall-copilot-agentops-shim\.ps1$/);

  const collector = commandPlan('collector', ['start'], 'win32');
  assert.equal(collector.command, 'pwsh');
  assert.match(collector.args.at(-1), /collector-azuremonitor-up\.ps1$/);
  assert.equal(collector.env.AZURE_RESOURCE_GROUP, 'rg-agentops-dev');

  const codex = commandPlan('codex', ['--help'], 'win32');
  assert.equal(codex.command, 'pwsh');
  assert.match(codex.args.at(-2), /agentops-codex\.ps1$/);
});

test('policy and mcp KQL queries expose documented Copilot dimensions', () => {
  const policy = kqlFileQuery('15-policy-governance.kql', '30d');
  assert.match(policy, /let lookback = 30d;/);
  assert.match(policy, /agentops\.cli\.allow_all/);
  assert.match(policy, /agentops\.cli\.session_id_provided/);
  assert.match(policy, /agentops\.cli\.additional_mcp_config\.count/);
  assert.match(policy, /content_capture_signals/);
  assert.match(policy, /policy_blocks/);

  const mcp = kqlFileQuery('16-mcp-tool-usage.kql', '12h');
  assert.match(mcp, /let lookback = 12h;/);
  assert.match(mcp, /likely_mcp_or_extension/);
  assert.match(mcp, /builtin_tools/);
  assert.match(mcp, /agentops\.mcp\.config\.servers/);
  assert.match(mcp, /mcp_server/);

  const permission = kqlFileQuery('17-permission-friction.kql', '6h');
  assert.match(permission, /let lookback = 6h;/);
  assert.match(permission, /friction_score/);
  assert.match(permission, /allow_all/);
  assert.match(permission, /policy_blocks/);

  const alerts = kqlFileQuery('18-alert-threshold-recommendations.kql', '21d');
  assert.match(alerts, /let lookback = 21d;/);
  assert.match(alerts, /suggested_threshold/);
  assert.match(alerts, /content-capture/);

  const lineage = kqlFileQuery('19-agent-flow-lineage.kql', '24h');
  assert.match(lineage, /let lookback = 24h;/);
  assert.match(lineage, /parent_node_id/);
  assert.match(lineage, /mcp_server/);
  assert.match(lineage, /subagent/);

  const primitives = kqlFileQuery('20-copilot-primitives-inventory.kql', '3d');
  assert.match(primitives, /let lookback = 3d;/);
  assert.match(primitives, /custom_agents/);
  assert.match(primitives, /workflows_commands/);
  assert.match(primitives, /runtime_status/);
});

test('alert recommendations expose proposal-only threshold evidence', () => {
  const recommendations = alertRecommendations('21d');

  assert.equal(recommendations.mode, 'proposal-only');
  assert.equal(recommendations.last, '21d');
  assert.equal(recommendations.rules.length, 3);
  assert.ok(recommendations.rules.some(rule => rule.name === 'content-capture' && rule.suggested_threshold === 0));
  assert.match(recommendations.evidence_query, /let lookback = 21d;/);
  assert.match(alertRecommendationQuery('7d'), /p99_aiu/);
});
