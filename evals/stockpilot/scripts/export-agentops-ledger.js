#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value) ? value : '';

// Vally trajectories are retained separately. Only selected execution metadata
// enters AgentOps; prompts, arguments, results, and final answers never do.
function exportTrial(record, ledgerDir) {
  if (record?.type !== 'trial-result' || !Array.isArray(record.trajectory?.events)) throw new Error('expected a Vally trial-result trajectory');
  const sessionId = identifier(record.trajectory.metadata?.sessionID || record.trajectory.id);
  if (!sessionId) throw new Error('trial lacks a safe session identity');
  const runId = `vally_${crypto.createHash('sha256').update(`${record.itemId}:${sessionId}`).digest('hex').slice(0,24)}`;
  const rows = record.trajectory.events.map((event, index) => {
    if (!event || typeof event.type !== 'string' || !identifier(event.type)) throw new Error('invalid trajectory event');
    const data = event.data || {};
    const usage = event.type === 'token_usage';
    return {
      TimeGenerated: Number.isFinite(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : null,
      Sequence: index + 1, EventId: `${runId}:${index+1}`, RunId: runId, SessionId: sessionId,
      EventName: `vally.${event.type}`, AgentName: 'vally-copilot-sdk',
      ToolName: event.type === 'tool_call' ? identifier(data.name || data.toolName) : '',
      SkillName: event.type === 'skill_activation' ? identifier(data.skillName || data.name) : '',
      Status: 'observed', ModelRequested: identifier(record.model),
      ModelActual: usage ? identifier(data.model) : '',
      Provider: usage ? identifier(data.cost?.provider) : '',
      InputTokens: usage ? measured(data.inputTokens) : null,
      OutputTokens: usage ? measured(data.outputTokens) : null,
      CacheReadTokens: usage ? measured(data.cacheReadTokens) : null,
      CacheWriteTokens: usage ? measured(data.cacheWriteTokens) : null,
      DurationMs: null, PrivacyMode: 'strict', SchemaVersion: '2'
    };
  });
  fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
  const dir = path.join(ledgerDir, runId);
  fs.mkdirSync(dir, { mode: 0o700 }); // Existing evidence is never overwritten.
  const context = {
    managedBy: 'copilot-agentops', schemaVersion: 1, runId, sessionId,
    architectureVersion: 'unknown', evidenceTier: 'live-synthetic-vally-trajectory-derived',
    lifecycle: { collector: 'unknown', process: record.status === 'success' ? 'completed' : 'unknown' },
    coverage: Object.fromEntries(['agents','skills','references','scripts','tools','models'].map(kind=>[kind,'unknown'])),
    evidenceComplete: false, outcomeFailed: record.gradeResult?.passed === false,
    stimulus: identifier(record.stimulus), variant: identifier(record.variant),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir,'run-context.json'), JSON.stringify(context,null,2)+'\n', { flag:'wx', mode:0o600 });
  fs.writeFileSync(path.join(dir,'AgentOpsEvents_CL.jsonl'), rows.map(row=>JSON.stringify(row)).join('\n')+'\n', { flag:'wx', mode:0o600 });
  return { runId, sessionId, rows: rows.length, outputDir: dir };
}

if (require.main === module) {
  try {
    const [file, ledgerDir] = process.argv.slice(2);
    if (!file || !ledgerDir) throw new Error('usage: export-agentops-ledger.js <results.jsonl> <ledger-dir>');
    const stat=fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>16*1024*1024) throw new Error('results must be a regular file below 16 MiB');
    const records=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    console.log(JSON.stringify(records.filter(row=>row.type==='trial-result').map(row=>exportTrial(row,ledgerDir)),null,2));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
module.exports = { exportTrial };
