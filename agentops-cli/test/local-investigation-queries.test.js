const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  coActivationQuery,
  readOrderQuery,
  repeatedToolsQuery,
  slowScriptsQuery
} = require('../src/lib/local-investigation-queries');

// --- read-order fixtures ---------------------------------------------------

const waterfallEvents = [
  { type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: {} },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'a', toolName: 'view', arguments: { path: 'ARG_CANARY' } } },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.500Z', data: { toolCallId: 'b', toolName: 'bash' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'b', success: false, result: 'RESULT_CANARY' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'a', success: true, result: '<content>' } }
];

function readOrderDeps(overrides = {}) {
  return {
    readSessionOutbox: () => ({ sessionId: 'session-xyz', runId: 'run-123' }),
    readCopilotSessionEvents: () => waterfallEvents,
    readSessionSpanRows: () => ({ spans: [] }),
    enrichSpansWithSessionToolContext: (spans) => spans,
    ...overrides
  };
}

test('readOrderQuery resolves the session id from the local delivery outbox and replays sessionWaterfall ordering', () => {
  const result = readOrderQuery('run-123', readOrderDeps());
  assert.equal(result.ok, true);
  assert.equal(result.run_id, 'run-123');
  assert.equal(result.session_id, 'session-xyz');
  assert.equal(result.row_count, result.timeline.length);
  assert.ok(result.timeline.length > 0);
  // Ordered: the row for toolCallId 'b' (bash) should appear before 'a' (view) resolves, since bash failed first.
  const bashRow = result.timeline.find(row => row.label === 'bash');
  const viewRow = result.timeline.find(row => row.label === 'view');
  assert.ok(bashRow);
  assert.ok(viewRow);
  assert.equal(bashRow.status, 'failed');
  assert.ok(bashRow.start < viewRow.end);
  assert.equal(result.failed_row_count, 1);
});

test('readOrderQuery never leaks raw tool arguments/results into the timeline', () => {
  const result = readOrderQuery('run-123', readOrderDeps());
  assert.doesNotMatch(JSON.stringify(result), /ARG_CANARY|RESULT_CANARY/);
});

