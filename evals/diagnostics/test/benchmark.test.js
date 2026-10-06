'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare, grade, CAUSES } = require('../benchmark');
const { readJson, readKey } = require('../common');
function setup(t, seed = 'diagnostic-fixture-11') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'keys'), { mode: 0o700 }); fs.mkdirSync(path.join(root, 'public'));
  const publicDir = path.join(root, 'public/bundle'), keyFile = path.join(root, 'keys/key.json');
  prepare(seed, publicDir, keyFile);
  return { root, publicDir, keyFile, bundle: readJson(path.join(publicDir, 'stimuli.json')), key: readKey(keyFile) };
}
function fixtureResponses(bundle, key) {
  return bundle.schedules.flatMap(s => s.trials.map(trial => {
    const answer = key.cases.find(c => c.runId === trial.runId);
    const startedAt = new Date().toISOString(), endedAt = startedAt;
    return { trialId: trial.trialId, identity: { participantRef: s.participantRef, kind: 'fixture', sessionRef: 'fixture-session' }, outcome: 'completed', cause: answer.cause, component: answer.component, sourceEventRefs: [answer.sourceEventRef], startedAt, endedAt, elapsedMs: 0, helpRequests: 0, setupEffortMs: 0 };
  }));
}
test('randomized twins are counterbalanced; participant files expose one condition only; key protected', t => {
  const { bundle, keyFile, publicDir } = setup(t);
  assert.equal(fs.statSync(keyFile).mode & 0o077, 0);
  assert.equal(bundle.stimuli.length, CAUSES.length * 2);
  for (const stimulus of bundle.stimuli) assert.deepEqual(new Set(bundle.schedules.flatMap(s => s.trials.filter(r => r.runId === stimulus.runId).map(r => r.condition))), new Set(['native', 'agentops']));
  const trial = bundle.schedules[0].trials[0], visible = readJson(path.join(publicDir, 'trials', trial.trialId + '.json'));
  assert.equal('cause' in visible, false); assert.equal('nativeEvidence' in visible, false); assert.equal('agentopsEvidence' in visible, false);
  assert.notDeepEqual(bundle.schedules[0].trials.map(t => t.runId), bundle.schedules[1].trials.map(t => t.runId));
});
test('fixture smoke grades complete correctness but excludes every fixture timing', t => {
  const { bundle, key } = setup(t), responses = fixtureResponses(bundle, key);
  const result = grade(bundle, key, responses);
  assert.equal(result.complete, true); assert.equal(result.evidenceTier, 'fixture-grader-validation');
  for (const condition of Object.values(result.byCondition)) { assert.equal(condition.accuracy, 1); assert.equal(condition.medianDiagnosisMs, null); assert.equal(condition.measuredCorrectTrials, 0); }
  responses[0].cause = responses[0].cause === 'healthy' ? 'mcp_failure' : 'healthy';
  responses[1].outcome = 'unknown';
  const failed = grade(bundle, key, responses.slice(0, -1));
  assert.equal(failed.complete, false); assert.equal(failed.rows[0].status, 'failed'); assert.equal(failed.rows[1].status, 'unknown'); assert.equal(failed.rows.at(-1).status, 'unknown');
});
test('invalid provenance/timing, duplicate answers, modified stimulus or grader rejected', t => {
  const { bundle, key } = setup(t), responses = fixtureResponses(bundle, key);
  assert.throws(() => grade(bundle, key, [...responses, responses[0]]), /duplicate/);
  const originalStart = responses[0].startedAt; responses[0].startedAt = '1'; assert.throws(() => grade(bundle, key, responses), /UTC timing/); responses[0].startedAt = originalStart;
  responses[0].elapsedMs = 12; assert.throws(() => grade(bundle, key, responses), /timing/); responses[0].elapsedMs = 0;
  responses[0].identity.kind = 'model'; assert.throws(() => grade(bundle, key, responses), /provenance/);
  assert.throws(() => grade({ ...bundle, instructions: 'changed' }, key, []), /hash mismatch/);
  assert.throws(() => grade(bundle, { ...key, graderHash: 'changed' }, []), /hash mismatch/);
});
test('seed changes incident identities and evidence; key cannot be staged or overwritten', t => {
  const a = setup(t, 'a'), b = setup(t, 'b');
  assert.notEqual(a.key.publicHash, b.key.publicHash);
  assert.throws(() => prepare('a', a.publicDir, a.keyFile), /must be new/);
  assert.throws(() => prepare('a', path.join(a.root, 'public/new'), path.join(a.root, 'public/new/key.json')), /ENOENT|outside/);
});
module.exports = { fixtureResponses };
test('unknown or malformed model identities cannot enter diagnosis timing comparisons', t => {
  const { bundle, key } = setup(t), responses = fixtureResponses(bundle, key);
  const model = { ...responses[0].identity, kind: 'model', requestedModel: 'gpt-test', observedModel: 'gpt-test', runtimeVersion: 'runtime-v1', modelEvidenceRef: 'receipt-1' };
  for (const field of ['requestedModel', 'observedModel', 'runtimeVersion', 'modelEvidenceRef']) {
    for (const value of [{}, true, ' ', '', 'unknown', 'partial', 'unavailable', 'UNKNOWN:model', 'x'.repeat(201)]) {
      responses[0].identity = { ...model, [field]: value };
      assert.throws(() => grade(bundle, key, responses), /provenance|identity reference/, `${field}: ${JSON.stringify(value)}`);
    }
  }
  responses[0].identity = model;
  const known = grade(bundle, key, responses);
  assert.equal(known.rows[0].comparisonEligible, true);
  assert.equal(known.rows[0].timingEligible, true);
  responses[0].identity = { ...model, observedModel: 'other-model' };
  assert.equal(grade(bundle, key, responses).rows[0].timingEligible, false);
});
