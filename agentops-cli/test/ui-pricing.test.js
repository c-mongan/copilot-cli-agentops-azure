const assert = require('node:assert/strict');
const test = require('node:test');

const pricing = require('../src/lib/ui/pricing');

test('ui pricing: table is dated, sourced and uses per-million token prices', () => {
  assert.match(pricing.PRICE_TABLE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(pricing.PRICE_TABLE_SOURCES.length >= 2);
  for (const source of pricing.PRICE_TABLE_SOURCES) assert.match(source, /^https:\/\//);
  for (const [model, price] of Object.entries(pricing.PRICES)) {
    assert.equal(model, model.toLowerCase());
    for (const key of ['input', 'cacheWrite', 'cacheRead', 'output']) {
      assert.equal(typeof price[key], 'number', `${model}.${key}`);
      assert.ok(price[key] >= 0 && price[key] < 1000, `${model}.${key} is per million tokens`);
    }
    assert.ok(price.cacheRead <= price.input, `${model} cache reads cost no more than input`);
  }
});

test('ui pricing: cache tokens are carved out of input before pricing', () => {
  const cost = pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 60000, cacheRead: 50000, cacheWrite: 8000, output: 500 });
  assert.equal(Number(cost.toFixed(6)), 0.0195);
  assert.equal(pricing.estimateModelCostUsd('CLAUDE-HAIKU-4.5', { input: 1e6 }), 1);
  assert.equal(pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 10, cacheRead: 100 }), 0.00001);
  assert.equal(pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 'NaN', output: -5 }), 0);
});

test('ui pricing: unknown models are unpriced rather than partially summed', () => {
  assert.equal(pricing.estimateModelCostUsd('mystery-model', { input: 100 }), null);
  assert.equal(pricing.estimateModelCostUsd(undefined, { input: 100 }), null);
  assert.equal(pricing.estimateCostUsd({ 'claude-haiku-4.5': { input: 1e6 }, 'mystery-model': { input: 1 } }), null);
  assert.equal(pricing.estimateCostUsd({ 'claude-haiku-4.5': { input: 1e6 }, 'mystery-model': { input: 0, output: 0 } }), 1);
  assert.equal(pricing.estimateCostUsd({}), null);
  assert.equal(pricing.estimateCostUsd(), null);
});
