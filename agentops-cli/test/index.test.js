const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.AGENTOPS_CONFIG_PATH = path.join(os.tmpdir(), `agentops-test-config-${process.pid}.json`);
const collectorManager = require('../src/lib/collector-manager');
const copilotResolver = require('../src/lib/copilot-resolver');
const { createRunMetadata } = require('../src/lib/copilot/run-metadata');
const { parseCopilotSessionRows } = require('../src/lib/copilot/session-parser');
const { summarizeCopilotRun } = require('../src/lib/copilot/run-summary');
const { classifyToolName, summarizeAllowedTools } = require('../src/lib/copilot/tool-classifier');
const privacy = require('../src/lib/privacy');
const { validateAgentRun, validateMcpSpan } = require('../src/lib/schema/agent-run-schema');
const { normalizeGenAiAttributes } = require('../src/lib/otel/genai-normalizer');
const { normalizeMcpAttributes } = require('../src/lib/otel/mcp-normalizer');
const { buildAskContext, hasV2AskArgs } = require('../src/commands/ask-context');
const { buildContentStatus, renderOptInGuide } = require('../src/commands/content');
const { removeAgentOpsCopilotFlags } = require('../src/commands/copilot');
const { dashboardImportPlan, dashboardKqlCheck, dashboardVerify, runDashboardImport, validateDashboardLinks, validateDashboardUx, validateDashboards } = require('../src/commands/dashboard');
const { browserProfileOptionsFromArgs, checkReportHtml, e2eAuthProfile, grafanaAuthRemediation, grafanaScreenshotTargets, grafanaVisualOk, renderAuthProfile, renderReportHtml, safeE2eEnv } = require('../src/commands/e2e');
const { hasV2Args } = require('../src/commands/explain');
const { openV2FromFiles, renderOpenV2 } = require('../src/commands/open');
const { productAudit, productAuditWithVisual, renderProductAudit, visualAuditRecoveryCommands } = require('../src/commands/product');
const { benchmarkEvidenceFromReport, firstPositional: firstRecommendPositional, recommendFromFiles, recommendationRow, renderRecommendationV2, writeRecommendation } = require('../src/commands/recommend');
const { demoOptionsFromArgs, demoVerifyCommand } = require('../src/commands/demo');
const { buildTriage, renderTriage, writeTriage } = require('../src/commands/triage');
const { buildAzureIngestPlan } = require('../src/lib/azure/v2-ingest-plan');
const { generateDemoData, tableNames, writeDemoData } = require('../src/lib/demo/agentops-demo-data');
const { ciStatusFromChecks, enrichGithubOutcomes, rowFromPullRequest, stableHash } = require('../src/lib/github/outcome-enricher');
const { isRevertPullRequest } = require('../src/lib/github/revert-detector');
const {
  evaluateRunQuality,
  scoreCodeOutcome,
  scoreReliability,
  scoreSecurity,
  scoreTestDiscipline,
  scoreToolEfficiency
} = require('../src/lib/evals');
const { patternRows, renderPatterns } = require('../src/commands/insights');
const { generateInsights } = require('../src/lib/insights/deterministic-insights');
const { detectCostOutlier, detectLatencyOutlier } = require('../src/lib/insights/outlier-detector');
const { detectEvalRegression, detectToolRegression } = require('../src/lib/insights/regression-detector');
const { explainRun, renderV2Explanation } = require('../src/lib/explain/v2-explain');
const { createMcpHttpProxyObserver } = require('../src/lib/mcp/proxy-http');
const { createMcpProxyObserver } = require('../src/lib/mcp/proxy-stdio');
const { classifyMcpToolRisk } = require('../src/lib/mcp/risk-classifier');
const { rollupSpanRows } = require('../src/lib/rollup/span-to-agentops-tables');

const {
  agentopsAttributionSmoke,
  agentopsInit,
  agentopsConfigure,
  agentopsSetupGuide,
  agentopsSmoke,
  agentopsLiveReplaySmoke,
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
  agentopsCustomEmit,
  agentopsCustomImport,
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
  otlpLiveReplaySmokeTracePayload,
  otlpCustomEventPayload,
  otelCompatibilityQuery,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  parseConfigureArgs,
  parseCustomArgs,
  parseEnvAssignments,
  parseOtelSetupArgs,
  parseFrontmatter,
  parseSavedViewArgs,
  parseSetupArgs,
  parseSmokeArgs,
  replayTimeline,
  renderExplanation,
  renderAskContext,
  renderConfigure,
  renderCustom,
  renderInit,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderOtelSetup,
  renderRecommendation,
  renderReplay,
  renderSetupGuide,
  renderSmoke,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  renderStatus,
  renderValidateEnterprise,
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
  validateEnterprise,
  validateAzure,
  validateKqlDuration,
  validateBenchmarkTask,
  uninstallPlugin,
  writeAgentOpsConfig,
  verifySmokeInAzure
} = require('../src/index.js');

const root = path.resolve(__dirname, '..', '..');
const benchmarkSummariesDir = path.join(__dirname, 'fixtures', 'benchmark-runs');

test('CLI help exposes small core surface and hides experimental commands', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'agentops-cli', 'src', 'index.js'), '--help'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /collector start\|stop\|status\|validate\|smoke\|install-binary\|uninstall-binary/);
  assert.match(result.stdout, /smoke \[--real-copilot\]/);
  assert.match(result.stdout, /init \[--dry-run\]/);
  assert.match(result.stdout, /uninstall \[--keep-plugin\]/);
  assert.match(result.stdout, /agentops experimental <old-command>/);
  assert.doesNotMatch(result.stdout, /benchmark list/);
  assert.doesNotMatch(result.stdout, /saved-view add/);
});

test('init is a core command without experimental migration warning', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'agentops-cli', 'src', 'index.js'), 'init', '--dry-run', '--no-skills'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AgentOps init/);
  assert.match(result.stdout, /smoke --real-copilot/);
  assert.doesNotMatch(result.stderr, /experimental now/);
});

test('collector manager plans strict configs and absolute Docker compose paths', () => {
  const args = collectorManager.dockerComposeArgs(['config']);
  assert.ok(path.isAbsolute(args[args.indexOf('-f') + 1]));
  assert.ok(args.includes('--project-name'));
  assert.ok(args.includes('agentops-azuremonitor'));
  assert.match(collectorManager.configPathFor('docker', 'strict'), /otelcol\.azuremonitor\.strict\.yaml$/);
  assert.match(collectorManager.configPathFor('binary', 'strict'), /otelcol\.binary\.strict\.yaml$/);
  assert.equal(collectorManager.composeHasLocalhostBindings(), true);
});

test('collector binary resolution respects AGENTOPS_OTELCOL_BIN', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-otelcol-'));
  const fake = path.join(tempDir, 'otelcol-contrib');
  try {
    fs.writeFileSync(fake, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(fake, 0o755);
    const resolved = collectorManager.findCollectorBinary({ AGENTOPS_OTELCOL_BIN: fake });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.path, fake);
    assert.equal(resolved.source, 'AGENTOPS_OTELCOL_BIN');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collector binary installer maps release packages without Docker', () => {
  const mac = collectorManager.collectorPackageInfo({ version: '0.151.0', platform: 'darwin', arch: 'arm64' });
  assert.equal(mac.fileName, 'otelcol-contrib_0.151.0_darwin_arm64.tar.gz');
  assert.equal(mac.binaryName, 'otelcol-contrib');
  assert.match(mac.url, /opentelemetry-collector-releases\/releases\/download\/v0\.151\.0/);
  assert.match(mac.checksumUrl, /opentelemetry-collector-releases_otelcol-contrib_checksums\.txt$/);

  const win = collectorManager.collectorPackageInfo({ version: 'v0.151.0', platform: 'win32', arch: 'x64' });
  assert.equal(win.fileName, 'otelcol-contrib_0.151.0_windows_amd64.tar.gz');
  assert.equal(win.binaryName, 'otelcol-contrib.exe');
  assert.match(win.checksumUrl, /opentelemetry-collector-releases_otelcol-contrib_windows_checksums\.txt$/);
});

