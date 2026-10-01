const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { architectureVersion, buildStaticGraph, joinLedger, joinObserved, normalizeEvent } = require('../src/lib/architecture/graph');
const { DEFAULTS, computeAllMetrics, eligibleRuns, maxConsecutiveSameTool, wilsonInterval } = require('../src/lib/architecture/metrics');
const { evaluateFindings } = require('../src/lib/architecture/findings');
const { buildReport, toInsightsRow, renderMarkdown } = require('../src/lib/architecture/report');
const { architectureCommand, computeArchitecture, loadLedgerFromDirectory } = require('../src/lib/architecture-command');

const SHA = () => crypto.createHash('sha256').update(Math.random().toString()).digest('hex');

function baseInventory() {
  return {
    agents: [
      { name: 'reviewer', path: '.github/agents/reviewer.md', sha256: SHA() },
      { name: 'planner', path: '.github/agents/planner.md', sha256: SHA() }
    ],
    skills: [
      {
        name: 'retrieve',
        path: '.github/skills/retrieve/SKILL.md',
        sha256: SHA(),
        references: [
          { path: '.github/skills/retrieve/references/catalog.md', sha256: SHA() },
          { path: '.github/skills/retrieve/references/options.md', sha256: SHA() }
        ],
        scripts: [{ path: '.github/skills/retrieve/scripts/fetch.py', sha256: SHA() }]
      },
      {
        name: 'summarise',
        path: '.github/skills/summarise/SKILL.md',
        sha256: SHA(),
        references: [{ path: '.github/skills/summarise/references/style.md', sha256: SHA() }],
        scripts: []
      },
      {
        name: 'ghost',
        path: '.github/skills/ghost/SKILL.md',
        sha256: SHA(),
        references: [],
        scripts: []
      }
    ],
    runtimeScripts: [
      { path: '.github/skills/retrieve/scripts/fetch.py', sha256: SHA() },
      { path: 'scripts/orphan.py', sha256: SHA() }
    ]
  };
}

function runId(prefix, index) { return `${prefix}-${String(index).padStart(3, '0')}`; }

function skillActivationEvent(sequence, agentName, skillName) {
  return {
    EventId: `evt-${sequence}-skill-${skillName}`,
    Sequence: sequence,
    EventName: 'skill.activated',
    AgentId: agentName,
    AgentName: agentName,
    SkillName: skillName
  };
}

function referenceReadEvent(sequence, agentName, skillName, referencePath) {
  return {
    EventId: `evt-${sequence}-ref-${referencePath}`,
    Sequence: sequence,
    EventName: 'skill.context_delivered_ref',
    AgentId: agentName,
    AgentName: agentName,
    SkillName: skillName,
    ReferenceName: referencePath
  };
}

function toolCallEvent(sequence, agentName, toolName, { toolCallId = `tc-${sequence}`, resultState = null, argHash = null, status = 'completed' } = {}) {
  return {
    EventId: `evt-${sequence}-tool-${toolCallId}`,
    Sequence: sequence,
    EventName: 'tool.execution_complete',
    AgentId: agentName,
    AgentName: agentName,
    ToolName: toolName,
    ToolCallId: toolCallId,
    Status: status,
    ResultState: resultState,
    ArgHash: argHash
  };
}

function modelCallEvent(sequence, agentName, skillName) {
  return {
    EventId: `evt-${sequence}-model-${skillName}`,
    Sequence: sequence,
    EventName: 'assistant.turn_end',
    AgentId: agentName,
    AgentName: agentName,
    SkillName: skillName,
    InputTokens: 100,
    OutputTokens: 100,
    DurationMs: 100
  };
}

function scriptEvent(sequence, agentName, skillName, scriptPath) {
  return {
    EventId: `evt-${sequence}-script-${scriptPath}`,
    Sequence: sequence,
    EventName: 'script.span',
    AgentId: agentName,
    AgentName: agentName,
    SkillName: skillName,
    ScriptName: scriptPath,
    Status: 'completed',
    DurationMs: 25
  };
}

function makeRun(id, events, extra = {}) {
  return { runId: id, architectureVersion: null, events, evidenceComplete: true, ...extra };
}

// --- Fixture ledgers -----------------------------------------------------

