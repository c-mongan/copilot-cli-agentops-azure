const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pricing = require('../src/lib/cost-estimate');
const data = require('../src/lib/ui/data');
const { buildDigest, parsePeriod } = require('../src/lib/digest/digest-summary');
const { readLocalSessions } = require('../src/lib/digest/session-metadata');
const { renderDigestMarkdown } = require('../src/lib/digest/render-markdown');
const { line, T0 } = require('./support/ui-fixture');

test('cost estimate: table is dated, sourced and uses per-million token prices', () => {
  assert.match(pricing.PRICE_TABLE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(pricing.PRICE_TABLE_LABEL, new RegExp(pricing.PRICE_TABLE_DATE));
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
  const loaded = pricing.loadPriceTable();
  assert.deepEqual(Object.keys(loaded.table).sort(), Object.keys(pricing.PRICES).sort(), 'digest and UI share one table');
});

test('cost estimate: cache tokens are carved out of input before pricing', () => {
  const cost = pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 60000, cacheRead: 50000, cacheWrite: 8000, output: 500 });
  assert.equal(Number(cost.toFixed(6)), 0.0195);
  assert.equal(pricing.estimateModelCostUsd('claude-haiku-4.5', { inputTokens: 60000, cacheReadTokens: 50000, cacheWriteTokens: 8000, outputTokens: 500 }), cost, 'both usage shapes price identically');
  assert.equal(pricing.estimateModelCostUsd('CLAUDE-HAIKU-4.5', { input: 1e6 }), 1);
  assert.equal(pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 10, cacheRead: 100 }), 0.00001);
  assert.equal(pricing.estimateModelCostUsd('claude-haiku-4.5', { input: 'NaN', output: -5 }), 0);
  assert.equal(pricing.estimateModelCostUsd('gpt-5.6-sol', { input: 1e6, output: 1e6 }), 24, 'known model yields the table price');
});

test('cost estimate: unpriced models are n/a and listed, never $0 or a guess', () => {
  assert.equal(pricing.estimateModelCostUsd('mystery-model', { input: 100 }), null);
  assert.equal(pricing.estimateModelCostUsd(undefined, { input: 100 }), null);
  assert.equal(pricing.estimateModelCostUsd('constructor', { input: 100 }), null, 'prototype keys are not prices');
  assert.deepEqual(pricing.estimateUsageCost({ 'claude-haiku-4.5': { input: 1e6 }, 'mystery-model': { input: 1 } }),
    { costUsd: 1, pricedModels: ['claude-haiku-4.5'], unpricedModels: ['mystery-model'] });
  assert.deepEqual(pricing.estimateUsageCost({ 'claude-haiku-4.5': { input: 1e6 }, 'mystery-model': { input: 0, output: 0 } }).unpricedModels, []);
  assert.deepEqual(pricing.estimateUsageCost({ 'mystery-model': { input: 5 } }), { costUsd: null, pricedModels: [], unpricedModels: ['mystery-model'] });
  assert.equal(pricing.estimateUsageCost({}).costUsd, null);
  assert.equal(pricing.estimateUsageCost().costUsd, null);
  assert.equal(pricing.formatCostTotal({ costUsd: 217.149, unpricedModels: [] }), '$217.15 est.');
  assert.equal(pricing.formatCostTotal({ costUsd: 1, unpricedModels: ['a'] }), '$1.00 est. (1 model unpriced)');
  assert.equal(pricing.formatCostTotal({ costUsd: 0.001, unpricedModels: ['a', 'b'] }), '<$0.01 est. (2 models unpriced)');
  assert.equal(pricing.formatCostTotal({ costUsd: null, unpricedModels: ['a'] }), 'n/a (1 model unpriced)');
  assert.equal(pricing.formatCostTotal({ costUsd: null, unpricedModels: [] }), 'n/a');
  assert.equal(pricing.formatUsd(null), 'n/a');
});

test('cost estimate: --prices overrides are case-insensitive and validated', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-prices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'prices.json');
  fs.writeFileSync(file, JSON.stringify({ 'Mystery-Model': { input: 1, output: 2 } }));
  const loaded = pricing.loadPriceTable(file);
  assert.equal(loaded.overrides, 1);
  assert.equal(pricing.estimateModelCostUsd('mystery-model', { input: 1e6, output: 1e6 }, loaded.table), 3);
});

function shutdown(ms, metrics) {
  return line('session.shutdown', ms, {
    shutdownType: 'routine',
    totalPremiumRequests: 1,
    modelMetrics: Object.fromEntries(Object.entries(metrics).map(([model, usage]) => [model, { requests: { count: 1, cost: 1 }, usage }]))
  });
}

