#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash, rng, shuffle, knownOpaque, readJson, preparePaths, writeJson, readKey } = require('./common');
function graderIdentity() { return hash([fs.readFileSync(__filename, 'utf8'), fs.readFileSync(path.join(__dirname, 'common.js'), 'utf8')]); }
const CAUSES = ['missing_reference', 'mcp_failure', 'wrong_actual_model', 'script_failure', 'healthy', 'unknown'];
function makeIncident(random, cause) {
  const suffix = Math.floor(random() * 1e9).toString(36);
  const component = `component-${suffix}`, runId = `synthetic-${suffix}`;
  const requestedModel = `model-${Math.floor(random() * 100)}`;
  const events = [{ id: `${runId}:1`, type: 'run.start', requestedModel, component }];
  if (cause === 'missing_reference') events.push({ id: `${runId}:2`, type: 'file.read', path: `references/policy-${suffix}.md`, status: 'error', errorCode: 'ENOENT', component });
  else if (cause === 'mcp_failure') events.push({ id: `${runId}:2`, type: 'mcp.call', server: component, tool: 'snapshot', status: 'error', errorCode: 'TOOL_ERROR' });
  else if (cause === 'script_failure') events.push({ id: `${runId}:2`, type: 'shell.complete', component, script: `scripts/check-${suffix}.js`, exitCode: 2 });
  else if (cause === 'unknown') events.push({ id: `${runId}:2`, type: 'capture.gap', component, status: 'unknown', completeness: 'unknown' });
  else events.push({ id: `${runId}:2`, type: 'model.observed', component, model: cause === 'wrong_actual_model' ? requestedModel + '-other' : requestedModel });
  events.push({ id: `${runId}:3`, type: 'run.complete', component, processExitCode: 0, taskOutcome: cause === 'healthy' ? 'success' : cause === 'unknown' ? 'unknown' : 'failed' });
  return { runId, component, events };
}
function prepare(seed, publicDir, keyFile, participants = 2) {
  if (!Number.isInteger(participants) || participants < 2 || participants > 100 || participants % 2) throw new Error('participants must be an even integer from 2 to 100');
  const paths = preparePaths(publicDir, keyFile), random = rng(seed);
  const cases = CAUSES.flatMap(cause => [0, 1].map(twin => ({ cause, twin, incident: makeIncident(random, cause) })));
  const stimuli = cases.map(({ incident }) => ({ ...incident, nativeEvidence: incident.events, agentopsEvidence: { captureCompleteness: incident.events.some(e => e.type === 'capture.gap') ? 'unknown' : 'stimulus-scoped', orderedEvents: incident.events.map(e => ({ ...e, sourceEventRef: e.id })) } }));
  const schedules = Array.from({ length: participants }, (_, index) => ({ participantRef: `participant-${String(index + 1).padStart(4, '0')}`, trials: shuffle(cases, random).map((c, order) => ({ trialId: `p${index + 1}-${c.incident.runId}`, runId: c.incident.runId, condition: (index + c.twin) % 2 ? 'native' : 'agentops', order: order + 1 })) }));
  const publicBundle = { schemaVersion: 1, evidenceTier: 'fixture-stimuli-only', seedHash: hash(seed), responseCauses: CAUSES, instructions: 'Identify cause, component and evidence event IDs. Unknown is valid when capture cannot support a diagnosis. Process success does not prove task success.', stimuli, schedules };
  const key = { schemaVersion: 1, publicHash: hash(publicBundle), graderHash: graderIdentity(), cases: cases.map(c => ({ runId: c.incident.runId, cause: c.cause, component: c.incident.component, sourceEventRef: c.incident.events[1].id })) };
  fs.mkdirSync(paths.publicDir, { mode: 0o755 });
  writeJson(path.join(paths.publicDir, 'stimuli.json'), publicBundle);
  fs.mkdirSync(path.join(paths.publicDir, 'trials'));
  for (const schedule of schedules) for (const trial of schedule.trials) {
    const stimulus = stimuli.find(s => s.runId === trial.runId);
    writeJson(path.join(paths.publicDir, 'trials', trial.trialId + '.json'), { schemaVersion: 1, evidenceTier: 'fixture-stimuli-only', participantRef: schedule.participantRef, ...trial, instructions: publicBundle.instructions, responseCauses: CAUSES, evidence: trial.condition === 'native' ? stimulus.nativeEvidence : stimulus.agentopsEvidence });
  }
  writeJson(paths.keyFile, key, 0o600);
  return { publicHash: key.publicHash, graderHash: key.graderHash, trials: cases.length * participants, evidenceTier: publicBundle.evidenceTier };
}
function grade(bundle, key, responses) {
  if (hash(bundle) !== key.publicHash || graderIdentity() !== key.graderHash) throw new Error('stimulus or grader hash mismatch');
  if (!Array.isArray(responses)) throw new Error('responses must be an array');
  const allowed = new Set(bundle.schedules.flatMap(s => s.trials.map(t => t.trialId)));
  if (responses.some(r => !allowed.has(r.trialId)) || new Set(responses.map(r => r.trialId)).size !== responses.length) throw new Error('unknown or duplicate response trial');
  const rows = bundle.schedules.flatMap(schedule => schedule.trials.map(trial => {
    const response = responses.find(r => r.trialId === trial.trialId), expected = key.cases.find(c => c.runId === trial.runId);
    if (!response) return { ...trial, participantRef: schedule.participantRef, status: 'unknown', reason: 'missing response', timingEligible: false };
    const identity = response.identity;
    const responseFields = ['trialId', 'identity', 'outcome', 'cause', 'component', 'sourceEventRefs', 'startedAt', 'endedAt', 'elapsedMs', 'helpRequests', 'setupEffortMs'];
    const identityFields = ['participantRef', 'kind', 'sessionRef', 'observedModel', 'requestedModel', 'runtimeVersion', 'modelEvidenceRef', 'consentConfirmed'];
    if (Object.keys(response).some(k => !responseFields.includes(k)) || !identity || Object.keys(identity).some(k => !identityFields.includes(k))) throw new Error('unexpected response/provenance field');
    for (const field of ['sessionRef', 'observedModel', 'requestedModel', 'runtimeVersion', 'modelEvidenceRef']) if (identity[field] !== undefined && (typeof identity[field] !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(identity[field]))) throw new Error('invalid opaque identity reference');
    if (!identity || identity.participantRef !== schedule.participantRef || !['human', 'model', 'fixture'].includes(identity.kind) || typeof identity.sessionRef !== 'string' || !identity.sessionRef || (identity.kind === 'model' && (!['observedModel', 'runtimeVersion', 'requestedModel', 'modelEvidenceRef'].every(field => knownOpaque(identity[field])))) || (identity.kind === 'human' && identity.consentConfirmed !== true)) throw new Error('missing or invalid participant/model provenance');
    if (!['completed', 'failed', 'unknown'].includes(response.outcome) || !CAUSES.includes(response.cause)) throw new Error('invalid response outcome or cause');
    for (const field of ['helpRequests', 'setupEffortMs']) if (!Number.isInteger(response[field]) || response[field] < 0) throw new Error(`invalid ${field}`);
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
    if (typeof response.startedAt !== 'string' || typeof response.endedAt !== 'string' || !utc.test(response.startedAt) || !utc.test(response.endedAt)) throw new Error('invalid measured UTC timing');
    const start = Date.parse(response.startedAt), end = Date.parse(response.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !Number.isInteger(response.elapsedMs) || response.elapsedMs !== end - start) throw new Error('invalid measured timing');
    const validRefs = new Set(bundle.stimuli.find(s => s.runId === trial.runId).events.map(e => e.id));
    if (!Array.isArray(response.sourceEventRefs) || response.sourceEventRefs.some(ref => !validRefs.has(ref))) throw new Error('unknown source evidence reference');
    const comparisonEligible = identity.kind === 'human' || (identity.kind === 'model' && identity.observedModel === identity.requestedModel);
    const correct = response.outcome === 'completed' && response.cause === expected.cause && response.component === expected.component && Array.isArray(response.sourceEventRefs) && response.sourceEventRefs.includes(expected.sourceEventRef);
    const status = response.outcome === 'unknown' ? 'unknown' : correct ? 'success' : 'failed';
    return { ...trial, participantRef: schedule.participantRef, identity, status, correct, elapsedMs: response.elapsedMs, helpRequests: response.helpRequests, setupEffortMs: response.setupEffortMs, comparisonEligible, timingEligible: correct && comparisonEligible, reason: correct ? 'matched cause, component and source evidence' : 'failed, unsupported or incorrect diagnosis' };
  }));
  const median = values => { if (!values.length) return null; values.sort((a, b) => a - b); const i = Math.floor(values.length / 2); return values.length % 2 ? values[i] : (values[i - 1] + values[i]) / 2; };
  const byCondition = Object.fromEntries(['native', 'agentops'].map(condition => { const subset = rows.filter(r => r.condition === condition); return [condition, { total: subset.length, correct: subset.filter(r => r.correct).length, failed: subset.filter(r => r.status === 'failed').length, unknown: subset.filter(r => r.status === 'unknown').length, accuracy: subset.filter(r => r.correct).length / subset.length, measuredCorrectTrials: subset.filter(r => r.timingEligible).length, medianDiagnosisMs: median(subset.filter(r => r.timingEligible).map(r => r.elapsedMs)), helpRequests: subset.filter(r => r.helpRequests !== undefined).reduce((n, r) => n + r.helpRequests, 0), setupEffortMs: subset.filter(r => r.setupEffortMs !== undefined).reduce((n, r) => n + r.setupEffortMs, 0) }]; }));
  return { schemaVersion: 1, evidenceTier: rows.every(r => !r.identity || r.identity.kind === 'fixture') ? 'fixture-grader-validation' : 'reported-participant-synthetic-study', publicHash: key.publicHash, graderHash: key.graderHash, complete: responses.length === allowed.size, byCondition, rows, inference: 'Descriptive pilot only. Identity and measurements are reported provenance; independent collection is required. No demonstrated human usefulness or time savings follows from fixture responses.' };
}
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command || command === '--help') console.log('benchmark.js prepare <seed> <new-public-dir> <new-external-key.json> [even-participants]\nbenchmark.js grade <stimuli.json> <external-key.json> <responses.json>');
    else if (command === 'prepare' && args.length >= 3 && args.length <= 4) console.log(JSON.stringify(prepare(args[0], args[1], args[2], args[3] === undefined ? 2 : Number(args[3])), null, 2));
    else if (command === 'grade' && args.length === 3) console.log(JSON.stringify(grade(readJson(args[0]), readKey(args[1]), readJson(args[2])), null, 2));
    else throw new Error('invalid arguments; use --help');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, grade, CAUSES };
