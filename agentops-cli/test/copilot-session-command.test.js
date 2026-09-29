const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseCopilotSessionArgs,
  renderCopilotSessionEnrichment
} = require('../src/lib/copilot/session-command');

test('copilot session command library parses args and renders enrichment summary', () => {
  assert.deepEqual(parseCopilotSessionArgs([
    'enrich',
    'session-1',
    '--file',
    'events.jsonl',
    '--output',
    'view.html',
    '--allow-content',
    '--sidecar',
    'sidecar-events.jsonl',
    '--endpoint',
    'http://127.0.0.1:4319',
    '--id',
    'import-1',
    '--dry-run',
    '--json'
  ]), {
    subcommand: 'enrich',
    sessionId: 'session-1',
    file: 'events.jsonl',
    output: 'view.html',
    allowContent: true,
    synthetic: false,
    sidecarFile: 'sidecar-events.jsonl',
    endpoint: 'http://127.0.0.1:4319',
    id: 'import-1',
    dryRun: true,
    json: true
  });
  assert.match(renderCopilotSessionEnrichment({
    session_id: 'session-1',
    source_file: 'events.jsonl',
    enriched_rows: 2,
    dry_run: true,
    ok: true,
    event_counts: { 'agent.selected': 1, 'mcp.tools.call': 1 },
    next: ['agentops open latest']
  }), /- mcp\.tools\.call: 1/);
});
