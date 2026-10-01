// Local proof that the StockPilot fixture's static structure is CAPABLE of
// producing Task 6's architecture-engine findings for each planted flaw,
// and produces NONE of the four flaw findings for the healthy base.
//
// This makes ZERO model calls. It hand-builds synthetic event ledgers
// (the same shape agentops-cli/test/architecture.test.js uses for its own
// generic fixtures) using StockPilot's real component names, and feeds
// them directly through agentops-cli's existing, already-tested
// architecture engine functions via a plain relative `require`. No new
// npm dependency is added to agentops-cli's own package.json by this file
// — it is a sibling Node test under evals/stockpilot/, run with
// `node --test`, same as any other test in this repo.
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');

const ARCH = path.join(__dirname, '..', '..', '..', 'agentops-cli', 'src', 'lib', 'architecture');
const { buildStaticGraph, joinLedger } = require(path.join(ARCH, 'graph'));
const { evaluateFindings } = require(path.join(ARCH, 'findings'));

const SHA = () => crypto.createHash('sha256').update(Math.random().toString()).digest('hex');

// --- StockPilot-shaped static inventory ------------------------------------

function stockpilotInventory() {
  return {
    agents: [
      { name: 'stockpilot', path: 'evals/stockpilot/fixtures/agents/stockpilot.agent.md', sha256: SHA() }
    ],
    skills: [
      {
        name: 'forecasting',
        path: 'evals/stockpilot/fixtures/skills/forecasting/SKILL.md',
        sha256: SHA(),
        references: [],
        scripts: [
          { path: 'evals/stockpilot/fixtures/skills/forecasting/scripts/rolling_mean.py', sha256: SHA() },
          { path: 'evals/stockpilot/fixtures/skills/forecasting/scripts/batch_days_of_cover.py', sha256: SHA() }
        ]
      },
      {
        name: 'notify-templates',
        path: 'evals/stockpilot/fixtures/skills/notify-templates/SKILL.md',
        sha256: SHA(),
        references: [],
        scripts: []
      },
      {
        name: 'reorder-policy',
        path: 'evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md',
        sha256: SHA(),
        references: [
          { path: 'evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md#compliance', sha256: SHA() }
        ],
        scripts: []
      },
      {
        name: 'supplier-selection',
        path: 'evals/stockpilot/fixtures/skills/supplier-selection/SKILL.md',
        sha256: SHA(),
        references: [],
        scripts: [{ path: 'supplier_score.py', sha256: SHA() }]
      },
      {
        name: 'weekly-report',
        path: 'evals/stockpilot/fixtures/skills/weekly-report/SKILL.md',
        sha256: SHA(),
        references: [],
        scripts: []
      }
    ],
    runtimeScripts: [
      { path: 'evals/stockpilot/fixtures/skills/forecasting/scripts/rolling_mean.py', sha256: SHA() },
      { path: 'evals/stockpilot/fixtures/skills/forecasting/scripts/batch_days_of_cover.py', sha256: SHA() },
      { path: 'supplier_score.py', sha256: SHA() }
    ]
  };
}

// --- event builder helpers (same shape as agentops-cli/test/architecture.test.js) --

function runId(prefix, index) { return `stockpilot-${prefix}-${String(index).padStart(3, '0')}`; }

function skillActivationEvent(sequence, skillName) {
  return {
    EventId: `evt-${sequence}-skill-${skillName}`,
    Sequence: sequence,
    EventName: 'skill.activated',
    AgentId: 'stockpilot',
    AgentName: 'stockpilot',
    SkillName: skillName
  };
}

function referenceReadEvent(sequence, skillName, referencePath) {
  return {
    EventId: `evt-${sequence}-ref-${referencePath}`,
    Sequence: sequence,
    EventName: 'skill.context_delivered_ref',
    AgentId: 'stockpilot',
    AgentName: 'stockpilot',
    SkillName: skillName,
    ReferenceName: referencePath
  };
}