function healthyLedger(inventory, count = 15) {
  const runs = [];
  const refCatalog = inventory.skills[0].references[0].path;
  const refOptions = inventory.skills[0].references[1].path;
  const styleRef = inventory.skills[1].references[0].path;
  const fetchScript = inventory.skills[0].scripts[0].path;
  for (let i = 0; i < count; i += 1) {
    const sameRef = i % 3 === 0;
    const events = [];
    let seq = 1;
    if (i % 2 === 0) {
      events.push(skillActivationEvent(seq++, 'reviewer', 'retrieve'));
      if (sameRef) events.push(referenceReadEvent(seq++, 'reviewer', 'retrieve', refCatalog));
      events.push(toolCallEvent(seq++, 'reviewer', 'bash', { resultState: `state-${i}-a`, argHash: 'a' }));
      events.push(toolCallEvent(seq++, 'reviewer', 'bash', { resultState: `state-${i}-b`, argHash: 'b' }));
      events.push(scriptEvent(seq++, 'reviewer', 'retrieve', fetchScript));
    }
    if (i % 2 === 1) {
      events.push(skillActivationEvent(seq++, 'planner', 'summarise'));
      events.push(referenceReadEvent(seq++, 'planner', 'summarise', styleRef));
      events.push(modelCallEvent(seq++, 'planner', 'summarise'));
    }
    runs.push(makeRun(runId('healthy', i), events));
  }
  return runs;
}

function plantedNearMandatoryLedger(inventory, count = 15) {
  const runs = [];
  const retrieveRef = inventory.skills[0].references[0].path;
  for (let i = 0; i < count; i += 1) {
    const events = [
      skillActivationEvent(1, 'reviewer', 'retrieve'),
      referenceReadEvent(2, 'reviewer', 'retrieve', retrieveRef),
      modelCallEvent(3, 'reviewer', 'retrieve')
    ];
    runs.push(makeRun(runId('planted-nmr', i), events));
  }
  return runs;
}

function plantedCoactivatedLedger(inventory, count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [
      skillActivationEvent(1, 'reviewer', 'retrieve'),
      skillActivationEvent(2, 'reviewer', 'summarise'),
      modelCallEvent(3, 'reviewer', 'summarise')
    ];
    runs.push(makeRun(runId('planted-coact', i), events));
  }
  return runs;
}

function plantedThrashLedger(inventory, count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [skillActivationEvent(1, 'reviewer', 'retrieve')];
    const stuck = i < 10;
    if (stuck) {
      events.push(toolCallEvent(2, 'reviewer', 'bash', { toolCallId: 't1', resultState: 'frozen', argHash: 'x' }));
      events.push(toolCallEvent(3, 'reviewer', 'bash', { toolCallId: 't2', resultState: 'frozen', argHash: 'x' }));
      events.push(toolCallEvent(4, 'reviewer', 'bash', { toolCallId: 't3', resultState: 'frozen', argHash: 'x' }));
    } else {
      events.push(toolCallEvent(2, 'reviewer', 'bash', { resultState: 'moved', argHash: 'a' }));
      events.push(toolCallEvent(3, 'reviewer', 'bash', { resultState: 'moved-again', argHash: 'b' }));
    }
    runs.push(makeRun(runId('planted-thrash', i), events));
  }
  return runs;
}

function plantedMechanicalLedger(inventory, count = 12) {
  const runs = [];
  const scriptPath = inventory.skills[0].scripts[0].path;
  const contract = {
    scriptCoverage: 'complete',
    deterministicSteps: [{ skillName: 'retrieve', scriptName: scriptPath }]
  };
  for (let i = 0; i < count; i += 1) {
    const events = [skillActivationEvent(1, 'reviewer', 'retrieve')];
    const bad = i < 6;
    if (bad) {
      events.push(modelCallEvent(2, 'reviewer', 'retrieve'));
      events.push(modelCallEvent(3, 'reviewer', 'retrieve'));
      events.push(modelCallEvent(4, 'reviewer', 'retrieve'));
      events.push(modelCallEvent(5, 'reviewer', 'retrieve'));
    } else {
      events.push(scriptEvent(2, 'reviewer', 'retrieve', scriptPath));
    }
    runs.push(makeRun(runId('planted-mech', i), events, { taskContract: contract }));
  }
  return runs;
}

