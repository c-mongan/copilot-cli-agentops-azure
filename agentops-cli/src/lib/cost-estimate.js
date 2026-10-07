const fs = require('node:fs');

// The single cost estimator shared by `agentops ui`, `agentops digest` and any other
// surface that shows a dollar figure. Copilot CLI bills by premium requests, not by
// tokens, and emits no cost metadata, so these figures multiply observed tokens by
// public API list prices. They are estimates and must never be shown as a bill.
//
// USD per 1 million tokens, standard tier, short context, 5-minute cache writes.
// Models that are not listed (including "-fast" variants) are unpriced: they render
// as "n/a" and are counted as "N models unpriced", never as $0 or a guessed price.
const PRICE_TABLE_DATE = '2026-10-07';
const PRICE_TABLE_SOURCES = Object.freeze([
  'https://platform.claude.com/docs/en/about-claude/pricing',
  'https://developers.openai.com/api/docs/pricing'
]);
const PRICE_TABLE_LABEL = `Public API list prices (table dated ${PRICE_TABLE_DATE}), USD per 1M tokens; an estimate, not your Copilot bill`;

const PRICES = Object.freeze({
  'claude-opus-5.5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.7': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.6': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.1': { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  'claude-sonnet-5.5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4.6': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4.5': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-haiku-4.5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  'gpt-6-astra': { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'gpt-6-sol': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'gpt-6-luna': { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  'gpt-5.6-sol': { input: 4, cacheWrite: 5, cacheRead: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cacheWrite: 0.25, cacheRead: 0.02, output: 1.2 },
  'gpt-5.5': { input: 5, cacheWrite: 5, cacheRead: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cacheWrite: 2.5, cacheRead: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cacheWrite: 0.75, cacheRead: 0.075, output: 4.5 },
  'gpt-5.2': { input: 1.75, cacheWrite: 1.75, cacheRead: 0.175, output: 14 },
  'gpt-5.1': { input: 1.25, cacheWrite: 1.25, cacheRead: 0.125, output: 10 },
  'gpt-5': { input: 1.25, cacheWrite: 1.25, cacheRead: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cacheWrite: 0.25, cacheRead: 0.025, output: 2 },
  'gpt-4.1': { input: 2, cacheWrite: 2, cacheRead: 0.5, output: 8 }
});

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// Accepts both the UI shape ({ input, output, cacheRead, cacheWrite }) and the
// Copilot/digest shape ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }).
function normalizeUsage(usage = {}) {
  const pick = (short, long) => count(usage[short] !== undefined ? usage[short] : usage[long]);
  return {
    input: pick('input', 'inputTokens'),
    output: pick('output', 'outputTokens'),
    cacheRead: pick('cacheRead', 'cacheReadTokens'),
    cacheWrite: pick('cacheWrite', 'cacheWriteTokens')
  };
}

function hasTokens(usage) {
  const normalized = normalizeUsage(usage);
  return normalized.input > 0 || normalized.output > 0;
}

function priceFor(model, table = PRICES) {
  const key = String(model || '').toLowerCase();
  return key && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

// Copilot's inputTokens already include cache reads and writes; only the remainder
// is billed at the base input price. Returns null when the model has no price.
function estimateModelCostUsd(model, usage = {}, table = PRICES) {
  const price = priceFor(model, table);
  if (!price) return null;
  const { input, output, cacheRead, cacheWrite } = normalizeUsage(usage);
  const uncached = Math.max(0, input - cacheRead - cacheWrite);
  return (uncached * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + output * price.output) / 1e6;
}

function roundUsd(value) {
  return Math.round(value * 1e6) / 1e6;
}

// Sums one or more usage-by-model maps per model, so a set of runs is priced the
// same way whichever surface asks.
function mergeUsageByModel(maps = []) {
  const merged = Object.create(null);
  for (const usageByModel of maps) {
    for (const [model, usage] of Object.entries(usageByModel || {})) {
      if (!model) continue;
      const normalized = normalizeUsage(usage);
      const current = merged[model] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const key of Object.keys(current)) current[key] += normalized[key];
      merged[model] = current;
    }
  }
  return merged;
}

// Prices every model that has a price and lists the rest as unpriced. costUsd is
// the sum of priced models only (null when nothing is priced); callers must show
// unpricedModels alongside it, e.g. with formatCostTotal().
function estimateUsageCost(usageByModel = {}, table = PRICES) {
  let total = 0;
  const pricedModels = [];
  const unpricedModels = [];
  for (const model of Object.keys(usageByModel || {}).sort()) {
    const usage = usageByModel[model];
    if (!model || !hasTokens(usage)) continue;
    const cost = estimateModelCostUsd(model, usage, table);
    if (cost === null) {
      unpricedModels.push(model);
    } else {
      total += cost;
      pricedModels.push(model);
    }
  }
  return {
    costUsd: pricedModels.length ? roundUsd(total) : null,
    pricedModels,
    unpricedModels
  };
}

// Prices a set of runs/sessions: usage is merged per model first, so the total is
// identical in every surface given the same runs.
function estimateRunsCost(usageMaps = [], table = PRICES) {
  return estimateUsageCost(mergeUsageByModel(usageMaps), table);
}

function formatUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// The one cost wording used everywhere: "$X est.", "$X est. (N models unpriced)",
// "n/a (N models unpriced)" or "n/a".
function formatCostTotal({ costUsd = null, unpricedModels = [] } = {}) {
  const base = costUsd === null || costUsd === undefined ? 'n/a' : `${formatUsd(costUsd)} est.`;
  return unpricedModels.length ? `${base} (${plural(unpricedModels.length, 'model')} unpriced)` : base;
}

function validPrice(price) {
  return price && typeof price === 'object'
    && ['input', 'output'].every(key => price[key] !== null && price[key] !== '' && Number.isFinite(Number(price[key])) && Number(price[key]) >= 0);
}

function optionalRate(value, fallback) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizePrice(price) {
  const input = Number(price.input);
  return {
    input,
    output: Number(price.output),
    cacheRead: optionalRate(price.cacheRead, input),
    cacheWrite: optionalRate(price.cacheWrite, input)
  };
}

// Default table plus optional `--prices <file.json>` overrides (USD per 1M tokens).
function loadPriceTable(file) {
  const table = Object.create(null);
  for (const [model, price] of Object.entries(PRICES)) table[model] = normalizePrice(price);
  if (!file) return { table, label: PRICE_TABLE_LABEL, date: PRICE_TABLE_DATE, sources: PRICE_TABLE_SOURCES, overrides: 0 };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--prices must be a JSON object of { "<model>": { "input": n, "output": n } } in USD per 1M tokens');
  let overrides = 0;
  for (const [model, price] of Object.entries(parsed)) {
    if (!validPrice(price)) throw new Error(`--prices entry for ${model} needs numeric input and output (USD per 1M tokens)`);
    table[String(model).toLowerCase()] = normalizePrice(price);
    overrides += 1;
  }
  return { table, label: `${PRICE_TABLE_LABEL}; ${overrides} model(s) from --prices`, date: PRICE_TABLE_DATE, sources: PRICE_TABLE_SOURCES, overrides };
}

function pricingInfo() {
  return {
    date: PRICE_TABLE_DATE,
    sources: PRICE_TABLE_SOURCES,
    label: PRICE_TABLE_LABEL,
    models: Object.keys(PRICES).sort()
  };
}

module.exports = {
  PRICES,
  PRICE_TABLE_DATE,
  PRICE_TABLE_LABEL,
  PRICE_TABLE_SOURCES,
  estimateModelCostUsd,
  estimateRunsCost,
  estimateUsageCost,
  formatCostTotal,
  formatUsd,
  loadPriceTable,
  mergeUsageByModel,
  normalizeUsage,
  pricingInfo
};
