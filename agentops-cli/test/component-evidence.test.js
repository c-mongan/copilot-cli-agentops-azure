const test = require('node:test');
const assert = require('node:assert/strict');
const { componentEvidence } = require('../src/lib/copilot/component-evidence');
test('component counters preserve independent unknowns and count pending/failed exact operations', () => {
 const rows = [
  { EventName:'tool.execution_start', Status:'started', ToolCallId:'a', ReferenceName:'ref' },
  { EventName:'tool.execution_complete', Status:'failed', ToolCallId:'a', ReferenceName:'ref' },
  { EventName:'tool.execution_start', Status:'started', ToolCallId:'b' },
  { EventName:'tool.execution_start', Status:'started', ToolCallId:'b' },
  { EventName:'subagent.started', Status:'started', ToolCallId:'delegation', AgentId:'agent-1' },
  { EventName:'subagent.completed', Status:'completed', ToolCallId:'delegation', AgentId:'agent-1' },
  { EventName:'skill.invoked', SkillName:'demo' }, { EventName:'skill.invoked', SkillName:'demo' }
 ];
 const evidence = componentEvidence(rows);
 assert.equal(evidence.tools.attempted,2); assert.equal(evidence.tools.failed,1); assert.equal(evidence.tools.pending,1);
 assert.equal(evidence.agents.completed,1);
 assert.equal(evidence.references.failed,1); assert.equal(evidence.skills.observed,1);
 for (const row of Object.values(evidence)) { assert.equal(row.expected,null); assert.equal(row.missing,null); assert.equal(row.status,'unknown'); }
 assert.equal(componentEvidence().tools.observed,0);
 assert.equal(componentEvidence().tools.missing,null);
 assert.equal(componentEvidence([], [{match:'run-linked-script'}]).scripts.observed,0);
});
test('independent stimulus expectations expose missing evidence without establishing complete coverage', () => {
 const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
 const { loadComponentExpectations } = require('../src/lib/copilot/component-evidence');
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'component-expectations-'));
 const file = path.join(dir,'manifest.json');
 try {
  fs.writeFileSync(file,JSON.stringify({scope:'stimulus',components:{skills:{expected:2,supported:true}},private:'CANARY'}));
  const manifest = loadComponentExpectations(file);
  assert.ok(!JSON.stringify(manifest).includes('CANARY'));
  const result = componentEvidence([{EventName:'skill.invoked',SkillName:'demo'}],[],manifest);
  assert.equal(result.skills.missing,1); assert.equal(result.skills.expected,2); assert.equal(result.skills.supported,true); assert.equal(result.skills.status,'unknown');
  assert.equal(result.references.missing,null);
  fs.writeFileSync(file,JSON.stringify({scope:'all',components:{skills:{expected:2,supported:true}}}));
  assert.throws(()=>loadComponentExpectations(file),/stimulus/);
  fs.writeFileSync(file,JSON.stringify({scope:'stimulus',components:{skills:{expected:-1,supported:true}}}));
  assert.throws(()=>loadComponentExpectations(file),/invalid/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