// --- Tests --------------------------------------------------------------

test('architectureVersion is deterministic and sha256-based', () => {
  const inventory = baseInventory();
  const first = architectureVersion(inventory);
  const second = architectureVersion(JSON.parse(JSON.stringify(inventory)));
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  const bumped = JSON.parse(JSON.stringify(inventory));
  bumped.skills[0].references[0].sha256 = SHA();
  assert.notEqual(architectureVersion(bumped), first);
});

test('buildStaticGraph produces reference and script ownership maps', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const refPath = inventory.skills[0].references[0].path;
  assert.deepEqual(graph.referenceOwners.get(refPath), ['retrieve']);
  assert.deepEqual(graph.scriptOwners.get(inventory.skills[0].scripts[0].path), ['retrieve']);
  assert.equal(graph.architectureVersion.length, 64);
});

test('joinObserved deduplicates duplicate deliveries and sorts by sequence', () => {
  const graph = buildStaticGraph(baseInventory());
  const run = makeRun('dup-1', [
    skillActivationEvent(2, 'reviewer', 'retrieve'),
    skillActivationEvent(2, 'reviewer', 'retrieve'),
    skillActivationEvent(1, 'reviewer', 'retrieve')
  ]);
  const joined = joinObserved(graph, run);
  assert.equal(joined.duplicateDeliveries, 1);
  assert.equal(joined.events.length, 2);
  assert.equal(joined.events[0].Sequence, 1);
});

test('normalizeEvent drops rows missing EventName', () => {
  assert.equal(normalizeEvent({ Sequence: 1 }), null);
  assert.equal(normalizeEvent(null), null);
  assert.ok(normalizeEvent({ EventName: 'skill.activated' }));
});

test('wilsonInterval returns 0..0 for empty denominator and 0..1 bounds otherwise', () => {
  assert.deepEqual(wilsonInterval(0, 0), { lower: 0, upper: 0 });
  const w = wilsonInterval(9, 10);
  assert.ok(w.lower > 0 && w.lower < 1);
  assert.ok(w.upper > w.lower);
  assert.ok(w.upper <= 1);
});

test('maxConsecutiveSameTool detects frozen state repeats', () => {
  const best = maxConsecutiveSameTool([
    { eventName: 'tool.execution_complete', tool: 'bash', resultState: 'a', argHash: 'x' },
    { eventName: 'tool.execution_complete', tool: 'bash', resultState: 'a', argHash: 'x' },
    { eventName: 'tool.execution_complete', tool: 'bash', resultState: 'a', argHash: 'x' }
  ]);
  assert.equal(best.count, 3);
  assert.equal(best.confirmedByState, true);
});

test('healthy ledger produces zero in-scope cards', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = healthyLedger(inventory, 15);
  const { joined } = joinLedger(graph, runs.map(run => ({ ...run, architectureVersion: graph.architectureVersion })));
  const findings = evaluateFindings(graph, joined);
  const nonInformational = findings.cards.filter(card => card.rule !== 'DECLARED_NOT_OBSERVED');
  assert.deepEqual(nonInformational.map(card => card.rule), []);
});

test('planted ledgers produce exactly the four expected planted cards (one of each rule)', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const scenarios = {
    REFERENCE_NEAR_MANDATORY: plantedNearMandatoryLedger(inventory, 15),
    SKILL_PAIR_COACTIVATED: plantedCoactivatedLedger(inventory, 15),
    TOOL_THRASH: plantedThrashLedger(inventory, 15),
    MECHANICAL_LLM_STEP: plantedMechanicalLedger(inventory, 12)
  };
  const triggered = new Set();
  for (const [ruleName, runs] of Object.entries(scenarios)) {
    const stamped = runs.map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
    const { joined } = joinLedger(graph, stamped);
    const findings = evaluateFindings(graph, joined);
    const planted = findings.cards.filter(card => card.rule !== 'DECLARED_NOT_OBSERVED');
    const rules = new Set(planted.map(card => card.rule));
    assert.ok(rules.has(ruleName), `scenario ${ruleName} failed to trigger its planted rule; got [${[...rules].join(',')}]`);
    for (const rule of rules) triggered.add(rule);
    if (ruleName === 'TOOL_THRASH') {
      const thrash = planted.find(card => card.rule === 'TOOL_THRASH');
      assert.equal(thrash.subStatus, 'confirmed-by-state-evidence');
    }
    if (ruleName === 'MECHANICAL_LLM_STEP') {
      const mech = planted.find(card => card.rule === 'MECHANICAL_LLM_STEP');
      assert.equal(mech.subStatus, 'pilot-hypothesis');
    }
    assert.ok(findings.deferredRules.includes('SUBAGENT_LOW_VALUE'));
    assert.ok(findings.deferredRules.includes('PROGRESSIVE_INDIRECTION'));
  }
  assert.deepEqual([...triggered].sort(), [
    'MECHANICAL_LLM_STEP',
    'REFERENCE_NEAR_MANDATORY',
    'SKILL_PAIR_COACTIVATED',
    'TOOL_THRASH'
  ]);
});