test('collector binary checksum verification rejects tampered archives', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-checksum-test-'));
  try {
    const archive = path.join(tempDir, 'otelcol-contrib_0.151.0_linux_amd64.tar.gz');
    fs.writeFileSync(archive, 'expected archive');
    const goodHash = crypto.createHash('sha256').update('expected archive').digest('hex');
    const checksums = [
      `${goodHash}  otelcol-contrib_0.151.0_linux_amd64.tar.gz`,
      '0'.repeat(64) + '  otelcol-contrib_0.151.0_linux_arm64.tar.gz'
    ].join('\n');

    assert.equal(
      collectorManager.parseChecksumFile(checksums, 'otelcol-contrib_0.151.0_linux_amd64.tar.gz'),
      goodHash
    );
    assert.equal(collectorManager.verifyChecksum({
      archive,
      checksumsText: checksums,
      fileName: 'otelcol-contrib_0.151.0_linux_amd64.tar.gz'
    }).ok, true);

    fs.writeFileSync(archive, 'tampered archive');
    const tampered = collectorManager.verifyChecksum({
      archive,
      checksumsText: checksums,
      fileName: 'otelcol-contrib_0.151.0_linux_amd64.tar.gz'
    });
    assert.equal(tampered.ok, false);
    assert.match(tampered.error, /SHA256 mismatch/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('strict privacy poison check drops unknown content fields and keeps safe metadata', () => {
  const result = privacy.poisonCheck();
  assert.equal(result.ok, true);
  assert.deepEqual(result.leaked, []);
  assert.equal(result.sanitized['agentops.content_capture.signal'], true);
  assert.equal(result.sanitized['unknown.future.content.field'], undefined);
});

test('collector privacy processor artifacts and poison fixtures are present', () => {
  const result = collectorManager.validateCollectorArtifacts();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.fixtures.length, 2);
  assert.ok(result.fixtures.every(fixture => fixture.ok));
  assert.ok(result.fixtures.every(fixture => fixture.content_signal));
  assert.ok(result.processors.some(file => file.endsWith('strict-allowlist.yaml')));
  assert.ok(result.processors.some(file => file.endsWith('span-to-run-summary.yaml')));
});

test('Agent Run schema accepts metadata-only strict runs and rejects content export', () => {
  const validAttrs = {
    'agentops.schema.version': '2',
    'agentops.run.id': 'run-1',
    'agentops.session.id': 'session-1',
    'agentops.surface': 'cli',
    'agentops.privacy.mode': 'strict',
    'agentops.content_capture.mode': 'off',
    'agentops.content_capture.signal': false,
    'agentops.repo.hash': 'repohash',
    'agentops.branch.hash': 'branchhash',
    'agentops.task.type': 'fix',
    'agentops.outcome.status': 'success',
    'agentops.duration.ms': 123,
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'github.copilot',
    'gen_ai.conversation.id': 'session-1'
  };
  const valid = validateAgentRun(validAttrs);
  assert.equal(valid.ok, true);

  const invalid = validateAgentRun({
    ...validAttrs,
    'agentops.privacy.mode': 'strict',
    'gen_ai.input.messages': 'do not export'
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(error => error.includes('gen_ai.input.messages')));
});

test('OTel normalizers preserve safe GenAI and MCP shape', () => {
  const genai = normalizeGenAiAttributes({
    'agentops.run.id': 'run-1',
    'agentops.session.id': 'session-1',
    'agentops.repo.path': '/private/repo'
  });
  assert.equal(genai['gen_ai.operation.name'], 'chat');
  assert.equal(genai['gen_ai.provider.name'], 'github.copilot');
  assert.equal(genai['gen_ai.conversation.id'], 'session-1');
  assert.ok(genai['agentops.repo.hash']);
  assert.equal(genai['agentops.repo.path'], undefined);

  const mcp = normalizeMcpAttributes({}, {
    sessionId: 'session-1',
    serverName: 'playwright',
    toolName: 'browser_click',
    argsSchema: { type: 'object' },
    result: { ok: true }
  });
  assert.equal(validateMcpSpan(mcp).ok, true);
  assert.equal(mcp['gen_ai.operation.name'], 'execute_tool');
  assert.equal(mcp['agentops.mcp.tool.risk'], 'browser-control');
  assert.ok(mcp['agentops.mcp.args_schema_hash']);
  assert.ok(mcp['agentops.mcp.result_size_bytes'] > 0);
});

test('demo data generator emits metadata-only AgentOps custom table rows', () => {
  const result = generateDemoData({ runs: 12 });
  assert.equal(result.ok, true);
  assert.equal(result.tables.AgentOpsRunSummary_CL.length, 12);
  assert.ok(result.scenario_names.includes('successful-test-writing-run'));
  assert.ok(result.scenario_names.includes('pr-opened-ci-failed'));
  assert.ok(result.tables.AgentOpsRunSummary_CL.every(row => row.ScenarioName));
  assert.equal(result.tables.AgentOpsPrivacy_CL.some(row => row.Action === 'dropped'), true);
  assert.equal(result.tables.AgentOpsGithubOutcomes_CL.some(row => row.PrOpened === true), true);
  assert.equal(result.tables.AgentOpsGithubOutcomes_CL.some(row => row.TimeToPrMinutes >= 0), true);
  assert.equal(result.tables.AgentOpsGithubOutcomes_CL.some(row => row.PrMerged && row.TimeToMergeMinutes >= row.TimeToPrMinutes), true);
  assert.equal(result.tables.AgentOpsMcpCalls_CL.some(row => row.McpServerHash), true);
  assert.equal(result.tables.AgentOpsRunSummary_CL.some(row => row.ContextWindowPct >= 90), true);
  assert.equal(result.tables.AgentOpsRunSummary_CL.some(row => row.CacheReadTokens > 0), true);
  assert.equal(result.tables.AgentOpsEvents_CL.some(row => row.EventName === 'context.pressure'), true);

  for (const table of tableNames) assert.ok(Array.isArray(result.tables[table]), table);

  const serialized = JSON.stringify(result.tables);
  assert.doesNotMatch(serialized, /gen_ai\.input\.messages|gen_ai\.output\.messages|system_instructions/);
  assert.doesNotMatch(serialized, /SECRET_FAKE_TEST_VALUE|api_key=|cat ~\/\.ssh\/id_rsa|this should never leave local machine/);
});

test('demo flags explicitly control scenario families', () => {
  assert.deepEqual(demoOptionsFromArgs(['--with-failures', '--with-privacy-drops', '--with-github-outcomes']), {
    withFailures: true,
    withPrivacyDrops: true,
    withGithubOutcomes: true,
    withContent: false
  });
  assert.equal(generateDemoData({
    runs: 12,
    withFailures: false,
    withPrivacyDrops: false,
    withGithubOutcomes: false
  }).tables.AgentOpsRunSummary_CL.some(row => row.OutcomeStatus === 'failed' || row.PrOpened || row.ContentCaptureSignal), false);
  assert.throws(() => demoOptionsFromArgs(['--with-failures', '--without-failures']), /either --with-failures or --without-failures/);
});

test('demo verify runs the local V2 control-room proof', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-demo-verify-'));
  const originalWrite = process.stdout.write;
  let output = '';
  try {
    process.stdout.write = chunk => {
      output += String(chunk);
      return true;
    };
    demoVerifyCommand(['--runs', '12', '--out', path.join(tempDir, 'demo'), '--insights-out', path.join(tempDir, 'insights'), '--json']);
  } finally {
    process.stdout.write = originalWrite;
  }
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.demo.runs, 12);
  assert.equal(result.insights.table_counts.AgentOpsEval_CL, 12);
  assert.equal(result.dashboard.ok, true);
  assert.equal(result.links.ok, true);
  assert.ok(result.explanation.headline);
  assert.equal(result.open_links.ok, true);
  assert.match(result.open_links.links.replay, /agentops-v2-run-replay/);
  assert.equal(result.recommendation.ok, true);
  assert.ok(result.recommendation.next_action);
  assert.ok(result.next.some(command => command.includes('agentops open latest')));
  assert.ok(result.next.some(command => command.includes('agentops recommend latest')));
  assert.doesNotMatch(output, /SECRET_FAKE_TEST_VALUE|api_key=|gen_ai\.input\.messages/);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('azure-ingest plan validates V2 table files and privacy shape', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-azure-ingest-'));
  try {
    const demo = generateDemoData({ runs: 12 });
    const { writeDemoData } = require('../src/lib/demo/agentops-demo-data');
    writeDemoData(demo, tempDir);

    const result = buildAzureIngestPlan({ dir: tempDir });
    assert.equal(result.ok, true);
    assert.equal(result.privacy.ok, true);
    assert.equal(result.tables.AgentOpsRunSummary_CL.rows, 12);
    assert.ok(result.tables.AgentOpsRunSummary_CL.columns.includes('RunId'));
    assert.equal(result.tables.AgentOpsRunSummary_CL.stream_name, 'Custom-AgentOpsRunSummary_CL');
    assert.equal(result.tables.AgentOpsRunSummary_CL.column_types.TimeGenerated, 'datetime');
    assert.equal(result.tables.AgentOpsRunSummary_CL.column_types.RunId, 'string');
    assert.equal(result.tables.AgentOpsRunSummary_CL.column_types.ToolCount, 'long');
    assert.equal(result.tables.AgentOpsRunSummary_CL.column_types.EstimatedCostUsd, 'real');
    assert.equal(result.tables.AgentOpsRunSummary_CL.column_types.PrOpened, 'boolean');
    assert.equal(result.azure.streams.AgentOpsRunSummary_CL, 'Custom-AgentOpsRunSummary_CL');
    assert.match(result.azure.ingestion_path, /Logs Ingestion API/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('azure-ingest plan fails closed on content-like fields', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-azure-ingest-leak-'));
  try {
    const demo = generateDemoData({ runs: 2 });
    const { writeDemoData } = require('../src/lib/demo/agentops-demo-data');
    writeDemoData(demo, tempDir);
    fs.appendFileSync(path.join(tempDir, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-leak',
      SessionId: 'session-leak',
      EventName: 'gen_ai.chat',
      'gen_ai.input.messages': 'SECRET_FAKE_TEST_VALUE'
    })}\n`);

    const result = buildAzureIngestPlan({ dir: tempDir });
    assert.equal(result.ok, false);
    assert.equal(result.privacy.ok, false);
    assert.ok(result.privacy.leaks.some(leak => leak.table === 'AgentOpsEvents_CL'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('azure-ingest plan requires explicit opt-in for prompt response content rows', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-azure-ingest-content-'));
  try {
    const demo = generateDemoData({ runs: 3, withContent: true });
    writeDemoData(demo, tempDir);

    const blocked = buildAzureIngestPlan({ dir: tempDir });
    assert.equal(blocked.ok, false);
    assert.match(blocked.errors.join('\n'), /--allow-content/);

    const allowed = buildAzureIngestPlan({ dir: tempDir, allowContent: true });
    assert.equal(allowed.ok, true, allowed.errors.join('\n'));
    assert.equal(allowed.content_capture.rows, 6);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('content status makes prompt response viewer opt-in explicit', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-status-'));
  try {
    const demo = generateDemoData({ runs: 3, withContent: true });
    writeDemoData(demo, tempDir);

    const blocked = buildContentStatus({
      dir: tempDir,
      allowContent: false
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.content_rows, 6);
    assert.equal(blocked.allowed_for_ingest, false);
    assert.match(blocked.status, /blocked/);
    assert.match(blocked.transcript_viewer_url, /viewPanel=26/);
    assert.ok(blocked.next.some(step => step.includes('--allow-content')));

    const allowed = buildContentStatus({
      dir: tempDir,
      allowContent: true
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.allowed_for_ingest, true);
    assert.equal(allowed.capture_modes.redacted, 6);
    assert.equal(allowed.has_full_content, false);

    const guide = renderOptInGuide();
    assert.match(guide, /AGENTOPS_CAPTURE_CONTENT=false/);
    assert.match(guide, /restricted to approved viewers/);
    assert.match(guide, /--allow-content/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('latest and replay understand V2 AgentOps custom table rows', () => {
  const demo = generateDemoData({ runs: 12 });
  const latest = latestSessionSummary({ rows: demo.tables.AgentOpsRunSummary_CL, source: 'demo' });
  assert.ok(latest.session);
  assert.ok(latest.session.input_tokens > 0);
  assert.ok(latest.session.output_tokens > 0);
  assert.ok(latest.session.est_usd > 0);
  assert.ok(latest.session.tool_calls > 0);

  const timeline = replayTimeline(demo.tables.AgentOpsEvents_CL, { sessionId: 'latest', source: 'demo' });
  assert.ok(timeline.events.length > 0);
  assert.ok(timeline.summary.input_tokens > 0);
  assert.ok(timeline.summary.est_usd > 0);
  assert.ok(timeline.events.some(event => event.event === 'gen_ai.chat'));
});

test('span rollup converts raw OTel JSONL rows into V2 AgentOps tables', () => {
  const rows = [
    {
      name: 'invoke_agent',
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': 'agent-optimizer',
        'gen_ai.conversation.id': 'conv-rollup',
        'gen_ai.request.model': 'gpt-5.5',
        'gen_ai.usage.input_tokens': 100,
        'gen_ai.usage.output_tokens': 20,
        'gen_ai.usage.cache_read.input_tokens': 25,
        'agentops.context.window_pct': 92,
        'agentops.context.tokens_removed': 11,
        'agentops.permission.wait_ms': 1200,
        'gen_ai.input.messages': 'must be dropped'
      }
    },
    {
      name: 'execute_tool',
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'shell',
        'error.type': 'command_failed'
      },
      status: { code: 'ERROR' }
    },
    {
      name: 'mcp.tools.call',
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'mcp__playwright__browser_click',
        'mcp.method.name': 'tools/call',
        'mcp.session.id': 'mcp-session-1',
        'mcp.server.name': 'playwright',
        'mcp.client.name': 'vscode',
        'mcp.transport': 'stdio',
        'agentops.mcp.sandboxed': true,
        'agentops.mcp.result_size_bytes': 128
      }
    },
    {
      name: 'github.pr.outcome',
      attributes: {
        'agentops.pr.opened': true,
        'agentops.pr.number_hash': 'pr_hash_123',
        'agentops.pr.merged': true,
        'agentops.ci.status': 'passed',
        'agentops.pr.review_comment_count': 2,
        'agentops.pr.commit_count': 3,
        'agentops.pr.files_changed_count': 4
      }
    }
  ];
  const result = rollupSpanRows(rows, { baseTime: '2026-05-29T12:00:00Z' });
  assert.equal(result.runs, 1);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].SessionId, 'conv-rollup');
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].OutcomeStatus, 'failed');
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].ToolFailureCount, 1);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].PrOpened, true);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].CiStatus, 'passed');
  assert.equal(result.tables.AgentOpsMcpCalls_CL[0].McpServerName, 'playwright');
  assert.equal(result.tables.AgentOpsMcpCalls_CL[0].ToolName, 'browser_click');
  assert.equal(result.tables.AgentOpsGithubOutcomes_CL[0].PrMerged, true);
  assert.equal(result.tables.AgentOpsGithubOutcomes_CL[0].FilesChangedCount, 4);
  assert.equal(result.tables.AgentOpsPrivacy_CL[0].Action, 'dropped');
  assert.equal(result.tables.AgentOpsEvents_CL[0].InputTokens, 100);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].CacheReadTokens, 25);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].ContextWindowPct, 92);
  assert.equal(result.tables.AgentOpsRunSummary_CL[0].TokensRemoved, 11);
  assert.doesNotMatch(JSON.stringify(result.tables), /must be dropped|gen_ai\.input\.messages/);
});

test('mcp-proxy observes stdio tool calls without storing args or results', () => {
  const observer = createMcpProxyObserver({
    serverName: 'playwright',
    runId: 'run-mcp-test',
    sessionId: 'session-mcp-test'
  });
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'browser_click',
      arguments: {
        selector: '#secret',
        token: 'SECRET_FAKE_TEST_VALUE'
      }
    }
  };
  const observed = observer.observeClientMessage(request);
  assert.equal(observed.observed, true);
  assert.equal(observed.message.params._meta.traceparent.startsWith('00-'), true);

  observer.observeServerMessage({
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: 'api_key=SECRET_FAKE_TEST_VALUE' }]
    }
  });

  assert.equal(observer.rows.length, 1);
  assert.equal(observer.rows[0].McpServerName, 'playwright');
  assert.equal(observer.rows[0].ToolRisk, 'browser-control');
  assert.ok(observer.rows[0].ResultSizeBytes > 0);
  assert.doesNotMatch(JSON.stringify(observer.rows), /SECRET_FAKE_TEST_VALUE|api_key=|#secret/);
});

test('mcp HTTP observer injects trace context and stores metadata only', () => {
  const observer = createMcpHttpProxyObserver({
    serverName: 'http-demo',
    runId: 'run-http-test',
    sessionId: 'session-http-test',
    transport: 'streamable_http'
  });
  const observed = observer.observeRequest({
    jsonrpc: '2.0',
    id: '42',
    method: 'tools/call',
    params: {
      name: 'fetch_secret_url',
      arguments: {
        url: 'https://example.test/?token=SECRET_FAKE_TEST_VALUE'
      }
    }
  });
  const row = observer.observeResponse({
    jsonrpc: '2.0',
    id: '42',
    result: {
      content: [{ type: 'text', text: 'api_key=SECRET_FAKE_TEST_VALUE' }]
    }
  });

  assert.equal(observed.observed, true);
  assert.equal(observed.message.params._meta.traceparent.startsWith('00-'), true);
  assert.equal(row.McpTransport, 'streamable_http');
  assert.equal(row.ToolRisk, 'secret-access');
  assert.ok(row.ResultSizeBytes > 0);
  assert.doesNotMatch(JSON.stringify(observer.rows), /SECRET_FAKE_TEST_VALUE|api_key=|example\.test/);
});

test('mcp-proxy risk classifier covers sensitive and destructive tools', () => {
  assert.equal(classifyMcpToolRisk('read_file'), 'read-only');
  assert.equal(classifyMcpToolRisk('shell_exec'), 'shell');
  assert.equal(classifyMcpToolRisk('delete_workspace'), 'destructive');
  assert.equal(classifyMcpToolRisk('get_secret_token'), 'secret-access');
});

test('mcp-proxy smoke passes stdio traffic and writes safe MCP rows', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-mcp-proxy-'));
  const outFile = path.join(tempDir, 'AgentOpsMcpCalls_CL.jsonl');
  const child = spawn(process.execPath, [
    path.join(root, 'agentops-cli', 'src', 'index.js'),
    'mcp-proxy',
    '--server-name',
    'demo',
    '--out',
    outFile,
    '--',
    process.execPath,
    path.join(root, 'examples', 'mcp-proxy', 'demo-server.js')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'read_file',
      arguments: {
        path: '/private/repo/secret.txt',
        token: 'SECRET_FAKE_TEST_VALUE'
      }
    }
  })}\n`);
  child.stdin.end();

  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, stderr);
  assert.match(stdout, /"jsonrpc":"2.0"/);
  const rows = fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].McpServerName, 'demo');
  assert.equal(rows[0].ToolName, 'read_file');
  assert.equal(rows[0].ToolRisk, 'read-only');
  assert.doesNotMatch(JSON.stringify(rows), /SECRET_FAKE_TEST_VALUE|secret\.txt|\/private\/repo/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('github outcome enricher hashes identifiers and keeps PR text out', () => {
  const row = rowFromPullRequest({
    number: 123,
    title: 'Fix SECRET_FAKE_TEST_VALUE leak',
    state: 'MERGED',
    headRefName: 'user/private-branch',
    updatedAt: '2026-05-29T12:00:00Z',
    createdAt: '2026-05-29T11:50:00Z',
    mergedAt: '2026-05-29T12:01:00Z',
    changedFiles: 4,
    commitsCount: 2,
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }]
  }, { repo: 'owner/private-repo', runStartedAt: '2026-05-29T11:45:00Z' });

  assert.equal(row.PrOpened, true);
  assert.equal(row.PrMerged, true);
  assert.equal(row.CiStatus, 'passed');
  assert.equal(row.FilesChangedCount, 4);
  assert.equal(row.TimeToPrMinutes, 5);
  assert.equal(row.TimeToMergeMinutes, 16);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /owner\/private-repo|private-branch|SECRET_FAKE_TEST_VALUE|Fix /);
});

test('github PR mappers detect reverts and summarize checks without text leakage', () => {
  const row = rowFromPullRequest({
    number: 99,
    title: 'Revert private customer fix',
    headRefName: 'private/revert-branch',
    updatedAt: '2026-05-29T12:00:00Z',
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    labels: [{ name: 'rollback' }]
  }, { repo: 'owner/private-repo' });

  assert.equal(isRevertPullRequest({ labels: [{ name: 'reverted' }] }), true);
  assert.equal(row.PrReverted, true);
  assert.equal(row.CiStatus, 'passed');
  assert.doesNotMatch(JSON.stringify(row), /private customer|private\/revert-branch|owner\/private-repo/);
});

test('github outcome enricher reads gh metadata with mocked CLI', () => {
  const calls = [];
  const result = enrichGithubOutcomes({
    limit: 1,
    spawnSync: (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'repo') return { status: 0, stdout: JSON.stringify({ nameWithOwner: 'owner/private-repo' }), stderr: '' };
      return {
        status: 0,
        stdout: JSON.stringify([{
          number: 7,
          state: 'OPEN',
          title: 'Do not export this title',
          headRefName: 'feature/private',
          updatedAt: '2026-05-29T12:00:00Z',
          changedFiles: 3,
          commitsCount: 1,
          statusCheckRollup: [{ conclusion: 'FAILURE' }]
        }]),
        stderr: ''
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].CiStatus, 'failed');
  assert.equal(calls[0][0], 'gh');
  assert.doesNotMatch(JSON.stringify(result), /owner\/private-repo|feature\/private|Do not export this title/);
});

test('github outcome enricher maps PR branches back to AgentOps run ids', () => {
  const result = enrichGithubOutcomes({
    limit: 1,
    runRows: [{
      TimeGenerated: '2026-05-29T12:00:01Z',
      RunId: 'run-agentops-match',
      RepoHash: stableHash('owner/private-repo', 'repo'),
      BranchHash: stableHash('feature/private', 'branch')
    }],
    spawnSync: (_command, args) => {
      if (args[0] === 'repo') return { status: 0, stdout: JSON.stringify({ nameWithOwner: 'owner/private-repo' }), stderr: '' };
      return {
        status: 0,
        stdout: JSON.stringify([{
          number: 8,
          state: 'MERGED',
          title: 'Private title must not export',
          headRefName: 'feature/private',
          updatedAt: '2026-05-29T12:02:00Z',
          changedFiles: 2,
          commits: [{ oid: 'a' }, { oid: 'b' }],
          statusCheckRollup: [{ conclusion: 'SUCCESS' }]
        }]),
        stderr: ''
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].RunId, 'run-agentops-match');
  assert.equal(result.rows[0].CiStatus, 'passed');
  assert.equal(result.rows[0].CommitCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /owner\/private-repo|feature\/private|Private title/);
});

test('github CI status summarizes check conclusions', () => {
  assert.equal(ciStatusFromChecks([{ conclusion: 'SUCCESS' }]), 'passed');
  assert.equal(ciStatusFromChecks([{ conclusion: 'FAILURE' }]), 'failed');
  assert.equal(ciStatusFromChecks([{ conclusion: '' }]), 'pending');
  assert.equal(ciStatusFromChecks([]), 'unknown');
});

test('deterministic insights score V2 rows and flag risky outcomes', () => {
  const result = generateInsights({
    runs: [{
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-risk',
      TraceId: 'trace-risk',
      RepoHash: 'repo_hash',
      ModelActual: 'gpt-5.5',
      TaskType: 'fix',
      OutcomeStatus: 'failed',
      EstimatedCostUsd: 1.4,
      ToolCount: 4,
      ToolFailureCount: 1,
      ToolDeniedCount: 1,
      TestsRan: false,
      TestsPassed: false,
      FilesEditedCount: 2,
      PrivacyMode: 'strict'
    }],
    tools: [{ RunId: 'run-risk', ToolName: 'shell', Status: 'failed', Allowed: true }],
    privacy: [{ RunId: 'run-risk', DroppedCount: 2 }],
    github: [{ RunId: 'run-risk', PrOpened: true, CiStatus: 'failed' }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.evals.length, 1);
  assert.equal(result.evals[0].EvalBucket, 'poor');
  assert.ok(result.insights.some(row => row.InsightType === 'test-discipline'));
  assert.ok(result.insights.some(row => row.InsightType === 'tool-regression'));
  assert.ok(result.insights.some(row => row.InsightType === 'privacy-drop'));
  assert.ok(result.insights.some(row => row.InsightType === 'ci-failed'));
  assert.ok(result.insights.some(row => row.InsightType === 'cost-anomaly'));
  assert.doesNotMatch(JSON.stringify(result), /prompt|SECRET_FAKE_TEST_VALUE|file contents/);
});

test('outlier and regression detectors flag cost latency eval and tool changes', () => {
  const run = {
    RunId: 'run-current',
    RepoHash: 'repo_hash',
    TaskType: 'review',
    ModelActual: 'gpt-5.5',
    EstimatedCostUsd: 4.2,
    DurationMs: 260000,
    ConfigHash: 'config_hash_new'
  };
  const baselineRuns = [
    { RunId: 'run-old-1', RepoHash: 'repo_hash', TaskType: 'review', ModelActual: 'gpt-5.5', EstimatedCostUsd: 0.9, DurationMs: 70000 },
    { RunId: 'run-old-2', RepoHash: 'repo_hash', TaskType: 'review', ModelActual: 'gpt-5.5', EstimatedCostUsd: 1.1, DurationMs: 80000 }
  ];
  const tools = [
    { RunId: 'run-current', ToolName: 'shell', Status: 'failed' },
    { RunId: 'run-current', ToolName: 'read_file', Status: 'success' }
  ];
  const baselineTools = [
    { RunId: 'run-old-1', ToolName: 'shell', Status: 'success' },
    { RunId: 'run-old-2', ToolName: 'shell', Status: 'success' }
  ];

  assert.equal(detectCostOutlier(run, baselineRuns).type, 'cost-anomaly');
  assert.equal(detectLatencyOutlier(run, baselineRuns).type, 'latency-anomaly');
  assert.equal(detectToolRegression(run, tools, baselineTools).type, 'tool-regression');
  assert.equal(detectEvalRegression(run, { EvalOverall: 50 }, [{ RunId: 'run-old-1', RepoHash: 'repo_hash', TaskType: 'review', EvalOverall: 88 }]).type, 'eval-regression');
});

test('insights include baseline-backed anomaly and regression evidence', () => {
  const result = generateInsights({
    runs: [
      { TimeGenerated: '2026-05-29T10:00:00Z', RunId: 'run-old-1', RepoHash: 'repo_hash', TaskType: 'review', ModelActual: 'gpt-5.5', OutcomeStatus: 'success', EstimatedCostUsd: 1, DurationMs: 60000, ToolCount: 2, TestsRan: false, FilesEditedCount: 0, PrivacyMode: 'strict' },
      { TimeGenerated: '2026-05-29T11:00:00Z', RunId: 'run-current', RepoHash: 'repo_hash', TaskType: 'review', ModelActual: 'gpt-5.5', OutcomeStatus: 'failed', EstimatedCostUsd: 4, DurationMs: 240000, ToolCount: 2, ToolFailureCount: 1, TestsRan: false, FilesEditedCount: 3, PrivacyMode: 'strict', ConfigHash: 'config_hash_new' }
    ],
    tools: [{ RunId: 'run-current', ToolName: 'shell', Status: 'failed' }],
    evals: [{ RunId: 'run-old-1', RepoHash: 'repo_hash', TaskType: 'review', EvalOverall: 90 }]
  });

  assert.ok(result.insights.some(row => row.InsightType === 'cost-anomaly' && row.BaselineValue));
  assert.ok(result.insights.some(row => row.InsightType === 'latency-anomaly' && row.BaselineValue));
  assert.ok(result.insights.some(row => row.InsightType === 'eval-regression' && row.ConfigHash === 'config_hash_new'));
});

test('insights generate privacy-safe recurring pattern rows', () => {
  const runs = Array.from({ length: 4 }, (_unused, index) => ({
    TimeGenerated: `2026-05-29T12:0${index}:00Z`,
    RunId: `run-pattern-${index}`,
    RepoHash: 'repo_hash',
    TaskType: 'fix',
    ModelActual: 'gpt-5.5',
    AgentName: 'agent-main',
    OutcomeStatus: 'failed',
    OutcomeReason: 'tool_failure',
    EstimatedCostUsd: 1.5,
    TestsRan: false,
    FilesEditedCount: 2,
    ToolDeniedCount: index % 2 === 0 ? 1 : 0,
    PrivacyMode: 'strict'
  }));
  const result = generateInsights({ runs });
  const recurring = result.insights.filter(row => row.InsightType.startsWith('recurring-'));

  assert.ok(recurring.some(row => row.InsightType === 'recurring-failure-pattern'));
  assert.ok(recurring.some(row => row.InsightType === 'recurring-no-tests-pattern'));
  assert.ok(recurring.some(row => row.InsightType === 'recurring-cost-pattern'));
  assert.ok(recurring.every(row => row.PatternId && row.PatternRuns >= 2 && row.PatternDimension));
  assert.doesNotMatch(JSON.stringify(recurring), /prompt|SECRET_FAKE_TEST_VALUE|file contents/);
  assert.equal(patternRows(result.insights)[0].PatternRuns, 4);
  assert.match(renderPatterns(result.insights), /PatternKey:/);
});

test('deterministic eval modules score each quality dimension', () => {
  const riskyRun = {
    OutcomeStatus: 'failed',
    PrivacyMode: 'strict',
    ToolCount: 24,
    ToolFailureCount: 2,
    ToolDeniedCount: 1,
    TestsRan: false,
    TestsPassed: false,
    FilesEditedCount: 3
  };
  const context = {
    privacy: [{ DroppedCount: 2 }],
    github: [{ PrOpened: true, CiStatus: 'failed' }]
  };

  assert.equal(scoreTestDiscipline(riskyRun), 35);
  assert.equal(scoreToolEfficiency(riskyRun), 51);
  assert.equal(scoreSecurity(riskyRun, context), 55);
  assert.equal(scoreReliability(riskyRun), 42);
  assert.equal(scoreCodeOutcome(riskyRun, context), 50);

  const quality = evaluateRunQuality(riskyRun, context);
  assert.equal(quality.EvalOverall, 47);
  assert.equal(quality.EvalBucket, 'poor');
});

test('V2 explain uses eval and insight evidence', () => {
  const run = {
    RunId: 'run-risk',
    OutcomeStatus: 'failed',
    OutcomeReason: 'tool_failure',
    TimeGenerated: '2026-05-29T12:00:00Z'
  };
  const explanation = explainRun(run, [{
    RunId: 'run-risk',
    EvalOverall: 42,
    EvalBucket: 'poor',
    TestDiscipline: 35,
    ToolEfficiency: 40,
    Security: 65,
    Reliability: 42,
    CodeOutcome: 30
  }], [{
    RunId: 'run-risk',
    Severity: 'high',
    InsightType: 'ci-failed',
    Summary: 'A PR outcome had failing CI after the agent run.',
    SuggestedNextStep: 'Open Code Outcomes.'
  }]);

  assert.equal(explanation.ok, true);
  assert.match(explanation.headline, /failing CI/);
  assert.match(renderV2Explanation(explanation), /Eval: 42/);
  assert.equal(hasV2Args(['latest', '--runs', 'runs.jsonl']), true);
});

test('V2 recommend turns insights into dashboard-backed next actions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-recommend-'));
  try {
    const runsFile = path.join(tempDir, 'AgentOpsRunSummary_CL.jsonl');
    const evalsFile = path.join(tempDir, 'AgentOpsEval_CL.jsonl');
    const insightsFile = path.join(tempDir, 'AgentOpsInsights_CL.jsonl');
    fs.writeFileSync(runsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-risk',
      SessionId: 'session-risk',
      TraceId: 'trace-risk',
      OutcomeStatus: 'failed',
      ModelActual: 'gpt-5.5',
      ToolFailureCount: 1,
      ToolDeniedCount: 0,
      EstimatedCostUsd: 1.2
    })}\n`);
    fs.writeFileSync(evalsFile, `${JSON.stringify({
      RunId: 'run-risk',
      EvalOverall: 42,
      EvalBucket: 'poor',
      EvalReason: 'tool_failures'
    })}\n`);
    fs.writeFileSync(insightsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:01Z',
      RunId: 'run-risk',
      Severity: 'high',
      InsightType: 'tool-regression',
      ToolName: 'shell',
      Summary: 'The shell tool failure rate regressed.',
      SuggestedNextStep: 'Open Tools & MCP Risk filtered to shell.'
    })}\n`);

    const recommendation = recommendFromFiles({
      runId: 'latest',
      runsFile,
      evalsFile,
      insightsFile,
      links: {
        v2_home_url: 'https://graf.example/d/agentops-v2-home'
      }
    });

    assert.equal(recommendation.ok, true);
    assert.equal(recommendation.action, 'investigate_tool');
    assert.equal(recommendation.severity, 'high');
    assert.match(recommendation.evidence.dashboards[0].url, /^https:\/\/graf\.example\/d\/agentops-v2-run-replay/);
    assert.ok(recommendation.evidence.dashboards.some(dashboard => dashboard.url.includes('var-tool_name=shell')));
    assert.ok(recommendation.evidence.dashboards.some(dashboard => dashboard.url.includes('agentops-v2-insights-regressions?var-run_id=run-risk')));
    assert.equal(firstRecommendPositional(['--runs', runsFile, '--json']), 'latest');
    assert.equal(firstRecommendPositional(['run-risk', '--runs', runsFile]), 'run-risk');
    assert.match(renderRecommendationV2(recommendation), /Open Tools & MCP Risk filtered to shell/);
    assert.doesNotMatch(JSON.stringify(recommendation), /prompt|response|SECRET_FAKE_TEST_VALUE/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 recommend falls back to recurring pattern evidence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-recommend-pattern-'));
  try {
    const runsFile = path.join(tempDir, 'AgentOpsRunSummary_CL.jsonl');
    const insightsFile = path.join(tempDir, 'AgentOpsInsights_CL.jsonl');
    fs.writeFileSync(runsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-pattern-current',
      SessionId: 'session-pattern',
      TraceId: 'trace-pattern',
      RepoHash: 'repo_hash',
      TaskType: 'review',
      ModelActual: 'gpt-5.5',
      AgentName: 'agent-main',
      OutcomeStatus: 'success',
      EstimatedCostUsd: 3.5
    })}\n`);
    fs.writeFileSync(insightsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:01Z',
      RunId: 'other-run',
      Severity: 'high',
      InsightType: 'recurring-cost-pattern',
      Summary: '4 high-cost runs share the same model/task shape.',
      SuggestedNextStep: 'Open Models, Cost & Tokens and compare cost per useful outcome.',
      PatternId: 'pattern-cost-review',
      PatternKey: 'cost|gpt-5.5|review',
      PatternRuns: 4,
      PatternDimension: 'model_task'
    })}\n`);

    const recommendation = recommendFromFiles({
      runId: 'latest',
      runsFile,
      insightsFile,
      links: {
        v2_home_url: 'https://graf.example/d/agentops-v2-home'
      }
    });

    assert.equal(recommendation.ok, true);
    assert.equal(recommendation.action, 'triage_recurring_pattern');
    assert.equal(recommendation.evidence.pattern.key, 'cost|gpt-5.5|review');
    assert.equal(recommendation.evidence.pattern.runs, 4);
    assert.ok(recommendation.evidence.dashboards.some(dashboard => dashboard.url.includes('var-pattern_key=cost%7Cgpt-5.5%7Creview')));
    assert.match(renderRecommendationV2(recommendation), /Pattern: cost\|gpt-5\.5\|review/);

    const written = writeRecommendation(recommendation, tempDir);
    const rows = fs.readFileSync(written.file, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Action, 'triage_recurring_pattern');
    assert.equal(rows[0].PatternKey, 'cost|gpt-5.5|review');
    assert.equal(rows[0].PatternRuns, 4);
    assert.ok(!JSON.stringify(rows[0]).includes('Demo prompt'));
    assert.ok(Array.isArray(rows[0].DashboardTitles));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 recommend carries benchmark gate and change-target metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-recommend-benchmark-'));
  try {
    const runsFile = path.join(tempDir, 'AgentOpsRunSummary_CL.jsonl');
    const insightsFile = path.join(tempDir, 'AgentOpsInsights_CL.jsonl');
    const evalsFile = path.join(tempDir, 'AgentOpsEval_CL.jsonl');
    const benchmarkFile = path.join(tempDir, 'benchmark-report.json');
    fs.writeFileSync(runsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-benchmark-current',
      SessionId: 'session-benchmark',
      TraceId: 'trace-benchmark',
      RepoHash: 'repo_hash',
      TaskType: 'fix',
      ModelActual: 'claude-sonnet-4.5',
      OutcomeStatus: 'success',
      FilesEditedCount: 2,
      TestsRan: false
    })}\n`);
    fs.writeFileSync(insightsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:01Z',
      RunId: 'run-benchmark-current',
      Severity: 'high',
      InsightType: 'test-discipline',
      Summary: 'Files were edited without a recorded test run.',
      SuggestedNextStep: 'Run the benchmark gate before promoting this change.'
    })}\n`);
    fs.writeFileSync(evalsFile, `${JSON.stringify({
      RunId: 'run-benchmark-current',
      EvalOverall: 58,
      EvalBucket: 'poor'
    })}\n`);
    fs.writeFileSync(benchmarkFile, `${JSON.stringify({
      runId: 'bench-candidate',
      passRatePct: 50,
      averageScore: 61,
      safetyViolationCount: 0,
      toolFailures: 1,
      totalTokens: 12000,
      cost: 0.42,
      promotion: {
        decision: 'reject',
        validation: 'benchmark summary includes local checks',
        rollback: 'do not promote until failures are explained'
      }
    })}\n`);

    const recommendation = recommendFromFiles({
      runId: 'latest',
      runsFile,
      evalsFile,
      insightsFile,
      benchmarkReportFile: benchmarkFile
    });

    assert.equal(recommendation.evidence.benchmark.run_id, 'bench-candidate');
    assert.equal(recommendation.evidence.benchmark.decision, 'reject');
    assert.ok(recommendation.evidence.file_refs.includes('tests_or_benchmark_suite'));
    assert.match(renderRecommendationV2(recommendation), /Benchmark: bench-candidate/);
    const row = recommendationRow(recommendation, '2026-05-29T12:00:02Z');
    assert.equal(row.BenchmarkRunId, 'bench-candidate');
    assert.equal(row.BenchmarkDecision, 'reject');
    assert.equal(row.BenchmarkAverageScore, 61);
    assert.ok(row.ChangeTargetRefs.includes('tests_or_benchmark_suite'));
    assert.doesNotMatch(JSON.stringify(row), /prompt|source code|tool args/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 recommend marks missing benchmark evidence without failing recommendation generation', () => {
  const report = benchmarkEvidenceFromReport({ runId: 'missing-bench', ok: false, message: 'no benchmark summaries were found for this run' });
  assert.equal(report.run_id, 'missing-bench');
  assert.equal(report.decision, 'missing');
  assert.match(report.validation, /no benchmark summaries/);
  assert.match(report.rollback, /before promotion/);
});

