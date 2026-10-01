const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { attachCommand } = require('../src/lib/attach-command');
const { attachedScriptEnvironment, scriptTraceEndpoint } = require('../src/lib/copilot/script-observation');
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
    assert.equal(env.AGENTOPS_REPO_ROOT, fs.realpathSync(root));
    assert.equal(env.AGENTOPS_ATTACHMENT_MANIFEST, path.join(fs.realpathSync(root), '.agentops', 'attachment.json'));
    assert.equal(env.AGENTOPS_SCRIPT_OTLP_ENDPOINT, 'http://127.0.0.1:4318/v1/traces');
    assert.deepEqual(env.PYTHONPATH.split(path.delimiter), [path.join(repoRoot, 'instrumentation', 'python'), '/existing/python']);
    assert.deepEqual(env.NODE_PATH.split(path.delimiter), [path.join(repoRoot, 'instrumentation', 'node'), '/existing/node']);
    assert.match(env.NODE_OPTIONS, new RegExp(`--require="${path.join(repoRoot, 'instrumentation', 'node', 'preload.cjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.ok(env.NODE_OPTIONS.endsWith('--max-old-space-size=4096'));
    assert.equal(env.PATH, '/usr/bin');
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

test('Node preload traces the script argument selected by a ts-node-style launcher', async () => {
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