function toolCallEvent(sequence, toolName, { toolCallId = `tc-${sequence}`, resultState = null, argHash = null } = {}) {
  return {
    EventId: `evt-${sequence}-tool-${toolCallId}`,
    Sequence: sequence,
    EventName: 'tool.execution_complete',
    AgentId: 'stockpilot',
    AgentName: 'stockpilot',
    ToolName: toolName,
    ToolCallId: toolCallId,
    Status: 'completed',
    ResultState: resultState,
    ArgHash: argHash
  };
}

function modelCallEvent(sequence, skillName) {
  return {
    EventId: `evt-${sequence}-model-${skillName}`,
    Sequence: sequence,
    EventName: 'assistant.turn_end',
    AgentId: 'stockpilot',
    AgentName: 'stockpilot',
    SkillName: skillName,
    InputTokens: 100,
    OutputTokens: 100,
    DurationMs: 100
  };
}

function scriptEvent(sequence, skillName, scriptPath) {
  return {
    EventId: `evt-${sequence}-script-${scriptPath}`,
    Sequence: sequence,
    EventName: 'script.span',
    AgentId: 'stockpilot',
    AgentName: 'stockpilot',
    SkillName: skillName,
    ScriptName: scriptPath,
    Status: 'completed',
    DurationMs: 25
  };
}

function makeRun(id, events, extra = {}) {
  return { runId: id, architectureVersion: null, events, evidenceComplete: true, ...extra };
}

// --- healthy negative-control ledger ----------------------------------------
// Mirrors fixtures/: reorder-policy reads its compliance reference only on
// PO-placing runs (a minority); weekly-report and notify-templates activate
// independently of each other; the notify-outbox-append tool is called once
// per batch with distinct state each time (no thrash); supplier-selection
// invokes its designated script.

function healthyLedger(count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [];
    let seq = 1;
    const bucket = i % 5;
    if (bucket === 0) {
      // reorder-policy, PO-placing (reads compliance reference) — minority of reorder-policy runs
      events.push(skillActivationEvent(seq++, 'reorder-policy'));
      events.push(referenceReadEvent(seq++, 'reorder-policy', 'evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md#compliance'));
      events.push(toolCallEvent(seq++, 'erp-write', { resultState: `po-${i}`, argHash: `a${i}` }));
    } else if (bucket === 1) {
      // reorder-policy, non-PO question — does NOT read the compliance reference
      events.push(skillActivationEvent(seq++, 'reorder-policy'));
      events.push(modelCallEvent(seq++, 'reorder-policy'));
    } else if (bucket === 2) {
      // weekly-report alone (read-only, no notification)
      events.push(skillActivationEvent(seq++, 'weekly-report'));
      events.push(scriptEvent(seq++, 'weekly-report', 'weekly_report.py'));
    } else if (bucket === 3) {
      // notify-templates alone (unrelated alert/email task) — batched single append
      events.push(skillActivationEvent(seq++, 'notify-templates'));
      events.push(toolCallEvent(seq++, 'notify-outbox-append', { toolCallId: `nt-${i}`, resultState: `sent-${i}`, argHash: `b${i}` }));
    } else {
      // supplier-selection: designated script invoked, no excess model reasoning
      events.push(skillActivationEvent(seq++, 'supplier-selection'));
      events.push(scriptEvent(seq++, 'supplier-selection', 'supplier_score.py'));
    }
    runs.push(makeRun(runId('healthy', i), events, {
      taskContract: { scriptCoverage: 'complete', deterministicSteps: [{ skillName: 'supplier-selection', scriptName: 'supplier_score.py' }] }
    }));
  }
  return runs;
}

// --- planted-reference-near-mandatory ledger --------------------------------

