'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { prepare, gradeHeldoutTrial, gradeResults, verifyHeldoutReceipt, DATA_DEST, SINK_DEST } = require('../scripts/heldout');
const { readKey, readJson } = require('../../diagnostics/common');
function fixture(t, seed = 'heldout-regression-12') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heldout-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'keys')); fs.mkdirSync(path.join(root, 'public')); fs.mkdirSync(path.join(root, 'workspaces'));
  const publicDir = path.join(root, 'public/bundle'), keyFile = path.join(root, 'keys/key.json');
  const plan = prepare(seed, publicDir, keyFile), key = readKey(keyFile), workspaceRoot = path.join(root, 'workspaces');
  const records = key.tasks.map((task, i) => {
    const workspacePath = path.join(workspaceRoot, 'trial-' + i);
    fs.mkdirSync(path.join(workspacePath, DATA_DEST), { recursive: true }); fs.mkdirSync(path.join(workspacePath, SINK_DEST), { recursive: true });
    fs.copyFileSync(path.join(publicDir, 'data/dataset.json'), path.join(workspacePath, DATA_DEST, 'dataset.json'));
    for (const [name, rows] of Object.entries(task.expected)) if (rows.length) fs.writeFileSync(path.join(workspacePath, SINK_DEST, name + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    return { stimulus: task.id, taskHash: task.taskHash, specHash: key.specHash, workspacePath, runId: 'fixture-run-' + i, status: 'success', trajectory: { output: 'fixture synthetic actions written' }, provenance: { kind: 'fixture', observedModel: key.model, runtimeVersion: process.version, modelEvidenceRef: 'fixture-no-model-executed' } };
  });
  return { root, keyFile, publicDir, workspaceRoot, records, key, plan };
}
test('heldout spec reuses pinned Vally, stages generated data only without key, seed changes expected actions', t => {
  const a = fixture(t, 'alpha'), b = fixture(t, 'beta'), spec = readJson(path.join(a.publicDir, 'eval.json'));
  assert.notEqual(a.key.datasetHash, b.key.datasetHash); assert.notDeepEqual(a.key.tasks, b.key.tasks);
  assert.equal(a.plan.vallyVersion, '0.17.0'); assert.equal(a.plan.workers, 1); assert.equal(spec.defaults.executor, 'copilot-sdk');
  assert.deepEqual(spec.agent_environment.mcpServers, {});
  assert.ok(!JSON.stringify(spec).includes(a.keyFile)); assert.equal(fs.statSync(a.keyFile).mode & 0o077, 0);
  assert.equal(a.plan.evidenceTier, 'heldout-preparation-only');
});
test('fixture smoke writes actual sinks and replay verifies receipt without live proof', t => {
  const f = fixture(t), result = gradeResults(f.records, f.key, f.workspaceRoot);
  assert.equal(result.passed, true); assert.equal(result.evidenceTier, 'fixture-grader-validation');
  const recordsFile = path.join(f.root, 'records.json'); fs.writeFileSync(recordsFile, JSON.stringify(f.records));
  const verification = verifyHeldoutReceipt(result.rows[0], { recordsFile, keyFile: f.keyFile, workspaceRoot: f.workspaceRoot });
  assert.equal(verification.verified, true); assert.equal(verification.independentlyVerifiedExecution, false);
  const row = result.rows[0]; assert.ok(row.sourceArtifacts.some(a => a.role === 'sink')); assert.match(row.datasetHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyHeldoutReceipt({ ...row, reason: 'forged reason' }, { recordsFile, keyFile: f.keyFile, workspaceRoot: f.workspaceRoot }).verified, false);
});
test('fabricated output, wrong qty, duplicate/extra actions, missing model and wrong model do not pass', t => {
  const f = fixture(t), record = f.records[0], sink = path.join(record.workspacePath, SINK_DEST, 'purchase_orders.jsonl');
  const original = fs.readFileSync(sink, 'utf8'); fs.unlinkSync(sink);
  assert.equal(gradeHeldoutTrial(record, f.key, f.workspaceRoot).status, 'failed');
  fs.writeFileSync(sink, original + original);
  const failedReceipt = gradeHeldoutTrial(record, f.key, f.workspaceRoot); assert.equal(failedReceipt.passed, false);
  const failedRecordsFile = path.join(f.root, 'failed-records.json'); fs.writeFileSync(failedRecordsFile, JSON.stringify(f.records));
  assert.equal(verifyHeldoutReceipt(failedReceipt, { recordsFile: failedRecordsFile, keyFile: f.keyFile, workspaceRoot: f.workspaceRoot }).verified, true);
  fs.writeFileSync(sink, original); const bad = JSON.parse(original); bad.qty++; fs.writeFileSync(sink, JSON.stringify(bad)); assert.equal(gradeHeldoutTrial(record, f.key, f.workspaceRoot).passed, false);
  fs.writeFileSync(sink, original);
  assert.equal(gradeHeldoutTrial({ ...record, provenance: {} }, f.key, f.workspaceRoot).status, 'unknown');
  assert.equal(gradeHeldoutTrial({ ...record, provenance: { ...record.provenance, observedModel: 'other' } }, f.key, f.workspaceRoot).status, 'failed');
  assert.equal(gradeHeldoutTrial({ ...record, taskHash: undefined }, f.key, f.workspaceRoot).status, 'unknown');
  assert.equal(gradeResults([...f.records, record], f.key, f.workspaceRoot).complete, false);
  const missing = gradeResults(f.records.slice(1), f.key, f.workspaceRoot);
  assert.equal(missing.complete, false); assert.equal(missing.rows.at(-1).status, 'unknown');
});
test('malformed/escaped sinks and changed dataset or grader fail closed', t => {
  const f = fixture(t), record = f.records[0], sink = path.join(record.workspacePath, SINK_DEST, 'purchase_orders.jsonl');
  fs.writeFileSync(sink, 'invalid-json'); assert.equal(gradeHeldoutTrial(record, f.key, f.workspaceRoot).passed, false);
  fs.unlinkSync(sink); const outside = path.join(f.root, 'outside.jsonl'); fs.writeFileSync(outside, '{}'); fs.symlinkSync(outside, sink);
  assert.match(gradeHeldoutTrial(record, f.key, f.workspaceRoot).reason, /invalid|escaping/);
  fs.unlinkSync(sink); fs.writeFileSync(path.join(record.workspacePath, DATA_DEST, 'dataset.json'), '{}');
  assert.match(gradeHeldoutTrial(record, f.key, f.workspaceRoot).reason, /dataset hash/);
  assert.throws(() => gradeHeldoutTrial(record, { ...f.key, graderHash: 'bad' }, f.workspaceRoot), /grader hash/);
});
test('malformed or unknown actual model provenance cannot qualify otherwise correct sinks', t => {
  const f = fixture(t), record = f.records[0];
  for (const field of ['runtimeVersion', 'observedModel', 'modelEvidenceRef']) {
    for (const value of [{}, true, ' ', '', 'unknown', 'partial', 'unavailable', 'UNKNOWN:model', 'x'.repeat(201)]) {
      const receipt = gradeHeldoutTrial({ ...record, provenance: { ...record.provenance, kind: 'observed-vally', [field]: value } }, f.key, f.workspaceRoot);
      assert.equal(receipt.status, 'unknown', `${field}: ${JSON.stringify(value)}`);
      assert.equal(receipt.passed, false);
    }
  }
});
