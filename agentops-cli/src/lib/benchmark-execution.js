const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeJsonFile } = require('./command-output');
const { hashText } = require('./hash');
const {
  benchmarkForbiddenMatches,
  changedRelativeFiles,
  normalizeBenchmarkRelativePath,
  relativeFileDiff,
  relativeFileSnapshot: relativeFileSnapshotBase,
  safeBenchmarkPath
} = require('./benchmark-paths');
const {
  benchmarkCopilotInvocation,
  benchmarkSandboxProfile,
  mergeResourceAttributes
} = require('./benchmark-invocation');
const { numberValue, roundNumber } = require('./benchmark-scoring');

const benchmarkSemanticAdapters = new Set(['file-contains', 'file-regex', 'file-rubric', 'llm-judge']);

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, predicate, results);
    if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function makeBenchmarkRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `bench-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function benchmarkRunPlan(suiteId, options = {}) {
  const variant = options.variant;
  const repeat = options.repeat || 1;
  const dryRun = Boolean(options.dryRun);
  const hypothesis = options.hypothesis || null;
  const loadBenchmarkSuites = options.loadBenchmarkSuites || (() => []);
  const benchmarkRunBaseDir = options.benchmarkRunBaseDir || path.join(os.tmpdir(), 'agentops-benchmark-runs');

  if (!variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error('--repeat must be a positive integer');

  const suite = loadBenchmarkSuites(options.benchmarksDir).find(item => item.id === suiteId);
  if (!suite) throw new Error(`Unknown benchmark suite: ${suiteId}`);

  const runId = options.runId || makeBenchmarkRunId(options.now);
  const runs = [];

  for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex += 1) {
    for (const task of suite.tasks) {
      const runRoot = path.join(benchmarkRunBaseDir, runId, task.id, `repeat-${repeatIndex}`);
      runs.push({
        taskId: task.id,
        taskTitle: task.title,
        repeat: repeatIndex,
        copiedFixturePath: {
          from: task.fixturePath,
          to: path.join(runRoot, 'workspace')
        },
        copilotHome: path.join(runRoot, 'copilot-home'),
        environment: {
          COPILOT_HOME: path.join(runRoot, 'copilot-home')
        },
        copilot: {
          command: 'copilot',
          args: task.copilotArgs,
          prompt: task.prompt
        },
        otelLabels: {
          'agentops.benchmark.run_id': runId,
          'agentops.benchmark.suite': suite.id,
          'agentops.benchmark.task_id': task.id,
          'agentops.benchmark.variant': variant,
          'agentops.benchmark.permission_profile': task.permissionProfile,
          'agentops.benchmark.repeat': String(repeatIndex),
          ...(task.toolPolicy?.blockedRisks?.length
            ? { 'agentops.benchmark.tool_policy.blocked_risks': task.toolPolicy.blockedRisks.join('|') }
            : {}),
          ...(hypothesis ? { 'agentops.hypothesis.id': hypothesis } : {})
        },
        osSandbox: task.osSandbox,
        promotionGates: suite.promotionGates,
        toolPolicyEnforcement: task.toolPolicyEnforcement,
        successChecks: {
          commands: task.successCommands,
          fixtureSeal: task.fixtureSeal ? {
            algorithm: task.fixtureSeal.algorithm,
            fileCount: Object.keys(task.fixtureSeal.files).length,
            files: Object.keys(task.fixtureSeal.files).sort()
          } : null,
          fixtureSealPack: task.fixtureSealPack ? {
            id: task.fixtureSealPack.id,
            title: task.fixtureSealPack.title,
            algorithm: task.fixtureSealPack.algorithm,
            fixture: task.fixtureSealPack.fixture,
            fileCount: Object.keys(task.fixtureSealPack.files).length,
            ...(task.fixtureSealPack.signature ? { signature: task.fixtureSealPack.signature } : {}),
            source: task.fixtureSealPack.source
          } : null,
          commandFileSeal: task.commandFileSeal ? {
            algorithm: task.commandFileSeal.algorithm,
            fileCount: Object.keys(task.commandFileSeal.files).length,
            files: Object.keys(task.commandFileSeal.files).sort()
          } : null,
          ...(options.includeHiddenChecks ? { commandFileSealDefinition: task.commandFileSeal } : {}),
          hiddenCommandCount: task.hiddenSuccessCommands.length + task.hiddenPackCommands.length,
          hiddenCheckPacks: task.hiddenCheckPacks.map(pack => ({
            id: pack.id,
            title: pack.title,
            commandCount: pack.commands.length,
            source: pack.source
          })),
          ...(options.includeHiddenChecks ? { hiddenCommands: [...task.hiddenSuccessCommands, ...task.hiddenPackCommands] } : {}),
          semanticCheckCount: task.semanticChecks.length,
          semanticChecks: task.semanticChecks.map(check => ({
            id: check.id,
            adapter: check.adapter,
            file: check.file
          })),
          ...(options.includeHiddenChecks ? { semanticCheckDefinitions: task.semanticChecks } : {}),
          expectedFiles: task.expectedFiles,
          forbiddenFiles: task.forbiddenFiles
        },
        permissionProfile: task.permissionProfile,
        toolPolicy: task.toolPolicy,
        timeoutSec: task.timeoutSec
      });
    }
  }

  return {
    runId,
    suite: suite.id,
    variant,
    hypothesis,
    repeat,
    dryRun,
    wouldMutateRepo: !dryRun,
    wouldExecuteCopilot: !dryRun,
    runs
  };
}

function relativeFileSnapshot(dir) {
  return relativeFileSnapshotBase(dir, { walk, hashText });
}

function commandSucceeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function commandFailureMessage(result) {
  if (!result) return 'command did not run';
  if (result.error) return result.error.message;
  if (result.signal) return `terminated by ${result.signal}`;
  return `exited with status ${result.status}`;
}

function runShellCheck(command, cwd, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  return spawnSync(shell, args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs || 10000,
    maxBuffer: 1024 * 1024
  });
}

function outputText(value) {
  if (value === undefined || value === null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function benchmarkPermissionPolicyChecks(run, changedFiles) {
  if (run.permissionProfile !== 'read-only') return [];

  return [{
    name: 'permission policy: read-only workspace unchanged',
    ok: changedFiles.length === 0,
    detail: changedFiles.length === 0 ? null : `${changedFiles.length} workspace file(s) changed`
  }];
}

function benchmarkCommandFileSealChecks(seal, afterSnapshot) {
  if (!seal) return [];

  return Object.entries(seal.files).map(([file, expectedHash]) => {
    const normalized = normalizeBenchmarkRelativePath(file);
    const actualHash = afterSnapshot.get(normalized);
    const ok = actualHash === expectedHash;
    return {
      name: `command file seal unchanged: ${normalized}`,
      ok,
      detail: ok ? null : (actualHash === undefined ? 'sealed command file missing' : 'sealed command file changed')
    };
  });
}

function parseBenchmarkLlmJudgeResult(check, result) {
  if (!commandSucceeded(result)) {
    return {
      id: check.id,
      adapter: check.adapter,
      file: check.file,
      ok: false,
      score: 0,
      detail: commandFailureMessage(result)
    };
  }

  let verdict;
  try {
    verdict = JSON.parse(outputText(result.stdout));
  } catch {
    return {
      id: check.id,
      adapter: check.adapter,
      file: check.file,
      ok: false,
      score: 0,
      detail: 'judge output must be JSON'
    };
  }

  const score = Number(verdict.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return {
      id: check.id,
      adapter: check.adapter,
      file: check.file,
      ok: false,
      score: 0,
      detail: 'judge score must be between 0 and 100'
    };
  }

  const normalizedScore = roundNumber(score);
  const ok = normalizedScore >= numberValue(check.minScore);
  return {
    id: check.id,
    adapter: check.adapter,
    file: check.file,
    ok,
    score: normalizedScore,
    detail: ok ? null : (typeof verdict.detail === 'string' && verdict.detail.trim() !== '' ? verdict.detail : `judge score below ${check.minScore}`)
  };
}

function runBenchmarkSemanticChecks(checks = [], workspace, options = {}) {
  return checks.map(check => {
    if (!benchmarkSemanticAdapters.has(check.adapter)) {
      return {
        id: check.id,
        adapter: check.adapter,
        ok: false,
        score: 0,
        detail: 'unsupported semantic adapter'
      };
    }

    if (check.adapter === 'llm-judge') {
      return parseBenchmarkLlmJudgeResult(check, runShellCheck(check.command, workspace, {
        spawnSync: options.spawnSync,
        timeoutMs: options.judgeTimeoutMs || 30000
      }));
    }

    const filePath = safeBenchmarkPath(workspace, check.file);
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    const text = exists ? fs.readFileSync(filePath, 'utf8') : '';
    if (check.adapter === 'file-rubric') {
      const criteria = check.criteria || [];
      const criteriaResults = criteria.map(criterion => {
        const ok = criterion.pattern !== undefined
          ? exists && new RegExp(criterion.pattern, 'm').test(text)
          : exists && text.includes(criterion.contains);
        return {
          id: criterion.id,
          ok
        };
      });
      const passed = criteriaResults.filter(criterion => criterion.ok).length;
      const score = criteria.length > 0 ? roundNumber((passed / criteria.length) * 100) : 0;
      const ok = score >= numberValue(check.minScore);
      return {
        id: check.id,
        adapter: check.adapter,
        file: check.file,
        ok,
        score,
        detail: ok ? null : `rubric criteria passed: ${passed}/${criteria.length}`,
        criteria: criteriaResults
      };
    }
    const ok = check.adapter === 'file-regex'
      ? exists && new RegExp(check.pattern, 'm').test(text)
      : exists && text.includes(check.contains);
    return {
      id: check.id,
      adapter: check.adapter,
      file: check.file,
      ok,
      score: ok ? 100 : 0,
      detail: ok ? null : 'semantic expectation not met'
    };
  });
}

function benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged, policyBlocks = 0) {
  if (copilotResult?.error?.code === 'ETIMEDOUT' || copilotResult?.signal) return 'timeout';
  if (!commandSucceeded(copilotResult)) return 'copilot_failed';
  if (forbiddenFilesChanged > 0 || policyBlocks > 0) return 'safety_violation';
  if (checkResults.some(check => !check.ok)) return 'assertion_failure';
  return null;
}

function executeBenchmarkRun(plan, run, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const runRoot = path.dirname(run.copiedFixturePath.to);
  const workspace = run.copiedFixturePath.to;

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });
  fs.cpSync(run.copiedFixturePath.from, workspace, { recursive: true });
  fs.mkdirSync(run.copilotHome, { recursive: true });

  const beforeSnapshot = relativeFileSnapshot(workspace);
  const preRunPolicyViolations = run.toolPolicyEnforcement?.blockedAllowedTools || [];
  const invocation = benchmarkCopilotInvocation(run, workspace, options);
  if (preRunPolicyViolations.length > 0 || invocation.sandbox.error) {
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(runRoot, 'stdout.txt'), '');
    fs.writeFileSync(path.join(runRoot, 'stderr.txt'), '');
    const checkResults = [
      ...preRunPolicyViolations.map(tool => ({
        name: `tool policy: blocked allowed tool ${tool.name}`,
        ok: false,
        detail: `risk ${tool.risk} is blocked before Copilot execution`
      })),
      ...(invocation.sandbox.error ? [{
        name: `os sandbox: ${invocation.sandbox.mode}`,
        ok: false,
        detail: invocation.sandbox.error
      }] : [])
    ];
    return {
      runId: plan.runId,
      suite: plan.suite,
      variant: plan.variant,
      hypothesis: plan.hypothesis,
      taskId: run.taskId,
      taskTitle: run.taskTitle,
      permissionProfile: run.permissionProfile,
      osSandbox: run.osSandbox || { mode: 'none', enforced: false },
      osSandboxRuntime: invocation.sandbox,
      toolPolicy: run.toolPolicy || null,
      toolPolicyEnforcement: run.toolPolicyEnforcement || null,
      promotionGates: run.promotionGates || null,
      repeat: run.repeat,
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      success: false,
      checksPassed: 0,
      checksFailed: checkResults.length,
      fixtureSealPack: run.successChecks.fixtureSealPack || null,
      commandFileSeal: run.successChecks.commandFileSeal || null,
      hiddenCheckPacks: run.successChecks.hiddenCheckPacks || [],
      hiddenChecksPassed: 0,
      hiddenChecksFailed: 0,
      semanticScore: null,
      semanticChecks: [],
      filesChanged: 0,
      changedFiles: [],
      artifactDiff: { added: [], modified: [], deleted: [], totalChanged: 0 },
      forbiddenFilesChanged: 0,
      forbiddenFilesPresent: [],
      toolFailures: 0,
      policyBlocks: checkResults.length,
      contentCaptureDetected: process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true',
      inputTokens: 0,
      outputTokens: 0,
      aiu: 0,
      cost: 0,
      errorCategory: invocation.sandbox.error ? 'sandbox_unavailable' : 'policy_violation',
      checks: checkResults,
      workspace,
      stdoutPath: path.join(runRoot, 'stdout.txt'),
      stderrPath: path.join(runRoot, 'stderr.txt')
    };
  }

  const env = {
    ...process.env,
    ...run.environment,
    AGENTOPS_BENCHMARK_RUN_ID: plan.runId,
    AGENTOPS_BENCHMARK_SUITE: plan.suite,
    AGENTOPS_BENCHMARK_TASK_ID: run.taskId,
    AGENTOPS_BENCHMARK_VARIANT: plan.variant,
    AGENTOPS_BENCHMARK_REPEAT: String(run.repeat),
    ...(plan.hypothesis ? { AGENTOPS_HYPOTHESIS_ID: plan.hypothesis } : {})
  };
  env.OTEL_RESOURCE_ATTRIBUTES = mergeResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES, run.otelLabels);

  const startedAt = new Date();
  const copilotResult = spawnSync(invocation.command, invocation.args, {
    cwd: workspace,
    env,
    encoding: 'utf8',
    timeout: run.timeoutSec * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  const endedAt = new Date();

  fs.writeFileSync(path.join(runRoot, 'stdout.txt'), outputText(copilotResult?.stdout));
  fs.writeFileSync(path.join(runRoot, 'stderr.txt'), outputText(copilotResult?.stderr));

  const checkResults = [{
    name: 'copilot exited 0',
    ok: commandSucceeded(copilotResult),
    detail: commandSucceeded(copilotResult) ? null : commandFailureMessage(copilotResult)
  }];

  for (const command of run.successChecks.commands) {
    const result = runShellCheck(command, workspace, { spawnSync });
    checkResults.push({
      name: `command: ${command}`,
      ok: commandSucceeded(result),
      detail: commandSucceeded(result) ? null : commandFailureMessage(result)
    });
  }

  for (const [index, command] of (run.successChecks.hiddenCommands || []).entries()) {
    const result = runShellCheck(command, workspace, { spawnSync });
    checkResults.push({
      name: `hidden command #${index + 1}`,
      hidden: true,
      ok: commandSucceeded(result),
      detail: commandSucceeded(result) ? null : 'hidden check failed'
    });
  }

  for (const file of run.successChecks.expectedFiles) {
    checkResults.push({
      name: `expected file: ${file}`,
      ok: fs.existsSync(safeBenchmarkPath(workspace, file)),
      detail: null
    });
  }

  const semanticResults = runBenchmarkSemanticChecks(run.successChecks.semanticCheckDefinitions || [], workspace, { spawnSync });
  for (const result of semanticResults) {
    checkResults.push({
      name: `semantic: ${result.id}`,
      ok: result.ok,
      detail: result.detail
    });
  }

  const afterSnapshot = relativeFileSnapshot(workspace);
  const changedFiles = changedRelativeFiles(beforeSnapshot, afterSnapshot);
  const artifactDiff = relativeFileDiff(beforeSnapshot, afterSnapshot);
  const forbiddenFilesPresent = benchmarkForbiddenMatches(run.successChecks.forbiddenFiles, afterSnapshot.keys());
  const forbiddenFilesChanged = benchmarkForbiddenMatches(run.successChecks.forbiddenFiles, changedFiles).length;

  for (const file of run.successChecks.forbiddenFiles) {
    const matches = benchmarkForbiddenMatches([file], afterSnapshot.keys());
    checkResults.push({
      name: `forbidden file absent: ${file}`,
      ok: matches.length === 0,
      detail: matches.length === 0 ? null : `matched: ${matches.join(', ')}`
    });
  }

  checkResults.push(...benchmarkCommandFileSealChecks(run.successChecks.commandFileSealDefinition, afterSnapshot));
  checkResults.push(...benchmarkPermissionPolicyChecks(run, changedFiles));
  const policyBlocks = checkResults.filter(check => check.name.startsWith('permission policy:') && !check.ok).length;
  const checksPassed = checkResults.filter(check => check.ok).length;
  const checksFailed = checkResults.length - checksPassed;
  const hiddenChecksPassed = checkResults.filter(check => check.hidden && check.ok).length;
  const hiddenChecksFailed = checkResults.filter(check => check.hidden && !check.ok).length;
  const semanticScore = semanticResults.length > 0
    ? roundNumber(semanticResults.reduce((total, result) => total + numberValue(result.score), 0) / semanticResults.length)
    : null;
  const errorCategory = benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged, policyBlocks);

  return {
    runId: plan.runId,
    suite: plan.suite,
    variant: plan.variant,
    hypothesis: plan.hypothesis,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    permissionProfile: run.permissionProfile,
    osSandbox: run.osSandbox || { mode: 'none', enforced: false },
    osSandboxRuntime: invocation.sandbox,
    toolPolicy: run.toolPolicy || null,
    toolPolicyEnforcement: run.toolPolicyEnforcement || null,
    promotionGates: run.promotionGates || null,
    repeat: run.repeat,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    success: checksFailed === 0 && forbiddenFilesChanged === 0,
    checksPassed,
    checksFailed,
    fixtureSealPack: run.successChecks.fixtureSealPack || null,
    commandFileSeal: run.successChecks.commandFileSeal || null,
    hiddenCheckPacks: run.successChecks.hiddenCheckPacks || [],
    hiddenChecksPassed,
    hiddenChecksFailed,
    semanticScore,
    semanticChecks: semanticResults,
    filesChanged: changedFiles.length,
    changedFiles,
    artifactDiff,
    forbiddenFilesChanged,
    forbiddenFilesPresent,
    toolFailures: 0,
    policyBlocks,
    contentCaptureDetected: process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true',
    inputTokens: 0,
    outputTokens: 0,
    aiu: 0,
    cost: 0,
    errorCategory,
    checks: checkResults,
    workspace,
    stdoutPath: path.join(runRoot, 'stdout.txt'),
    stderrPath: path.join(runRoot, 'stderr.txt')
  };
}

