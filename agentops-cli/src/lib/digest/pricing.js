const fs = require('node:fs');

// Estimate-only seed table in USD per 1M tokens, taken from the providers'
// public pay-as-you-go API list prices (2025). Copilot does not bill this way,
// so any value derived from it is labelled "est." and never presented as a bill.
// Unknown models deliberately have no price; add them with `--prices <file.json>`.
const PRICE_TABLE_LABEL = 'Public API list prices (2025), USD per 1M tokens; an estimate, not your Copilot bill';
const DEFAULT_PRICES = Object.freeze({
  'claude-haiku-4.5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4.5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-opus-4.1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4.5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 }
});

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

function loadPriceTable(file) {
  const table = {};
  for (const [model, price] of Object.entries(DEFAULT_PRICES)) table[model] = normalizePrice(price);
  if (!file) return { table, label: PRICE_TABLE_LABEL, overrides: 0 };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--prices must be a JSON object of { "<model>": { "input": n, "output": n } } in USD per 1M tokens');
  let overrides = 0;
  for (const [model, price] of Object.entries(parsed)) {
    if (!validPrice(price)) throw new Error(`--prices entry for ${model} needs numeric input and output (USD per 1M tokens)`);
    table[model] = normalizePrice(price);
    overrides += 1;
  }
  return { table, label: `${PRICE_TABLE_LABEL}; ${overrides} model(s) from --prices`, overrides };
}

// Copilot reports inputTokens including cache reads and writes; only the
// remainder is priced at the uncached input rate.
function estimateCost(usage = {}, price) {
  if (!price) return null;
  const cacheRead = Math.max(0, Number(usage.cacheReadTokens || 0));
  const cacheWrite = Math.max(0, Number(usage.cacheWriteTokens || 0));
  const uncached = Math.max(0, Number(usage.inputTokens || 0) - cacheRead - cacheWrite);
  const output = Math.max(0, Number(usage.outputTokens || 0));
  return (uncached * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + output * price.output) / 1e6;
}

module.exports = {
  DEFAULT_PRICES,
  PRICE_TABLE_LABEL,
  estimateCost,
  loadPriceTable
};
