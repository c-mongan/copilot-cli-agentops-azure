const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agentops-${name}-${process.pid}-`));
}

function freshRequire(relativePath) {
  const absolutePath = path.join(repoRoot, 'agentops-cli', relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

function patch(object, property, value) {
  const original = object[property];
  object[property] = value;
  return () => {
    object[property] = original;
  };
}

async function captureOutput(fn) {
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  let output = '';
  process.exitCode = 0;
  process.stdout.write = chunk => {
    output += String(chunk);
    return true;
  };
  try {
    await fn();
    return { output, exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

test('schemaCommand prints the schema and validates a file without exporting content', async () => {
  const { schemaCommand } = freshRequire('src/commands/schema.js');
  const dir = tmpDir('schema');
  const invalidRun = path.join(dir, 'invalid-run.json');
  fs.writeFileSync(invalidRun, JSON.stringify({
    attributes: {
      'agentops.run.id': 'run_test',
      'gen_ai.input.messages': 'private prompt'
    }
  }));

  const printed = await captureOutput(() => schemaCommand(['print']));
  assert.equal(printed.exitCode, 0);
  const schema = JSON.parse(printed.output);
  assert.equal(schema.version, '2');
  assert.ok(schema.required_agentops_attributes.includes('agentops.run.id'));

  const validated = await captureOutput(() => schemaCommand(['validate', '--file', invalidRun]));
  const result = JSON.parse(validated.output);
  assert.equal(validated.exitCode, 1);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /strict privacy mode must not export content attribute/);
});

test('statusCommand renders mocked collector, copilot, and local status as JSON', async () => {
  const legacy = require('../src/legacy');
  const collector = require('../src/lib/collector-manager');
  const resolver = require('../src/lib/copilot-resolver');
  const restore = [
    patch(legacy, 'doctor', () => [{ name: 'content-capture-disabled', ok: true }]),
    patch(legacy, 'agentopsStatusSummary', () => ({
      ok: true,
      required_files: { found: 3, total: 3 },
      shim: { agentops_cli: 'ok', agentops_command: 'ok', shadow: 'safe' }
    })),
    patch(collector, 'status', async () => ({
      running: true,
      mode: 'auto',
      effectiveMode: 'binary',
      privacyMode: 'strict',
      safeLocalhostBinding: true
    })),
    patch(resolver, 'resolveCopilotBinary', () => ({
      ok: true,
      path: '/usr/local/bin/copilot',
      source: 'PATH',
      error: null,
      candidates: []
    }))
  ];

  try {
    const { statusCommand, renderStatus } = freshRequire('src/commands/status.js');
    const captured = await captureOutput(() => statusCommand(['--json']));
    const summary = JSON.parse(captured.output);
    assert.equal(captured.exitCode, 0);
    assert.equal(summary.content_capture_off, true);
    assert.equal(summary.collector.running, true);
    assert.equal(summary.copilot.path, '/usr/local/bin/copilot');
    assert.match(renderStatus(summary), /Collector: running \(binary, strict\)\./);
  } finally {
    restore.reverse().forEach(fn => fn());
  }
});

test('doctorSummary flags stored connection strings and renderDoctor reports blocking issues', async () => {
  const dir = tmpDir('doctor');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, 'APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=fake');

  const legacy = require('../src/legacy');
  const collector = require('../src/lib/collector-manager');
  const resolver = require('../src/lib/copilot-resolver');
  const originalConfigPath = process.env.AGENTOPS_CONFIG_PATH;
  process.env.AGENTOPS_CONFIG_PATH = configPath;
  const restore = [
    patch(legacy, 'doctor', () => [{ name: 'base-check', ok: true }]),
    patch(collector, 'status', async () => ({
      running: true,
      mode: 'auto',
      effectiveMode: 'binary',
      details: ['binary selected'],
      safeLocalhostBinding: true,
      health: { statusCode: 200 },
      binary: { ok: true, error: null }
    })),
    patch(resolver, 'resolveCopilotBinary', () => ({ ok: true, path: '/bin/copilot', error: null }))
  ];

  try {
    const { doctorSummary, renderDoctor } = freshRequire('src/commands/doctor.js');
    const summary = await doctorSummary({ localOnly: true });
    assert.equal(summary.ok, false);
    assert.equal(summary.checks.find(item => item.name === 'connection-string-not-on-disk').ok, false);
    assert.match(renderDoctor(summary), /connection-string-not-on-disk: failed/);
    assert.match(renderDoctor(summary), /Doctor found blocking issues/);
  } finally {
    restore.reverse().forEach(fn => fn());
    if (originalConfigPath === undefined) delete process.env.AGENTOPS_CONFIG_PATH;
    else process.env.AGENTOPS_CONFIG_PATH = originalConfigPath;
  }
});

test('runSummaryCommand rolls up a JSONL span file and writes table paths', async () => {
  const { runSummaryCommand } = freshRequire('src/commands/run-summary.js');
  const dir = tmpDir('run-summary');
  const input = path.join(dir, 'spans.jsonl');
  const outDir = path.join(dir, 'tables');
  fs.writeFileSync(input, `${JSON.stringify({
    timestamp: '2026-01-01T00:00:00.000Z',
    name: 'execute_tool',
    attributes: {
      'agentops.run.id': 'run_test',
      'agentops.session.id': 'session_test',
      'agentops.surface': 'cli',
      'agentops.privacy.mode': 'strict',
      'agentops.repo.hash': 'repo_hash',
      'agentops.branch.hash': 'branch_hash',
      'agentops.task.type': 'fix',
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'npm test'
    }
  })}\n`);

  const captured = await captureOutput(() => runSummaryCommand([
    'generate',
    '--file',
    input,
    '--out',
    outDir,
    '--json',
    '--surface',
    'cli',
    '--repo',
    'repo/name',
    '--branch',
    'main'
  ]));
  const payload = JSON.parse(captured.output);
  assert.equal(captured.exitCode, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.runs, 1);
  assert.equal(payload.out_dir, outDir);
  assert.equal(fs.existsSync(payload.manifest), true);
  assert.equal(fs.existsSync(path.join(outDir, 'AgentOpsRunSummary_CL.jsonl')), true);
});

test('azureIngestCommand reports a not-ready local plan without contacting Azure', async () => {
  const { azureIngestCommand } = freshRequire('src/commands/azure-ingest.js');
  const dir = tmpDir('azure-ingest');

  const captured = await captureOutput(() => azureIngestCommand(['plan', '--dir', dir, '--json']));
  const plan = JSON.parse(captured.output);
  assert.equal(captured.exitCode, 1);
  assert.equal(plan.ok, false);
  assert.equal(plan.dir, dir);
  assert.match(plan.errors.join('\n'), /AgentOpsRunSummary_CL: required table has no rows/);
  assert.equal(plan.privacy.ok, true);
});

test('githubEnrichCommand shells through mocked gh output and writes outcome files', async () => {
  const calls = [];
  const restoreSpawnSync = patch(childProcess, 'spawnSync', (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'repo') {
      return { status: 0, stdout: JSON.stringify({ nameWithOwner: 'owner/repo' }), stderr: '' };
    }
    return {
      status: 0,
      stdout: JSON.stringify([{
        number: 42,
        title: 'Test PR',
        state: 'MERGED',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        mergedAt: '2026-01-02T00:00:00Z',
        closedAt: '2026-01-02T00:00:00Z',
        headRefName: 'feature/test',
        changedFiles: 2,
        commits: { totalCount: 1 },
        reviewDecision: 'APPROVED',
        labels: [],
        statusCheckRollup: []
      }]),
      stderr: ''
    };
  });

  try {
    const { githubEnrichCommand } = freshRequire('src/commands/github-enrich.js');
    const outDir = path.join(tmpDir('github-enrich'), 'out');
    const captured = await captureOutput(() => githubEnrichCommand(['--out', outDir, '--limit', '1', '--json']));
    const result = JSON.parse(captured.output);
    assert.equal(captured.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.rows.length, 1);
    assert.equal(fs.existsSync(result.file), true);
    assert.deepEqual(calls.map(call => call.slice(0, 3)), [
      ['gh', 'repo', 'view'],
      ['gh', 'pr', 'list']
    ]);
  } finally {
    restoreSpawnSync();
  }
});

test('githubEnrichCommand validates limit before invoking gh', () => {
  const { githubEnrichCommand } = freshRequire('src/commands/github-enrich.js');
  assert.throws(() => githubEnrichCommand(['--limit', '0']), /--limit must be an integer between 1 and 200/);
});

test('collector render and command dispatch handle status, JSON output, and failure exit code', async () => {
  const collectorManager = require('../src/lib/collector-manager');
  const restore = [
    patch(collectorManager, 'parseCollectorOptions', () => ({ json: true, mode: 'binary', privacy: 'strict' })),
    patch(collectorManager, 'validate', options => ({
      ok: false,
      mode: options.mode,
      privacyMode: options.privacy,
      running: false,
      error: 'invalid config'
    }))
  ];

  try {
    const { collectorCommand, renderCollector } = freshRequire('src/commands/collector.js');
    const rendered = renderCollector({
      ok: false,
      mode: 'binary',
      privacyMode: 'strict',
      running: false,
      endpoint: 'http://127.0.0.1:4318',
      healthUrl: 'http://127.0.0.1:13133',
      error: 'invalid config',
      warning: 'check config',
      details: ['config missing exporter'],
      poison: { ok: false, leaked: ['SECRET_FAKE_TEST_VALUE'] }
    });
    assert.match(rendered, /Running: no/);
    assert.match(rendered, /Poison privacy check: failed/);
    assert.match(rendered, /Leaks: SECRET_FAKE_TEST_VALUE/);

    const captured = await captureOutput(() => collectorCommand(['validate', '--json']));
    const result = JSON.parse(captured.output);
    assert.equal(captured.exitCode, 1);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid config');
  } finally {
    restore.reverse().forEach(fn => fn());
  }
});

test('static-check script validates repo syntax and local docs links', () => {
  const result = childProcess.spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'static-check.js'),
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.failures.length, 0);
  assert.ok(summary.checked.js > 0);
  assert.ok(summary.checked.json > 0);
  assert.ok(summary.checked.markdown > 0);
});

test('security audit reports production readiness checks as JSON', () => {
  const result = childProcess.spawnSync(process.execPath, [
    path.join(repoRoot, 'agentops-cli', 'src', 'index.js'),
    'security',
    'audit',
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.ok, true);
  assert.ok(audit.checks.some(check => check.name === 'static-check' && check.ok));
  assert.ok(audit.checks.some(check => check.name === 'ci-security-gates' && check.ok));
  assert.ok(audit.checks.some(check => check.name === 'owasp-abuse-fixtures' && check.ok));
  assert.ok(audit.checks.some(check => check.name === 'dependency-audit' && check.ok));
  assert.ok(audit.checks.some(check => check.name === 'dashboard-content-guardrails' && check.ok));
});

test('security posture reports OWASP and ASVS control coverage as JSON', () => {
  const result = childProcess.spawnSync(process.execPath, [
    path.join(repoRoot, 'agentops-cli', 'src', 'index.js'),
    'security',
    'posture',
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const posture = JSON.parse(result.stdout);
  const byId = Object.fromEntries(posture.controls.map(control => [control.id, control]));
  assert.equal(posture.ok, true);
  assert.equal(byId.LLM01.status, 'covered');
  assert.equal(byId.LLM02.status, 'covered');
  assert.equal(byId.LLM06.status, 'covered');
  assert.equal(byId.LLM08.status, 'not-applicable');
  assert.equal(byId['ASVS-SEC'].status, 'covered');
  assert.ok(posture.summary.partial >= 1);
});
