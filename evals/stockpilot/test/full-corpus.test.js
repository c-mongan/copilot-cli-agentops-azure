const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expectedValue } = require('../graders');
const { makeSpec, gradeTrial } = require('../scripts/full-corpus');
test('full corpus contains each authoritative task once and isolates external integrations', () => {
 const spec = makeSpec();
 assert.equal(spec.stimuli.length, 12);
 assert.equal(new Set(spec.stimuli.map(row => row.name)).size, 12);
 assert.deepEqual(spec.agent_environment.mcpServers, {});
 assert.equal(spec.defaults.runs, 1);
});
test('full corpus grades actual sink writes and fails fabricated or malformed actions', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpilot-full-'));
 const trial = path.join(root, 'trial'), sinks = path.join(trial, 'evals/stockpilot/fixtures/sinks');
 fs.mkdirSync(sinks, { recursive: true });
 const record = { stimulus: 'R3', workspacePath: trial, status: 'success', trajectory: { output: 'I placed the PO', events: [] } };
 try {
  assert.equal(gradeTrial(record, root).passed, false);
  const file = path.join(sinks, 'purchase_orders.jsonl');
  fs.writeFileSync(file, JSON.stringify({ sku: 'SKU-0204', qty: 50, supplier_id: 'SUP-02' }) + '\n');
  assert.equal(gradeTrial(record, root).passed, true);
  fs.writeFileSync(file, JSON.stringify({ sku: 'SKU-0204', qty: 50, supplier_id: 'SUP-05' }) + '\n');
  assert.equal(gradeTrial(record, root).passed, false);
  fs.writeFileSync(file, 'malformed\n');
  assert.equal(gradeTrial(record, root).passed, false);
  assert.equal(gradeTrial({ ...record, workspacePath: root }, root).passed, false);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fixture supports required alert population and declares comparable promo evidence', () => {
 assert.ok(expectedValue({ source: 'computed_low_stock' }).size >= 3);
 const { readCsv } = require('../graders');
 const promo = readCsv('promo_history.csv').find(row => row.sku === 'SKU-0116');
 assert.equal(Number(promo.promo_units) / Number(promo.baseline_units), 2);
 assert.ok(!readCsv('promo_history.csv').some(row => row.sku === 'SKU-0091'));
 assert.match(makeSpec().stimuli[0].prompt, /planning date: 2026-06-15/);
});
