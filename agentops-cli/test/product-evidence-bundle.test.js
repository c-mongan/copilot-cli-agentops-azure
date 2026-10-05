const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LIMITS, buildProductEvidenceBundle, loadEvidenceSchemas, productEvidenceFromLedger, projectTypedRow, receiptHash, replaySchemaProjection, writeProductEvidenceBundle } = require('../src/lib/product-evidence-bundle');
const { qualifyOutcomeEvidence, replayEvidenceKqlContract } = require('../../scripts/check-outcome-evidence');
function run(overrides = {}) {
  return { runId: 'run-one', sessionId: 'session-one', taskId: 'task-one', evidenceComplete: false,
    events: [{ TimeGenerated: '2026-10-02T10:00:00Z', EventId: 'event-one', EventName: 'tool.execution_complete', Sequence: 1, RunId: 'run-one', SessionId: 'session-one', Status: 'completed', ScriptName: null }], ...overrides };
}
function receipt(overrides = {}) { return { runId: 'run-one', taskId: 'task-one', taskHash: 'a'.repeat(64), datasetHash: 'b'.repeat(64), graderHash: 'c'.repeat(64), sourceEventRefs: ['event-one'], status: 'success', passed: true, ...overrides }; }
function verified(value) { return { verified: true, receiptSha256: receiptHash(value), passed: value.passed, status: value.status, evidenceTier: 'fixture-synthetic-sink-grade' }; }

