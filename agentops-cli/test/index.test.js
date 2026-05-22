const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  agentopsStatusSummary,
  benchmarkAzureTelemetryQuery,
  benchmarkReport,
  benchmarkRunBaseDir,
  benchmarkRunPlan,
  buildLink,
  commandPlan,
  compareBenchmarkRuns,
  contextPressureQuery,
  doctor,
  explainLatest,
  fieldCatalogQuery,
  importJsonl,
  installedShimStatus,
  kqlFileQuery,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  listBenchmarks,
  loadBenchmarkSummaries,
  openLinksSummary,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  parseFrontmatter,
  renderExplanation,
  renderLatest,
  renderOpenLinks,
  renderStatus,
  runBenchmarkSuite,
  scan,
  tokenRollupAuditQuery,
  validateKqlDuration,
  validateBenchmarkTask
} = require('../src/index.js');

const root = path.resolve(__dirname, '..', '..');
const benchmarkSummariesDir = path.join(__dirname, 'fixtures', 'benchmark-runs');

test('scan finds plugin agents and skills', () => {
  const result = scan();
  assert.ok(result.agents.length >= 5);
  assert.ok(result.skills.length >= 4);
  assert.ok(result.mcp_servers.includes('azure-mcp'));
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
    dryRun: true,
    runId: 'bench-test'
  });

  assert.equal(plan.runId, 'bench-test');
  assert.equal(plan.wouldMutateRepo, false);
  assert.equal(plan.wouldExecuteCopilot, false);
  assert.equal(plan.runs.length, 2);
  assert.match(plan.runs[0].copiedFixturePath.from, /benchmarks\/starter\/fixtures\/tiny-repo$/);
  assert.match(plan.runs[0].copiedFixturePath.to, /agentops-benchmark-runs\/bench-test\/create-note\/repeat-1\/workspace$/);
  assert.deepEqual(plan.runs[0].copilot.args, ['--allow-all']);
  assert.match(plan.runs[0].copilot.prompt, /notes\/hello\.txt/);
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.variant'], 'baseline');
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.task_id'], 'create-note');
  assert.equal(plan.runs[0].otelLabels['agentops.benchmark.task'], undefined);
  assert.deepEqual(plan.runs[0].successChecks.expectedFiles, ['notes/hello.txt']);
  assert.deepEqual(plan.runs[0].successChecks.forbiddenFiles, ['.env', 'secrets.txt']);
  assert.equal(plan.runs[0].timeoutSec, 30);
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
  assert.match(result.query, /conversation == "abc-123"/);
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
  assert.equal(summary.mode, 'azure');
  assert.equal(summary.session.id, 'live-conv');
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

test('open prints main Grafana and latest fixture session links', () => {
  const summary = latestSessionSummary({ filePath: path.join(root, 'tests', 'sample-otel', 'simple-success.jsonl') });
  const output = renderOpenLinks(openLinksSummary(summary));

  assert.match(output, /Main dashboard:/);
  assert.match(output, /copilot-cli-agentops/);
  assert.match(output, /Latest session:/);
  assert.match(output, /var-conversation=conv-success/);
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
});

test('windows command plan prefers PowerShell Core wrappers', () => {
  const enable = commandPlan('enable-shadow', [], 'win32');
  assert.equal(enable.command, 'pwsh');
  assert.ok(enable.args.includes('-ShadowCopilot'));
  assert.match(enable.args.at(-2), /install-copilot-agentops-shim\.ps1$/);

  const disable = commandPlan('disable-shadow', [], 'win32');
  assert.equal(disable.command, 'pwsh');
  assert.ok(disable.args.includes('-KeepAgentopsCommand'));
  assert.match(disable.args.at(-2), /uninstall-copilot-agentops-shim\.ps1$/);
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
});
