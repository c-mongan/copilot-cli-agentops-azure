const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { attachCommand } = require('../src/lib/attach-command');
const { findCollectorBinary } = require('../src/lib/collector-discovery');
const { attachedScriptEnvironment, executableOnPath, scriptTraceEndpoint } = require('../src/lib/copilot/script-observation');
const { startScopedStrictCollector } = require('../src/lib/copilot/scoped-collector');
const { readSessionOtelSpans } = require('../src/lib/copilot/session-otel');
const { spanRowsFromOtelSpans } = require('../src/lib/copilot/session-span-export');
const { buildAzureIngestPlan } = require('../src/lib/azure/v2-ingest-plan');
const { repoRoot } = require('../src/lib/paths');

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-script-observation-'));
  childProcess.execFileSync('git', ['init', '-q', root]);
  const scripts = path.join(root, '.github', 'skills', 'demo', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'skills', 'demo', 'SKILL.md'), 'synthetic skill');
  fs.writeFileSync(path.join(scripts, 'task.py'), 'print("synthetic")\n');
  return root;
}

test('Python interpreter lookup preserves a PATH symlink and skips executable directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-python-path-'));
  try {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    fs.mkdirSync(path.join(first, 'python3'), { recursive: true });
    fs.mkdirSync(second);
    const linked = path.join(second, 'python3');
    fs.symlinkSync(process.execPath, linked);
    assert.equal(executableOnPath('python3', [first, second].join(path.delimiter), root), linked);
    assert.notEqual(linked, fs.realpathSync.native(linked));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('attached Copilot environment scopes Python script bootstrap and exact run ID to the opted-in process', () => {
  const root = fixtureRepo();
  try {
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({
      env: { PATH: '/usr/bin', PYTHONPATH: '/existing/python', NODE_PATH: '/existing/node', NODE_OPTIONS: '--max-old-space-size=4096', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318/' },
      cwd: root,
      runId: 'run-synthetic-123',
      agentopsRoot: repoRoot,
      collectorMode: 'auto'
    });
    assert.equal(env.AGENTOPS_RUN_ID, 'run-synthetic-123');
    assert.equal(env.AGENTOPS_REPO_ROOT, fs.realpathSync.native(root));
    assert.equal(env.AGENTOPS_ATTACHMENT_MANIFEST, path.join(fs.realpathSync.native(root), '.agentops', 'attachment.json'));
    assert.equal(env.AGENTOPS_SCRIPT_OTLP_ENDPOINT, 'http://127.0.0.1:4318/v1/traces');
    assert.deepEqual(env.PYTHONPATH.split(path.delimiter), [path.join(repoRoot, 'instrumentation', 'python'), '/existing/python']);
    if (process.platform !== 'win32') {
      assert.equal(env.PATH.split(path.delimiter)[0], path.join(repoRoot, 'instrumentation', 'python', 'bin-python3'));
      assert.ok(path.isAbsolute(env.AGENTOPS_REAL_PYTHON3));
      assert.equal(env.PATH.split(path.delimiter).some(entry => fs.existsSync(path.join(entry, 'python'))), Boolean(env.AGENTOPS_REAL_PYTHON));
    } else {
      assert.equal(env.PATH, '/usr/bin', 'scoped Python PATH shims are POSIX-only');
    }
    assert.deepEqual(env.NODE_PATH.split(path.delimiter), [path.join(repoRoot, 'instrumentation', 'node'), '/existing/node']);
    assert.match(env.NODE_OPTIONS, new RegExp(`--require="${path.join(repoRoot, 'instrumentation', 'node', 'preload.cjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.ok(env.NODE_OPTIONS.endsWith('--max-old-space-size=4096'));
    if (process.platform !== 'win32') {
      const expectedPathTail = env.AGENTOPS_REAL_PYTHON ? [path.join(repoRoot, 'instrumentation', 'python', 'bin-python'), '/usr/bin'] : ['/usr/bin'];
      assert.deepEqual(env.PATH.split(path.delimiter).slice(1), expectedPathTail);
    }
    const repeated = attachedScriptEnvironment({ env, cwd: root, runId: 'run-synthetic-123', agentopsRoot: repoRoot, collectorMode: 'auto' });
    assert.equal(repeated.PATH, env.PATH);
    assert.equal(repeated.AGENTOPS_REAL_PYTHON3, env.AGENTOPS_REAL_PYTHON3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unattached repositories receive no bootstrap settings and existing trace endpoints are preserved', () => {
  const root = fixtureRepo();
  try {
    const input = { PATH: '/usr/bin', PYTHONPATH: '/existing/python' };
    const env = attachedScriptEnvironment({ env: input, cwd: root, runId: 'run-a', agentopsRoot: repoRoot });
    assert.deepEqual(env, input);
    assert.equal(scriptTraceEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/v1/traces' }), 'https://collector.example/v1/traces');
    assert.equal(scriptTraceEndpoint({}, 'none'), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node preload exports root and named step spans only for an inventoried script', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const script = path.join(root, 'scripts', 'task.js');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "const { step } = require('agentops-script.cjs');\nstep('parse-input', () => console.log('synthetic-node-ok'));\n");
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({
      env: { PATH: process.env.PATH, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` },
      cwd: root,
      runId: 'synthetic-node-run',
      agentopsRoot: repoRoot
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'synthetic-node-ok');
    assert.equal(requests.length, 1);
    const spans = requests[0].resourceSpans[0].scopeSpans[0].spans;
    const rootSpan = spans.find(span => span.name === 'agentops.script');
    const stepSpan = spans.find(span => span.name === 'agentops.script.step');
    assert.ok(rootSpan);
    assert.ok(stepSpan);
    assert.equal(rootSpan.status.code, 1);
    assert.equal(rootSpan.attributes.some(item => item.key === 'error.type'), false);
    assert.equal(rootSpan.traceId, stepSpan.traceId);
    assert.equal(stepSpan.parentSpanId, rootSpan.spanId);
    assert.equal(rootSpan.parentSpanId, undefined);
    assert.equal(stepSpan.attributes.find(item => item.key === 'agentops.step.name').value.stringValue, 'parse-input');
    assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.runtime.name').value.stringValue, 'node');
    assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.runtime.version').value.stringValue, process.versions.node);
    assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.runtime.implementation').value.stringValue, 'node');
    assert.equal(requests[0].resourceSpans[0].resource.attributes.find(item => item.key === 'agentops.run.id').value.stringValue, 'synthetic-node-run');
    const receipt = path.join(root, 'synthetic-node-receipt.jsonl');
    fs.writeFileSync(receipt, `${JSON.stringify(requests[0])}\n`, { mode: 0o600 });
    const parsed = readSessionOtelSpans('synthetic-copilot-session', [receipt], { runId: 'synthetic-node-run' });
    assert.equal(parsed.spans.length, 2);
    const rows = spanRowsFromOtelSpans(parsed.spans, 'synthetic-copilot-session', 'synthetic-node-run');
    assert.equal(rows[0].LinkType, 'run-id-logical-link');
    assert.equal(rows[1].ParentSpanId, rootSpan.spanId);
    assert.equal(rows[1].ScriptName, 'scripts/task.js');
    assert.equal(rows[1].StepName, 'parse-input');
    assert.equal(rows[0].ScriptRuntimeName, 'node');
    assert.equal(rows[0].ScriptRuntimeVersion, process.versions.node);
    const exportDir = path.join(root, 'export');
    fs.mkdirSync(exportDir);
    fs.writeFileSync(path.join(exportDir, 'AgentOpsSpans_CL.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    const plan = buildAzureIngestPlan({ dir: exportDir, spansOnly: true });
    assert.equal(plan.ok, true, JSON.stringify(plan.errors));
    assert.equal(plan.tables.AgentOpsSpans_CL.rows, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node TypeScript .ts .mts and .cts entrypoints trace without changing task output', async t => {
  const help = childProcess.spawnSync(process.execPath, ['--help'], { encoding: 'utf8' });
  if (!/--experimental-strip-types|--experimental-transform-types/.test(help.stdout)) {
    t.skip('selected Node runtime does not document built-in TypeScript support');
    return;
  }
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(request.url === '/reject' ? 503 : 200, { 'content-type': 'application/json' });
      response.end(request.url === '/reject' ? 'synthetic collector rejected data' : '{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const extensionScripts = new Map([
      ['.ts', "let step = (_name: string, callback: () => void) => callback();\ntry { ({ step } = require('agentops-script.cjs')); } catch {}\nconst message: string = 'synthetic-typescript-ok';\nstep('typed-step', () => console.log(message));\n"],
      ['.cts', "let step = (_name: string, callback: () => void) => callback();\ntry { ({ step } = require('agentops-script.cjs')); } catch {}\nconst message: string = 'synthetic-typescript-ok';\nstep('typed-step', () => console.log(message));\n"],
      ['.mts', "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nlet step: (name: string, callback: () => void) => void = (_name, callback) => callback();\ntry { ({ step } = require('agentops-script.cjs')); } catch {}\nconst message: string = 'synthetic-typescript-ok';\nstep('typed-step', () => console.log(message));\n"]
    ]);
    const scripts = [...extensionScripts].map(([extension, source]) => {
      const script = path.join(root, '.github', 'skills', 'demo', 'scripts', `task${extension}`);
      fs.writeFileSync(script, source);
      return { extension, script, relative: `.github/skills/demo/scripts/task${extension}` };
    });
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const execute = runEnv => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runEnv.script], { cwd: root, env: runEnv.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    for (const [index, fixture] of scripts.entries()) {
      const runId = `synthetic-typescript-${fixture.extension.slice(1)}-run`;
      const env = attachedScriptEnvironment({
        env: { PATH: process.env.PATH, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint },
        cwd: root,
        runId,
        agentopsRoot: repoRoot
      });
      const baseline = await execute({ script: fixture.script, env: { PATH: process.env.PATH } });
      const observed = await execute({ script: fixture.script, env });
      const rejectedCollector = await execute({ script: fixture.script, env: { ...env, AGENTOPS_SCRIPT_OTLP_ENDPOINT: `${endpoint}/reject` } });
      const unavailableCollector = await execute({ script: fixture.script, env: { ...env, AGENTOPS_SCRIPT_OTLP_ENDPOINT: 'http://127.0.0.1:1/v1/traces' } });
      for (const result of [observed, rejectedCollector, unavailableCollector]) {
        assert.equal(result.code, baseline.code, `${fixture.extension}: ${result.stderr}`);
        assert.equal(result.signal, baseline.signal);
        assert.equal(result.stdout, baseline.stdout);
      }
      assert.equal(baseline.code, 0, `${fixture.extension}: ${baseline.stderr}`);
      assert.equal(baseline.stdout.trim(), 'synthetic-typescript-ok');
      const successfulPayload = requests[index * 2];
      assert.ok(successfulPayload, `${fixture.extension} should be exported to the local receiver`);
      const spans = successfulPayload.resourceSpans[0].scopeSpans[0].spans;
      const rootSpan = spans.find(span => span.name === 'agentops.script');
      const stepSpan = spans.find(span => span.name === 'agentops.script.step');
      assert.ok(rootSpan);
      assert.ok(stepSpan);
      assert.equal(rootSpan.traceId, stepSpan.traceId);
      assert.equal(stepSpan.parentSpanId, rootSpan.spanId);
      assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.name').value.stringValue, fixture.relative);
      assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.runtime.name').value.stringValue, 'node');
      assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.loader.name').value.stringValue, 'node-native-typescript');
      assert.equal(stepSpan.attributes.find(item => item.key === 'agentops.step.name').value.stringValue, 'typed-step');
      assert.equal(successfulPayload.resourceSpans[0].resource.attributes.find(item => item.key === 'agentops.run.id').value.stringValue, runId);
    }
    assert.equal(requests.length, 6, 'successful and HTTP-rejected collector attempts should be recorded for each extension');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node preload traces the script argument selected by a ts-node-style launcher', async t => {
  if (!process.features.typescript) {
    t.skip('selected Node runtime does not strip TypeScript types by default');
    return;
  }
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const script = path.join(root, '.github', 'skills', 'demo', 'scripts', 'task.ts');
    fs.writeFileSync(script, "const message: string = 'synthetic-tsnode-cli-ok';\nconsole.log(message);\n");
    const launcher = path.join(root, 'tools', 'ts-node');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, "const { pathToFileURL } = require('node:url');\nconst script = process.argv.slice(2).find(arg => arg.endsWith('.ts'));\nif (!script) throw new Error('missing TypeScript entrypoint');\nimport(pathToFileURL(script).href).then(() => require('agentops-script.cjs').step('tsnode-entrypoint', () => {})).catch(error => { console.error(error); process.exitCode = 1; });\n");
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({
      env: { PATH: process.env.PATH, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` },
      cwd: root,
      runId: 'synthetic-tsnode-cli-run',
      agentopsRoot: repoRoot
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [launcher, '--transpile-only', '--compiler-options', '{}', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'synthetic-tsnode-cli-ok');
    assert.equal(requests.length, 1, 'the selected attached TypeScript entrypoint should emit a root span');
    const spans = requests[0].resourceSpans[0].scopeSpans[0].spans;
    const rootSpan = spans.find(span => span.name === 'agentops.script');
    const stepSpan = spans.find(span => span.name === 'agentops.script.step');
    assert.ok(rootSpan);
    assert.ok(stepSpan);
    assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.name').value.stringValue, '.github/skills/demo/scripts/task.ts');
    assert.equal(rootSpan.attributes.find(item => item.key === 'agentops.script.loader.name').value.stringValue, 'ts-node');
    assert.equal(stepSpan.attributes.find(item => item.key === 'agentops.step.name').value.stringValue, 'tsnode-entrypoint');
    assert.equal(stepSpan.parentSpanId, rootSpan.spanId);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node preload records nonzero script outcome without changing its exit code', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(request.url === '/reject' ? 503 : 200);
      response.end(request.url === '/reject' ? 'synthetic collector rejected data' : '{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const script = path.join(root, '.github', 'skills', 'demo', 'scripts', 'fail.js');
    fs.writeFileSync(script, 'process.exitCode = 7;\n');
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({
      env: { PATH: process.env.PATH, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` },
      cwd: root,
      runId: 'synthetic-node-failure-run',
      agentopsRoot: repoRoot
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stderr }));
    });
    assert.equal(result.code, 7, result.stderr);
    assert.equal(requests.length, 1);
    const rootSpan = requests[0].resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(rootSpan.status.code, 2);
    assert.equal(rootSpan.attributes.find(item => item.key === 'error.type').value.stringValue, 'ProcessExit');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node script output and exit status match with telemetry off, on, and unavailable', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200);
      response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const script = path.join(root, '.github', 'skills', 'demo', 'scripts', 'parity.js');
    fs.writeFileSync(script, "console.log('agent task output');\nprocess.exitCode = 7;\n");
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const execute = env => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    const baselineEnv = { ...process.env };
    for (const key of Object.keys(baselineEnv)) {
      if (key.startsWith('AGENTOPS_')) delete baselineEnv[key];
    }
    const baseline = await execute(baselineEnv);
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const observedEnv = attachedScriptEnvironment({
      env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint },
      cwd: root,
      runId: 'synthetic-parity-run',
      agentopsRoot: repoRoot
    });
    const observed = await execute(observedEnv);
    const rejectedCollector = await execute({
      ...observedEnv,
      AGENTOPS_SCRIPT_OTLP_ENDPOINT: `${endpoint}/reject`
    });
    const failedCollector = await execute({
      ...observedEnv,
      AGENTOPS_SCRIPT_OTLP_ENDPOINT: 'http://127.0.0.1:1/v1/traces'
    });
    for (const result of [observed, rejectedCollector, failedCollector]) {
      assert.equal(result.code, baseline.code, result.stderr);
      assert.equal(result.signal, baseline.signal);
      assert.equal(result.stdout, baseline.stdout);
    }
    assert.equal(baseline.code, 7);
    assert.equal(baseline.stdout.trim(), 'agent task output');
    assert.equal(requests.length, 2, 'successful and HTTP-rejected collector attempts should both be recorded');
    const rootSpan = requests[0].resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(rootSpan.status.code, 2);
    assert.equal(rootSpan.attributes.find(item => item.key === 'error.type').value.stringValue, 'ProcessExit');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlapping and repeated invocations of inventoried scripts within one run are traced distinctly, never aliased', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200);
      response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const scriptsDir = path.join(root, 'scripts');
    const scriptA = path.join(scriptsDir, 'overlap-a.js');
    const scriptB = path.join(scriptsDir, 'overlap-b.js');
    fs.mkdirSync(scriptsDir, { recursive: true });
    // Each script waits briefly so concurrent child processes genuinely overlap in wall-clock time
    // rather than happening to run sequentially fast enough to look concurrent.
    fs.writeFileSync(scriptA, "const { step } = require('agentops-script.cjs');\nstep('work-a', () => new Promise(r => setTimeout(r, 40)));\nconsole.log('overlap-a-done');\n");
    fs.writeFileSync(scriptB, "const { step } = require('agentops-script.cjs');\nstep('work-b', () => new Promise(r => setTimeout(r, 10)));\nconsole.log('overlap-b-done');\n");
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({
      env: { PATH: process.env.PATH, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` },
      cwd: root,
      runId: 'synthetic-overlap-run',
      agentopsRoot: repoRoot
    });
    const execute = script => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });

    // Two concurrent invocations of the SAME script, plus one concurrent invocation of a DIFFERENT
    // script, all launched together so their child processes genuinely overlap.
    const [repeatOne, repeatTwo, other] = await Promise.all([
      execute(scriptA),
      execute(scriptA),
      execute(scriptB)
    ]);

    assert.equal(repeatOne.code, 0, repeatOne.stderr);
    assert.equal(repeatTwo.code, 0, repeatTwo.stderr);
    assert.equal(other.code, 0, other.stderr);
    assert.equal(repeatOne.stdout.trim(), 'overlap-a-done');
    assert.equal(repeatTwo.stdout.trim(), 'overlap-a-done');
    assert.equal(other.stdout.trim(), 'overlap-b-done');

    assert.equal(requests.length, 3, 'each overlapping invocation must export its own trace batch, not be collapsed into another');
    const rootSpans = requests.map(request => request.resourceSpans[0].scopeSpans[0].spans.find(span => span.name === 'agentops.script'));
    const traceIds = rootSpans.map(span => span.traceId);
    const spanIds = rootSpans.map(span => span.spanId);
    assert.equal(new Set(traceIds).size, 3, 'overlapping invocations must not share a trace ID');
    assert.equal(new Set(spanIds).size, 3, 'overlapping invocations must not share a root span ID');

    const scriptNames = requests.map(request => request.resourceSpans[0].scopeSpans[0].spans
      .find(span => span.name === 'agentops.script.step').attributes
      .find(item => item.key === 'agentops.script.name').value.stringValue);
    const scriptACount = scriptNames.filter(name => name === 'scripts/overlap-a.js').length;
    const scriptBCount = scriptNames.filter(name => name === 'scripts/overlap-b.js').length;
    assert.equal(scriptACount, 2, 'both repeated invocations of script A must be individually attributed to script A');
    assert.equal(scriptBCount, 1, 'the concurrent different script must be attributed to script B, not aliased to A');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped Python launcher records actual owned-script outcomes without capturing exception payloads', async t => {
  if (process.platform === 'win32') {
    t.skip('scoped Python launcher shims are POSIX-only');
    return;
  }
  const payloads = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      payloads.push({ contentType: request.headers['content-type'], bodyBase64: Buffer.concat(chunks).toString('base64') });
      response.writeHead(200); response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const cases = [
      ['exit.py', 'import sys; sys.exit(7)\n', 7, 'failed', 'ProcessExit'],
      ['exit-string.py', 'import sys; sys.exit("PRIVATE_SYSTEM_EXIT_CANARY")\n', 1, 'failed', 'ProcessExit'],
      ['ok.py', 'print("ok")\n', 0, 'ok', ''],
      ['caught.py', 'import sys\ntry: sys.exit(7)\nexcept SystemExit: print("caught")\n', 0, 'ok', ''],
      ['error.py', 'raise ValueError("PRIVATE_ERROR_CANARY")\n', 1, 'failed', 'ProcessExit']
    ];
    for (const [name, code] of cases) fs.writeFileSync(path.join(root, '.github/skills/demo/scripts', name), code);
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const env = attachedScriptEnvironment({ env: process.env, cwd: root, runId: 'python-outcome-test', agentopsRoot: repoRoot });
    env.AGENTOPS_SCRIPT_OTLP_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/traces`;
    const baselineEnv = { ...process.env };
    for (const key of Object.keys(baselineEnv)) if (key.startsWith('AGENTOPS_')) delete baselineEnv[key];
    const execute = (name, selectedEnv) => new Promise((resolve, reject) => {
      const child = spawn('python3', [path.join(root, '.github/skills/demo/scripts', name)], { cwd: root, env: selectedEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      child.once('error', reject);
    });
    for (const [name, , exit, outcome, errorType] of cases) {
      payloads.length = 0;
      const baseline = await execute(name, baselineEnv);
      const result = await execute(name, env);
      assert.equal(result.code, exit);
      assert.equal(result.code, baseline.code);
      assert.equal(result.signal, baseline.signal);
      assert.equal(result.stdout, baseline.stdout);
      assert.equal(result.stderr, baseline.stderr);
      assert.equal(payloads.length, 1);
      const receipt = path.join(root, 'receipt.jsonl');
      fs.writeFileSync(receipt, payloads.map(row => JSON.stringify(row)).join('\n'));
      const parsed = readSessionOtelSpans('synthetic-session', [receipt], { runId: 'python-outcome-test' });
      const rows = spanRowsFromOtelSpans(parsed.spans, 'synthetic-session', 'python-outcome-test');
      assert.equal(rows.length, 1, `${name} should have one supervisor-derived root span`);
      assert.equal(parsed.spans[0].processExitCode, exit);
      assert.equal(parsed.spans[0].processSignalNumber, null);
      assert.equal(parsed.spans[0].scriptOutcomeSource, 'supervisor-child-wait');
      assert.equal(parsed.spans[0].scriptObserverRole, 'python-launcher');
      assert.ok(Number.isInteger(parsed.spans[0].scriptObserverPid));
      assert.ok(Number.isInteger(parsed.spans[0].scriptChildPid));
      assert.notEqual(parsed.spans[0].scriptObserverPid, parsed.spans[0].scriptChildPid);
      assert.equal(rows[0].Outcome, outcome);
      assert.equal(rows[0].ErrorType, errorType);
      assert.ok(!JSON.stringify(rows).includes('PRIVATE_ERROR_CANARY'));
      assert.ok(!JSON.stringify(rows).includes('PRIVATE_SYSTEM_EXIT_CANARY'));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped Python launcher forwards SIGTERM and SIGINT, reaps each child, and records signal outcomes', async t => {
  if (process.platform === 'win32') {
    t.skip('POSIX signal parity applies to the scoped shell shims');
    return;
  }
  const payloads = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      payloads.push({ contentType: request.headers['content-type'], bodyBase64: Buffer.concat(chunks).toString('base64') });
      response.writeHead(200); response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const childPidFile = path.join(root, 'child.pid');
    const script = path.join(root, '.github/skills/demo/scripts/wait.py');
    fs.writeFileSync(script, 'import os, pathlib, time\npathlib.Path(os.environ["AGENTOPS_TEST_CHILD_PID_FILE"]).write_text(str(os.getpid()))\ntime.sleep(60)\n');
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    for (const signalName of ['SIGTERM', 'SIGINT']) {
      payloads.length = 0;
      fs.rmSync(childPidFile, { force: true });
      const runId = `python-${signalName.toLowerCase()}-test`;
      const env = attachedScriptEnvironment({ env: { ...process.env, AGENTOPS_TEST_CHILD_PID_FILE: childPidFile }, cwd: root, runId, agentopsRoot: repoRoot });
      env.AGENTOPS_SCRIPT_OTLP_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/traces`;
      const started = Date.now();
      const launched = spawn('python3', [script], { cwd: root, env, stdio: 'ignore' });
      const resultPromise = new Promise((resolve, reject) => {
        launched.once('close', (code, signal) => resolve({ code, signal }));
        launched.once('error', reject);
      });
      for (let attempt = 0; attempt < 100 && !fs.existsSync(childPidFile); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(fs.existsSync(childPidFile), true, 'owned child should start before cancellation');
      const childPid = Number(fs.readFileSync(childPidFile, 'utf8'));
      launched.kill(signalName);
      const result = await resultPromise;
      assert.deepEqual(result, { code: null, signal: signalName });
      assert.ok(Date.now() - started < 5000, 'signal cleanup should stay bounded');
      assert.throws(() => process.kill(childPid, 0), /ESRCH/);
      assert.equal(payloads.length, 1);
      const receipt = path.join(root, `${signalName.toLowerCase()}-receipt.jsonl`);
      fs.writeFileSync(receipt, `${JSON.stringify(payloads[0])}\n`);
      const parsed = readSessionOtelSpans('synthetic-session', [receipt], { runId });
      assert.equal(parsed.spans.length, 1);
      assert.equal(parsed.spans[0].failed, true);
      assert.equal(parsed.spans[0].errorType, 'ProcessSignal');
      assert.equal(parsed.spans[0].processExitCode, null);
      assert.equal(parsed.spans[0].processSignalNumber, os.constants.signals[signalName]);
      assert.equal(parsed.spans[0].scriptChildPid, childPid);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped Python launcher preserves a child signal handler exit code instead of forcing cancellation', async t => {
  if (process.platform === 'win32') {
    t.skip('POSIX signal parity applies to the scoped shell shims');
    return;
  }
  const payloads = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      payloads.push({ contentType: request.headers['content-type'], bodyBase64: Buffer.concat(chunks).toString('base64') });
      response.writeHead(200); response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const childPidFile = path.join(root, 'handled-child.pid');
    const scripts = [0, 7].map(exitCode => {
      const script = path.join(root, `.github/skills/demo/scripts/handle-${exitCode}.py`);
      fs.writeFileSync(script, `import os, pathlib, signal, sys, time\npathlib.Path(os.environ["AGENTOPS_TEST_CHILD_PID_FILE"]).write_text(str(os.getpid()))\nsignal.signal(signal.SIGTERM, lambda *_: sys.exit(${exitCode}))\ntime.sleep(60)\n`);
      return { exitCode, script };
    });
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    for (const { exitCode, script } of scripts) {
      payloads.length = 0;
      fs.rmSync(childPidFile, { force: true });
      const runId = `python-handled-signal-${exitCode}`;
      const env = attachedScriptEnvironment({ env: { ...process.env, AGENTOPS_TEST_CHILD_PID_FILE: childPidFile }, cwd: root, runId, agentopsRoot: repoRoot });
      env.AGENTOPS_SCRIPT_OTLP_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/traces`;
      const launched = spawn('python3', [script], { cwd: root, env, stdio: 'ignore' });
      const resultPromise = new Promise((resolve, reject) => {
        launched.once('close', (code, signal) => resolve({ code, signal }));
        launched.once('error', reject);
      });
      for (let attempt = 0; attempt < 100 && !fs.existsSync(childPidFile); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(fs.existsSync(childPidFile), true);
      launched.kill('SIGTERM');
      assert.deepEqual(await resultPromise, { code: exitCode, signal: null });
      assert.equal(payloads.length, 1);
      const receipt = path.join(root, `handled-${exitCode}-receipt.jsonl`);
      fs.writeFileSync(receipt, `${JSON.stringify(payloads[0])}\n`);
      const parsed = readSessionOtelSpans('synthetic-session', [receipt], { runId });
      assert.equal(parsed.spans[0].processExitCode, exitCode);
      assert.equal(parsed.spans[0].processSignalNumber, null);
      assert.equal(parsed.spans[0].failed, exitCode !== 0);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped Python launcher bounds cleanup when an owned child ignores cancellation', async t => {
  if (process.platform === 'win32') {
    t.skip('POSIX signal parity applies to the scoped shell shims');
    return;
  }
  const payloads = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      payloads.push({ contentType: request.headers['content-type'], bodyBase64: Buffer.concat(chunks).toString('base64') });
      response.writeHead(200); response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const childPidFile = path.join(root, 'ignored-child.pid');
    const script = path.join(root, '.github/skills/demo/scripts/ignore-signal.py');
    fs.writeFileSync(script, 'import os, pathlib, signal, time\npathlib.Path(os.environ["AGENTOPS_TEST_CHILD_PID_FILE"]).write_text(str(os.getpid()))\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(60)\n');
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const runId = 'python-forced-cleanup-test';
    const env = attachedScriptEnvironment({ env: { ...process.env, AGENTOPS_TEST_CHILD_PID_FILE: childPidFile }, cwd: root, runId, agentopsRoot: repoRoot });
    env.AGENTOPS_SCRIPT_OTLP_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/traces`;
    const launched = spawn('python3', [script], { cwd: root, env, stdio: 'ignore' });
    const resultPromise = new Promise((resolve, reject) => {
      launched.once('close', (code, signal) => resolve({ code, signal }));
      launched.once('error', reject);
    });
    for (let attempt = 0; attempt < 100 && !fs.existsSync(childPidFile); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(childPidFile), true);
    const childPid = Number(fs.readFileSync(childPidFile, 'utf8'));
    const cancelledAt = Date.now();
    launched.kill('SIGTERM');
    assert.deepEqual(await resultPromise, { code: null, signal: 'SIGKILL' });
    const cleanupMs = Date.now() - cancelledAt;
    assert.ok(cleanupMs >= 1800 && cleanupMs < 5000, `cleanup took ${cleanupMs}ms`);
    assert.throws(() => process.kill(childPid, 0), /ESRCH/);
    assert.equal(payloads.length, 1);
    const receipt = path.join(root, 'forced-cleanup-receipt.jsonl');
    fs.writeFileSync(receipt, `${JSON.stringify(payloads[0])}\n`);
    const parsed = readSessionOtelSpans('synthetic-session', [receipt], { runId });
    assert.equal(parsed.spans[0].processSignalNumber, os.constants.signals.SIGKILL);
    assert.equal(parsed.spans[0].errorType, 'ProcessSignal');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped Python launcher retains explicit step spans and leaves unsupported or unowned commands truthful', async t => {
  if (process.platform === 'win32') {
    t.skip('scoped Python launcher shims are POSIX-only');
    return;
  }
  const payloads = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      payloads.push({ contentType: request.headers['content-type'], bodyBase64: Buffer.concat(chunks).toString('base64') });
      response.writeHead(200); response.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fixtureRepo();
  try {
    const explicit = path.join(root, '.github/skills/demo/scripts/explicit.py');
    fs.writeFileSync(explicit, 'from agentops_script import observe_script\nwith observe_script(".github/skills/demo/scripts/explicit.py") as observation:\n    with observation.step("bounded-work"):\n        print("explicit-ok")\n');
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    const runId = 'python-explicit-step-test';
    const env = attachedScriptEnvironment({ env: process.env, cwd: root, runId, agentopsRoot: repoRoot });
    env.AGENTOPS_SCRIPT_OTLP_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/traces`;
    const execute = (command, args) => new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      child.once('error', reject);
    });

    const observed = await execute('python3', [explicit]);
    assert.equal(observed.code, 0, observed.stderr);
    assert.equal(observed.stdout.trim(), 'explicit-ok');
    const receipt = path.join(root, 'explicit-receipt.jsonl');
    fs.writeFileSync(receipt, `${payloads.map(row => JSON.stringify(row)).join('\n')}\n`);
    let parsed = readSessionOtelSpans('synthetic-session', [receipt], { runId });
    const supervisor = parsed.spans.find(span => span.scriptOutcomeSource === 'supervisor-child-wait');
    const step = parsed.spans.find(span => span.stepName === 'bounded-work');
    assert.ok(supervisor, 'direct owned command should retain its supervisor-derived root outcome');
    assert.ok(step, 'explicit child instrumentation should retain its internal step span');
    assert.equal(step.runId, runId);
    assert.notEqual(step.traceId, supervisor.traceId, 'separate process instrumentation remains a logical run link, not invented parentage');

    payloads.length = 0;
    const unowned = path.join(root, 'unowned-after-attach.py');
    fs.writeFileSync(unowned, 'print("unowned-ok")\n');
    const plain = await execute('python3', [unowned]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), 'unowned-ok');
    assert.equal(payloads.length, 0, 'an unowned script must pass through without a fabricated root span');

    const inventoried = path.join(root, '.github/skills/demo/scripts/task.py');
    const unsupported = await execute('python3', ['-u', inventoried]);
    assert.equal(unsupported.code, 0, unsupported.stderr);
    assert.equal(unsupported.stdout.trim(), 'synthetic');
    assert.equal(payloads.length, 1);
    const unsupportedReceipt = path.join(root, 'unsupported-receipt.jsonl');
    fs.writeFileSync(unsupportedReceipt, `${JSON.stringify(payloads[0])}\n`);
    parsed = readSessionOtelSpans('synthetic-session', [unsupportedReceipt], { runId });
    assert.equal(parsed.spans[0].outcome, 'unknown');
    assert.equal(parsed.spans[0].scriptOutcomeSource, '');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('actual scoped strict Collector retains supervisor-derived Python exit evidence', async t => {
  const binary = findCollectorBinary();
  if (!binary.ok) {
    t.skip('installed Collector binary unavailable');
    return;
  }
  const root = fixtureRepo();
  let collector;
  try {
    const script = path.join(root, '.github/skills/demo/scripts/collector-exit.py');
    // Separate early step export from launcher completion to exercise receipt ordering.
    fs.writeFileSync(script, 'from agentops_script import observe_script\nwith observe_script(".github/skills/demo/scripts/collector-exit.py") as observation:\n    with observation.step("collector-step"):\n        pass\nimport time\ntime.sleep(0.4)\nraise SystemExit(7)\n');
    attachCommand(['--repo', root, '--yes', '--json'], { stdout: { write() {} } });
    collector = await startScopedStrictCollector({
      tempRoot: path.join(root, 'collector-runtime'),
      findCollectorBinary: () => binary
    });
    const runId = 'python-strict-collector-test';
    const env = attachedScriptEnvironment({
      env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: collector.endpoint },
      cwd: root,
      runId,
      agentopsRoot: repoRoot
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn('python3', [script], { cwd: root, env, stdio: 'ignore' });
      child.once('close', (code, signal) => resolve({ code, signal }));
      child.once('error', reject);
    });
    assert.deepEqual(result, { code: 7, signal: null });
    // Child exit proves export submission, not that both Collector batch
    // pipelines and the receipt file have drained. An early step receipt can
    // precede the launcher's terminal span; stop only after that exact receipt.
    const receiptDeadline = Date.now() + 8000;
    let receivedSupervisor;
    while (Date.now() < receiptDeadline) {
      const receipt = readSessionOtelSpans('synthetic-session', [collector.receiptPath], { runId });
      receivedSupervisor = receipt.spans.some(span => span.scriptOutcomeSource === 'supervisor-child-wait' && span.processExitCode === 7);
      if (receivedSupervisor) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(receivedSupervisor, fs.readFileSync(path.join(collector.directory, 'collector.log'), 'utf8'));
    await collector.stop({ remove: false });
    const parsed = readSessionOtelSpans('synthetic-session', [collector.receiptPath], { runId });
    const supervisor = parsed.spans.find(span => span.scriptOutcomeSource === 'supervisor-child-wait');
    assert.ok(supervisor, `strict Collector receipt should retain bounded supervisor provenance: ${JSON.stringify(parsed.spans)}`);
    assert.equal(supervisor.processExitCode, 7);
    assert.equal(supervisor.processSignalNumber, null);
    assert.equal(supervisor.errorType, 'ProcessExit');
    assert.equal(supervisor.failed, true);
    assert.ok(Number.isInteger(supervisor.scriptObserverPid));
    assert.ok(Number.isInteger(supervisor.scriptChildPid));
    assert.notEqual(supervisor.scriptObserverPid, supervisor.scriptChildPid);
    const step = parsed.spans.find(span => span.stepName === 'collector-step');
    assert.ok(step, 'strict Collector receipt should retain explicit internal child steps');
    assert.equal(step.runId, runId);
    assert.notEqual(step.traceId, supervisor.traceId);
    assert.ok(!fs.readFileSync(collector.receiptPath, 'utf8').includes('SystemExit'));
  } finally {
    if (collector) await collector.stop({ remove: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
