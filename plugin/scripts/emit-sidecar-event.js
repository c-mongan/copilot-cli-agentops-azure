#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

function safeText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).slice(0, 120);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sidecarEventsPath() {
  return process.env.AGENTOPS_SIDECAR_EVENTS_PATH ||
    process.env.AGENTOPS_HOOK_EVENTS_PATH ||
    path.join(process.cwd(), '.agentops', 'sidecar-events.jsonl');
}

function appendSidecarEvent(event) {
  const file = sidecarEventsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
  return file;
}

function buildEvent(input = {}, startedAt = Date.now()) {
  const metadata = input.metadata || input.meta || {};
  const hookType = safeText(input.type || input.hookType || input.hook_type || metadata.hookType, 'notification');
  const decision = safeText(input.decision || input.permissionDecision || metadata.decision, 'observed');
  const reasonCategory = safeText(input.reasonCategory || input.reason_category || metadata.reasonCategory, '');
  const durationMs = safeNumber(input.durationMs || input.duration_ms || metadata.durationMs, Date.now() - startedAt);
  const sessionId = safeText(
    input.sessionId ||
    input.session_id ||
    input.conversationId ||
    input.conversation_id ||
    metadata.sessionId ||
    process.env.AGENTOPS_WRAPPER_SESSION_ID,
    ''
  );

  return {
    TimeGenerated: new Date().toISOString(),
    EventName: `agentops.hook.${hookType}`,
    Source: 'copilot-agentops-azure',
    'agentops.event.kind': 'hook.event',
    'agentops.event.name': `agentops.hook.${hookType}`,
    'agentops.hook.type': hookType,
    'agentops.hook.decision': decision,
    'agentops.hook.reason_category': reasonCategory,
    'agentops.hook.duration_ms': durationMs,
    'gen_ai.conversation.id': sessionId,
    'content.capture.enabled': false
  };
}

(async () => {
  const startedAt = Date.now();
  let input;
  try {
    input = JSON.parse(await readStdin() || '{}');
  } catch {
    input = {};
  }
  const event = buildEvent(input, startedAt);
  const file = appendSidecarEvent(event);

  process.stdout.write(JSON.stringify({
    timestamp: event.TimeGenerated,
    type: event['agentops.hook.type'],
    source: event.Source,
    event_file: file
  }));
  process.exit(0);
})();