function plantedReferenceNearMandatoryLedger(count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [
      skillActivationEvent(1, 'reorder-policy'),
      referenceReadEvent(2, 'reorder-policy', 'evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md#compliance'),
      modelCallEvent(3, 'reorder-policy')
    ];
    runs.push(makeRun(runId('planted-refmand', i), events));
  }
  return runs;
}

// --- planted-coactivated-skill-pair ledger ----------------------------------

function plantedCoactivatedLedger(count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [
      skillActivationEvent(1, 'weekly-report'),
      skillActivationEvent(2, 'notify-templates'),
      scriptEvent(3, 'weekly-report', 'weekly_report.py'),
      toolCallEvent(4, 'notify-outbox-append', { toolCallId: `nt-coact-${i}`, resultState: `status-${i}`, argHash: `c${i}` })
    ];
    runs.push(makeRun(runId('planted-coact', i), events));
  }
  return runs;
}

// --- planted-mechanical-llm-step ledger -------------------------------------

function plantedMechanicalLedger(count = 12) {
  const runs = [];
  const contract = {
    scriptCoverage: 'complete',
    deterministicSteps: [{ skillName: 'supplier-selection', scriptName: 'supplier_score.py' }]
  };
  for (let i = 0; i < count; i += 1) {
    const events = [skillActivationEvent(1, 'supplier-selection')];
    const bad = i < 6; // reasons in prose instead of invoking the designated script
    if (bad) {
      events.push(modelCallEvent(2, 'supplier-selection'));
      events.push(modelCallEvent(3, 'supplier-selection'));
      events.push(modelCallEvent(4, 'supplier-selection'));
      events.push(modelCallEvent(5, 'supplier-selection'));
    } else {
      events.push(scriptEvent(2, 'supplier-selection', 'supplier_score.py'));
    }
    runs.push(makeRun(runId('planted-mech', i), events, { taskContract: contract }));
  }
  return runs;
}

// --- planted-tool-thrash ledger ----------------------------------------------

function plantedToolThrashLedger(count = 15) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    const events = [skillActivationEvent(1, 'notify-templates')];
    const stuck = i < 10; // naive per-SKU loop, no batch guidance to stop it
    if (stuck) {
      events.push(toolCallEvent(2, 'notify-outbox-append', { toolCallId: 't1', resultState: 'pending', argHash: 'x' }));
      events.push(toolCallEvent(3, 'notify-outbox-append', { toolCallId: 't2', resultState: 'pending', argHash: 'x' }));
      events.push(toolCallEvent(4, 'notify-outbox-append', { toolCallId: 't3', resultState: 'pending', argHash: 'x' }));
    } else {
      events.push(toolCallEvent(2, 'notify-outbox-append', { resultState: `sent-${i}-a`, argHash: `d${i}a` }));
      events.push(toolCallEvent(3, 'notify-outbox-append', { resultState: `sent-${i}-b`, argHash: `d${i}b` }));
    }
    runs.push(makeRun(runId('planted-thrash', i), events));
  }
  return runs;
}

// --- test helpers -------------------------------------------------------------

function findingsFor(inventory, runs) {
  const graph = buildStaticGraph(inventory);
  const joinedRuns = runs.map(run => ({ ...run, architectureVersion: graph.architectureVersion }));
  const { joined } = joinLedger(graph, joinedRuns);
  return evaluateFindings(graph, joined);
}

function rulesPresent(result) {
  return new Set(result.cards.map(card => card.rule));
}

// --- tests --------------------------------------------------------------------

test('healthy StockPilot ledger triggers none of the four planted-flaw rules', () => {
  const inventory = stockpilotInventory();
  const result = findingsFor(inventory, healthyLedger(15));
  assert.equal(result.insufficientEvidence, false);
  const rules = rulesPresent(result);
  assert.equal(rules.has('REFERENCE_NEAR_MANDATORY'), false);
  assert.equal(rules.has('SKILL_PAIR_COACTIVATED'), false);
  assert.equal(rules.has('TOOL_THRASH'), false);
  assert.equal(rules.has('MECHANICAL_LLM_STEP'), false);
});