test('existing producers and actual synthetic sink grades qualify without external calls', () => {
  const report = qualifyOutcomeEvidence();
  assert.equal(report.ok, true);
  assert.equal(report.cloudIngestionVerified, false);
  assert.equal(report.liveModelExecutionVerified, false);
});
test('missing and asserted outcomes, usage and health remain unknown', () => {
  for (const evaluations of [[], [receipt()]]) {
    const bundle = buildProductEvidenceBundle({ runs: [run()], evaluations });
    const row = bundle.tables.AgentOpsRunSummary_CL[0];
    for (const field of ['OutcomeStatus', 'OutcomeReason', 'InputTokens', 'OutputTokens', 'EstimatedCostUsdReal', 'ModelActual', 'TestsRan', 'TestsPassed', 'PrOpened', 'CiStatus', 'ToolFailureCount']) assert.equal(row[field], null);
    assert.deepEqual(bundle.tables.AgentOpsEval_CL, []);
    assert.deepEqual(bundle.tables.AgentOpsCollectorHealth_CL, []);
    assert.equal(bundle.manifest.delivered, null);
  }
});
test('verified failed grades qualify separately from success and task/process completion', () => {
  const failed = receipt({ status: 'failed', passed: false });
  const bundle = buildProductEvidenceBundle({ runs: [run()], evaluations: [failed], evaluationVerifier: verified });
  assert.equal(bundle.tables.AgentOpsRunSummary_CL[0].OutcomeStatus, 'failed');
  assert.equal(bundle.tables.AgentOpsEval_CL[0].EvalOverall, null);
  assert.equal(bundle.tables.AgentOpsEval_CL[0].EvalBucket, null);
  assert.equal(bundle.manifest.evaluationReceipts[0].independentlyVerifiedExecution, false);
});
test('evaluation joins require task identity, hash binding and consistent grade result', () => {
  const wrongTask = receipt({ taskId: 'different-task' });
  assert.equal(buildProductEvidenceBundle({ runs: [run()], evaluations: [wrongTask], evaluationVerifier: verified }).tables.AgentOpsRunSummary_CL[0].OutcomeStatus, null);
  for (const evaluationVerifier of [() => ({ ...verified(receipt()), receiptSha256: '0'.repeat(64) }), () => ({ ...verified(receipt()), passed: false })]) {
    assert.equal(buildProductEvidenceBundle({ runs: [run()], evaluations: [receipt()], evaluationVerifier }).tables.AgentOpsRunSummary_CL[0].OutcomeStatus, null);
  }
  assert.throws(() => buildProductEvidenceBundle({ runs: [run()], evaluations: [receipt(), receipt()] }), /unique matching run/);
  const dangling = buildProductEvidenceBundle({ runs: [run()], evaluations: [receipt({ sourceEventRefs: ['missing'] })], evaluationVerifier: verified });
  assert.equal(dangling.manifest.evaluationReceipts[0].sourceEventRefs, null);
  assert.ok(dangling.manifest.evidenceLimits.some(limit => limit.code === 'evaluation_has_no_joined_event_refs'));
});
test('dedupe rejects conflicting IDs and mismatched run/session identities', () => {
  const source = run();
  assert.equal(buildProductEvidenceBundle({ runs: [{ ...source, events: [...source.events, source.events[0]] }] }).tables.AgentOpsEvents_CL.length, 1);
  assert.throws(() => buildProductEvidenceBundle({ runs: [source, source] }), /Duplicate evidence run/);
  for (const event of [{ ...source.events[0], RunId: 'other' }, { ...source.events[0], SessionId: 'other' }, { ...source.events[0], EventId: '' }]) assert.throws(() => buildProductEvidenceBundle({ runs: [run({ events: [event] })] }));
  assert.throws(() => buildProductEvidenceBundle({ runs: [run({ events: [...source.events, { ...source.events[0], Status: 'failed' }] })] }), /Conflicting duplicate/);
});
test('exact schema validation preserves additive real cost and nullable integers', () => {
  const schemas = loadEvidenceSchemas();
  assert.equal(Object.keys(schemas).length, 12);
  const row = projectTypedRow('AgentOpsRunSummary_CL', { InputTokens: null, EstimatedCostUsd: null, EstimatedCostUsdReal: 0.125, SourceCode: 'ignored' }, schemas);
  assert.deepEqual(row, { InputTokens: null, EstimatedCostUsd: null, EstimatedCostUsdReal: 0.125 });
  for (const field of [{ InputTokens: 0.5 }, { EstimatedCostUsd: 0.125 }, { TestsPassed: 'false' }, { TimeGenerated: 'yesterday' }, { InputTokens: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => projectTypedRow('AgentOpsRunSummary_CL', field, schemas), /must match Azure/);
  assert.throws(() => replaySchemaProjection('AgentOpsRunSummary_CL', { NonexistentField: 0 }, schemas), /absent from its deployed schema/);
  const projected = replaySchemaProjection('AgentOpsSpans_CL', { ScriptRuntimeName: null, InputTokens: null }, schemas);
  assert.equal(projected.ScriptRuntimeName, '');
  assert.equal(projected.InputTokens, null);
});
test('poison metadata is rejected, raw source payload excluded and dynamic content fields rejected', () => {
  const source = run();
  assert.equal(JSON.stringify(buildProductEvidenceBundle({ runs: [run({ events: [{ ...source.events[0], Prompt: 'SECRET_FAKE_TEST_VALUE', arguments: { key: 'api_key=bad' } }] })] })).includes('SECRET_FAKE_TEST_VALUE'), false);
  assert.throws(() => buildProductEvidenceBundle({ runs: [run({ summary: { AgentName: 'SECRET_FAKE_TEST_VALUE' } })] }), /privacy scan/);
  const insight = { TimeGenerated: source.events[0].TimeGenerated, RunId: source.runId, InsightId: 'finding', InsightType: 'architecture-fixture', SuggestedNextStep: 'Review sequence', Severity: 'low', ComponentRefs: [{ SourceCode: 'private code' }], Evidence: { evidenceIds: ['event-one'] } };
  assert.throws(() => buildProductEvidenceBundle({ runs: [source], architectureRows: [insight] }), /raw content field/);
});
test('recommendations remain proposals linked to observed events and evidence limits', () => {
  const insight = { TimeGenerated: '2026-10-02T10:00:00Z', RunId: 'run-one', InsightId: 'finding', InsightType: 'architecture-fixture', SuggestedNextStep: 'Review sequence', Severity: 'low', Evidence: { evidenceIds: ['event-one'] } };
  const bundle = buildProductEvidenceBundle({ runs: [run()], architectureRows: [insight, { ...insight, Evidence: { evidenceIds: ['missing'] } }] });
  assert.equal(bundle.tables.AgentOpsInsights_CL.length, 1);
  assert.equal(bundle.tables.AgentOpsRecommendations_CL.length, 1);
  const proposal = bundle.tables.AgentOpsRecommendations_CL[0];
  assert.equal(proposal.Action, 'propose-review');
  assert.equal(proposal.Validation[0].status, 'proposal-only');
  assert.deepEqual(proposal.Validation[0].sourceEventRefs, ['event-one']);
  assert.deepEqual(proposal.ObservedMetricMovement, {});
  assert.equal(buildProductEvidenceBundle({ runs: [run()], architectureRows: [insight, insight] }).tables.AgentOpsInsights_CL.length, 1);
  assert.throws(() => buildProductEvidenceBundle({ runs: [run()], architectureRows: [insight, { ...insight, SuggestedNextStep: 'Different proposal' }] }), /Conflicting duplicate insight/);
});
test('bounded inputs and absent timestamps cannot generate misleading rows', () => {
  assert.throws(() => buildProductEvidenceBundle({ runs: [run({ events: [] })] }), /valid recorded timestamp/);
  assert.throws(() => buildProductEvidenceBundle({ runs: [run({ events: Array(LIMITS.events + 1).fill(run().events[0]) })] }), /count exceeds bound/);
  assert.throws(() => buildProductEvidenceBundle({ runs: [run({ summary: { AgentName: 'x'.repeat(2049) } })] }), /metadata bound/);
  assert.throws(() => buildProductEvidenceBundle({ runs: [run()], healthRows: [{ Component: 'collector', Status: 'ok' }] }), /requires timestamp/);
});
test('single-run recommendations cannot cite another runs events', () => {
  const second = run({ runId: 'run-two', sessionId: 'session-two', events: [{ ...run().events[0], RunId: 'run-two', SessionId: 'session-two', EventId: 'event-two' }] });
  const finding = { TimeGenerated: '2026-10-02T10:00:00Z', RunId: 'run-one', InsightId: 'finding', InsightType: 'architecture-fixture', SuggestedNextStep: 'Review sequence', Severity: 'low', Evidence: { evidenceIds: ['event-two'] } };
  const bundle = buildProductEvidenceBundle({ runs: [run(), second], architectureRows: [finding] });
  assert.equal(bundle.tables.AgentOpsInsights_CL.length, 0);
  assert.equal(bundle.tables.AgentOpsRecommendations_CL.length, 0);
  assert.ok(bundle.manifest.evidenceLimits.some(limit => limit.code === 'architecture_finding_without_joined_evidence'));
});
test('forged exhaustive context labels cannot remove capture limits for modern or legacy ledgers', () => {
  const complete = { evidenceComplete: true, coverage: Object.fromEntries(['agents', 'skills', 'references', 'scripts', 'tools', 'models'].map(component => [component, 'complete'])) };
  for (const source of [run(complete), run({ ...complete, evidenceOrigin: 'recorded-run', preRunSnapshot: { status: 'unavailable' }, sourceIntegrity: { status: 'invalid' } })]) {
    const bundle = buildProductEvidenceBundle({ runs: [source] });
    const limit = bundle.manifest.evidenceLimits.find(item => item.code === 'capture_partial_or_unknown');
    assert.equal(limit.runId, source.runId);
    assert.equal(limit.exhaustiveCaptureVerified, false);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-forged-context-'));
  try {
    const runDir = path.join(temp, 'run-one');
    fs.mkdirSync(runDir);
    // Actual recorder filenames establish origin even if context claims to be
    // a legacy fixture and strips the modern integrity/snapshot signals.
    fs.writeFileSync(path.join(runDir, 'run-context.json'), JSON.stringify({ runId: 'run-one', sessionId: 'session-one', evidenceOrigin: 'legacy-fixture', ...complete }));
    fs.writeFileSync(path.join(runDir, 'AgentOpsEvents_CL.jsonl'), JSON.stringify(run().events[0]) + '\n');
    const bundle = productEvidenceFromLedger({ ledgerDir: temp });
    const limit = bundle.manifest.evidenceLimits.find(item => item.code === 'capture_partial_or_unknown');
    assert.equal(limit.source, 'recorded-run');
    assert.equal(limit.exhaustiveCaptureVerified, false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('target preview, JSONL hashes, permissions and deterministic rerun are preserved', () => {
  const target = { endpoint: 'https://fixture.ingest.monitor.azure.com', dcrImmutableId: 'dcr-fixture', workspaceId: 'fixture-workspace' };
  const bundle = buildProductEvidenceBundle({ runs: [run()], target });
  assert.deepEqual(bundle, buildProductEvidenceBundle({ runs: [run()], target }));
  assert.equal(bundle.manifest.targetBound, true);
  assert.ok(bundle.manifest.streams.every(stream => stream.uri.includes('dcr-fixture') && stream.accepted === null));
  assert.throws(() => buildProductEvidenceBundle({ runs: [run()], target: { endpoint: 'https://user:password@example.com' } }), /Azure Logs Ingestion/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-test-'));
  try {
    const written = writeProductEvidenceBundle(bundle, path.join(temp, 'new'));
    if (process.platform !== "win32") assert.equal(fs.statSync(written.directory).mode & 0o777, 0o700);
    if (process.platform !== "win32") assert.equal(fs.statSync(written.manifestFile).mode & 0o777, 0o600);
    assert.throws(() => writeProductEvidenceBundle(bundle, written.directory), /must be new/);
    bundle.tables.AgentOpsRunSummary_CL[0].InputTokens = 42;
    assert.throws(() => writeProductEvidenceBundle(bundle, path.join(temp, 'mutated')), /changed after qualification/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('real recorder directory layout loads bounded regular files and malformed input fails closed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-ledger-test-'));
  try {
    const runDir = path.join(temp, 'run-one');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'run-context.json'), JSON.stringify({ runId: 'run-one', sessionId: 'session-one', evidenceComplete: false }));
    fs.writeFileSync(path.join(runDir, 'AgentOpsEvents_CL.jsonl'), JSON.stringify(run().events[0]) + '\n');
    const bundle = productEvidenceFromLedger({ ledgerDir: temp });
    assert.equal(bundle.tables.AgentOpsRunSummary_CL[0].RunId, 'run-one');
    assert.equal(replayEvidenceKqlContract(bundle)[0].OutcomeStatus, null);
    fs.appendFileSync(path.join(runDir, 'AgentOpsEvents_CL.jsonl'), 'bad json\n');
    assert.throws(() => productEvidenceFromLedger({ ledgerDir: temp }), /JSON/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
