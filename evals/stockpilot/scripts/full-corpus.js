#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { grade, PASS, readCsv } = require('../graders');
const tasks = require('../graders/tasks.json').tasks;
const root = path.resolve(__dirname, '..');

function makeSpec() {
  const agent = fs.readFileSync(path.join(root, 'fixtures/agents/stockpilot.agent.md'), 'utf8').split('---').slice(2).join('---');
  return {
    name: 'stockpilot-full-corpus', type: 'regression',
    defaults: { runs: 1, timeout: '3m', model: 'gpt-5.4-mini', executor: 'copilot-sdk' },
    agent_environment: {
      skills: ['forecasting', 'notify-templates', 'reorder-policy', 'supplier-selection', 'weekly-report'].map(name => path.join(root, 'fixtures/skills', name)),
      mcpServers: {}, files: [{ src: path.join(root, 'fixtures'), dest: 'evals/stockpilot/fixtures' }]
    },
    stimuli: tasks.map(task => ({
      name: task.id,
      prompt: `${agent}\n\nSynthetic planning date: 2026-06-15 (the fixture snapshot). Next month means July 2026, regardless of the real system date.\nTask: ${task.prompt}\nUse only the staged synthetic files. Do not access the network. Write requested actions to the synthetic sinks, never claim a write without making it.`,
      constraints: { max_turns: 25, max_tool_calls: 35, max_wall_time: '180s' },
      // Operational check only. The authoritative task/sink grade below is required.
      graders: [{ type: 'output-matches', config: { pattern: '.+' } }]
    }))
  };
}

function readSink(workspace, name) {
  const dir = path.join(workspace, 'evals/stockpilot/fixtures/sinks');
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return [];
  const real = fs.realpathSync(file);
  if (!real.startsWith(fs.realpathSync(workspace) + path.sep)) throw new Error('sink escapes trial workspace');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('invalid or oversized synthetic sink');
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const row = JSON.parse(line);
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid sink row');
    return row;
  });
}

function gradeTrial(record, workspaceRoot) {
  const task = tasks.find(task => task.id === record.stimulus);
  if (!task) throw new Error('unknown task');
  try {
    const workspace = fs.realpathSync(record.workspacePath);
    if (!workspace.startsWith(fs.realpathSync(workspaceRoot) + path.sep)) throw new Error('workspace escapes approved synthetic root');
    const actions = [];
    for (const [file, kind] of [['purchase_orders.jsonl', 'po'], ['outbox.jsonl', 'notify'], ['erp_writes.jsonl', 'erp']]) {
      actions.push(...readSink(workspace, file).map(row => ({ ...row, kind })));
    }
    const events = record.trajectory?.events || [];
    const result = {
      finalText: record.trajectory?.output || '', actions,
      wallMs: record.durationMs,
      turns: events.filter(event => event.type === 'token_usage').length,
      tokensOut: events.filter(event => event.type === 'token_usage').reduce((sum, event) => sum + (event.data?.outputTokens || 0), 0),
      error: record.status === 'success' ? null : `execution ${record.status}`
    };
    let [status, reason] = grade(task, result);
    if (status === PASS && task.id === 'R3') {
      const eligible = readCsv('supplier_catalog.csv').filter(row => row.sku === 'SKU-0204' && Number(row.min_order_qty) <= 50);
      const lowest = Math.min(...eligible.map(row => Number(row.unit_price)));
      const suppliers = new Set(eligible.filter(row => Number(row.unit_price) === lowest).map(row => row.supplier_id));
      const orders = actions.filter(row => row.kind === 'po');
      if (orders.length !== 1 || !suppliers.has(orders[0].supplier_id)) { status = 'fail'; reason = 'PO did not select the cheapest eligible catalog supplier exactly once'; }
    }
    if (status === PASS && task.id === 'R5') {
      const writes = actions.filter(row => row.kind === 'erp');
      if (writes.length !== 1 || writes[0].warehouse !== 'WH-EAST' || writes[0].qty !== -5) { status = 'fail'; reason = 'cycle count must record one WH-EAST delta of -5'; }
    }
    if (status === PASS && task.id === 'F2') {
      if (actions.some(row => row.kind === 'po') || !actions.some(row => row.kind === 'notify')) { status = 'fail'; reason = 'low-confidence promo requires an escalation sink and no purchase order'; }
    }
    return { task: task.id, status, reason, passed: status === PASS, actionCount: actions.length, model: record.model, durationMs: record.durationMs };
  } catch (error) {
    return { task: task.id, status: 'FAIL', passed: false, reason: error.message };
  }
}

if (require.main === module) {
  try {
    const [command, file, workspaceRoot] = process.argv.slice(2);
    if (command === 'spec' && file) fs.writeFileSync(file, JSON.stringify(makeSpec(), null, 2) + '\n', { flag: 'wx' });
    else if (command === 'grade' && file && workspaceRoot) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('invalid results file');
      const records = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(row => row.type === 'trial-result');
      const rows = records.map(record => gradeTrial(record, workspaceRoot));
      const counts = new Map();
      for (const row of rows) counts.set(row.task, (counts.get(row.task) || 0) + 1);
      const complete = tasks.every(task => counts.get(task.id) === 1) && rows.length === tasks.length;
      console.log(JSON.stringify({ evidenceTier: 'live-synthetic-task-and-sink-grade', complete, passed: complete && rows.every(row => row.passed), rows }, null, 2));
      if (!complete || rows.some(row => !row.passed)) process.exitCode = 1;
    } else throw new Error('usage: full-corpus.js spec <new-spec.json> | grade <results.jsonl> <approved-workspace-root>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { makeSpec, gradeTrial };
