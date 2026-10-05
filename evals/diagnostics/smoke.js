#!/usr/bin/env node
'use strict';
// Explicit fixture oracle rehearsal. Reads protected answers to simulate output;
// therefore it provides zero model, participant, or usefulness evidence.
const fs = require('node:fs');
const path = require('node:path');
const diagnostics = require('./benchmark');
const heldout = require('../stockpilot/scripts/heldout');
const { readKey, readJson, writeJson, inside, repo } = require('./common');
function smoke(root, seed = 'fixture-smoke') {
  root = path.resolve(root);
  if (inside(root, repo) || fs.existsSync(root)) throw new Error('fixture smoke requires a new directory outside repository');
  fs.mkdirSync(root, { recursive: false, mode: 0o700 });
  for (const dir of ['keys', 'public', 'workspaces']) fs.mkdirSync(path.join(root, dir), { mode: 0o700 });
  const diagnosticDir = path.join(root, 'public/diagnostics'), diagnosticKeyFile = path.join(root, 'keys/diagnostics.json');
  diagnostics.prepare(seed, diagnosticDir, diagnosticKeyFile);
  const bundle = readJson(path.join(diagnosticDir, 'stimuli.json')), key = readKey(diagnosticKeyFile);
  const responses = bundle.schedules.flatMap(s => s.trials.map(trial => {
    const expected = key.cases.find(c => c.runId === trial.runId), now = new Date().toISOString();
    return { trialId: trial.trialId, identity: { kind: 'fixture', participantRef: s.participantRef, sessionRef: 'oracle-smoke-no-participant' }, cause: expected.cause, component: expected.component, sourceEventRefs: [expected.sourceEventRef], outcome: 'completed', startedAt: now, endedAt: now, elapsedMs: 0, helpRequests: 0, setupEffortMs: 0 };
  }));
  writeJson(path.join(root, 'diagnostic-responses.json'), responses);
  const diagnosticResult = diagnostics.grade(bundle, key, responses);
  writeJson(path.join(root, 'diagnostic-grade.json'), diagnosticResult);
  const stockDir = path.join(root, 'public/stockpilot'), stockKeyFile = path.join(root, 'keys/stockpilot.json');
  heldout.prepare(seed, stockDir, stockKeyFile);
  const stockKey = readKey(stockKeyFile), workspaceRoot = path.join(root, 'workspaces');
  const records = stockKey.tasks.map((task, i) => {
    const workspacePath = path.join(workspaceRoot, `trial-${i}`);
    fs.mkdirSync(path.join(workspacePath, heldout.DATA_DEST), { recursive: true }); fs.mkdirSync(path.join(workspacePath, heldout.SINK_DEST), { recursive: true });
    fs.copyFileSync(path.join(stockDir, 'data/dataset.json'), path.join(workspacePath, heldout.DATA_DEST, 'dataset.json'));
    for (const [name, rows] of Object.entries(task.expected)) if (rows.length) fs.writeFileSync(path.join(workspacePath, heldout.SINK_DEST, name + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    return { stimulus: task.id, taskHash: task.taskHash, specHash: stockKey.specHash, runId: `fixture-${i}`, workspacePath, status: 'success', trajectory: { output: 'fixture oracle wrote synthetic sinks' }, provenance: { kind: 'fixture', runtimeVersion: process.version, observedModel: stockKey.model, modelEvidenceRef: 'fixture-no-model-executed' } };
  });
  const recordsFile = path.join(root, 'stockpilot-records.json'); writeJson(recordsFile, records);
  const stockpilotResult = heldout.gradeResults(records, stockKey, workspaceRoot);
  writeJson(path.join(root, 'stockpilot-grade.json'), stockpilotResult);
  return { evidenceTier: 'fixture-grader-validation', root, diagnosticTrials: diagnosticResult.rows.length, diagnosticAccuracy: diagnosticResult.byCondition, stockpilotPassed: stockpilotResult.passed, stockpilotTrials: stockpilotResult.rows.length, replay: heldout.verifyHeldoutReceipt(stockpilotResult.rows[0], { keyFile: stockKeyFile, recordsFile, workspaceRoot }).verified, caveat: 'Oracle-produced fixture answers only; no actual participant/model was run and no time saving was measured.' };
}
if (require.main === module) {
  try { const args = process.argv.slice(2); if (!args.length || args[0] === '--help') console.log('smoke.js <new-external-directory> [seed]\nLocal fixture oracle rehearsal only. Never calls a model or a cloud service.'); else if (args.length <= 2) console.log(JSON.stringify(smoke(...args), null, 2)); else throw new Error('invalid arguments; use --help'); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { smoke };