test('<10 runs produces insufficient-evidence and no cards', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = plantedNearMandatoryLedger(inventory, 5).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, runs);
  const findings = evaluateFindings(graph, joined);
  assert.equal(findings.insufficientEvidence, true);
  assert.deepEqual(findings.cards, []);
});

test('missing-fields rows are skipped by normalizeEvent, not counted as positives', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const broken = Array.from({ length: 12 }, (_, i) => makeRun(runId('broken', i), [
    { Sequence: 1 },
    skillActivationEvent(2, 'reviewer', 'retrieve')
  ], { architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, broken);
  const findings = evaluateFindings(graph, joined);
  const nonInformational = findings.cards.filter(card => card.rule !== 'DECLARED_NOT_OBSERVED');
  assert.deepEqual(nonInformational, []);
});

test('ambiguous ownership is marked on reference-load-given-skill rows', () => {
  const inventory = baseInventory();
  inventory.skills[1].references.push({ path: inventory.skills[0].references[0].path, sha256: inventory.skills[0].references[0].sha256 });
  const graph = buildStaticGraph(inventory);
  const refPath = inventory.skills[0].references[0].path;
  assert.equal((graph.referenceOwners.get(refPath) || []).length, 2);
  const runs = Array.from({ length: 12 }, (_, i) => makeRun(runId('amb', i), [
    skillActivationEvent(1, 'reviewer', 'retrieve'),
    referenceReadEvent(2, 'reviewer', 'retrieve', refPath)
  ], { architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, runs);
  const metrics = computeAllMetrics(graph, joined);
  const row = metrics.referenceLoadGivenSkill.find(r => r.reference === refPath && r.skill === 'retrieve');
  assert.equal(row.ambiguousOwnership, true);
});

test('mixed architecture versions: only matching-version runs are eligible', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = [
    ...plantedNearMandatoryLedger(inventory, 10).map(run => ({ ...run, architectureVersion: graph.architectureVersion })),
    ...plantedNearMandatoryLedger(inventory, 10).map(run => ({ ...run, architectureVersion: 'other-version' }))
  ];
  const { joined } = joinLedger(graph, runs);
  const eligible = eligibleRuns(graph, joined);
  assert.equal(eligible.length, 10);
});

test('duplicate delivery is deduped before metrics', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const run = makeRun('dup-run', [
    skillActivationEvent(1, 'reviewer', 'retrieve'),
    skillActivationEvent(1, 'reviewer', 'retrieve'),
    referenceReadEvent(2, 'reviewer', 'retrieve', inventory.skills[0].references[0].path)
  ], { architectureVersion: graph.architectureVersion });
  const { joined } = joinLedger(graph, [run]);
  assert.equal(joined[0].duplicateDeliveries, 1);
  assert.equal(joined[0].events.length, 2);
});

test('TOOL_THRASH without result-state evidence falls back to suspected-by-name-only', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = Array.from({ length: 15 }, (_, i) => {
    const events = [skillActivationEvent(1, 'reviewer', 'retrieve')];
    if (i < 10) {
      events.push(toolCallEvent(2, 'reviewer', 'bash', { toolCallId: 'a' }));
      events.push(toolCallEvent(3, 'reviewer', 'bash', { toolCallId: 'b' }));
      events.push(toolCallEvent(4, 'reviewer', 'bash', { toolCallId: 'c' }));
    } else {
      events.push(toolCallEvent(2, 'reviewer', 'other'));
    }
    return makeRun(runId('nostate', i), events, { architectureVersion: graph.architectureVersion });
  });
  const { joined } = joinLedger(graph, runs);
  const findings = evaluateFindings(graph, joined);
  const thrash = findings.cards.find(card => card.rule === 'TOOL_THRASH');
  assert.equal(thrash.subStatus, 'suspected-by-name-only');
});

