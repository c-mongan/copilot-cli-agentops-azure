const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderRuns, renderArchitecture, renderCompare, loadExperiments } = require('../src/lib/architecture/views');
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