function runBenchmarkSuite(suiteId, options = {}) {
  const plan = benchmarkRunPlan(suiteId, { ...options, includeHiddenChecks: !options.dryRun });
  if (plan.dryRun) return plan;

  const summaries = plan.runs.map(run => executeBenchmarkRun(plan, run, options));
  const defaultBenchmarkSummaryDir = options.defaultBenchmarkSummaryDir || (() => {
    throw new Error('defaultBenchmarkSummaryDir is required');
  });
  const benchmarkReport = options.benchmarkReport || (() => {
    throw new Error('benchmarkReport is required');
  });
  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir();
  const summariesPath = path.join(summariesDir, `${plan.runId}.json`);
  writeJsonFile(summariesPath, summaries);

  return {
    ...plan,
    summariesPath,
    summaries,
    report: benchmarkReport(plan.runId, summaries)
  };
}

module.exports = {
  benchmarkCommandFileSealChecks,
  benchmarkCopilotInvocation,
  benchmarkErrorCategory,
  benchmarkPermissionPolicyChecks,
  benchmarkRunPlan,
  benchmarkSandboxProfile,
  commandFailureMessage,
  commandSucceeded,
  executeBenchmarkRun,
  makeBenchmarkRunId,
  mergeResourceAttributes,
  parseBenchmarkLlmJudgeResult,
  runBenchmarkSemanticChecks,
  runBenchmarkSuite,
  runShellCheck
};
