const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureArchitecture, validateExperiment, evaluateExperiment } = require('../src/lib/architecture/experiment-contract');
const { renderCompare } = require('../src/lib/architecture/views');
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'compare-contract-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const roots = ['baseline','candidate'].map(name=>{const dir=path.join(root,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'skill.md'),name);fs.writeFileSync(path.join(dir,'other.md'),'same');return dir;});
 const snapshots=roots.map(captureArchitecture);
 const identity={modelRequested:'model-a',modelActual:'model-a',provider:'provider-a',runtime:'runtime-v1',tools:'tool-a,tool-b',mcp:'none',settings:'temperature=0',task:'task-1',dataset:'dataset-v1',grader:'sink-grader-v1'};
 const side=(index)=>({architectureVersion:snapshots[index].architectureVersion,architectureSnapshot:snapshots[index],identity:{...identity},identityEvidence:{completeness:'authoritative',verification:'caller_asserted',ref:'receipts/config.json'},trialEvidence:[1,2,3].map(i=>({runId:`${index}-${i}`,passed:true,toolCalls:index?7:10,identity:{...identity},sinkEvidenceRefs:[`receipts/${index}-${i}/actual-sink.json`]}))});
 const record={id:'treatment',status:'inconclusive',baseline:side(0),candidate:side(1),contract:{version:1,treatment:{path:'skill.md',beforeHash:snapshots[0].files['skill.md'],afterHash:snapshots[1].files['skill.md']},declaredBeforeTrials:true,planEvidenceRef:'plan-v1.json',criteria:{minimumTrials:3,minimumEffect:0.2,maximumQualityRegression:0,requireAllCandidatePass:true,metric:'toolCalls'}}};
 return {record,options:{baselineRoot:roots[0],candidateRoot:roots[1]},roots};
}
test('single changed treatment is controlled despite changed architecture identities; no automatic approval',t=>{
 const {record,options}=fixture(t);
 assert.notEqual(record.baseline.architectureVersion,record.candidate.architectureVersion);
 const evaluation=evaluateExperiment(record,options);
 assert.equal(evaluation.status,'criteria-met');assert.equal(evaluation.effect,0.3);assert.equal(evaluation.authorization,'none');assert.match(evaluation.provenance,/local-files-verified/);assert.match(evaluation.provenance,/caller-asserted/);
 assert.equal(evaluation.evidenceRefs.length,6);
 const html=renderCompare({records:[record],invalid:0,availableRunIds:new Set()});
 assert.match(html,/controlled single-change treatment/);assert.match(html,/caller-asserted; not independently verified/);assert.match(html,/no statistical significance/);
});
test('local validator rejects unexpected file drift and symlinks',t=>{
 const {record,options,roots}=fixture(t);fs.writeFileSync(path.join(roots[1],'other.md'),'drift');
 assert.equal(validateExperiment(record,options).compatible,false);
 record.candidate.architectureSnapshot=captureArchitecture(roots[1]);record.candidate.architectureVersion=record.candidate.architectureSnapshot.architectureVersion;
 assert.match(validateExperiment(record).reasons.join(';'),/unexpected architecture drift/);
 fs.symlinkSync('skill.md',path.join(roots[1],'link'));assert.throws(()=>captureArchitecture(roots[1]),/symlinks/);
});
test('settings/model/task/dataset/grader mismatch and partial provenance fail closed',t=>{
 const {record}=fixture(t);
 for(const key of ['settings','modelRequested','modelActual','provider','runtime','tools','mcp','task','dataset','grader']) {const altered=structuredClone(record);altered.candidate.identity[key]='changed';assert.equal(evaluateExperiment(altered).status,'inconclusive');assert.match(evaluateExperiment(altered).reason,new RegExp(`${key} mismatch`));}
 const partial=structuredClone(record);partial.candidate.identityEvidence.completeness='partial';assert.match(evaluateExperiment(partial).reason,/partial or unknown/);
 const trial=structuredClone(record);trial.candidate.trialEvidence[0].identity.modelActual='other';assert.match(evaluateExperiment(trial).reason,/trial actual model/);
});
test('quality first: retain failed tasks, gate samples/effect and actual sink refs',t=>{
 const {record}=fixture(t);
 const failure=structuredClone(record);failure.candidate.trialEvidence[0].passed=false;assert.equal(evaluateExperiment(failure).status,'rejected');failure.candidate.trialEvidence.pop();assert.equal(evaluateExperiment(failure).status,'rejected');
 const few=structuredClone(record);few.candidate.trialEvidence.pop();assert.match(evaluateExperiment(few).reason,/inadequate/);
 const refs=structuredClone(record);refs.candidate.trialEvidence[0].sinkEvidenceRefs=[];assert.match(evaluateExperiment(refs).reason,/missing actual sink/);
 const effect=structuredClone(record);effect.candidate.trialEvidence.forEach(trial=>trial.toolCalls=9);assert.match(evaluateExperiment(effect).reason,/minimum effect not met/);
 const baseline=structuredClone(record);baseline.baseline.trialEvidence[0].passed=false;assert.equal(evaluateExperiment(baseline).status,'inconclusive');
});
test('legacy and malformed bounded records cannot become comparable by matching hashes',t=>{
 const {record}=fixture(t);
 assert.equal(evaluateExperiment({baseline:{configurationVersion:'a'},candidate:{configurationVersion:'a'}}).status,'inconclusive');
 for(const mutate of [r=>r.contract.criteria.minimumTrials=1,r=>r.contract.treatment.path='../skill.md',r=>r.contract.criteria.minimumEffect=NaN,r=>r.baseline.identity.modelActual='unknown',r=>r.contract=null,r=>r.candidate.trialEvidence=Array(1001).fill({})]) {const r=structuredClone(record);mutate(r);assert.equal(evaluateExperiment(r).status,'inconclusive');}
 assert.equal(evaluateExperiment(null).status,'inconclusive');
 const oversized=structuredClone(record);oversized.extra='x'.repeat(1024*1024);assert.equal(evaluateExperiment(oversized).status,'inconclusive');
});
