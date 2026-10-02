const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderRuns, renderArchitecture, renderCompare, loadExperiments, writeViews } = require('../src/lib/architecture/views');
const { loadLedgerFromDirectory } = require('../src/lib/architecture-command');

test('views allow only selected metadata, escape content, and keep null usage unknown', () => {
 const html = renderRuns([{runId:'<script>',events:[{EventName:'model.response',InputTokens:null,OutputTokens:0,Payload:'SECRET_CANARY'}]}]);
 assert.doesNotMatch(html, /<script>.*<\/h2>|SECRET_CANARY/);
 assert.match(html, /unknown \/ 0/);
 assert.match(html, /&lt;script&gt;/);
 assert.match(html, /partial or unknown/);
 assert.match(html, /href="architecture.html"/);
});
test('empty architecture and compare show honest empty states', () => {
 assert.match(renderArchitecture({cards:[],inventory:{agents:0,skills:0,references:0,scripts:0},coverageRuns:0,insufficientEvidence:true}), /Insufficient evidence/);
 assert.match(renderCompare({records:[],invalid:0}), /No experiment results yet/);
});
test('compare renders stored outcomes and detects configuration mismatch', () => {
 const html=renderCompare({invalid:0,records:[{id:'trial-1',status:'rejected',baseline:{configurationVersion:'a',runIds:['run-1']},candidate:{configurationVersion:'b'},reason:'Failed protected test'}]});
 assert.match(html,/data-status="rejected"/);
 assert.match(html,/unknown or mismatched/);
 assert.match(html,/runs.html#run-/);
 assert.match(html,/Failed protected test/);
});
test('compare marks compatibility only when both architecture and configuration versions are known and equal', () => {
 const authoritative={completeness:'authoritative',source:'supplied_identity',verification:'caller_asserted',scope:{model:'authoritative',tools:'authoritative',mcp:'authoritative',skills:'authoritative'}};
 const matching=renderCompare({invalid:0,records:[{id:'matching',status:'accepted',baseline:{architectureVersion:'arch-a',configurationVersion:'cfg-a',executionConfiguration:authoritative},candidate:{architectureVersion:'arch-a',configurationVersion:'cfg-a',executionConfiguration:authoritative}}]});
 assert.match(matching,/compatible by matching caller-asserted authoritative architecture and configuration identities; not independently verified/);
 const partial={completeness:'partial',source:'observed_launch_arguments',scope:{model:'observed',tools:'observed',mcp:'unknown',skills:'unknown'}};
 const observedOnly=renderCompare({invalid:0,records:[{id:'partial',status:'inconclusive',baseline:{architectureVersion:'arch-a',configurationVersion:'cfg-a',executionConfiguration:partial},candidate:{architectureVersion:'arch-a',configurationVersion:'cfg-a',executionConfiguration:partial}}]});
 assert.match(observedOnly,/matching recorded identities; configuration evidence is not authoritative/);
 assert.doesNotMatch(observedOnly,/compatible: matching/);
 const architectureMismatch=renderCompare({invalid:0,records:[{id:'arch-mismatch',status:'inconclusive',baseline:{architectureVersion:'arch-a',configurationVersion:'cfg-a'},candidate:{architectureVersion:'arch-b',configurationVersion:'cfg-a'}}]});
 assert.match(architectureMismatch,/unknown or mismatched architecture\/configuration/);
 const unknownArchitecture=renderCompare({invalid:0,records:[{id:'unknown-arch',status:'inconclusive',baseline:{configurationVersion:'cfg-a'},candidate:{configurationVersion:'cfg-a'}}]});
 assert.match(unknownArchitecture,/unknown or mismatched architecture\/configuration/);
});
test('architecture cards render version, unit, coverage and exact evidence IDs without content payloads', () => {
 const html=renderArchitecture({architectureVersion:'arch-a',configurationVersion:'cfg-a',configurationVersions:['cfg-a'],coverageRuns:12,insufficientEvidence:false,inventory:{agents:1,skills:1,references:1,scripts:0},cards:[{rule:'REFERENCE_NEAR_MANDATORY',title:'Reference evidence',summary:'metadata only',metricEvidence:{architectureVersion:'arch-a',configurationVersion:'cfg-a',unit:'runs',numerator:11,denominator:12,coverageRuns:12,coverage:{evidenceCompleteRuns:12,configurationVersionStatus:'known'},evidenceIds:['event-1']},representativeRunIds:['run-1'],proposedChange:'Review it',rejectionTest:'pending'}]});
 assert.match(html,/Execution configuration identity: cfg-a/);
 assert.match(html,/11 \/ 12 runs/);
 assert.match(html,/Exact evidence IDs: <a href="runs\.html#event-[a-f0-9]+"><code>event-1<\/code><\/a>/);
 const target=html.match(/href="runs\.html#(event-[a-f0-9]+)"/)[1];
 const runs=renderRuns([{runId:'run-1',events:[{EventId:'event-1',Sequence:1,EventName:'reference.read',Status:'completed'}]}]);
 assert.match(runs,new RegExp(`id="${target}"`));
 assert.match(html,/Complete evidence: 12/);
 assert.doesNotMatch(html,/prompt|tool arguments|file contents/i);
});
test('architecture exposes excluded mixed cohorts and event links reveal closed evidence details', () => {
 const html=renderArchitecture({architectureVersion:'arch-a',configurationVersions:['cfg-a','cfg-b'],configurationVersionStatus:'mixed',coverageRuns:0,insufficientEvidence:true,inventory:{agents:1,skills:1,references:1,scripts:0},cards:[],cohorts:[{cohortId:'cohort-mixed',configurationVersions:['cfg-a','cfg-b'],configurationVersionStatus:'mixed',taskIds:['task-a','task-b'],taskStatus:'mixed',coverageRuns:2,eligibleForMetrics:false,exclusionReason:'conflicting configuration or task identity within a run'}]});
 assert.match(html,/Evidence cohorts/);
 assert.match(html,/mixed \(cfg-a, cfg-b\)/);
 assert.match(html,/excluded: conflicting configuration or task identity within a run/);
 const runs=renderRuns([{runId:'run-1',events:[{EventId:'event-1',Sequence:1,EventName:'reference.read',Status:'completed'}]}]);
 assert.match(runs,/target\.closest\('details'\)/);
 assert.match(runs,/details\.open=true;target\.scrollIntoView\(\)/);
});
test('writeViews links only run and event evidence available in the rendered ledger', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentops-views-'));
 try {
  const report={architectureVersion:'arch-a',coverageRuns:1,insufficientEvidence:false,inventory:{agents:1,skills:1,references:1,scripts:0},cohorts:[],cards:[{rule:'REFERENCE_NEAR_MANDATORY',summary:'metadata only',metricEvidence:{evidenceIds:['event-present','event-missing']},representativeRunIds:['run-present','run-missing']}]};
  const runs=[{runId:'run-present',events:[{EventId:'event-present',Sequence:1,EventName:'reference.read'}]}];
  const experiments={invalid:0,records:[{id:'trial',status:'inconclusive',baseline:{runIds:['run-present','run-missing']},candidate:{},reason:'review'}]};
  writeViews(report,runs,experiments,dir);
  const architecture=fs.readFileSync(path.join(dir,'architecture.html'),'utf8');
  const compare=fs.readFileSync(path.join(dir,'compare.html'),'utf8');
  assert.match(architecture,/href="runs\.html#event-[a-f0-9]+"><code>event-present/);
  assert.match(architecture,/<code>event-missing<\/code> \(evidence unavailable in this ledger\)/);
  assert.match(architecture,/href="runs\.html#run-[a-f0-9]+">run-present/);
  assert.match(architecture,/run-missing \(evidence unavailable in this ledger\)/);
  assert.match(compare,/href="runs\.html#run-[a-f0-9]+">run-present/);
  assert.match(compare,/run-missing \(evidence unavailable in this ledger\)/);
  assert.doesNotMatch(compare,/href="runs\.html#run-[a-f0-9]+">run-missing/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('experiment loader excludes malformed, wrong-status and symlink records', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentops-experiments-'));
 try {fs.mkdirSync(path.join(dir,'accepted'));fs.writeFileSync(path.join(dir,'accepted','bad.json'),'{}');fs.writeFileSync(path.join(dir,'accepted','ok.json'),JSON.stringify({id:'ok',status:'accepted',baseline:{},candidate:{}}));assert.equal(loadExperiments(dir).invalid,1);assert.equal(loadExperiments(dir).records.length,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('partial component coverage and malformed ledger defeat complete flag', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agentops-partial-'));
 try {
 fs.writeFileSync(path.join(dir,'attachment.json'),JSON.stringify({architecture:{skills:[],agents:[]}}));
 for(const [id,context,lines] of [['partial',{evidenceComplete:true,coverage:{scripts:'unknown'}},'{"EventName":"session.start"}'],['malformed',{evidenceComplete:true},'{"EventName":"session.start"}\n{'],['complete',{coverage:Object.fromEntries(['agents','skills','references','scripts','tools','models'].map(k=>[k,'complete']))},'{"EventName":"session.start"}']]){fs.mkdirSync(path.join(dir,id));fs.writeFileSync(path.join(dir,id,'context.json'),JSON.stringify(context));fs.writeFileSync(path.join(dir,id,'events.jsonl'),lines);}
 const result=loadLedgerFromDirectory(dir);
 assert.equal(result.runs.find(r=>r.runId==='partial').evidenceComplete,false);
 assert.equal(result.runs.find(r=>r.runId==='malformed').evidenceComplete,false);
 assert.equal(result.runs.find(r=>r.runId==='complete').evidenceComplete,true);
 assert.equal(result.invalidLedgerRows,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