test('readOrderQuery accepts an explicit session id and skips the outbox lookup', () => {
  const result = readOrderQuery('run-123', readOrderDeps({
    sessionId: 'session-explicit',
    readSessionOutbox: () => { throw new Error('outbox should not be read when a session id is supplied'); }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.session_id, 'session-explicit');
});

test('readOrderQuery rejects an unsafe run id', () => {
  const result = readOrderQuery('../etc/passwd', readOrderDeps());
  assert.equal(result.ok, false);
  assert.match(result.error, /safe run id/);
});

test('readOrderQuery reports a clear error when no local session id can be resolved', () => {
  const result = readOrderQuery('run-123', readOrderDeps({ readSessionOutbox: () => null }));
  assert.equal(result.ok, false);
  assert.match(result.error, /No local session id resolved/);
});

test('readOrderQuery reports a clear error when local session events are missing', () => {
  const result = readOrderQuery('run-123', readOrderDeps({
    readCopilotSessionEvents: () => { throw new Error('ENOENT: no such file'); }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.session_id, 'session-xyz');
  assert.match(result.error, /No local session events were found/);
});

// --- architecture-ledger-backed canned questions ---------------------------

function sha() {
  return crypto.createHash('sha256').update(Math.random().toString()).digest('hex');
}

function architectureInventory() {
  return {
    agents: [{ name: 'reviewer', path: '.github/agents/reviewer.md', sha256: sha() }],
    skills: [
      {
        name: 'retrieve',
        path: '.github/skills/retrieve/SKILL.md',
        sha256: sha(),
        references: [],
        scripts: [{ path: '.github/skills/retrieve/scripts/fetch.py', sha256: sha() }]
      },
      {
        name: 'summarise',
        path: '.github/skills/summarise/SKILL.md',
        sha256: sha(),
        references: [],
        scripts: [{ path: '.github/skills/summarise/scripts/write.py', sha256: sha() }]
      }
    ],
    runtimeScripts: [
      { path: '.github/skills/retrieve/scripts/fetch.py', sha256: sha() },
      { path: '.github/skills/summarise/scripts/write.py', sha256: sha() }
    ]
  };
}

function skillEvent(seq, skill) {
  return { EventId: `e${seq}`, Sequence: seq, EventName: 'skill.activated', AgentId: 'reviewer', AgentName: 'reviewer', SkillName: skill };
}

function scriptEvent(seq, skill, scriptPath, { status = 'completed', durationMs = 10 } = {}) {
  return { EventId: `e${seq}`, Sequence: seq, EventName: 'script.span', AgentId: 'reviewer', AgentName: 'reviewer', SkillName: skill, ScriptName: scriptPath, Status: status, DurationMs: durationMs };
}

function toolEvent(seq, { toolCallId = `t${seq}`, resultState = null, argHash = null } = {}) {
  return { EventId: `e${seq}`, Sequence: seq, EventName: 'tool.execution_complete', AgentId: 'reviewer', AgentName: 'reviewer', ToolName: 'bash', ToolCallId: toolCallId, Status: 'completed', ResultState: resultState, ArgHash: argHash };
}

function writeLedger(root, inventory, runs) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'attachment.json'), JSON.stringify({ architecture: inventory }));
  for (const run of runs) {
    const runDir = path.join(root, run.runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'context.json'), JSON.stringify({ architectureVersion: null }));
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${run.events.map(e => JSON.stringify(e)).join('\n')}\n`);
  }
}

function buildMixedLedger(inventory) {
  const fetchScript = inventory.skills[0].scripts[0].path;
  const writeScript = inventory.skills[1].scripts[0].path;
  const runs = [];
  for (let i = 0; i < 12; i += 1) {
    const events = [skillEvent(1, 'retrieve')];
    // fetch.py: slow, occasionally fails
    events.push(scriptEvent(2, 'retrieve', fetchScript, { durationMs: 500 + i * 10, status: i < 2 ? 'failed' : 'completed' }));
    if (i % 2 === 0) {
      // summarise co-activates with retrieve in half the runs
      events.push(skillEvent(3, 'summarise'));
      events.push(scriptEvent(4, 'summarise', writeScript, { durationMs: 20 }));
    }
    if (i < 10) {
      // bash thrash: 3+ consecutive calls with no state progress in most runs
      events.push(toolEvent(5, { toolCallId: `t${i}-1`, resultState: 'stuck', argHash: 'x' }));
      events.push(toolEvent(6, { toolCallId: `t${i}-2`, resultState: 'stuck', argHash: 'x' }));
      events.push(toolEvent(7, { toolCallId: `t${i}-3`, resultState: 'stuck', argHash: 'x' }));
    } else {
      events.push(toolEvent(5, { toolCallId: `t${i}-1`, resultState: 'moved', argHash: 'a' }));
    }
    runs.push({ runId: `run-${String(i).padStart(3, '0')}`, events });
  }
  return runs;
}

test('slowScriptsQuery ranks scripts by p95 duration and reports failure rate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-slow-scripts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = architectureInventory();
  writeLedger(root, inventory, buildMixedLedger(inventory));

  const result = slowScriptsQuery(root, { top: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.question, 'slow-scripts');
  assert.ok(result.scripts.length <= 2);
  assert.ok(result.scripts.length > 0);
  // fetch.py is the slow, occasionally-failing script and must rank first.
  assert.match(result.scripts[0].script, /fetch\.py$/);
  assert.ok(result.scripts[0].p95_duration_ms > result.scripts[1]?.p95_duration_ms || result.scripts.length === 1);
  assert.ok(result.scripts[0].failure_rate > 0);
});

test('repeatedToolsQuery surfaces the thrashing tool with its coverage-based rate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-repeated-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = architectureInventory();
  writeLedger(root, inventory, buildMixedLedger(inventory));

  const result = repeatedToolsQuery(root, { top: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.question, 'repeated-tools');
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].tool, 'bash');
  assert.ok(result.tools[0].thrash_rate > 0);
  assert.equal(result.tools[0].thrash_triggered, 10);
  assert.equal(result.tools[0].coverage_runs, 12);
});

test('coActivationQuery surfaces the co-activated skill pair', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-co-activation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = architectureInventory();
  writeLedger(root, inventory, buildMixedLedger(inventory));

  const result = coActivationQuery(root, { top: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.question, 'co-activation');
  assert.equal(result.pairs.length, 1);
  assert.deepEqual([result.pairs[0].skill_a, result.pairs[0].skill_b].sort(), ['retrieve', 'summarise']);
  assert.ok(result.pairs[0].p_b_given_a > 0 || result.pairs[0].p_a_given_b > 0);
});

test('slowScriptsQuery propagates a clear error when the ledger has no attachment manifest', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-missing-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => slowScriptsQuery(root, {}), /attachment manifest/);
});