test('V2 open builds run-scoped control-room links from run table rows', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-open-v2-'));
  try {
    const runsFile = path.join(tempDir, 'AgentOpsRunSummary_CL.jsonl');
    fs.writeFileSync(runsFile, `${JSON.stringify({
      TimeGenerated: '2026-05-29T12:00:00Z',
      RunId: 'run-open',
      SessionId: 'session-open',
      TraceId: 'trace-open',
      RepoHash: 'repo_hash',
      AgentName: 'agent-main',
      ModelActual: 'gpt-5.5',
      OutcomeStatus: 'success'
    })}\n`);

    const result = openV2FromFiles({
      runId: 'latest',
      runsFile,
      legacyLinks: {
        v2_home_url: 'https://graf.example/d/agentops-v2-home',
        v2_runs_url: 'https://graf.example/d/agentops-v2-runs-explorer',
        v2_replay_url: 'https://graf.example/d/agentops-v2-run-replay'
      }
    });

    assert.equal(result.ok, true);
    assert.match(result.links.replay, /var-run_id=run-open/);
    assert.match(result.links.replay, /var-session_id=session-open/);
    assert.match(result.links.content_viewer, /viewPanel=26/);
    assert.match(result.links.content_viewer, /var-run_id=run-open/);
    assert.match(result.links.runs, /var-repo_hash=repo_hash/);
    assert.match(result.links.models, /var-model=gpt-5\.5/);
    assert.match(result.links.insights, /agentops-v2-insights-regressions/);
    assert.match(renderOpenV2(result), /Run Replay:/);
    assert.match(renderOpenV2(result), /Prompt\/response viewer \(explicit opt-in\):/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 ask-context builds a metadata-only investigation bundle', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-ask-context-'));
  try {
    const demo = generateDemoData({ runs: 12 });
    const { writeDemoData } = require('../src/lib/demo/agentops-demo-data');
    const written = writeDemoData(demo, tempDir);
    const insightResult = generateInsights({
      runs: demo.tables.AgentOpsRunSummary_CL,
      tools: demo.tables.AgentOpsToolCalls_CL,
      privacy: demo.tables.AgentOpsPrivacy_CL,
      github: demo.tables.AgentOpsGithubOutcomes_CL
    });
    const insightDir = path.join(tempDir, 'insights');
    const { writeInsights } = require('../src/lib/insights/deterministic-insights');
    const insightFiles = writeInsights(insightResult, insightDir);

    const result = buildAskContext({
      runId: 'latest',
      runsFile: written.files.AgentOpsRunSummary_CL,
      eventsFile: written.files.AgentOpsEvents_CL,
      toolsFile: written.files.AgentOpsToolCalls_CL,
      privacyFile: written.files.AgentOpsPrivacy_CL,
      githubFile: written.files.AgentOpsGithubOutcomes_CL,
      evalsFile: insightFiles.evalFile,
      insightsFile: insightFiles.insightsFile
    });

    assert.equal(result.ok, true);
    assert.equal(hasV2AskArgs(['latest', '--runs', written.files.AgentOpsRunSummary_CL]), true);
    assert.match(result.replay_url, /agentops-v2-run-replay/);
    assert.ok(result.counts.events > 0);
    assert.ok(result.prompt.includes('Do not request or enable prompt'));
    assert.doesNotMatch(JSON.stringify(result), /gen_ai\.input\.messages|SECRET_FAKE_TEST_VALUE|api_key=/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 triage builds a single run packet with links prompt and recommendation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-triage-'));
  try {
    const demo = generateDemoData({ runs: 12 });
    const written = writeDemoData(demo, tempDir);
    const insightResult = generateInsights({
      runs: demo.tables.AgentOpsRunSummary_CL,
      tools: demo.tables.AgentOpsToolCalls_CL,
      privacy: demo.tables.AgentOpsPrivacy_CL,
      github: demo.tables.AgentOpsGithubOutcomes_CL
    });
    const insightDir = path.join(tempDir, 'insights');
    const { writeInsights } = require('../src/lib/insights/deterministic-insights');
    const insightFiles = writeInsights(insightResult, insightDir);

    const result = buildTriage({
      runId: 'latest',
      runsFile: written.files.AgentOpsRunSummary_CL,
      eventsFile: written.files.AgentOpsEvents_CL,
      toolsFile: written.files.AgentOpsToolCalls_CL,
      privacyFile: written.files.AgentOpsPrivacy_CL,
      githubFile: written.files.AgentOpsGithubOutcomes_CL,
      evalsFile: insightFiles.evalFile,
      insightsFile: insightFiles.insightsFile
    });

    assert.equal(result.ok, true);
    assert.match(result.links.replay, /agentops-v2-run-replay/);
    assert.equal(result.ask_agentops.prompt.includes('Use only the metadata'), true);
    assert.ok(result.recommendation.action);
    assert.ok(result.evidence_counts.events > 0);
    assert.doesNotMatch(JSON.stringify(result), /gen_ai\.input\.messages|SECRET_FAKE_TEST_VALUE|api_key=/);
    assert.match(renderTriage(result), /AgentOps triage/);
    const artifact = writeTriage(result, tempDir);
    assert.equal(fs.existsSync(artifact.file), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 triage reports missing run rows clearly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-triage-empty-'));
  try {
    const runsFile = path.join(tempDir, 'AgentOpsRunSummary_CL.jsonl');
    fs.writeFileSync(runsFile, '');
    const result = buildTriage({ runId: 'latest', runsFile });
    assert.equal(result.ok, false);
    assert.match(result.error, /no V2 run row/);
    assert.match(renderTriage(result), /AgentOps triage/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('copilot resolver rejects AgentOps shim candidates', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-shim-resolver-'));
  const shim = path.join(tempDir, 'copilot');
  try {
    fs.writeFileSync(shim, '#!/usr/bin/env bash\nexec /tmp/copilot-agentops "$@"\n# AGENTOPS_\n');
    fs.chmodSync(shim, 0o755);
    const result = copilotResolver.validateCandidate(shim, {});
    assert.equal(result.ok, false);
    assert.match(result.error, /AgentOps shim/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('copilot command strips AgentOps-only flags before invoking Copilot', () => {
  assert.deepEqual(
    removeAgentOpsCopilotFlags(['--collector-mode', 'none', '--privacy=strict', '--unsafe-no-collector', '-p', 'hello']),
    ['-p', 'hello']
  );
});

test('Copilot run metadata hashes prompt and command without storing raw text', () => {
  const metadata = createRunMetadata([
    '--no-remote',
    '--allow-tool',
    'shell(npm test)',
    '-p',
    'SECRET_FAKE_TEST_VALUE fix the failing test'
  ], {
    now: '2026-05-29T12:00:00Z',
    cwd: root,
    privacyMode: 'strict'
  });

  assert.equal(metadata.surface, 'cli');
  assert.equal(metadata.remote, false);
  assert.equal(metadata.promptHash.startsWith('prompt_'), true);
  assert.equal(metadata.commandHash.startsWith('cmd_'), true);
  assert.equal(metadata.allowToolCount, 1);
  assert.equal(metadata.allowedToolRisks.shell, 1);
  assert.doesNotMatch(JSON.stringify(metadata), /SECRET_FAKE_TEST_VALUE|failing test|npm test/);
});

test('Copilot tool classifier and session parser produce safe run summaries', () => {
  assert.equal(classifyToolName('browser_click'), 'browser-control');
  assert.equal(classifyToolName('delete_workspace'), 'destructive');
  assert.equal(summarizeAllowedTools(['--allow-tool=shell(pwd)', '--allow-tool', 'read_file']).risks.shell, 1);

  const sessions = parseCopilotSessionRows([
    {
      TimeGenerated: '2026-05-29T12:00:00Z',
      OperationId: 'trace-1',
      Success: true,
      Properties: JSON.stringify({
        'agentops.run.id': 'run-1',
        'agentops.session.id': 'session-1',
        'gen_ai.operation.name': 'chat',
        'gen_ai.usage.input_tokens': 10,
        'gen_ai.usage.output_tokens': 3
      })
    },
    {
      TimeGenerated: '2026-05-29T12:00:01Z',
      OperationId: 'trace-1',
      Success: false,
      Properties: {
        'agentops.run.id': 'run-1',
        'agentops.session.id': 'session-1',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'shell'
      }
    }
  ]);
  const summary = summarizeCopilotRun({
    runId: 'run-1',
    privacyMode: 'strict',
    contentCaptureMode: 'off',
    promptHash: 'prompt_hash',
    commandHash: 'cmd_hash',
    repoHash: 'repo_hash'
  }, sessions[0], { exitCode: 0, durationMs: 1000 });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].failures, 1);
  assert.equal(sessions[0].toolCalls, 1);
  assert.equal(summary.OutcomeStatus, 'failed');
  assert.equal(summary.InputTokens, 10);
  assert.doesNotMatch(JSON.stringify(summary), /prompt text|tool args|SECRET/);
});

test('scan finds plugin agents and skills', () => {
  const result = scan();
  assert.ok(result.agents.length >= 5);
  assert.ok(result.skills.length >= 4);
  assert.ok(result.mcp_servers.includes('azure-mcp'));
  assert.equal(result.hooks.hooks.preToolUse[0].bash, 'node scripts/pre-tool-policy.js');
  assert.equal(result.hooks.hooks.postToolUseFailure[0].bash, 'node scripts/post-tool-failure-hints.js');
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
  const envValues = parseEnvAssignments('AZURE_RESOURCE_GROUP="rg-a"\nGRAFANA_ENDPOINT=https://grafana.example\nAPPLICATIONINSIGHTS_NAME=appi-a\n');
  const configValues = configFromEnvValues(envValues);
  const parsed = parseConfigureArgs(['set', '--resource-group', 'rg-b', '--workspace-id', 'workspace-b']);

  assert.equal(configValues.resourceGroup, 'rg-a');
  assert.equal(configValues.grafanaBaseUrl, 'https://grafana.example');
  assert.equal(configValues.appInsightsName, 'appi-a');
  assert.deepEqual(parsed.values, { resourceGroup: 'rg-b', workspaceId: 'workspace-b' });
  assert.deepEqual(compactConfig({ resourceGroup: 'rg-c', workspaceId: '' }), { resourceGroup: 'rg-c' });
});

test('setup guide recommends the shortest non-mutating setup path', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-setup-guide-'));
  try {
    const result = agentopsSetupGuide({
      installDir: tempDir,
      config: {},
      env: {},
      commandAvailability: { az: true, azd: true, docker: true, copilot: true },
      commandPaths: {
        az: '/usr/local/bin/az',
        azd: '/usr/local/bin/azd',
        docker: '/usr/local/bin/docker',
        copilot: '/usr/local/bin/copilot'
      },
      azdValues: [
        'AZURE_RESOURCE_GROUP="rg-agentops-dev"',
        'LOG_ANALYTICS_WORKSPACE_ID="workspace-123"',
        'LOG_ANALYTICS_WORKSPACE_NAME="law-agentops-dev"',
        'GRAFANA_ENDPOINT="https://grafana.example"',
        'GRAFANA_NAME="graf-agentops-dev"',
        'APPLICATIONINSIGHTS_NAME="appi-agentops-dev"'
      ].join('\n')
    });
    const output = renderSetupGuide(result);

    assert.equal(result.mutates, false);
    assert.equal(result.azd.ok, true);
    assert.equal(result.first_run.read_only, true);
    assert.equal(result.first_run.bind_command, 'agentops configure import-azd');
    assert.match(result.first_run.privacy_smoke_command, /collector smoke --privacy strict --poison/);
    assert.match(result.first_run.smoke_command, /smoke --real-copilot/);
    assert.match(result.first_run.run_command, /--no-remote/);
    assert.match(result.first_run.privacy_note, /Prompts and responses stay off by default/);
    assert.ok(result.next.includes('agentops configure import-azd'));
    assert.match(output, /This command is read-only/);
    assert.match(output, /One-minute first run/);
    assert.match(output, /Privacy smoke: agentops collector smoke --privacy strict --poison --json/);
    assert.match(output, /Real smoke: agentops smoke --real-copilot --wait 2m --poll 10s/);
    assert.match(output, /agentops latest --last 2h && agentops open latest --last 2h/);
    assert.match(output, /agentops dashboard import --yes --resource-group rg-agentops-dev --grafana-name graf-agentops-dev/);
    assert.match(output, /Fastest path/);
    assert.match(output, /agentops collector smoke --privacy strict --poison/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('setup args support json output', () => {
  assert.deepEqual(parseSetupArgs(['--json']), { json: true });
});

test('enterprise validation confirms local guardrails', () => {
  const result = validateEnterprise({ config: {}, env: {} });
  const output = renderValidateEnterprise(result);

  assert.equal(result.ok, true);
  assert.ok(result.score >= 88);
  assert.ok(result.checks.some(check => check.name === 'daily-ingestion-cap' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'least-privilege-rbac-module' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'budget-module' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'enterprise-deploy-script' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'pilot-review-docs' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'threat-model' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'azd-no-connection-string-output' && check.ok));
  assert.ok(result.checks.some(check => check.name === 'collector-content-scrub' && check.ok));
  assert.match(output, /Enterprise guardrails passed/);
});

test('enterprise validation blocks content capture env overrides', () => {
  const result = validateEnterprise({
    config: {},
    env: { COPILOT_OTEL_CAPTURE_CONTENT: 'true' }
  });

  assert.equal(result.ok, false);
  assert.ok(result.failed.includes('content-capture-env-off'));
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
    assert.equal(result.azd.ok, false);
    assert.equal(result.cloud_provision.requested, false);
    assert.ok(result.next.includes('agentops init --provision-cloud'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js validate-azure --import-dashboards --last 24h'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js smoke --real-copilot --wait 2m --poll 10s'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js open latest --last 2h'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js triage latest --out .agentops/triage/latest --json'));
    assert.ok(result.next.includes('node agentops-cli/src/index.js plugin uninstall'));
    assert.ok(result.next.every(command => !command.includes('experimental')));
    assert.match(output, /AgentOps init/);
    assert.match(output, /Agents:/);
    assert.match(output, /Skills:/);
    assert.match(output, /Cloud config: workspace=missing, grafana=missing/);
    assert.match(output, /azd environment:/);
    assert.match(output, /First value: run the real smoke/);
    assert.match(output, /agentops plugin uninstall/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('init prefers azd import when AgentOps deployment outputs exist', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-init-azd-'));
  try {
    const result = agentopsInit({
      dryRun: true,
      noSkills: true,
      env: {},
      workspaceId: '',
      grafanaBaseUrl: '',
      installDir: path.join(tempDir, 'bin'),
      commandAvailability: { azd: true },
      commandPaths: { azd: '/usr/local/bin/azd' },
      azdValues: [
        'AZURE_RESOURCE_GROUP="rg-agentops-dev"',
        'LOG_ANALYTICS_WORKSPACE_ID="workspace-123"',
        'GRAFANA_ENDPOINT="https://grafana.example"',
        'GRAFANA_NAME="graf-agentops-dev"'
      ].join('\n')
    });

    assert.equal(result.azd.ok, true);
    assert.ok(result.next.includes('agentops configure import-azd'));
    assert.equal(result.next.includes('agentops configure set --workspace-id "<workspace-id>"'), false);
    assert.equal(result.next.includes('agentops configure set --grafana-url "https://<your-grafana>.grafana.azure.com"'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('init provision-cloud can run azd provision then import outputs explicitly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-init-provision-'));
  const configPath = path.join(tempDir, 'config.json');
  const calls = [];
  try {
    const result = agentopsInit({
      provisionCloud: true,
      noSkills: true,
      env: {},
      workspaceId: '',
      grafanaBaseUrl: '',
      configPath,
      installDir: path.join(tempDir, 'bin'),
      commandAvailability: { azd: true },
      commandPaths: { azd: '/usr/local/bin/azd' },
      spawnSync: (command, args) => {
        calls.push([command, args]);
        if (args[0] === 'provision') return { status: 0, stdout: 'provisioned\n', stderr: '' };
        if (args[0] === 'env' && args[1] === 'get-values') {
          return {
            status: 0,
            stdout: [
              'AZURE_RESOURCE_GROUP="rg-agentops-dev"',
              'LOG_ANALYTICS_WORKSPACE_ID="workspace-123"',
              'GRAFANA_ENDPOINT="https://grafana.example"',
              'GRAFANA_NAME="graf-agentops-dev"'
            ].join('\n'),
            stderr: ''
          };
        }
        return { status: 1, stdout: '', stderr: 'unexpected command' };
      }
    });

    assert.equal(result.cloud_provision.requested, true);
    assert.equal(result.cloud_provision.ok, true);
    assert.equal(result.cloud_provision.import_result.ok, true);
    assert.ok(calls.some(([, args]) => args[0] === 'provision'));
    assert.ok(calls.some(([, args]) => args[0] === 'env' && args[1] === 'get-values'));
    assert.match(fs.readFileSync(configPath, 'utf8'), /workspace-123/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('init provision-cloud reports azd provision failure with remediation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-init-provision-fail-'));
  try {
    const result = agentopsInit({
      provisionCloud: true,
      noSkills: true,
      env: {},
      workspaceId: '',
      grafanaBaseUrl: '',
      installDir: path.join(tempDir, 'bin'),
      commandAvailability: { azd: true },
      commandPaths: { azd: '/usr/local/bin/azd' },
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'not logged in' })
    });
    const output = renderInit(result);

    assert.equal(result.cloud_provision.ok, false);
    assert.equal(result.cloud_provision.failing_stage, 'azd provision');
    assert.ok(result.cloud_provision.next.includes('az login'));
    assert.ok(result.cloud_provision.next.includes('azd env list'));
    assert.ok(result.cloud_provision.next.includes('azd provision'));
    assert.match(output, /Cloud provision failed at: azd provision/);
    assert.match(output, /Cloud provision next:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('init provision-cloud reports azd import failure with manual binding remediation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-init-import-fail-'));
  try {
    const result = agentopsInit({
      provisionCloud: true,
      noSkills: true,
      env: {},
      workspaceId: '',
      grafanaBaseUrl: '',
      configPath: path.join(tempDir, 'config.json'),
      installDir: path.join(tempDir, 'bin'),
      commandAvailability: { azd: true },
      commandPaths: { azd: '/usr/local/bin/azd' },
      spawnSync: (command, args) => {
        if (args[0] === 'provision') return { status: 0, stdout: 'provisioned\n', stderr: '' };
        if (args[0] === 'env' && args[1] === 'get-values') return { status: 1, stdout: '', stderr: 'no env selected' };
        return { status: 1, stdout: '', stderr: 'unexpected command' };
      }
    });
    const output = renderInit(result);

    assert.equal(result.cloud_provision.ok, false);
    assert.equal(result.cloud_provision.failing_stage, 'agentops configure import-azd');
    assert.ok(result.cloud_provision.next.includes('azd env get-values'));
    assert.ok(result.cloud_provision.next.includes('agentops configure import-azd'));
    assert.ok(result.cloud_provision.next.includes('agentops configure set --workspace-id "<workspace-id>"'));
    assert.match(output, /Cloud provision failed at: agentops configure import-azd/);
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

test('live replay smoke emits orchestrator delegation telemetry', async () => {
  const payload = otlpLiveReplaySmokeTracePayload('agentops-live-replay-smoke-test', Date.parse('2026-05-26T12:00:00Z'));
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  const attrValues = JSON.stringify(payload);

  assert.equal(spans.length, 7);
  assert.ok(spans.some(span => span.parentSpanId));
  assert.match(attrValues, /agentops-orchestrator-smoke/);
  assert.match(attrValues, /agentops-investigator-smoke/);
  assert.match(attrValues, /agentops\.parent_agent\.name/);
  assert.match(attrValues, /agentops\.delegation\.id/);
  assert.match(attrValues, /azure-mcp\/monitor_query/);

  const result = await agentopsLiveReplaySmoke({
    dryRun: true,
    id: 'agentops-live-replay-smoke-test',
    workspaceId: 'workspace-123',
    last: '30m'
  });
  const output = renderSmoke(result);

  assert.equal(result.ok, true);
  assert.equal(result.smoke_kind, 'live-replay');
  assert.equal(result.payload_preview.agent, 'agentops-orchestrator-smoke');
  assert.equal(result.payload_preview.subagent, 'agentops-investigator-smoke');
  assert.match(result.grafana_url, /agentops-live-replay/);
  assert.match(result.grafana_url, /agentops-live-replay-smoke-test/);
  assert.match(output, /AgentOps live replay smoke/);
  assert.match(output, /Grafana Live Replay/);
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

test('smoke real-copilot mode runs safe prompt and prints Run Replay link', async () => {
  let copilotCall = null;
  let latestCalls = 0;
  const result = await agentopsSmoke({
    id: 'agentops-smoke-real',
    endpoint: 'http://collector.example',
    last: '30m',
    workspaceId: 'workspace-123',
    waitMs: 100,
    pollMs: 1,
    realCopilot: true,
    postJson: async () => ({ ok: true, statusCode: 200, body: '' }),
    runQuery: query => {
      assert.match(query, /agentops-smoke-real/);
      return { ok: true, rows: [{ Name: 'agentops.smoke.agentops-smoke-real' }] };
    },
    spawnSync: (command, args, options) => {
      copilotCall = { command, args, options };
      return { status: 0, stdout: 'ok', stderr: '' };
    },
    latestSummary: () => {
      latestCalls += 1;
      if (latestCalls === 1) return { session: null };
      return {
        session: {
          id: 'session-real',
          grafana_url: 'https://grafana.example/d/agentops-sessions?var-conversation=session-real'
        }
      };
    },
    sleep: async () => {}
  });
  const output = renderSmoke(result);

  assert.equal(result.ok, true);
  assert.equal(result.real_copilot, true);
  assert.equal(copilotCall.command, 'copilot');
  assert.ok(copilotCall.args.includes('--no-ask-user'));
  assert.ok(copilotCall.args.includes('--no-remote'));
  assert.equal(copilotCall.options.env.AGENTOPS_CAPTURE_CONTENT, 'false');
  assert.equal(copilotCall.options.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://collector.example');
  assert.equal(result.latest_visibility.ok, true);
  assert.equal(result.latest_visibility.attempts.length, 2);
  assert.match(result.links.v2_replay_url, /agentops-v2-run-replay/);
  assert.match(result.links.v2_replay_url, /var-session_id=session-real/);
  assert.match(output, /Real Copilot smoke: completed/);
  assert.match(output, /Latest Copilot run: visible after 2 attempts/);
  assert.match(output, /V2 Run Replay:/);
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
  const args = parseSmokeArgs(['--id', 'smoke-a', '--wait', '5s', '--poll', '500ms', '--timeout', '9s', '--real-copilot', '--no-verify', '--json']);

  assert.equal(args.id, 'smoke-a');
  assert.equal(args.realCopilot, true);
  assert.equal(args.copilotTimeoutMs, 9000);
  assert.equal(args.verify, false);
  assert.equal(args.waitMs, 5000);
  assert.equal(args.pollMs, 500);
  assert.equal(args.json, true);
  assert.equal(durationToMs('2m'), 120000);
});

test('custom emit dry run creates privacy-safe agent lifecycle telemetry', async () => {
  const result = await agentopsCustomEmit({
    dryRun: true,
    id: 'agentops-custom-test',
    event: 'agent.step.started',
    agent: 'ci-investigator',
    parentAgent: 'agentops-orchestrator',
    delegationId: 'delegation-123',
    workflow: 'investigation',
    step: 'collect-evidence',
    outcome: 'started',
    risk: 'low',
    score: 0.98,
    entityType: 'pull-request',
    entityIdHash: 'hashed-pr-001',
    tags: ['real-run', 'ci-pattern'],
    custom: { 'agentops.custom.signal': 'build-log' },
    attributes: { 'agentops.content_capture.signal': 'true' },
    workspaceId: 'workspace-123'
  });
  const output = renderCustom(result);

  assert.equal(result.ok, true);
  assert.equal(result.custom_event_id, 'agentops-custom-test');
  assert.equal(result.payload_preview.content_capture_enabled, false);
  assert.equal(result.events[0].event, 'agent.step.started');
  assert.equal(result.events[0].agent, 'ci-investigator');
  assert.equal(result.events[0].parentAgent, 'agentops-orchestrator');
  assert.equal(result.events[0].delegationId, 'delegation-123');
  assert.equal(result.events[0].entityType, 'pull-request');
  assert.equal(result.events[0].entityIdHash, 'hashed-pr-001');
  assert.equal(result.events[0].custom['agentops.custom.signal'], 'build-log');
  assert.equal(result.events[0].attributes['agentops.content_capture.signal'], 'true');
  assert.match(result.azure_query, /agentops-custom-test/);
  assert.match(output, /AgentOps custom telemetry/);
});

test('custom OTLP payload maps generic fields to dashboard attributes', () => {
  const { payload, normalized } = otlpCustomEventPayload([{
    event: 'agent.eval.scored',
    agent: 'eval-gate',
    parentAgent: 'agentops-orchestrator',
    delegationId: 'delegation-eval',
    workflow: 'release-gate',
    step: 'score',
    session: 'session-123',
    outcome: 'passed',
    score: 0.91,
    custom: { 'agentops.custom.eval_name': 'release' },
    attributes: { 'github.copilot.policy.decision': 'allowed' }
  }], {
    id: 'agentops-custom-payload',
    nowMs: Date.parse('2026-05-26T12:00:00Z')
  });
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
  const attrs = Object.fromEntries(span.attributes.map(item => [item.key, item.value.stringValue ?? item.value.doubleValue ?? item.value.boolValue]));

  assert.equal(normalized[0].event, 'agent.eval.scored');
  assert.equal(attrs['agentops.event.name'], 'agent.eval.scored');
  assert.equal(attrs['gen_ai.operation.name'], 'agent.eval.scored');
  assert.equal(attrs['agentops.agent.name'], 'eval-gate');
  assert.equal(attrs['agentops.parent_agent.name'], 'agentops-orchestrator');
  assert.equal(attrs['agentops.delegation.id'], 'delegation-eval');
  assert.equal(attrs['agentops.workflow.name'], 'release-gate');
  assert.equal(attrs['agentops.score'], 0.91);
  assert.equal(attrs['content.capture.enabled'], false);
  assert.equal(attrs['github.copilot.policy.decision'], 'allowed');
});

test('custom import maps JSONL agent rows without CI-specific coupling', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-custom-import-'));
  const file = path.join(tempDir, 'events.jsonl');
  try {
    fs.writeFileSync(file, [
      JSON.stringify({ event_name: 'agent.run.started', agent: 'portable-agent', workflow: 'analysis', session_id: 'session-a', attributes: { 'agentops.content_capture.signal': 'true' } }),
      JSON.stringify({ event_name: 'agent.decision.made', agent: 'portable-agent', workflow: 'analysis', step: 'rank', outcome: 'selected', metrics: { confidence: 0.82 } })
    ].join('\n'));

    const result = await agentopsCustomImport(file, {
      dryRun: true,
      id: 'agentops-custom-import-test',
      workspaceId: 'workspace-123'
    });

    assert.equal(result.ok, true);
    assert.equal(result.rows, 2);
    assert.equal(result.events[0].event, 'agent.run.started');
    assert.equal(result.events[0].attributes['agentops.content_capture.signal'], 'true');
    assert.equal(result.events[1].custom['agentops.custom.confidence'], 0.82);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('custom args parse repeated tags and delegation dimensions', () => {
  const args = parseCustomArgs(['emit', '--event', 'agent.step.started', '--agent', 'portable-agent', '--parent-agent', 'orchestrator', '--delegation-id', 'delegation-1', '--tag', 'real-run', '--tag', 'ci-pattern', '--custom', 'queue=main', '--attribute', 'agentops.content_capture.signal=true', '--attr', 'github.copilot.policy.decision=blocked', '--score', '0.7']);

  assert.equal(args.subcommand, 'emit');
  assert.equal(args.event, 'agent.step.started');
  assert.equal(args.parentAgent, 'orchestrator');
  assert.equal(args.delegationId, 'delegation-1');
  assert.deepEqual(args.tags, ['real-run', 'ci-pattern']);
  assert.equal(args.custom['agentops.custom.queue'], 'main');
  assert.equal(args.attributes['agentops.content_capture.signal'], 'true');
  assert.equal(args.attributes['github.copilot.policy.decision'], 'blocked');
  assert.equal(args.score, 0.7);
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
  const output = renderValidateAzure(result);

  assert.equal(result.ok, false);
  assert.deepEqual(byName['grafana-dashboards'].missing, ['agentops-sessions']);
  assert.ok(result.next.some(command => command.includes('agentops dashboard import --yes --resource-group rg-agentops-dev --grafana-name graf-agentops-dev')));
  assert.match(output, /fix: agentops validate-azure --import-dashboards --last 24h/);
});

test('validateAzure can import missing Grafana dashboards only when explicitly requested', () => {
  const imports = [];
  const result = validateAzure({
    importDashboards: true,
    workspaceId: 'workspace-123',
    resourceGroup: 'rg-agentops-dev',
    grafanaBaseUrl: 'https://grafana.example',
    grafanaName: 'graf-agentops-dev',
    appInsightsName: 'appi-agentops-dev',
    expectedDashboards: [{ uid: 'agentops-sessions', title: 'Sessions' }],
    last: '1h',
    spawnDashboardImport: (command, args) => {
      imports.push([command, args]);
      return { status: 0, stdout: 'imported\n', stderr: '' };
    },
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

  assert.equal(imports.length, 1);
  assert.equal(byName['grafana-dashboard-import'].ok, true);
  assert.match(byName['grafana-dashboard-import'].command, /agentops dashboard import --yes --resource-group rg-agentops-dev --grafana-name graf-agentops-dev/);
  assert.ok(result.next.includes('agentops validate-azure --last 24h'));
});

test('Grafana dashboard inventory reads stable dashboard UIDs from repo', () => {
  const dashboards = listGrafanaDashboardFiles();
  const uids = dashboards.map(dashboard => dashboard.uid);

  assert.ok(uids.includes('agentops-sessions'));
  assert.ok(uids.includes('agentops-session-detail'));
  assert.ok(uids.includes('agentops-live-replay'));
  assert.ok(uids.includes('agentops-attribution'));
});

test('V2 dashboard pack follows global AgentOps UX contract', () => {
  const result = validateDashboards();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.dashboards >= 24);
});

test('V2 dashboard ux-check protects the Datadog-style operator flow', () => {
  const result = validateDashboardUx();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.dashboards, 10);
  assert.deepEqual(result.contracts.transcript_first_columns, ['Status', 'SafetyNote', 'OpenTranscript', 'ContentRows']);
  assert.equal(result.contracts.code_outcome_timing, true);
  assert.equal(result.contracts.empty_state_dashboards, 10);
  assert.equal(result.contracts.pattern_drilldowns, true);
  assert.equal(result.contracts.recommendation_artifacts, true);
  assert.equal(result.contracts.ask_agentops_context, true);
});

test('product audit proves the local AgentOps control-room contract', () => {
  const result = productAudit();
  const output = renderProductAudit(result);
  const byName = Object.fromEntries(result.checks.map(check => [check.name, check]));

  assert.equal(result.ok, true, result.checks.filter(check => !check.ok).map(check => `${check.name}: ${check.missing.join(', ')}`).join('\n'));
  assert.equal(result.scope, 'local-product-contract');
  assert.equal(result.live_azure_verified, false);
  assert.equal(result.live_grafana_verified, false);
  assert.ok(result.summary.checked_links >= 100);
  for (const name of [
    'agent-run-schema',
    'strict-privacy-pipeline',
    'privacy-defaults',
    'copilot-cli-surface',
    'copilot-sdk-adapter',
    'mcp-observability-proxy',
    'github-outcomes',
    'evals-insights-recommendations',
    'grafana-v2-pack',
    'kql-library',
    'content-transcript-opt-in',
    'first-run-loop'
  ]) {
    assert.equal(byName[name].ok, true, name);
  }
  assert.match(output, /AgentOps product audit/);
  assert.match(output, /Live Azure verified: not in this audit/);
  assert.ok(result.next.some(command => command.includes('product audit --live')));
});

test('product audit can include live Azure and Grafana gates', () => {
  const result = productAudit({
    live: true,
    last: '2h',
    requireRows: true,
    dashboardVerify: args => ({
      ok: args.includes('--live') && args.includes('--require-rows') && args.includes('2h'),
      errors: [],
      summary: {
        kql_checks: 19,
        checked_links: 709
      }
    }),
    validateAzure: options => ({
      ok: options.last === '2h',
      checks: [
        { name: 'resource-group', ok: true },
        { name: 'grafana-dashboards', ok: true }
      ]
    })
  });

  assert.equal(result.ok, true, result.checks.filter(check => !check.ok).map(check => check.name).join(', '));
  assert.equal(result.scope, 'local-and-live-product-contract');
  assert.equal(result.live_azure_verified, true);
  assert.equal(result.live_grafana_verified, true);
  assert.equal(result.summary.live_kql_checks, 19);
  assert.equal(result.checks.some(check => check.name === 'live-grafana-dashboard-queries'), true);
  assert.equal(result.checks.some(check => check.name === 'live-azure-resources'), true);
});

test('product audit can require rendered Grafana visual proof', async () => {
  const result = await productAuditWithVisual({
    live: true,
    requireVisual: true,
    dashboardVerify: () => ({
      ok: true,
      errors: [],
      summary: { kql_checks: 19, checked_links: 709 }
    }),
    validateAzure: () => ({
      ok: true,
      checks: [{ name: 'grafana-dashboards', ok: true }]
    }),
    browserCheck: async () => ({
      ok: true,
      playwright: {
        grafana: [
          { label: 'AgentOps V2 Home', dashboardVisible: true },
          { label: 'V2 Runs Explorer', dashboardVisible: true },
          { label: 'V2 Run Replay', dashboardVisible: true }
        ]
      }
    })
  });

  assert.equal(result.ok, true, result.checks.filter(check => !check.ok).map(check => check.name).join(', '));
  assert.equal(result.scope, 'local-live-and-visual-product-contract');
  assert.equal(result.visual_grafana_verified, true);
  assert.equal(result.summary.visual_dashboards, 3);
  assert.equal(result.summary.visual_dashboards_visible, 3);
  assert.equal(result.checks.some(check => check.name === 'visual-grafana-rendered-dashboards'), true);
});

test('product visual audit returns auth remediation when Grafana is SSO-blocked', async () => {
  const result = await productAuditWithVisual({
    requireVisual: true,
    browserCheck: async () => ({
      ok: false,
      playwright: {
        authRemediation: {
          reason: 'Azure Managed Grafana redirected to Microsoft sign-in.',
          sign_in_once: ['sign-in-command'],
          verify_after_sign_in: ['rerun-command']
        },
        grafana: [
          { label: 'AgentOps V2 Home', authBlocked: true, dashboardVisible: false }
        ]
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.visual_grafana_verified, false);
  assert.equal(result.checks.find(check => check.name === 'visual-grafana-rendered-dashboards').ok, false);
  assert.ok(result.next.includes('sign-in-command'));
  assert.ok(result.next.includes('rerun-command'));
});

test('product visual audit explains how to regenerate a missing report', async () => {
  const result = await productAuditWithVisual({
    requireVisual: true,
    reportPath: '/tmp/missing-agentops-report.html',
    browserCheck: async () => {
      throw new Error('Report not found: /tmp/missing-agentops-report.html');
    }
  });
  const recovery = visualAuditRecoveryCommands('/tmp/missing-agentops-report.html');

  assert.equal(result.ok, false);
  assert.ok(result.next.includes(recovery[0]));
  assert.ok(result.next.includes(recovery[1]));
  assert.ok(result.next.includes(recovery[2]));
});

test('dashboard verify combines static UX and optional live KQL gates', () => {
  const offline = dashboardVerify();
  assert.equal(offline.ok, true, offline.errors.join('\n'));
  assert.equal(offline.live, false);
  assert.equal(offline.summary.kql_checks, 0);
  assert.ok(offline.next.some(command => command.includes('--live')));

  const live = dashboardVerify(['--live', '--last', '24h', '--workspace-id', 'workspace-123'], {
    runQuery: (_query, options) => ({ ok: options.workspaceId === 'workspace-123', rows: [{ ok: true }] })
  });
  assert.equal(live.ok, true, live.errors.join('\n'));
  assert.equal(live.live, true);
  assert.equal(live.summary.kql_checks, 19);
});

test('V2 dashboard links preserve drilldown contracts', () => {
  const result = validateDashboardLinks();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.dashboards, 10);
  assert.ok(result.checked_links >= 100);
  const replayDashboard = JSON.parse(fs.readFileSync(path.join(root, 'grafana', 'dashboards', 'v2', '03-run-replay.json'), 'utf8'));
  const runsDashboard = JSON.parse(fs.readFileSync(path.join(root, 'grafana', 'dashboards', 'v2', '02-runs-explorer.json'), 'utf8'));
  const homeDashboard = JSON.parse(fs.readFileSync(path.join(root, 'grafana', 'dashboards', 'v2', '01-agentops-home.json'), 'utf8'));
  const variables = homeDashboard.templating.list.map(item => item.name);
  for (const variable of ['datasource', 'workspace', 'timeRange', 'branch_hash', 'pattern_key']) {
    assert.ok(variables.includes(variable), `missing global variable: ${variable}`);
  }
  const homeTitles = homeDashboard.panels.map(panel => panel.title);
  for (const title of ['Policy blocks', 'Input tokens', 'Output tokens', 'p95 duration', 'Tests ran %', 'PRs opened']) {
    assert.ok(homeTitles.includes(title), `missing home stat: ${title}`);
  }
  assert.match(JSON.stringify(replayDashboard), /OpenTranscript/);
  assert.match(JSON.stringify(replayDashboard), /viewPanel=26/);
  assert.match(JSON.stringify(replayDashboard), /MessageText/);
  assert.match(JSON.stringify(replayDashboard), /ViewerNote/);
  assert.match(JSON.stringify(replayDashboard), /SafetyNote/);
  assert.match(JSON.stringify(replayDashboard), /Ask AgentOps context/);
  assert.match(JSON.stringify(replayDashboard), /TriageCommand/);
  assert.match(JSON.stringify(replayDashboard), /Do not request or enable prompt/);
  assert.match(JSON.stringify(replayDashboard), /project Status, SafetyNote, OpenTranscript, ContentRows/);
  assert.match(JSON.stringify(runsDashboard), /OpenReplay/);
  assert.match(JSON.stringify(runsDashboard), /OpenTrace/);
  assert.match(JSON.stringify(runsDashboard), /OpenGithub/);
  assert.match(JSON.stringify(runsDashboard), /PrNumberHash/);
  const insightsDashboard = JSON.parse(fs.readFileSync(path.join(root, 'grafana', 'dashboards', 'v2', '09-insights-regressions.json'), 'utf8'));
  assert.match(JSON.stringify(insightsDashboard), /OpenPattern/);
  assert.match(JSON.stringify(insightsDashboard), /Recommendation artifacts/);
  assert.match(JSON.stringify(insightsDashboard), /var-pattern_key/);
});

test('dashboard import plans V2 managed Grafana import safely by default', () => {
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
  assert.equal(plan.dashboards, 10);
  assert.match(plan.command, /AGENTOPS_V2_ONLY=true/);
  assert.ok(plan.files.every(file => file.includes(`${path.sep}dashboards${path.sep}v2${path.sep}`)));
});

test('dashboard import --yes invokes the import script with explicit env', () => {
  const calls = [];
  const result = runDashboardImport(['--yes', '--resource-group', 'rg-agentops-dev', '--grafana-name', 'graf-agentops-dev'], {
    env: {},
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'imported\n', stderr: '' };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.dry_run, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /grafana-import-dashboard\.sh$/);
  assert.equal(calls[0].options.env.AGENTOPS_V2_ONLY, 'true');
  assert.equal(calls[0].options.env.GRAFANA_FOLDER, 'AgentOps for Azure');
  assert.equal(calls[0].options.env.AZURE_RESOURCE_GROUP, 'rg-agentops-dev');
  assert.equal(calls[0].options.env.GRAFANA_NAME, 'graf-agentops-dev');
});

test('dashboard kql-check renders representative V2 panel queries', () => {
  const queries = [];
  const result = dashboardKqlCheck(['--last', '24h', '--workspace-id', 'workspace-123'], {
    runQuery: (query, options) => {
      queries.push({ query, options });
      return { ok: true, rows: [{ ok: true }] };
    }
  });

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.checks.length, 19);
  assert.ok(queries.every(item => item.options.workspaceId === 'workspace-123'));
  assert.ok(queries.every(item => item.query.includes('ago(24h)')));
  assert.ok(queries.every(item => !item.query.includes('$__timeFrom')));
  assert.ok(queries.some(item => item.query.includes('AppDependencies')));
  assert.ok(queries.some(item => item.query.includes('AgentOpsRunSummary_CL')));
  assert.ok(queries.some(item => item.query.includes('AgentOpsContent_CL')));
  assert.ok(queries.some(item => item.query.includes('OpenReplay')));
  assert.ok(queries.some(item => item.query.includes('OpenGithub')));
  assert.ok(queries.some(item => item.query.includes('OpenTranscript')));
  assert.ok(queries.some(item => item.query.includes('AskPrompt')));
  assert.ok(queries.some(item => item.query.includes('TriageCommand')));
  assert.ok(queries.some(item => item.query.includes('MessageText')));
  assert.ok(queries.some(item => item.query.includes('ViewerNote')));
  assert.ok(queries.some(item => item.query.includes('SuggestedNextStep')));
  assert.ok(queries.some(item => item.query.includes('PatternRuns')));
  assert.ok(queries.some(item => item.query.includes('PatternDimension')));
  assert.ok(queries.some(item => item.query.includes('AgentOpsRecommendations_CL')));
  assert.ok(queries.some(item => item.query.includes('RecommendationId')));
  assert.ok(queries.some(item => item.query.includes('BadOutcomeRuns')));
  assert.ok(queries.some(item => item.query.includes('RunOutcomeStatus')));
  assert.ok(queries.some(item => item.query.includes('TimeToPrMinutes')));
  assert.ok(queries.some(item => item.query.includes('TimeToMergeMinutes')));
  assert.ok(queries.some(item => item.query.includes("todouble(datetime_diff('minute'")));
  assert.ok(queries.some(item => item.query.includes('order by Priority asc') && item.query.indexOf('order by Priority asc') < item.query.indexOf('project TimeGenerated, Severity')));
  assert.ok(queries.some(item => item.query.includes('ContextWindowPct')));
  assert.ok(queries.some(item => item.query.includes('DelegationId')));
  assert.ok(queries.some(item => item.query.includes('McpServer')));
});

test('dashboard kql-check can require live rows', () => {
  const result = dashboardKqlCheck(['--require-rows'], {
    runQuery: () => ({ ok: true, rows: [] })
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 16);
  assert.match(result.errors[0], /query returned no rows/);
  assert.equal(result.checks.find(check => check.panel === 'Prompt and response viewer (explicit opt-in)').ok, true);
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

test('Grafana dashboard filters follow page-specific contracts', () => {
  const dashboards = Object.fromEntries(listGrafanaDashboardFiles().map(dashboard => {
    const body = JSON.parse(fs.readFileSync(path.join(root, dashboard.file), 'utf8'));
    const variables = (body.templating?.list || [])
      .filter(variable => variable.type !== 'constant')
      .map(variable => variable.name);
    return [dashboard.uid, variables];
  }));

  assert.deepEqual(dashboards['agentops-sessions'], [
    'model',
    'operation',
    'agent',
    'agentops_agent',
    'repo',
    'tool',
    'risk'
  ]);
  assert.deepEqual(dashboards['agentops-session-detail'], ['conversation']);
  assert.deepEqual(dashboards['agentops-live-replay'], [
    'conversation',
    'agentops_agent',
    'mcp_server',
    'tool'
  ]);
  assert.deepEqual(dashboards['agentops-traces-spans'], [
    'model',
    'operation',
    'agent',
    'agentops_agent',
    'repo',
    'tool'
  ]);
  assert.deepEqual(dashboards['agentops-tools-mcp'], [
    'mcp_server',
    'tool'
  ]);
  assert.deepEqual(dashboards['agentops-attribution'], ['risk']);
  assert.deepEqual(dashboards['agentops-experiments'], [
    'benchmark_suite',
    'benchmark_task',
    'benchmark_variant',
    'benchmark_run',
    'hypothesis'
  ]);
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

test('collector health query summarizes collector and real ingestion signals', () => {
  const query = collectorHealthQuery('12h');

  assert.match(query, /let lookback = 12h/);
  assert.match(query, /AgentOpsSpans/);
  assert.match(query, /agentops\.smoke_id/);
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

test('copilot-agentops help resolves real copilot without collector fallback', { skip: process.platform === 'win32' }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-copilot-fallback-'));
  const fakeCopilot = path.join(tempDir, 'copilot');
  try {
    fs.writeFileSync(fakeCopilot, '#!/usr/bin/env bash\nprintf "real copilot %s\\n" "$*"\n');
    fs.chmodSync(fakeCopilot, 0o755);

    const result = spawnSync(path.join(root, 'scripts', 'copilot-agentops'), ['--help'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}:/bin:/usr/bin`,
        COPILOT_CLI_BIN: fakeCopilot,
        AZURE_RESOURCE_GROUP: 'rg-agentops-definitely-missing',
        APPLICATIONINSIGHTS_NAME: 'appi-agentops-definitely-missing'
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /real copilot --help/);
    assert.doesNotMatch(result.stderr, /Launching Copilot without AgentOps telemetry/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('copilot-observe percent-encodes resource attributes and forces content capture off', { skip: process.platform === 'win32' }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-observe-env-'));
  const fakeCopilot = path.join(tempDir, 'copilot');
  try {
    fs.writeFileSync(fakeCopilot, '#!/usr/bin/env bash\nprintf "capture=%s\\nattrs=%s\\n" "$OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT" "$OTEL_RESOURCE_ATTRIBUTES"\n');
    fs.chmodSync(fakeCopilot, 0o755);
    const result = spawnSync(path.join(root, 'copilot', 'copilot-observe'), ['--version'], {
      cwd: root,
      env: {
        ...process.env,
        COPILOT_CLI_BIN: fakeCopilot,
        AGENTOPS_PROFILE: 'safe default,=x',
        AGENTOPS_E2E_ID: 'agentops e2e,=id',
        AGENTOPS_CAPTURE_CONTENT: 'true',
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true'
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /capture=false/);
    assert.match(result.stdout, /agentops\.profile=safe%20default%2C%3Dx/);
    assert.match(result.stdout, /agentops\.e2e\.id=agentops%20e2e%2C%3Did/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pre-tool policy emits valid deny decisions for camelCase and snake_case inputs', () => {
  const hook = path.join(root, 'plugin', 'scripts', 'pre-tool-policy.js');
  for (const payload of [
    { toolName: 'shell', toolArgs: { command: 'az keyvault secret show --vault-name x --name y' } },
    { tool_name: 'shell', tool_input: { command: 'cat .env' } }
  ]) {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(payload),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.permissionDecision, 'deny');
    assert.match(decision.permissionDecisionReason, /demo preToolUse guardrail/);
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

test('E2E report browser check detects pass status, evidence links, and secret leaks', () => {
  const html = renderReportHtml({
    ok: true,
    privacyMode: 'strict',
    e2eId: 'agentops-e2e-test',
    latestSessionId: 'session-test',
    collector: { effectiveMode: 'binary' },
    poison: { ok: true },
    grafanaLinks: [{ label: 'Overview', url: 'https://grafana.example.grafana.azure.com/d/overview' }],
    evidenceFiles: ['/tmp/summary.json']
  });
  const clean = checkReportHtml(html);
  assert.equal(clean.ok, true);
  assert.equal(clean.passVisible, true);
  assert.equal(clean.grafanaLinks, 1);
  assert.equal(clean.evidenceLinks, 1);

  const leaked = checkReportHtml(html.replace('</main>', '<p>SECRET_SHOULD_NOT_LEAVE</p></main>'));
  assert.equal(leaked.ok, false);
  assert.equal(leaked.secretLooking, true);
});

test('E2E live commands force strict privacy and content capture off', () => {
  const env = safeE2eEnv({ AGENTOPS_E2E_ID: 'agentops-e2e-test' });

  assert.equal(env.AGENTOPS_PRIVACY_MODE, 'strict');
  assert.equal(env.AGENTOPS_CAPTURE_CONTENT, 'false');
  assert.equal(env.AGENTOPS_DISABLE_CONTENT_CAPTURE_OVERRIDE, '1');
  assert.equal(env.COPILOT_OTEL_CAPTURE_CONTENT, 'false');
  assert.equal(env.AGENTOPS_E2E_ID, 'agentops-e2e-test');
});

test('E2E Grafana screenshot targets use stable V2 tour names', () => {
  const targets = grafanaScreenshotTargets([
    { label: 'AgentOps V2 Home', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-home' },
    { label: 'V2 Runs Explorer', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-runs-explorer' },
    { label: 'V2 Run Replay', url: 'https://grafana.example.grafana.azure.com/d/agentops-v2-run-replay' },
    { label: 'Overview', url: 'https://grafana.example.grafana.azure.com/d/overview' }
  ], { v2Only: true });

  assert.deepEqual(targets.map(target => target.fileName), [
    'agentops-v2-home-live.png',
    'agentops-v2-runs-explorer-live.png',
    'agentops-v2-run-replay-live.png'
  ]);
  assert.ok(targets.every(target => target.v2Tour));
});

test('E2E Grafana visual gate distinguishes auth-blocked from visible dashboards', () => {
  const authBlocked = [
    { label: 'AgentOps V2 Home', authBlocked: true, dashboardVisible: false },
    { label: 'V2 Runs Explorer', authBlocked: true, dashboardVisible: false }
  ];
  const visible = [
    { label: 'AgentOps V2 Home', authBlocked: false, dashboardVisible: true },
    { label: 'V2 Runs Explorer', authBlocked: false, dashboardVisible: true }
  ];

  assert.equal(grafanaVisualOk(authBlocked, false), true);
  assert.equal(grafanaVisualOk(authBlocked, true), false);
  assert.equal(grafanaVisualOk(visible, true), true);
});

test('E2E browser profile args support authenticated Grafana visual QA', () => {
  const options = browserProfileOptionsFromArgs([
    '--browser-executable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '--browser-user-data-dir',
    '/tmp/agentops-grafana-profile',
    '--storage-state',
    '/tmp/storage-state.json',
    '--headed'
  ], {});

  assert.equal(options.browserExecutable, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(options.browserUserDataDir, '/tmp/agentops-grafana-profile');
  assert.equal(options.storageState, '/tmp/storage-state.json');
  assert.equal(options.headed, true);
});

test('E2E auth remediation prints sign-in and strict visual commands', () => {
  const remediation = grafanaAuthRemediation({
    reportPath: '.agentops/e2e/latest/report.html',
    browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    browserUserDataDir: '$HOME/.agentops/browser/grafana-profile',
    grafanaUrl: 'https://grafana.example.grafana.azure.com/d/agentops-v2-home'
  });

  assert.match(remediation.reason, /Microsoft sign-in/);
  assert.ok(remediation.sign_in_once.some(command => command.includes('--user-data-dir="$HOME/.agentops/browser/grafana-profile"')));
  assert.ok(remediation.sign_in_once.some(command => command.includes('/d/agentops-v2-home')));
  assert.ok(remediation.verify_after_sign_in.some(command => command.includes('--require-grafana-visible')));
  assert.ok(remediation.verify_after_sign_in.some(command => command.includes('--browser-user-data-dir "$HOME/.agentops/browser/grafana-profile"')));
});

test('E2E auth-profile command renders reusable Grafana sign-in profile steps', () => {
  const result = e2eAuthProfile([
    '--report',
    '.agentops/e2e/latest/report.html',
    '--browser-executable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '--browser-user-data-dir',
    '/tmp/agentops-grafana-profile',
    '--url',
    'https://grafana.example.grafana.azure.com/d/agentops-v2-home'
  ]);
  const text = renderAuthProfile(result);

  assert.equal(result.ok, true);
  assert.equal(result.browserProfile.browserUserDataDir, '/tmp/agentops-grafana-profile');
  assert.ok(result.remediation.sign_in_once.some(command => command.includes('--user-data-dir="/tmp/agentops-grafana-profile"')));
  assert.match(text, /Sign in once/);
  assert.match(text, /Verify after sign-in/);
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
  assert.match(plan.runs[0].copiedFixturePath.from.replaceAll(path.sep, '/'), /benchmarks\/starter\/fixtures\/tiny-repo$/);
  assert.match(plan.runs[0].copiedFixturePath.to.replaceAll(path.sep, '/'), /agentops-benchmark-runs\/bench-test\/create-note\/repeat-1\/workspace$/);
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
    assert.deepEqual(result.summaries[0].changedFiles.map(file => file.replaceAll(path.sep, '/')), ['notes/hello.txt']);
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
  assert.match(output, /AgentOps V2 Home:/);
  assert.match(output, /agentops-v2-home/);
  assert.match(output, /V2 Run Replay:/);
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
  assert.match(install.command, /install-agentops\.sh$/);
  assert.deepEqual(install.args, []);

  const installNoShadow = commandPlan('install', ['--no-shadow-copilot', '--no-collector'], 'darwin');
  assert.deepEqual(installNoShadow.args, ['--no-shadow-copilot', '--no-collector']);

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
  assert.match(install.args.at(-2), /install-agentops\.ps1$/);

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

test('PowerShell shim does not auto-install plugin files and uninstall advice is collector-native', () => {
  const installScript = fs.readFileSync(path.join(root, 'scripts', 'install-copilot-agentops-shim.ps1'), 'utf8');
  const uninstallScript = fs.readFileSync(path.join(root, 'scripts', 'uninstall-copilot-agentops-shim.ps1'), 'utf8');

  assert.doesNotMatch(installScript, /src\/index\.js"\) plugin install/);
  assert.match(installScript, /agentops plugin install/);
  assert.match(uninstallScript, /agentops collector stop --mode auto/);
  assert.doesNotMatch(uninstallScript, /docker compose/);
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
