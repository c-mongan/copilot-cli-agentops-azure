#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SERVER = 'stockpilot-readonly';
const SPECIALIST = 'stock-risk-auditor';

function audit(events, spans) {
  const checks = {};
  const completions = events.filter(row => row.EventName === 'tool.execution_complete' && row.McpServerName === SERVER);
  const stock = completions.filter(row => row.McpToolName === 'stock_snapshot');
  const unavailable = completions.filter(row => row.McpToolName === 'unavailable_snapshot');
  const stockIndex = events.indexOf(stock[0]);
  const unavailableIndex = events.indexOf(unavailable[0]);
  const starts = events.filter(row => row.EventName === 'subagent.started' && row.SubAgentName === SPECIALIST);
  const completed = events.filter(row => row.EventName === 'subagent.completed' && row.SubAgentName === SPECIALIST);
  const startIndex = events.indexOf(starts[0]);
  const completedIndex = events.indexOf(completed[0]);

  checks.stockSnapshotCompleted = stock.length === 1 && stock[0].Status === 'completed';
  checks.unavailableSnapshotFailed = unavailable.length === 1 && unavailable[0].Status === 'failed';
  checks.namedSpecialistCompleted = starts.length === 1 && completed.length === 1
    && completed[0].Status === 'completed';
  checks.orderedMcpThenDelegation = stockIndex >= 0 && unavailableIndex > stockIndex
    && startIndex > unavailableIndex && completedIndex > startIndex;
  checks.noUnexpectedMcp = events.filter(row => row.McpServerName)
    .every(row => row.McpServerName === SERVER);
  checks.noUnexpectedSubagents = events.filter(row => row.SubAgentName)
    .every(row => row.SubAgentName === SPECIALIST);
  checks.noSkillsActivated = !events.some(row => row.EventName === 'skill.invoked');
  checks.modelProvenance = spans.some(row => row.ModelActual
    && Number.isFinite(row.InputTokens) && Number.isFinite(row.OutputTokens));
  checks.metadataPrivacy = [...events, ...spans].every(row => {
    const serialized = JSON.stringify(row);
    return !serialized.includes('PRIVACY_CANARY_STOCKPILOT')
      && (!Object.hasOwn(row, 'ContentCaptureMode') || row.ContentCaptureMode === 'off');
  });

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    order: { stockIndex, unavailableIndex, startIndex, completedIndex },
    events: events.length,
    spans: spans.length,
    coverage: 'stimulus-contract-only'
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: node audit-mcp-delegation.js <exported-run-directory>');
  const read = name => fs.readFileSync(path.join(dir, name), 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  const result = audit(read('AgentOpsEvents_CL.jsonl'), read('AgentOpsSpans_CL.jsonl'));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

module.exports = { audit };
