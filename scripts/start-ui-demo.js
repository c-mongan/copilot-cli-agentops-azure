#!/usr/bin/env node
'use strict';

// Synthetic sessions for the real local UI. Never reads the user's CLI homes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startUi } = require('../agentops-cli/src/lib/ui-command');

function createDemo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-synthetic-demo-'));
  const copilotHome = path.join(root, 'copilot');
  const agentOpsHome = path.join(root, 'agentops');
  fs.mkdirSync(agentOpsHome, { recursive: true });
  const scenarios = [
    { id: 'demo-denied', repo: 'synthetic-demo-permission-denied', offset: 0, outcome: 'denied', duration: 12000 },
    { id: 'demo-failed', repo: 'synthetic-demo-tool-error', offset: -3600000, outcome: 'failed', duration: 2400 },
    { id: 'demo-completed', repo: 'synthetic-demo-completed', offset: -7200000, outcome: 'ok', duration: 800 }
  ];
  for (const scenario of scenarios) {
    const start = Date.now() - 120000 + scenario.offset;
    const at = ms => new Date(start + ms).toISOString();
    const events = [];
    const add = (type, ms, data) => events.push({ type, timestamp: at(ms), id: `${scenario.id}-${events.length}`, parentId: null, data });
    add('session.start', 0, { sessionId: scenario.id, copilotVersion: 'synthetic-demo', selectedModel: 'claude-haiku-4.5', context: { cwd: `/synthetic/${scenario.repo}` } });
    add('assistant.turn_start', 100, { turnId: '0' });
    add('tool.execution_start', 1000, { toolCallId: 'read-1', toolName: 'view', turnId: '0' });
    add('tool.execution_complete', 1400, { toolCallId: 'read-1', success: true });
    add('tool.execution_start', 2000, { toolCallId: 'shell-1', toolName: 'bash', turnId: '0' });
    add('tool.execution_complete', 2000 + scenario.duration, { toolCallId: 'shell-1', success: true, shellExecution: { exitCode: 0 } });
    add('tool.execution_start', 15000, { toolCallId: 'api-1', toolName: 'fetch', turnId: '0' });
    add('tool.execution_complete', 15200, { toolCallId: 'api-1', success: scenario.outcome === 'ok', ...(scenario.outcome === 'ok' ? {} : { error: { code: scenario.outcome === 'denied' ? 'policy_denied' : 'timeout' } }) });
    add('assistant.turn_end', 16000, { turnId: '0' });
    add('session.shutdown', 17000, { currentModel: 'claude-haiku-4.5', shutdownType: 'routine', modelMetrics: { 'claude-haiku-4.5': { requests: { count: 1 }, usage: { inputTokens: 12000, outputTokens: 350, cacheReadTokens: 8000, cacheWriteTokens: 1000 } } } });
    const dir = path.join(copilotHome, 'session-state', scenario.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  }
  return { root, copilotHome, agentOpsHome, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--no-open')) throw new Error('Usage: node scripts/start-ui-demo.js [--no-open]');
  const demo = createDemo();
  let ui;
  const stop = async () => {
    if (ui) await ui.close();
    demo.cleanup();
  };
  try {
    process.stdout.write('SYNTHETIC DEMO — generated examples, not production runs or performance measurements.\n');
    ui = await startUi({ copilotHome: demo.copilotHome, agentOpsHome: demo.agentOpsHome, open: !args.includes('--no-open'), allowContent: false });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }); });
  } catch (error) {
    await stop();
    throw error;
  }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { createDemo };
