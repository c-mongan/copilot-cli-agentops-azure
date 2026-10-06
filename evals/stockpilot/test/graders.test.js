// Unit tests for evals/stockpilot/graders/index.js (Task 9, bullet 5).
//
// Required proof: each grader must correctly FAIL on (a) a deliberately
// wrong answer, (b) a missing artifact, (c) a process that exits zero but
// produced no real output, and (d) a harness/tooling error — i.e. graders
// must not rubber-stamp a technically-successful run that didn't actually
// do the task. Also proves each grader PASSes on a correct result, so the
// FAIL proofs aren't vacuously true from a grader that always fails.
//
// Zero model calls — these are pure function tests against hand-built
// `result` objects.
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const graders = require('../graders/index.js');
const tasks = require('../graders/tasks.json').tasks;
const { PASS, FAIL, SLOW, grade } = graders;

function taskById(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no such task: ${id}`);
  return t;
}

function baseResult(overrides = {}) {
  return {
    finalText: '',
    actions: [],
    turns: 1,
    tokensOut: 100,
    wallMs: 1000,
    error: null,
    ...overrides
  };
}

// --- R1 exact_match ----------------------------------------------------------

test('R1 exact_match: PASSes on the correct on-hand number', () => {
  const [status] = grade(taskById('R1'), baseResult({ finalText: 'SKU-0042 has 312 units on hand at WH-EAST.' }));
  assert.equal(status, PASS);
});

test('R1 exact_match: FAILs on a deliberately wrong number', () => {
  const [status, why] = grade(taskById('R1'), baseResult({ finalText: 'SKU-0042 has 999 units on hand at WH-EAST.' }));
  assert.equal(status, FAIL);
  assert.match(why, /expected 312/);
});

test('R1 exact_match: FAILs when the process exits zero but produced no real answer', () => {
  // Simulates exit code 0 with an empty/non-answering transcript.
  const [status] = grade(taskById('R1'), baseResult({ finalText: 'I could not determine the stock level.' }));
  assert.equal(status, FAIL);
});

test('R1 exact_match: FAILs on a harness/tooling error regardless of any text', () => {
  const [status, why] = grade(taskById('R1'), baseResult({ finalText: '312', error: 'sandbox timeout: data mount unavailable' }));
  assert.equal(status, FAIL);
  assert.match(why, /error:/);
});

// --- R2 set_match --------------------------------------------------------------

test('R2 set_match: PASSes when the full expected SKU set is present', () => {
  const [status] = grade(taskById('R2'), baseResult({ finalText: `Below reorder point: ${[...graders.expectedValue({ source: 'computed_low_stock' })].join(', ')}.` }));
  assert.equal(status, PASS);
});

test('R2 set_match: FAILs when an expected SKU is missing (deliberately wrong/incomplete answer)', () => {
  const [status, why] = grade(taskById('R2'), baseResult({ finalText: 'Below reorder point: none found.' }));
  assert.equal(status, FAIL);
  assert.match(why, /missing/);
});

test('R2 set_match: FAILs on empty output from a zero-exit run with no real content', () => {
  const [status] = grade(taskById('R2'), baseResult({ finalText: '' }));
  assert.equal(status, FAIL);
});

test('R2 set_match: FAILs on a harness error', () => {
  const [status] = grade(taskById('R2'), baseResult({ finalText: 'SKU-0183', error: 'tool execution failed: ENOENT products.csv' }));
  assert.equal(status, FAIL);
});

// --- R6 / R7 numeric_tolerance ---------------------------------------------

test('R7 numeric_tolerance: PASSes within tolerance of the computed forecast', () => {
  // ground truth forecast for SKU-0057/14d is 254 (see graders/tasks.json provenance note)
  const [status] = grade(taskById('R7'), baseResult({ finalText: 'Forecast: approximately 240 units over the next 14 days.' }));
  assert.equal(status, PASS);
});

test('R7 numeric_tolerance: FAILs on a deliberately wrong magnitude', () => {
  const [status, why] = grade(taskById('R7'), baseResult({ finalText: 'Forecast: approximately 9000 units over the next 14 days.' }));
  assert.equal(status, FAIL);
  assert.match(why, /vs target/);
});

test('R7 numeric_tolerance: FAILs when no quantity is present (missing artifact)', () => {
  const [status, why] = grade(taskById('R7'), baseResult({ finalText: 'I would need more information to forecast this.' }));
  assert.equal(status, FAIL);
  assert.match(why, /no quantity found/);
});

test('R8 numeric_tolerance: FAILs when the number is in range but the required justification is missing', () => {
  // exit-zero-but-incomplete: a plausible number with no real analysis behind it
  const [status, why] = grade(taskById('R8'), baseResult({ finalText: 'Order about 900 units.' }));
  assert.equal(status, FAIL);
  assert.match(why, /didn't cite/);
});

test('R7 numeric_tolerance: FAILs on a harness error even with a plausible number present', () => {
  const [status] = grade(taskById('R7'), baseResult({ finalText: '250 units', error: 'script.span supplier_score.py crashed' }));
  assert.equal(status, FAIL);
});

// --- R3 / R5 action_taken -----------------------------------------------------

test('R3 action_taken: PASSes when a matching PO action was recorded', () => {
  const [status] = grade(taskById('R3'), baseResult({ actions: [{ kind: 'po', sku: 'SKU-0204', qty: 50 }] }));
  assert.equal(status, PASS);
});

test('R3 action_taken: FAILs on a deliberately wrong quantity', () => {
  const [status, why] = grade(taskById('R3'), baseResult({ actions: [{ kind: 'po', sku: 'SKU-0204', qty: 999 }] }));
  assert.equal(status, FAIL);
  assert.match(why, /qty 999/);
});

test('R3 action_taken: FAILs when the PO artifact is simply missing (no action recorded)', () => {
  const [status, why] = grade(taskById('R3'), baseResult({ finalText: 'I have placed the order for 50 units.', actions: [] }));
  assert.equal(status, FAIL);
  assert.match(why, /no po/);
});

test('R5 action_taken: FAILs when the process exits zero (no error) but produced no ERP action, only prose claiming success', () => {
  // This is the specific "exit-zero-but-did-nothing" shape: no thrown
  // error, final text LOOKS like success, but result.actions is empty.
  const [status] = grade(taskById('R5'), baseResult({ finalText: 'Done — adjusted SKU-0012 at WH-EAST.', actions: [], error: null }));
  assert.equal(status, FAIL);
});

test('R5 action_taken: FAILs on a harness error even if an action was partially recorded', () => {
  const [status] = grade(taskById('R5'), baseResult({ actions: [{ kind: 'erp', sku: 'SKU-0012' }], error: 'bash: permission denied writing sinks/erp_writes.jsonl' }));
  assert.equal(status, FAIL);
});

// --- F2 regex_present ----------------------------------------------------------

test('F2 regex_present: PASSes when a numeric confidence is present', () => {
  const [status] = grade(taskById('F2'), baseResult({ finalText: 'Recommend 210 units; confidence 0.41, flagged promo_uplift_uncertain.' }));
  assert.equal(status, PASS);
});

test('F2 regex_present: FAILs when confidence is stated only in prose (the documented failure mode)', () => {
  const [status, why] = grade(taskById('F2'), baseResult({ finalText: 'Recommend 210 units; fairly confident in this given the promo.' }));
  assert.equal(status, FAIL);
  assert.match(why, /qualitatively/);
});

test('F2 regex_present: FAILs on an empty zero-exit transcript', () => {
  const [status] = grade(taskById('F2'), baseResult({ finalText: '' }));
  assert.equal(status, FAIL);
});

test('F2 regex_present: FAILs on a harness error', () => {
  const [status] = grade(taskById('F2'), baseResult({ finalText: 'confidence 0.7', error: 'forecasting script not found' }));
  assert.equal(status, FAIL);
});

// --- F3 efficiency (action_taken + turn/token budget) -------------------------

test('F3 efficiency: PASSes when enough distinct notify actions were recorded within budget', () => {
  const actions = ['SKU-0183', 'SKU-0201', 'SKU-0205'].map((sku) => ({ kind: 'notify', sku }));
  const [status] = grade(taskById('F3'), baseResult({ actions, turns: 6, tokensOut: 400 }));
  assert.equal(status, PASS);
});

test('F3 efficiency: FAILs (not merely SLOW) when too few distinct SKUs were actually notified — the "exit zero, no real output" shape (claims success, didn\'t do the batch)', () => {
  const [status, why] = grade(taskById('F3'), baseResult({ finalText: '✓ 10 alerts sent to ops.', actions: [{ kind: 'notify', sku: 'SKU-0183' }], turns: 3, tokensOut: 200 }));
  assert.equal(status, FAIL);
  assert.match(why, /only 1 distinct/);
});

test('F3 efficiency: reports SLOW (not a silent PASS) when correct but over the turn budget', () => {
  const actions = ['SKU-0183', 'SKU-0201', 'SKU-0205'].map((sku) => ({ kind: 'notify', sku }));
  const [status, why] = grade(taskById('F3'), baseResult({ actions, turns: 40, tokensOut: 400 }));
  assert.equal(status, SLOW);
  assert.match(why, /40 turns/);
});

test('F3 efficiency: FAILs on a harness error even if some notify actions were recorded', () => {
  const actions = ['SKU-0183', 'SKU-0201', 'SKU-0205'].map((sku) => ({ kind: 'notify', sku }));
  const [status] = grade(taskById('F3'), baseResult({ actions, turns: 6, tokensOut: 400, error: 'sinks/outbox.jsonl: disk full' }));
  assert.equal(status, FAIL);
});

// --- F1 composite (action_taken + wall_budget + ranked_mention) ---------------

test('F1 composite: PASSes when all three sub-checks pass', () => {
  const result = baseResult({
    actions: [{ kind: 'po', sku: 'SKU-0183', qty: 150 }],
    wallMs: 120000,
    finalText: '| SKU | days_of_cover |\n|---|---|\n| SKU-0183 | 0.0 |\n| SKU-0012 | 3.6 |'
  });
  const [status] = grade(taskById('F1'), result);
  assert.equal(status, PASS);
});

test('F1 composite: FAILs end-to-end when the PO sub-check deliberately has the wrong SKU', () => {
  const result = baseResult({
    actions: [{ kind: 'po', sku: 'SKU-0012', qty: 150 }],
    wallMs: 120000,
    finalText: '| SKU | days_of_cover |\n|---|---|\n| SKU-0012 | 3.6 |'
  });
  const [status, why] = grade(taskById('F1'), result);
  assert.equal(status, FAIL);
  assert.match(why, /no po/);
});

test('F1 composite: FAILs when the PO artifact is simply missing (actions empty, zero-exit run)', () => {
  const result = baseResult({ actions: [], wallMs: 120000, finalText: 'Low stock sweep complete.' });
  const [status] = grade(taskById('F1'), result);
  assert.equal(status, FAIL);
});

test('F1 composite: FAILs when the task ran over its wall-clock budget, even with a correct PO', () => {
  const result = baseResult({
    actions: [{ kind: 'po', sku: 'SKU-0183', qty: 150 }],
    wallMs: 400000,
    finalText: '| SKU | days_of_cover |\n|---|---|\n| SKU-0183 | 0.0 |'
  });
  const [status, why] = grade(taskById('F1'), result);
  assert.equal(status, FAIL);
  assert.match(why, /wall \(budget/);
});

test('F1 composite: FAILs on a harness error regardless of sub-check content', () => {
  const result = baseResult({
    actions: [{ kind: 'po', sku: 'SKU-0183', qty: 150 }],
    wallMs: 120000,
    finalText: '| SKU | days_of_cover |\n|---|---|\n| SKU-0183 | 0.0 |',
    error: 'batch_days_of_cover.py exited 1: products.csv not found'
  });
  const [status, why] = grade(taskById('F1'), result);
  assert.equal(status, FAIL);
  assert.match(why, /^error:/);
});

// --- R9 structural_report_check (deterministic R9 approximation) -------------

test('R9 structural_report_check: PASSes on a report with required sections, the right warehouse, and numbers', () => {
  const result = baseResult({
    finalText: '# Inventory Report — WH-EAST — week of 2026-06-15\n\n## Stockouts (on_hand = 0)\n...\n\n## Low Stock (below reorder point)\n| SKU-0183 | 0 | 150 |'
  });
  const [status] = grade(taskById('R9'), result);
  assert.equal(status, PASS);
});

test('R9 structural_report_check: FAILs when covering the wrong warehouse (deliberately wrong answer)', () => {
  const result = baseResult({
    finalText: '# Inventory Report — WH-WEST — week of 2026-06-15\n\n## Stockouts (on_hand = 0)\n...\n\n## Low Stock (below reorder point)\n| SKU-0183 | 0 | 150 |'
  });
  const [status, why] = grade(taskById('R9'), result);
  assert.equal(status, FAIL);
  assert.match(why, /doesn't mention WH-EAST/);
});

test('R9 structural_report_check: FAILs when the report is missing a required section (missing artifact)', () => {
  const result = baseResult({ finalText: '# Inventory Report — WH-EAST\n\nEverything looks fine, no concerns this week.' });
  const [status, why] = grade(taskById('R9'), result);
  assert.equal(status, FAIL);
  assert.match(why, /missing section/);
});

test('R9 structural_report_check: FAILs on a zero-exit run whose "report" has headings but no real numbers in it', () => {
  const result = baseResult({
    finalText: '# Inventory Report — WH-EAST\n\n## Stockouts (on_hand = 0)\nNone to report.\n\n## Low Stock (below reorder point)\nNone to report.'
  });
  const [status, why] = grade(taskById('R9'), result);
  assert.equal(status, FAIL);
  assert.match(why, /no concrete/);
});

test('R9 structural_report_check: FAILs on a harness error', () => {
  const result = baseResult({
    finalText: '# Inventory Report — WH-EAST\n\n## Stockouts (on_hand = 0)\nSKU-0183: 0 on hand.\n\n## Low Stock (below reorder point)\nSKU-0012: 22.',
    error: 'weekly_report.py: ModuleNotFoundError'
  });
  const [status, why] = grade(taskById('R9'), result);
  assert.equal(status, FAIL);
  assert.match(why, /^error:/);
});

// --- cross-cutting: grade() always fails fast on any harness error regardless of grader ---

test('grade(): every task grader short-circuits to FAIL on a harness error before running its own logic', () => {
  for (const task of tasks) {
    const [status, why] = grade(task, baseResult({ error: 'simulated harness crash', finalText: 'irrelevant content' }));
    assert.equal(status, FAIL, `task ${task.id} did not fail on a harness error`);
    assert.match(why, /^error:/, `task ${task.id}'s failure reason did not surface the harness error`);
  }
});

test('F2 numeric confidence accepts ordinary prose and Markdown emphasis', () => {
  for (const finalText of ['forecast confidence was **0.41**', 'Confidence is 0.41.', 'confidence of 0.41', 'confidence: 0.41']) {
    assert.equal(grade(taskById('F2'), baseResult({ finalText }))[0], PASS);
  }
});

test('F2 confidence rejects unrelated numbers and qualitative claims', () => {
  for (const finalText of ['confidence was low; order 450 units', 'confidence was uncertain. SKU sales were 0.41 units', '0.41 units; confidence is qualitative']) {
    assert.equal(grade(taskById('F2'), baseResult({ finalText }))[0], FAIL);
  }
});