test('planted-reference-near-mandatory ledger triggers REFERENCE_NEAR_MANDATORY on reorder-policy', () => {
  const inventory = stockpilotInventory();
  const result = findingsFor(inventory, plantedReferenceNearMandatoryLedger(15));
  const card = result.cards.find(c => c.rule === 'REFERENCE_NEAR_MANDATORY');
  assert.ok(card, 'expected a REFERENCE_NEAR_MANDATORY card');
  assert.deepEqual(
    card.componentRefs.map(ref => ref.name || ref.path).sort(),
    ['evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md#compliance', 'reorder-policy'].sort()
  );
  assert.equal(card.metricEvidence.numerator, 15);
  assert.equal(card.metricEvidence.denominator, 15);
});

test('planted-coactivated-skill-pair ledger triggers SKILL_PAIR_COACTIVATED for weekly-report/notify-templates', () => {
  const inventory = stockpilotInventory();
  const result = findingsFor(inventory, plantedCoactivatedLedger(15));
  const card = result.cards.find(c => c.rule === 'SKILL_PAIR_COACTIVATED');
  assert.ok(card, 'expected a SKILL_PAIR_COACTIVATED card');
  const names = card.componentRefs.map(ref => ref.name).sort();
  assert.deepEqual(names, ['notify-templates', 'weekly-report']);
});

test('planted-mechanical-llm-step ledger triggers MECHANICAL_LLM_STEP on supplier-selection', () => {
  const inventory = stockpilotInventory();
  const result = findingsFor(inventory, plantedMechanicalLedger(12));
  const card = result.cards.find(c => c.rule === 'MECHANICAL_LLM_STEP');
  assert.ok(card, 'expected a MECHANICAL_LLM_STEP card');
  assert.deepEqual(
    card.componentRefs,
    [
      { kind: 'skill', name: 'supplier-selection' },
      { kind: 'script', path: 'supplier_score.py' }
    ]
  );
  assert.equal(card.metricEvidence.numerator, 6);
  assert.equal(card.metricEvidence.denominator, 12);
});

test('planted-tool-thrash ledger triggers TOOL_THRASH on notify-outbox-append', () => {
  const inventory = stockpilotInventory();
  const result = findingsFor(inventory, plantedToolThrashLedger(15));
  const card = result.cards.find(c => c.rule === 'TOOL_THRASH');
  assert.ok(card, 'expected a TOOL_THRASH card');
  assert.equal(card.componentRefs[0].name, 'notify-outbox-append');
  assert.equal(card.subStatus, 'confirmed-by-state-evidence');
});

test('each planted ledger triggers ONLY its one expected rule (isolation holds)', () => {
  const inventory = stockpilotInventory();
  const expectations = [
    ['REFERENCE_NEAR_MANDATORY', plantedReferenceNearMandatoryLedger(15)],
    ['SKILL_PAIR_COACTIVATED', plantedCoactivatedLedger(15)],
    ['MECHANICAL_LLM_STEP', plantedMechanicalLedger(12)],
    ['TOOL_THRASH', plantedToolThrashLedger(15)]
  ];
  for (const [expectedRule, runs] of expectations) {
    const result = findingsFor(inventory, runs);
    const rules = rulesPresent(result);
    const otherFlawRules = ['REFERENCE_NEAR_MANDATORY', 'SKILL_PAIR_COACTIVATED', 'MECHANICAL_LLM_STEP', 'TOOL_THRASH']
      .filter(rule => rule !== expectedRule);
    for (const otherRule of otherFlawRules) {
      assert.equal(rules.has(otherRule), false, `${expectedRule}'s ledger unexpectedly also triggered ${otherRule}`);
    }
    assert.equal(rules.has(expectedRule), true, `${expectedRule}'s ledger did not trigger its own rule`);
  }
});
