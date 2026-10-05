const test = require('node:test');
const assert = require('node:assert/strict');
const { observedLaunchExecutionConfiguration, reconcileModelProvenance } = require('../src/lib/copilot/execution-configuration');
const { renderSessionWaterfall } = require('../src/lib/copilot/session-waterfall');

const launchExecutionConfiguration = observedLaunchExecutionConfiguration(['--model', 'mini', '--prompt', 'private prompt', '--secret-env-vars', 'SECRET']);
test('launcher override discrepancy preserves producer and response identities', () => {
  const result = reconcileModelProvenance({ launchExecutionConfiguration,
    events: [{ type: 'session.start', data: { requestedModel: 'cloud5.5', currentModel: 'cloud5.5' } }],
    nativeSpans: [{ modelRequested: 'cloud5.5', modelActual: 'cloud5.5' }] });
  assert.equal(result.launchRequestedModel, 'mini');
  assert.deepEqual(result.producerRequestedModels, ['cloud5.5']);
  assert.deepEqual(result.actualModels, ['cloud5.5']);
  assert.equal(result.status, 'conflict');
  assert.equal(result.overrideCertified, false);
  assert.doesNotMatch(JSON.stringify(result), /private prompt|SECRET/);
});
test('mixed usage aggregates response identities, excludes script spans and never infers actual from display model', () => {
  const result = reconcileModelProvenance({ launchExecutionConfiguration, nativeSpans: [
    { modelRequested: 'mini', modelActual: 'mini' },
    { modelRequested: 'cloud5.5', modelActual: 'cloud5.5' },
    { modelActual: 'script-model', match: 'run-linked-script' },
    { model: 'display-fallback' }
  ] });
  assert.deepEqual(result.actualModels, ['cloud5.5', 'mini']);
  assert.equal(result.mixedActualModels, true);
  assert.equal(result.status, 'conflict');
});
test('session model declarations alone cannot prove actual usage', () => {
  const result = reconcileModelProvenance({ launchExecutionConfiguration,
    events: [{ type: 'session.model_change', data: { newModel: 'mini' } }],
    nativeSpans: [{ modelRequested: 'mini', model: 'mini' }] });
  assert.deepEqual(result.actualModels, []);
  assert.equal(result.actualUsageObserved, false);
  assert.equal(result.status, 'unknown');
});
test('unknown launch provenance never borrows producer requested identity', () => {
  const result = reconcileModelProvenance({ nativeSpans: [{ modelRequested: 'mini', modelActual: 'mini' }] });
  assert.equal(result.launchRequestedModel, null);
  assert.equal(result.launchRequestSource, 'unknown');
  assert.equal(result.status, 'unknown');
  assert.equal(result.overrideCertified, false);
});
test('matching observed identities stay observations and explicit contextual requests are sanitized', () => {
  const result = reconcileModelProvenance({ requestedModel: 'mini', nativeSpans: [{ modelActual: 'mini' }] });
  assert.equal(result.status, 'consistent_observation');
  assert.equal(result.overrideCertified, false);
  assert.equal(reconcileModelProvenance({ requestedModel: '<secret>\n' }).launchRequestedModel, null);
});
test('replay uses one top-level main landmark containing summary and timeline with preserved controls', () => {
  const html = renderSessionWaterfall([{ type: 'session.start', timestamp: '2026-01-01T00:00:00Z', data: { currentModel: 'cloud5.5' } }], 'run', { launchExecutionConfiguration, metadataOnly: true });
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.ok(html.indexOf('<main id="run-evidence">') < html.indexOf('<div class="summary-grid"'));
  assert.match(html, /<div id="timeline">/);
  assert.match(html, /Launcher requested model<\/dt><dd>mini/);
  assert.match(html, /conflict.*cloud5\.5/);
  assert.match(html, /Actual model usage was not observed/);
  assert.match(html, /id="row-search"/);
  assert.match(html, /data-filter="failed"/);
  assert.match(html, /id="event-0"/);
  assert.doesNotMatch(html, /private prompt|SECRET/);
});

test('actual model/provider pairs preserve conflicting producer evidence when launcher is unknown', () => {
  const result = reconcileModelProvenance({ nativeSpans: [
    { modelRequested: 'mini', modelActual: 'cloud5.5', provider: 'github' },
    { modelRequested: 'mini', modelActual: 'cloud5.5', provider: 'azure' },
    { modelActual: 'cloud5.5', provider: 'azure' }
  ] });
  assert.equal(result.launchRequestedModel, null);
  assert.deepEqual(result.producerRequestedModels, ['mini']);
  assert.deepEqual(result.actualModels, ['cloud5.5']);
  assert.deepEqual(result.actualUsageIdentities, [
    { model: 'cloud5.5', provider: 'azure' },
    { model: 'cloud5.5', provider: 'github' }
  ]);
  assert.equal(result.status, 'conflict');
  assert.equal(result.producerResponseConflicts.length, 2);
  assert.equal(result.overrideCertified, false);
});

test('model and provider identities reject URL credentials and known credential forms across sources', () => {
  const { safeModelIdentity } = require('../src/lib/copilot/execution-configuration');
  for (const secret of ['https://user:fixture-password@example.invalid/model', 'user:fixture-password@example.invalid', 'TOKEN:fixture-password', 'ghp_fixture-password', 'github_pat_fixture-password', 'sk-proj-fixture-password']) {
    assert.equal(safeModelIdentity(secret), null);
    const result = reconcileModelProvenance({
      launchExecutionConfiguration: observedLaunchExecutionConfiguration(['--model', secret]),
      requestedModel: secret,
      events: [{ data: { requestedModel: secret, currentModel: secret, newModel: secret, model: secret } }],
      nativeSpans: [{ modelRequested: secret, modelActual: secret, provider: secret }]
    });
    assert.equal(result.launchRequestedModel, null);
    assert.deepEqual(result.producerRequestedModels, []);
    assert.deepEqual(result.actualModels, []);
    assert.deepEqual(result.sessionReportedModels, []);
    assert.doesNotMatch(JSON.stringify(result), /fixture-password/);
  }
  assert.equal(safeModelIdentity('provider/model-v1'), 'provider/model-v1');
  assert.equal(safeModelIdentity('model:variant'), 'model:variant');
});
test('whole metadata replay excludes credential canary from provenance, labels, metrics and row details', () => {
  const secret = 'https://user:fixture-password@example.invalid/model';
  const runEvents = [
    { type: 'session.start', timestamp: '2026-01-01T00:00:00Z', data: { currentModel: secret, requestedModel: secret } },
    { type: 'session.model_change', timestamp: '2026-01-01T00:00:01Z', data: { newModel: secret } }
  ];
  const nativeSpans = [{ start: Date.parse('2026-01-01T00:00:00Z'), end: Date.parse('2026-01-01T00:00:01Z'), operation: 'chat', agent: 'native OTel', match: 'session-id', model: secret, modelRequested: secret, modelActual: secret, provider: secret }];
  const html = renderSessionWaterfall(runEvents, 'private-model', { metadataOnly: true, requestedModel: secret, nativeSpans });
  assert.doesNotMatch(html, /fixture-password|example\.invalid/);
  assert.match(html, /Launcher requested model<\/dt><dd>Unknown/);
  assert.match(html, /Actual model usage was not observed/);
  assert.equal(runEvents[0].data.currentModel, secret);
  assert.equal(nativeSpans[0].modelActual, secret);
});
