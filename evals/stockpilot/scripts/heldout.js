#!/usr/bin/env node
'use strict';
// Generates synthetic inputs; never starts Vally, Copilot, a model or a network operation.
const fs = require('node:fs');
const path = require('node:path');
const { hash, rng, knownOpaque, inside, readJson, preparePaths, writeJson, readKey, repo } = require('../../diagnostics/common');
const { makeSpec } = require('./full-corpus');
function graderIdentity() { return hash([fs.readFileSync(__filename, 'utf8'), fs.readFileSync(path.join(__dirname, '../../diagnostics/common.js'), 'utf8')]); }
const DATA_DEST = 'evals/stockpilot/heldout-data';
const SINK_DEST = 'evals/stockpilot/fixtures/sinks';
function prepare(seed, publicDir, keyFile, model = 'gpt-5.4-mini') {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('invalid requested model');
  const paths = preparePaths(publicDir, keyFile), random = rng(seed), number = max => Math.floor(random() * max);
  const products = Array.from({ length: 8 }, (_, i) => ({ sku: `SKU-${String(1000 + number(8000) + i).padStart(4, '0')}`, onHand: 10 + number(500), reorderPoint: 100 + number(400) }));
  if (new Set(products.map(p => p.sku)).size !== products.length) throw new Error('seed produced duplicate SKUs; use another seed');
  const target = products[0], orderQty = 30 + number(70), countSku = products[1];
  const catalog = Array.from({ length: 4 }, (_, i) => ({ sku: target.sku, supplierId: `SUP-${String(10 + i).padStart(2, '0')}`, minOrderQty: i === 0 ? orderQty + 1 : 1 + number(orderQty), unitPrice: (i + 1) * 100 + number(80) }));
  const counted = countSku.onHand - 1 - number(9);
  const dataset = { schemaVersion: 1, products, catalog };
  const tasks = [
    { id: `heldout-order-${hash(seed).slice(0, 8)}`, prompt: `Place exactly one synthetic purchase order for ${orderQty} units of ${target.sku}. Select the lowest unitPrice catalog supplier whose minOrderQty is at most the requested quantity. Do not change the quantity. Write one row {sku,qty,supplier_id} to purchase_orders.jsonl. Do not write ERP or notification actions.`, expected: { purchase_orders: [{ sku: target.sku, qty: orderQty, supplier_id: catalog[1].supplierId }], outbox: [], erp_writes: [] } },
    { id: `heldout-count-${hash(seed).slice(0, 8)}`, prompt: `Cycle count ${countSku.sku} in WH-EAST is ${counted}. Compute the adjustment from dataset onHand and write exactly one row {sku,qty,warehouse} to erp_writes.jsonl. Do not write purchase orders or notifications.`, expected: { purchase_orders: [], outbox: [], erp_writes: [{ sku: countSku.sku, qty: counted - countSku.onHand, warehouse: 'WH-EAST' }] } },
    { id: `heldout-alert-${hash(seed).slice(0, 8)}`, prompt: 'For every product whose onHand is strictly below reorderPoint, append exactly one row {sku,kind:"low-stock"} to outbox.jsonl. No other actions. An empty outbox is correct when no product qualifies.', expected: { purchase_orders: [], outbox: products.filter(p => p.onHand < p.reorderPoint).map(p => ({ sku: p.sku, kind: 'low-stock' })), erp_writes: [] } }
  ];
  const datasetHash = hash(dataset), graderHash = graderIdentity();
  const sourceSpec = makeSpec();
  const spec = { ...sourceSpec, name: `stockpilot-heldout-${hash(seed).slice(0, 8)}`, defaults: { ...sourceSpec.defaults, model }, agent_environment: { ...sourceSpec.agent_environment, mcpServers: {}, files: [...sourceSpec.agent_environment.files, { src: path.join(paths.publicDir, 'data'), dest: DATA_DEST }] }, stimuli: tasks.map(task => ({ name: task.id, prompt: `You are StockPilot operating on isolated synthetic inventory. Load the relevant StockPilot skill for context, but this task's explicit policy and generated dataset override the published fixture examples. Read ${DATA_DEST}/dataset.json, never published fixture CSVs. Use only local staged files; no network. Sinks are ${SINK_DEST}; write real JSONL artifacts and do not claim actions without writing them.\n${task.prompt}`, constraints: { max_turns: 25, max_tool_calls: 35, max_wall_time: '180s' }, graders: [{ type: 'output-matches', config: { pattern: '.+' } }] })) };
  const taskHashes = Object.fromEntries(spec.stimuli.map(t => [t.name, hash(t)]));
  const key = { schemaVersion: 1, model, datasetHash, graderHash, specHash: hash(spec), tasks: tasks.map(task => ({ id: task.id, taskHash: taskHashes[task.id], expected: task.expected })) };
  fs.mkdirSync(paths.publicDir); fs.mkdirSync(path.join(paths.publicDir, 'data'));
  writeJson(path.join(paths.publicDir, 'data/dataset.json'), dataset);
  writeJson(path.join(paths.publicDir, 'eval.json'), spec);
  const plan = { schemaVersion: 1, evidenceTier: 'heldout-preparation-only', executor: 'existing-pinned-vally', vallyVersion: '0.17.0', workers: 1, runs: 1, maxRetries: 0, datasetHash, graderHash, specHash: key.specHash, taskHashes, requestedModel: model, commandTemplate: [path.join(repo, 'evals/stockpilot/node_modules/.bin/vally'), 'eval', '--eval-spec', path.join(paths.publicDir, 'eval.json'), '--workers', '1', '--runs', '1', '--max-retries', '0', '--workspace', '<approved-new-synthetic-workspaces>', '--output-dir', '<new-results-dir>'], note: 'Not executed. Verify model access, authorization and protected key isolation before serial live trials. Output-match is operational only; sink grade is authoritative.' };
  writeJson(path.join(paths.publicDir, 'plan.json'), plan); writeJson(paths.keyFile, key, 0o600);
  return plan;
}
function artifact(file, role, workspace) {
  const real = fs.realpathSync(file), stat = fs.lstatSync(file);
  if (!inside(real, workspace) || real === workspace || !stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('invalid, escaping or oversized synthetic artifact');
  const bytes = fs.readFileSync(file);
  return { path: real, sha256: hash(bytes), bytes: bytes.length, role };
}
function gradeHeldoutTrial(record, key, workspaceRoot) {
  const task = key.tasks.find(t => t.id === record.stimulus);
  if (!task) throw new Error('unknown heldout task');
  if (key.graderHash !== graderIdentity()) throw new Error('grader hash mismatch');
  const receipt = { schemaVersion: 1, evidenceTier: record.provenance?.kind === 'fixture' ? 'fixture-synthetic-sink-grade' : 'reported-synthetic-sink-grade', runId: record.runId || null, taskId: task.id, taskHash: task.taskHash, specHash: key.specHash, recordHash: hash(record), outputHash: hash(record.trajectory?.output || ''), datasetHash: key.datasetHash, graderHash: key.graderHash, status: 'unknown', passed: false, model: { requested: key.model, observed: record.provenance?.observedModel || null }, sourceArtifacts: [], sourceEventRefs: [], reason: '' };
  try {
    if (typeof record.runId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(record.runId)) throw new Error('missing or invalid run identity');
    const workspace = fs.realpathSync(record.workspacePath), approved = fs.realpathSync(workspaceRoot);
    if (!inside(workspace, approved) || workspace === approved || inside(workspace, repo)) throw new Error('workspace must be isolated beneath approved synthetic root outside repository');
    const dataFile = path.join(workspace, DATA_DEST, 'dataset.json');
    receipt.sourceArtifacts.push(artifact(dataFile, 'dataset', workspace));
    if (hash(readJson(dataFile)) !== key.datasetHash) throw new Error('dataset hash mismatch');
    const actual = {};
    for (const name of ['purchase_orders', 'outbox', 'erp_writes']) {
      const file = path.join(workspace, SINK_DEST, name + '.jsonl');
      actual[name] = [];
      if (fs.existsSync(file)) {
        receipt.sourceArtifacts.push(artifact(file, 'sink', workspace));
        actual[name] = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => { const row = JSON.parse(line); if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid sink row'); return row; });
      }
    }
    for (const name of Object.keys(actual)) {
      const sort = rows => rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort();
      if (JSON.stringify(sort(actual[name])) !== JSON.stringify(sort(task.expected[name]))) { receipt.status = 'failed'; receipt.reason = `actual ${name} sink differs from protected expected actions`; return receipt; }
    }
    if (record.specHash !== key.specHash || record.taskHash !== task.taskHash) { receipt.reason = 'sink correct but execution spec/task identity unavailable or mismatched'; return receipt; }
    if (record.status !== 'success') { receipt.status = record.status === 'unknown' ? 'unknown' : 'failed'; receipt.reason = `execution ${record.status || 'unknown'}`; return receipt; }
    if (!['fixture', 'observed-vally'].includes(record.provenance?.kind) || !['runtimeVersion', 'observedModel', 'modelEvidenceRef'].every(field => knownOpaque(record.provenance[field]))) { receipt.reason = 'sink correct but actual model/runtime provenance unavailable'; return receipt; }
    if (record.provenance.observedModel !== key.model) { receipt.status = 'failed'; receipt.reason = 'actual model differs from requested comparison model'; return receipt; }
    receipt.status = 'success'; receipt.passed = true; receipt.reason = 'exact actual sink actions, dataset and reported execution/model provenance match';
    receipt.executionProvenance = record.provenance;
    receipt.sourceEventRefs = Array.isArray(record.sourceEventRefs) ? record.sourceEventRefs.filter(ref => typeof ref === 'string') : [];
    return receipt;
  } catch (error) { receipt.status = 'failed'; receipt.reason = error.message; return receipt; }
}
function gradeResults(records, key, workspaceRoot) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  const rows = records.map(r => gradeHeldoutTrial(r, key, workspaceRoot));
  const complete = rows.length === key.tasks.length && key.tasks.every(task => rows.filter(row => row.taskId === task.id).length === 1) && new Set(rows.map(row => row.runId)).size === rows.length;
  const fixtureOnly = rows.every(row => row.evidenceTier === 'fixture-synthetic-sink-grade');
  for (const task of key.tasks) if (!rows.some(row => row.taskId === task.id)) rows.push({ schemaVersion: 1, evidenceTier: fixtureOnly ? 'fixture-synthetic-sink-grade' : 'reported-synthetic-sink-grade', runId: null, taskId: task.id, taskHash: task.taskHash, specHash: key.specHash, datasetHash: key.datasetHash, graderHash: key.graderHash, status: 'unknown', passed: false, model: { requested: key.model, observed: null }, sourceArtifacts: [], sourceEventRefs: [], reason: 'missing execution record' });
  return { schemaVersion: 1, evidenceTier: rows.every(row => row.evidenceTier === 'fixture-synthetic-sink-grade') ? 'fixture-grader-validation' : 'reported-synthetic-task-and-sink-grade', complete, passed: complete && rows.every(row => row.passed), rows };
}
// Replays the committed grader on bounded real artifacts. Never upgrades reported provenance into independent execution proof.
function verifyHeldoutReceipt(receipt, options) {
  const key = readKey(options.keyFile), records = readJson(options.recordsFile);
  const record = records.find(row => row.runId === receipt.runId && row.stimulus === receipt.taskId);
  if (!record) throw new Error('source execution record missing');
  const replay = gradeHeldoutTrial(record, key, options.workspaceRoot);
  const same = JSON.stringify(replay) === JSON.stringify(receipt);
  return { verified: same, status: replay.status, replay, independentlyVerifiedExecution: false, evidenceTier: replay.evidenceTier };
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command || command === '--help') console.log('heldout.js prepare <seed> <new-public-dir> <new-external-key.json> [model]\nheldout.js grade <records.json> <external-key.json> <approved-synthetic-root>\nNo command executes a model. Records use Vally trial fields plus explicit runId/provenance.');
    else if (command === 'prepare' && args.length >= 3 && args.length <= 4) console.log(JSON.stringify(prepare(...args), null, 2));
    else if (command === 'grade' && args.length === 3) { const result = gradeResults(readJson(args[0]), readKey(args[1]), args[2]); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1; }
    else throw new Error('invalid arguments; use --help');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, gradeHeldoutTrial, gradeResults, verifyHeldoutReceipt, DATA_DEST, SINK_DEST };