test('DECLARED_NOT_OBSERVED emits "review whether needed", never "remove"', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = healthyLedger(inventory, 12).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, runs);
  const findings = evaluateFindings(graph, joined);
  const dno = findings.cards.filter(card => card.rule === 'DECLARED_NOT_OBSERVED');
  assert.ok(dno.length > 0, 'expected at least one declared-not-observed card for the ghost skill');
  for (const card of dno) {
    assert.doesNotMatch(card.proposedChange, /\bremove\b/i, `DECLARED_NOT_OBSERVED must not recommend removal: ${card.proposedChange}`);
    assert.match(card.proposedChange, /review whether/i);
  }
});

test('property: shrinking the eligible run set never increases numerator or denominator', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const fullRuns = plantedNearMandatoryLedger(inventory, 15).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined: joinedFull } = joinLedger(graph, fullRuns);
  const metricsFull = computeAllMetrics(graph, joinedFull);
  for (let drop = 1; drop < fullRuns.length; drop += 3) {
    const subset = fullRuns.slice(0, fullRuns.length - drop);
    const { joined: joinedSubset } = joinLedger(graph, subset);
    const metricsSubset = computeAllMetrics(graph, joinedSubset);
    for (const row of metricsSubset.referenceLoadGivenSkill) {
      const match = metricsFull.referenceLoadGivenSkill.find(r => r.skill === row.skill && r.reference === row.reference);
      assert.ok(match, 'metric row must exist in the fuller set');
      assert.ok(row.numerator <= match.numerator, `numerator must not increase as eligibility shrinks (subset=${row.numerator}, full=${match.numerator})`);
      assert.ok(row.denominator <= match.denominator, `denominator must not increase as eligibility shrinks`);
    }
  }
});

test('property: excluding runs can legitimately change a rate (sanity check against the invalid "rates never change" assertion)', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const refPath = inventory.skills[0].references[0].path;
  const runs = [];
  for (let i = 0; i < 12; i += 1) {
    const events = [skillActivationEvent(1, 'reviewer', 'retrieve')];
    if (i < 11) events.push(referenceReadEvent(2, 'reviewer', 'retrieve', refPath));
    runs.push(makeRun(runId('mix', i), events, { architectureVersion: graph.architectureVersion }));
  }
  const { joined: joinedAll } = joinLedger(graph, runs);
  const fullRate = computeAllMetrics(graph, joinedAll).referenceLoadGivenSkill
    .find(row => row.skill === 'retrieve' && row.reference === refPath).rate;
  const { joined: joinedTrim } = joinLedger(graph, runs.filter(run => run.runId !== 'mix-011'));
  const trimmedRate = computeAllMetrics(graph, joinedTrim).referenceLoadGivenSkill
    .find(row => row.skill === 'retrieve' && row.reference === refPath).rate;
  assert.notEqual(fullRate, trimmedRate, 'removing the one no-reference run must change the rate (not asserting stability)');
});

test('toInsightsRow projects cards onto the AgentOpsInsights_CL schema', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = plantedNearMandatoryLedger(inventory, 12).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, runs);
  const findings = evaluateFindings(graph, joined);
  const card = findings.cards.find(c => c.rule === 'REFERENCE_NEAR_MANDATORY');
  const row = toInsightsRow(card);
  const expectedKeys = ['TimeGenerated', 'InsightId', 'InsightType', 'Severity', 'RunId', 'TraceId', 'Title', 'Summary', 'SuggestedNextStep',
    'Rule', 'ArchitectureVersion', 'Numerator', 'Denominator', 'CoverageRuns', 'Status', 'ComponentRefs', 'Evidence', 'SchemaVersion'];
  for (const key of expectedKeys) assert.ok(key in row, `missing column ${key}`);
  assert.equal(row.Rule, 'REFERENCE_NEAR_MANDATORY');
  assert.equal(row.ArchitectureVersion, graph.architectureVersion);
  assert.ok(Number.isInteger(row.Numerator));
  assert.ok(Number.isInteger(row.Denominator));
});

