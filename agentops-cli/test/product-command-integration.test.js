const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { productCommand, parseProductArgs } = require('../src/lib/product-command');
const cli = path.resolve(__dirname, '../src/index.js');
const sink = { write() {} };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-product-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = path.join(dir, 'ledger');
  fs.mkdirSync(path.join(ledger, 'run-1'), { recursive: true });
  fs.writeFileSync(path.join(ledger, 'attachment.json'), JSON.stringify({ architecture: { agents: [], skills: [], runtimeScripts: [] } }));
  fs.writeFileSync(path.join(ledger, 'run-1', 'run-context.json'), JSON.stringify({ runId: 'run-1', taskId: 'task-1', evidenceComplete: false }));
  fs.writeFileSync(path.join(ledger, 'run-1', 'AgentOpsEvents_CL.jsonl'), JSON.stringify({ TimeGenerated: '2026-10-02T12:00:00Z', RunId: 'run-1', EventId: 'event-1', EventName: 'tool.execution_complete', ToolName: 'read_file', Sequence: 1, Payload: 'PRIVATE_CANARY' }) + '\n');
  return { dir, ledger };
}
test('actual CLI product help has no local writes, even with invalid paths', t => {
  const { dir } = fixture(t);
  const home = path.join(dir, 'never-created');
  for (const args of [['product', 'build', '--help', '--ledger', '/missing', '--bogus'], ['help', 'product']]) {
    const result = childProcess.spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, AGENTOPS_HOME: home }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /audit\|build\|evidence\|compare\|runtime/);
    assert.equal(fs.existsSync(home), false);
  }
});
test('unknown flags and missing values fail before reading or writing', async t => {
  const { dir } = fixture(t);
  const out = path.join(dir, 'never-created');
  await assert.rejects(productCommand(['build', '--ledger', '/missing', '--repo', '/missing', '--out', out, '--upload'], { stdout: sink }), /Unknown/);
  assert.equal(fs.existsSync(out), false);
  assert.throws(() => parseProductArgs(['evidence', '--ledger', '--json']), /requires a value/);
  assert.throws(() => parseProductArgs(['evidence', '--ledger', 'x', '--evaluation-key', 'k']), /all three/);
});
test('integrated build writes linked local views and provenance with owner-only evidence', async t => {
  const { dir, ledger } = fixture(t);
  const out = path.join(dir, 'product');
  const result = await productCommand(['build', '--ledger', ledger, '--repo', dir, '--out', out, '--json'], { stdout: sink });
  assert.equal(result.localEvidence, 'generated');
  assert.equal(result.cloudDelivery, 'pending');
  assert.match(result.outcomes, /unknown/);
  for (const name of ['index.html', 'runs.html', 'architecture.html', 'compare.html', 'product.json', 'evidence/product-evidence-manifest.json']) {
    assert.equal(fs.existsSync(path.join(out, name)), true, name);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(out, name)).mode & 0o777, 0o600);
  }
  assert.match(fs.readFileSync(result.indexPath, 'utf8'), /href="evidence\/product-evidence-manifest.json"/);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'runs.html'), 'utf8'), /PRIVATE_CANARY/);
  const manifest = JSON.parse(fs.readFileSync(result.evidence.manifestFile));
  assert.equal(manifest.delivered, null);
  assert.equal(manifest.mode, 'local-preview-only');
  await assert.rejects(productCommand(['build', '--ledger', ledger, '--repo', dir, '--out', out], { stdout: sink }), /new output directory/);
});
test('evidence previews from the real recorder layout and preserves unknown outcomes', async t => {
  const { dir, ledger } = fixture(t);
  const result = await productCommand(['evidence', '--ledger', ledger, '--repo', dir, '--json'], { stdout: sink });
  assert.equal(result.preview, true);
  assert.equal(result.bundle.tables.AgentOpsRunSummary_CL[0].OutcomeStatus, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY/);
  assert.equal(fs.existsSync(path.join(dir, 'evidence')), false);
});
test('stored compare assessment is read-only and legacy assertions stay inconclusive', async t => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'trial.json');
  const record = { id: 'trial', status: 'accepted', baseline: { architectureVersion: 'a' }, candidate: { architectureVersion: 'a' } };
  fs.writeFileSync(file, JSON.stringify(record));
  const before = fs.readFileSync(file, 'utf8');
  const result = await productCommand(['compare', '--experiment', file, '--json'], { stdout: sink });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.execution, 'stored-trials-only');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('runtime qualification uses packaged-root compatible read-only API', async () => {
  const result = await productCommand(['runtime', '--json'], { stdout: sink });
  assert.equal(result.qualification, 'metadata_only');
  assert.ok(result.components);
});
test('legacy launcher snapshots before collector and model execution, strips task-id, and passes snapshot to delivery', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/copilot/command.js'), 'utf8');
  const sequence = [];
  let launchedArgs, delivered, collectorStarted = false;
  const snapshot = Object.freeze({ status: 'captured', architectureVersion: 'before-launch', taskId: 'protected-task' });
  const config = { source: 'observed_launch_arguments', observedSettings: { model: { requested: 'requested-model' } } };
  const stubs = {
    'node:child_process': { spawnSync(_file, args) { sequence.push('launch'); launchedArgs = args; return { status: 0 }; } },
    '../../legacy': { openLinksSummary: () => ({}) },
    '../collector-manager': { status: async () => ({ running: collectorStarted, privacyMode: 'strict', privacyVerified: true }), start: async () => { sequence.push('collector'); collectorStarted = true; return { ok: true, privacyMode: 'strict' }; } },
    './wrapper-envelope': { createWrapperEnvelope: () => ({ runId: 'run-1', sessionId: 'wrapper-1' }), appendWrapperEvent: () => ({ file: 'memory' }) },
    '../copilot-resolver': { resolveCopilotBinary: () => ({ ok: true, path: '/mock/copilot' }) },
    './receipt-session': { snapshotCopilotSessions: () => [], changedCopilotSession: () => ({ sessionId: 'native-1', model: 'reported-model' }) },
    './wrapper-delivery': { createWrapperDelivery: () => ({ record: () => ({ state: 'local_pending' }), drain: async () => ({ state: 'local_pending' }) }) },
    './script-observation': { scriptTraceEndpoint: () => '', attachedScriptEnvironment: ({ env }) => env },
    './session-run-delivery': { deliverCopilotSession: options => { sequence.push('delivery'); delivered = options; return { state: 'local_pending' }; } },
    './run-evidence-contract': { capturePreRunSnapshot: options => { sequence.push('snapshot'); assert.equal(options.taskId, 'protected-task'); assert.equal(options.executionConfiguration, config); return snapshot; } },
    './execution-configuration': { observedLaunchExecutionConfiguration: () => config }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: name => stubs[name] || require(name.startsWith('.') ? path.resolve(__dirname, '../src/lib/copilot', name) : name), process: { env: { AGENTOPS_PRINT_RUN_LINK: 'false' }, cwd: () => process.cwd(), stderr: sink } });
  await module.exports.copilotCommand(['--collector-mode', 'local', '--task-id', 'protected-task', '--model', 'requested-model', '-p', 'bounded task']);
  assert.deepEqual(sequence, ['snapshot', 'collector', 'launch', 'delivery']);
  assert.deepEqual(Array.from(launchedArgs), ['--model', 'requested-model', '-p', 'bounded task']);
  assert.equal(delivered.preRunSnapshot, snapshot);
  assert.equal(delivered.executionConfiguration, config);
  const receipt = module.exports.renderCopilotReceipt({ envelope: { runId: 'run-1' }, exitCode: 0, requestedModel: 'requested-model', summary: { model: 'reported-model' } });
  assert.match(receipt, /Requested\s+requested-model from launch arguments/);
  assert.match(receipt, /reported by session; response model requires span evidence/);
});
test('CLI dispatch builds and previews local product evidence end to end', t => {
  const { dir, ledger } = fixture(t);
  const out = path.join(dir, 'cli-product');
  const build = childProcess.spawnSync(process.execPath, [cli, 'product', 'build', '--ledger', ledger, '--repo', dir, '--out', out, '--json'], { env: { ...process.env, AGENTOPS_HOME: path.join(dir, 'cli-home') }, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  assert.equal(JSON.parse(build.stdout).cloudDelivery, 'pending');
  const preview = childProcess.spawnSync(process.execPath, [cli, 'product', 'evidence', '--ledger', ledger, '--json'], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).preview, true);
  assert.doesNotMatch(build.stdout + preview.stdout, /PRIVATE_CANARY/);
});
