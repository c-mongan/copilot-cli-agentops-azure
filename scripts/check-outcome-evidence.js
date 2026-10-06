#!/usr/bin/env node
// Local fixture qualification only. This script never invokes a model or Azure.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildProductEvidenceBundle, receiptHash, loadEvidenceSchemas, replaySchemaProjection, writeProductEvidenceBundle } = require('../agentops-cli/src/lib/product-evidence-bundle');
const { projectSessionEvents } = require('../agentops-cli/src/lib/copilot/session-event-export');
const { prepare, gradeHeldoutTrial, verifyHeldoutReceipt, DATA_DEST, SINK_DEST } = require('../evals/stockpilot/scripts/heldout');

const OUTCOME_KQL = 'AgentOpsRunSummary_CL\n| project RunId, OutcomeStatus, InputTokens, OutputTokens, EstimatedCostUsdReal';
// A deliberately limited local replay for a table/project KQL contract. Azure
// parsing, ingestion and rendered dashboard execution require separate proof.
function replayEvidenceKqlContract(bundle, query = OUTCOME_KQL) {
  const match = /^(AgentOps\w+_CL)\s*\|\s*project\s+(\w+(?:\s*,\s*\w+)*)$/.exec(query);
  if (!match) throw new Error('Local evidence KQL replay supports only table | project named columns');
  const schemas = loadEvidenceSchemas();
  const schema = schemas[match[1]];
  const columns = match[2].split(',').map(column => column.trim());
  if (!schema || columns.some(column => !schema.columns.some(field => field.name === column))) throw new Error('KQL contract references undeployed columns');
  return (bundle.tables[match[1]] || []).map(row => {
    const projected = replaySchemaProjection(match[1], row, schemas);
    return Object.fromEntries(columns.map(column => [column, projected[column] ?? null]));
  });
}
function qualifyOutcomeEvidence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-outcome-qualification-'));
  try {
    const publicDir = path.join(directory, 'public');
    fs.mkdirSync(path.join(directory, 'private'), { mode: 0o700 });
    const keyFile = path.join(directory, 'private/protected-key.json');
    prepare('outcome-contract-20261002', publicDir, keyFile);
    const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const workspaceRoot = path.join(directory, 'synthetic-workspaces');
    const workspace = path.join(workspaceRoot, 'trial');
    fs.mkdirSync(path.join(workspace, DATA_DEST), { recursive: true });
    fs.mkdirSync(path.join(workspace, SINK_DEST), { recursive: true });
    fs.copyFileSync(path.join(publicDir, 'data/dataset.json'), path.join(workspace, DATA_DEST, 'dataset.json'));
    for (const [name, rows] of Object.entries(key.tasks[0].expected)) fs.writeFileSync(path.join(workspace, SINK_DEST, `${name}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
    const native = [
      { type: 'session.start', timestamp: '2026-10-02T10:00:00Z', data: { prompt: 'SECRET_FAKE_TEST_VALUE' } },
      { type: 'tool.execution_start', timestamp: '2026-10-02T10:00:01Z', data: { toolCallId: 'call-fixture', toolName: 'bash', arguments: { command: 'node --api_key=SECRET_FAKE_TEST_VALUE' } } },
      { type: 'tool.execution_complete', timestamp: '2026-10-02T10:00:02Z', data: { toolCallId: 'call-fixture', toolName: 'bash', success: true, output: 'this should never leave local machine' } }
    ];
    const events = projectSessionEvents(native, { runId: 'run-fixture', sessionId: 'session-fixture', referencePaths: new Set() });
    assert.equal(events.length, 3);
    const record = { runId: 'run-fixture', stimulus: key.tasks[0].id, workspacePath: workspace, specHash: key.specHash, taskHash: key.tasks[0].taskHash, status: 'success', sourceEventRefs: [events[2].EventId], provenance: { kind: 'fixture', runtimeVersion: 'fixture-only', observedModel: key.model, modelEvidenceRef: 'fixture-model-assertion' } };
    const receipt = gradeHeldoutTrial(record, key, workspaceRoot);
    assert.equal(receipt.passed, true, receipt.reason);
    const recordsFile = path.join(directory, 'records.json');
    fs.writeFileSync(recordsFile, JSON.stringify([record]));
    const verifier = value => {
      const replay = verifyHeldoutReceipt(value, { keyFile, recordsFile, workspaceRoot });
      return { ...replay, receiptSha256: receiptHash(value), passed: replay.replay.passed };
    };
    const run = { runId: record.runId, sessionId: 'session-fixture', taskId: record.stimulus, events, evidenceComplete: false };
    const architectureRows = [{ TimeGenerated: events[2].TimeGenerated, InsightId: 'fixture-insight', InsightType: 'architecture-tool-repetition', Severity: 'low', RunId: run.runId, SuggestedNextStep: 'Review the recorded tool sequence', Evidence: { evidenceIds: [events[2].EventId] } }];
    const options = { runs: [run], evaluations: [receipt], evaluationVerifier: verifier, architectureRows };
    const bundle = buildProductEvidenceBundle(options);
    assert.equal(bundle.tables.AgentOpsRunSummary_CL[0].OutcomeStatus, 'success');
    assert.equal(bundle.manifest.evaluationReceipts[0].evidenceTier, 'fixture-synthetic-sink-grade');
    assert.equal(bundle.manifest.evaluationReceipts[0].independentlyVerifiedExecution, false);
    assert.equal(bundle.manifest.delivered, null);
    assert.equal(bundle.tables.AgentOpsCollectorHealth_CL.length, 0);
    const files = writeProductEvidenceBundle(bundle, path.join(directory, 'qualified'));
    for (const stream of bundle.manifest.streams) {
      const replay = fs.readFileSync(files.files[stream.table], 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.deepEqual(replay, bundle.tables[stream.table]);
      for (const row of replay) assert.deepEqual(replaySchemaProjection(stream.table, row, loadEvidenceSchemas()), row);
    }
    const selected = replayEvidenceKqlContract(bundle);
    assert.equal(selected[0].OutcomeStatus, 'success');
    assert.equal(selected[0].InputTokens, null);
    assert.equal(selected[0].EstimatedCostUsdReal, null);
    assert.equal(buildProductEvidenceBundle({ runs: [run] }).tables.AgentOpsRunSummary_CL[0].OutcomeStatus, null);
    assert.equal(buildProductEvidenceBundle({ runs: [run], evaluations: [receipt] }).tables.AgentOpsRunSummary_CL[0].OutcomeStatus, null);
    assert.equal(buildProductEvidenceBundle({ ...options, runs: [{ ...run, events: [...events, events[0]] }] }).tables.AgentOpsEvents_CL.length, events.length);
    assert.equal(bundle.tables.AgentOpsEvents_CL.some(row => row.ScriptName), false);
    assert.equal(JSON.stringify(bundle).includes('SECRET_FAKE_TEST_VALUE'), false);
    fs.writeFileSync(path.join(workspace, SINK_DEST, 'purchase_orders.jsonl'), '');
    const failedReceipt = gradeHeldoutTrial(record, key, workspaceRoot);
    assert.equal(failedReceipt.status, 'failed');
    const rejected = buildProductEvidenceBundle({ ...options, evaluations: [failedReceipt] });
    assert.equal(rejected.tables.AgentOpsRunSummary_CL[0].OutcomeStatus, 'failed');
    assert.throws(() => buildProductEvidenceBundle({ runs: [{ ...run, events: [{ ...events[0], EventName: 'SECRET_FAKE_TEST_VALUE' }] }] }), /privacy scan/);
    assert.throws(() => buildProductEvidenceBundle({ runs: [{ ...run, events: [...events, { ...events[0], EventName: 'changed' }] }] }), /Conflicting duplicate/);
    assert.throws(() => replayEvidenceKqlContract(bundle, 'AgentOpsEval_CL | project IndependentQuality'), /undeployed/);
    return { ok: true, evidenceTier: 'local-synthetic-producer-to-ledger-qualification', proof: ['existing native event producer', 'actual isolated synthetic sink grader replay', 'metadata-only typed JSONL readback', 'maintained 12-table schema contracts', 'exact outcome stream projections', 'bounded table/project KQL contract replay', 'unknown outcome and cost preservation', 'failed grade, duplicate delivery and poison rejection'], kqlContract: OUTCOME_KQL, cloudIngestionVerified: false, dashboardVerified: false, liveModelExecutionVerified: false };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(qualifyOutcomeEvidence(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { OUTCOME_KQL, qualifyOutcomeEvidence, replayEvidenceKqlContract };