test('loadLedgerFromDirectory reads attachment.json plus per-run subdirectories', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-arch-ledger-'));
  try {
    const inventory = baseInventory();
    fs.writeFileSync(path.join(tempRoot, 'attachment.json'), JSON.stringify({ architecture: inventory }));
    const runDir = path.join(tempRoot, 'run-abc');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'context.json'), JSON.stringify({ architectureVersion: architectureVersion(inventory), taskContract: null }));
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), [skillActivationEvent(1, 'reviewer', 'retrieve')].map(e => JSON.stringify(e)).join('\n') + '\n');
    const loaded = loadLedgerFromDirectory(tempRoot);
    assert.equal(loaded.runs.length, 1);
    assert.equal(loaded.runs[0].runId, 'run-abc');
    assert.equal(loaded.runs[0].events.length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('architectureCommand help and flag parse', () => {
  const inventory = baseInventory();
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-arch-cmd-'));
  const outDir = path.join(tempRoot, 'out');
  try {
    fs.writeFileSync(path.join(tempRoot, 'attachment.json'), JSON.stringify({ architecture: inventory }));
    const avHash = architectureVersion(inventory);
    for (let i = 0; i < 12; i += 1) {
      const d = path.join(tempRoot, runId('cmd', i));
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'context.json'), JSON.stringify({ architectureVersion: avHash }));
      fs.writeFileSync(path.join(d, 'events.jsonl'), JSON.stringify(skillActivationEvent(1, 'reviewer', 'retrieve')) + '\n' +
        JSON.stringify(referenceReadEvent(2, 'reviewer', 'retrieve', inventory.skills[0].references[0].path)) + '\n');
    }
    let out = '';
    const stdout = { write: chunk => { out += chunk; } };
    const payload = architectureCommand(['--ledger', tempRoot, '--out', outDir, '--json'], { stdout });
    assert.equal(payload.ok, true);
    assert.equal(payload.coverage_runs, 12);
    assert.ok(payload.cards.some(card => card.rule === 'REFERENCE_NEAR_MANDATORY'));
    assert.ok(fs.existsSync(path.join(outDir, 'architecture-report.json')));
    assert.ok(fs.existsSync(path.join(outDir, 'architecture-report.md')));
    assert.ok(fs.existsSync(path.join(outDir, 'AgentOpsInsights_CL.jsonl')));
    assert.ok(out.includes('"ok": true'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('architectureCommand --help prints the exact flag set', () => {
  let out = '';
  const result = architectureCommand(['--help'], { stdout: { write: chunk => { out += chunk; } } });
  assert.equal(result.action, 'help');
  assert.match(out, /--ledger/);
  assert.match(out, /--json/);
  assert.match(out, /--out/);
  assert.match(out, /--upload/);
});

test('renderMarkdown prints card titles and the deferred-rule note', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const runs = plantedThrashLedger(inventory, 15).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, runs);
  const findings = evaluateFindings(graph, joined);
  const { report } = buildReport({ graph, findings });
  const md = renderMarkdown(report);
  assert.match(md, /# AgentOps architecture report/);
  assert.match(md, /TOOL_THRASH/);
  assert.match(md, /Deferred rules/);
});

test('duplicate delivery across the full fixture does not inflate planted counts', () => {
  const inventory = baseInventory();
  const graph = buildStaticGraph(inventory);
  const base = plantedNearMandatoryLedger(inventory, 15).map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const doubled = base.map(run => ({ ...run, events: [...run.events, ...run.events] }));
  const { joined: joinedBase } = joinLedger(graph, base);
  const { joined: joinedDouble } = joinLedger(graph, doubled);
  const baseMetric = computeAllMetrics(graph, joinedBase).referenceLoadGivenSkill
    .find(row => row.reference === inventory.skills[0].references[0].path);
  const doubleMetric = computeAllMetrics(graph, joinedDouble).referenceLoadGivenSkill
    .find(row => row.reference === inventory.skills[0].references[0].path);
  assert.equal(baseMetric.numerator, doubleMetric.numerator);
  assert.equal(baseMetric.denominator, doubleMetric.denominator);
});
