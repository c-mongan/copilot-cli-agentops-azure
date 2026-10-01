const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {exportTrial}=require('../scripts/export-agentops-ledger');

test('Vally ledger keeps measured zero and unknown usage while excluding private content',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vally-ledger-'));
 try {
 const record={type:'trial-result',itemId:'trial',model:'fixture-model',status:'success',gradeResult:{passed:true},trajectory:{id:'session-1',output:'FINAL_CANARY',events:[{type:'user_message',data:{content:'PROMPT_CANARY'}},{type:'tool_call',data:{name:'bash',arguments:'ARG_CANARY',result:'RESULT_CANARY'}},{type:'token_usage',data:{inputTokens:0,outputTokens:12,model:'actual-model'}}]}};
 const result=exportTrial(record,dir);
 const text=fs.readFileSync(path.join(result.outputDir,'AgentOpsEvents_CL.jsonl'),'utf8');
 assert.doesNotMatch(text,/CANARY/);
 const rows=text.trim().split('\n').map(JSON.parse);
 assert.equal(rows[0].InputTokens,null);assert.equal(rows[2].InputTokens,0);assert.equal(rows[2].OutputTokens,12);assert.equal(rows[2].ModelActual,'actual-model');
 const context=JSON.parse(fs.readFileSync(path.join(result.outputDir,'run-context.json')));assert.equal(context.evidenceComplete,false);assert.equal(context.coverage.scripts,'unknown');
 assert.throws(()=>exportTrial(record,dir),/EEXIST/);
 assert.throws(()=>exportTrial({type:'trial-result',trajectory:{id:'session-2',events:[{}]}},dir),/invalid trajectory/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
