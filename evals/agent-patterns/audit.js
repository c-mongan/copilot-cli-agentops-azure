'use strict';
const fs = require('node:fs');
const path = require('node:path');
const reference = '.github/skills/incident-evidence/references/';
const probe = '.github/skills/incident-evidence/scripts/probe.js';
const gate = '.github/skills/release-verification/scripts/gate.py';
function audit(events, spans) {
  const checks = {};
  const skills = new Set(events.filter(row => row.EventName === 'skill.invoked').map(row => row.SkillName));
  checks.skillsActivated = ['incident-evidence', 'release-verification'].every(name => skills.has(name));
  const reads = events.filter(row => row.EventName === 'tool.execution_start' && row.ReferenceName?.startsWith(reference));
  checks.orderedReferences = reads.length === 4 && reads.every((row, index) => row.ReferenceName === reference + ['incident.md', 'counter-evidence.md', 'incident.md', 'incident.md'][index]);
  checks.referencesCompleted = reads.length === 4 && reads.every(row => row.ToolCallId && events.some(event => event.EventName === 'tool.execution_complete' && event.ToolCallId === row.ToolCallId && event.Status === 'completed'));
  const childStart = events.findIndex(row => row.EventName === 'subagent.started' && row.SubAgentName === 'incident-triager');
  const thirdRead = events.findIndex(row => row.EventName === 'tool.execution_complete' && row.ToolCallId && row.ToolCallId === reads[2]?.ToolCallId && row.Status === 'completed');
  checks.delegationAfterMainReads = childStart > thirdRead && thirdRead >= 0 && reads.slice(0, 3).every(row => row.AgentName !== 'incident-triager') && reads[3]?.AgentName === 'incident-triager';
  checks.namedSpecialistCompleted = events.some(row => row.EventName === 'subagent.completed' && row.SubAgentName === 'incident-triager' && row.Status === 'completed');
  for (const [name, status] of [['status', 'completed'], ['unavailable', 'failed']]) {
    const rows = events.filter(row => row.EventName === 'tool.execution_complete' && row.McpServerName === 'fixture' && row.McpToolName === name);
    checks['mcp_' + name] = rows.length === 1 && rows[0].Status === status;
  }
  checks.ownedScripts = [probe, gate].every(name => spans.some(row => row.ScriptName === name && row.LinkType === 'run-id-logical-link'));
  checks.nodeProbePassed = spans.some(row => row.ScriptName === probe && row.Outcome === 'ok');
  checks.pythonGateRejected = spans.some(row => row.ScriptName === gate && row.ToolCallId && events.some(event => event.ToolCallId === row.ToolCallId && event.EventName === 'tool.execution_complete' && event.Status === 'failed'));
  checks.modelProvenance = spans.some(row => row.ModelActual && Number.isFinite(row.InputTokens) && Number.isFinite(row.OutputTokens));
  checks.metadataPrivacy = [...events, ...spans].every(row => !JSON.stringify(row).includes('PRIVACY_CANARY_AGENT_PATTERNS') && (!Object.hasOwn(row, 'ContentCaptureMode') || row.ContentCaptureMode === 'off'));
  return { passed: Object.values(checks).every(Boolean), checks, orderedReferences: reads.map(row => ({ reference: row.ReferenceName, agent: row.AgentName || 'main' })), events: events.length, spans: spans.length };
}
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node audit.js <exported-run-directory>');
  const read = name => fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const result = audit(read('AgentOpsEvents_CL.jsonl'), read('AgentOpsSpans_CL.jsonl'));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
module.exports = { audit };