// Same Copilot sessions read through the UI data layer and the digest must price identically.
function parityFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-cost-parity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copilotHome = path.join(root, 'copilot');
  const agentOpsHome = path.join(root, 'agentops');
  fs.mkdirSync(agentOpsHome, { recursive: true });
  const sessions = {
    'd0000000-0000-4000-8000-000000000001': {
      'claude-opus-5.5': { inputTokens: 900000, outputTokens: 4000, cacheReadTokens: 700000, cacheWriteTokens: 50000 },
      'claude-haiku-4.5': { inputTokens: 20000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 }
    },
    'd0000000-0000-4000-8000-000000000002': {
      'gpt-5.6-sol': { inputTokens: 1200000, outputTokens: 9000, cacheReadTokens: 1000000, cacheWriteTokens: 0 },
      'gpt-4o-mini': { inputTokens: 5000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }
    },
    'd0000000-0000-4000-8000-000000000003': {
      'claude-opus-5.5': { inputTokens: 100000, outputTokens: 1000, cacheReadTokens: 10000, cacheWriteTokens: 0 },
      'gpt-5.4-nano': { inputTokens: 300, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }
    }
  };
  let offset = 0;
  for (const [id, metrics] of Object.entries(sessions)) {
    const dir = path.join(copilotHome, 'session-state', id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl');
    const start = offset * 60000;
    fs.writeFileSync(file, `${[
      line('session.start', start, { sessionId: id, startTime: new Date(T0 + start).toISOString(), selectedModel: Object.keys(metrics)[0], context: { cwd: '/work/repo' } }),
      shutdown(start + 30000, metrics)
    ].join('\n')}\n`);
    fs.utimesSync(file, new Date(T0 + start + 30000), new Date(T0 + start + 30000));
    offset += 1;
  }
  // A session that never shut down: both surfaces fall back to per-call usage, deduped by call ID.
  const openId = 'd0000000-0000-4000-8000-000000000004';
  const openDir = path.join(copilotHome, 'session-state', openId);
  fs.mkdirSync(openDir, { recursive: true });
  const call = (ms, callId) => line('model.model_call_success', ms, {
    callId,
    modelCall: { model: 'claude-sonnet-5' },
    responseChunk: { usage: { prompt_tokens: 100000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 80000 } } }
  });
  const openStart = offset * 60000;
  const openFile = path.join(openDir, 'events.jsonl');
  fs.writeFileSync(openFile, `${[
    line('session.start', openStart, { sessionId: openId, startTime: new Date(T0 + openStart).toISOString(), selectedModel: 'claude-sonnet-5', context: { cwd: '/work/repo' } }),
    call(openStart + 1000, 'call-1'),
    call(openStart + 1000, 'call-1'),
    call(openStart + 2000, 'call-2')
  ].join('\n')}\n`);
  fs.utimesSync(openFile, new Date(T0 + openStart + 2000), new Date(T0 + openStart + 2000));
  return { copilotHome, agentOpsHome, nowMs: T0 + 3600000 };
}

test('cost estimate: UI data layer and digest compute the same total for the same runs', async t => {
  const fixture = parityFixture(t);
  const store = new data.RunStore({ copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome, now: () => fixture.nowMs });
  const ui = await store.list();
  const read = readLocalSessions({ copilotHome: fixture.copilotHome, agentopsHome: fixture.agentOpsHome, sinceMs: 0 });
  const digest = buildDigest({ sessions: read.sessions, nowMs: fixture.nowMs, period: parsePeriod('7d'), prices: pricing.loadPriceTable() });

  assert.equal(ui.kpis.runs, 4);
  assert.equal(digest.current.sessions, 4);
  assert.equal(typeof ui.kpis.costUsd, 'number');
  assert.equal(ui.kpis.costUsd, digest.current.tokens.estCostUsd);
  assert.deepEqual([...ui.kpis.unpricedModels].sort(), [...digest.current.tokens.unpricedModels].sort());
  assert.deepEqual([...ui.kpis.unpricedModels].sort(), ['gpt-4o-mini', 'gpt-5.4-nano']);
  assert.equal(ui.kpis.costLabel, digest.current.tokens.costLabel);
  assert.match(ui.kpis.costLabel, /^\$\d+\.\d\d est\. \(2 models unpriced\)$/);
  assert.ok(renderDigestMarkdown(digest).includes(ui.kpis.costLabel), 'digest markdown shows the same total text');

  const expected = pricing.estimateModelCostUsd('claude-opus-5.5', { inputTokens: 1000000, outputTokens: 5000, cacheReadTokens: 710000, cacheWriteTokens: 50000 })
    + pricing.estimateModelCostUsd('claude-haiku-4.5', { inputTokens: 20000, outputTokens: 300 })
    + pricing.estimateModelCostUsd('gpt-5.6-sol', { inputTokens: 1200000, outputTokens: 9000, cacheReadTokens: 1000000 })
    + pricing.estimateModelCostUsd('claude-sonnet-5', { inputTokens: 200000, outputTokens: 4000, cacheReadTokens: 160000 });
  assert.ok(Math.abs(ui.kpis.costUsd - expected) < 1e-6);

  const open = ui.runs.find(run => run.id.endsWith('4'));
  assert.equal(open.tokens.input, 200000, 'duplicate call IDs are counted once');
  assert.deepEqual(open.models, ['claude-sonnet-5']);

  const mixed = ui.runs.find(run => run.id.endsWith('3'));
  assert.deepEqual(mixed.unpricedModels, ['gpt-5.4-nano']);
  assert.match(mixed.costLabel, /\(1 model unpriced\)$/);
  const unpricedModel = digest.current.tokens.models.find(model => model.model === 'gpt-4o-mini');
  assert.equal(unpricedModel.estCostUsd, null);
  assert.match(renderDigestMarkdown(digest), /\| gpt-4o-mini \|.*\| n\/a \|/);

  const detail = await store.detail(mixed.id);
  assert.equal(detail.usageByModel.find(row => row.model === 'gpt-5.4-nano').costUsd, null);
});
