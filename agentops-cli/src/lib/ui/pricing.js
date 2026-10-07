// Estimated cost only. Copilot CLI bills by premium requests, not by tokens, and
// emits no cost metadata, so the local UI multiplies observed tokens by public API
// list prices to give an order-of-magnitude estimate. Never present it as billed cost.
//
// USD per 1 million tokens, standard tier, short context, 5-minute cache writes.
// Sources (checked 2026-10-07):
//   Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI:    https://developers.openai.com/api/docs/pricing
// Models that are not listed (including "-fast" variants) are shown as unknown ("—").
const PRICE_TABLE_DATE = '2026-10-07';
const PRICE_TABLE_SOURCES = Object.freeze([
  'https://platform.claude.com/docs/en/about-claude/pricing',
  'https://developers.openai.com/api/docs/pricing'
]);

const PRICES = Object.freeze({
  'claude-opus-5.5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.7': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.6': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4.5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5.5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4.6': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4.5': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
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

// usage.input is the Copilot "inputTokens" total, which already includes cache
// reads and writes; only the remainder is billed at the base input price.
function estimateModelCostUsd(model, usage = {}) {
  const price = PRICES[String(model || '').toLowerCase()];
  if (!price) return null;
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const uncached = Math.max(0, count(usage.input) - cacheRead - cacheWrite);
  return (uncached * price.input + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite + count(usage.output) * price.output) / 1e6;
}

// Returns null when any model with tokens is unpriced, so a partial sum is never shown as complete.
function estimateCostUsd(usageByModel = {}) {
  let total = 0;
  let priced = 0;
  for (const [model, usage] of Object.entries(usageByModel)) {
    if (!count(usage.input) && !count(usage.output)) continue;
    const cost = estimateModelCostUsd(model, usage);
    if (cost === null) return null;
    total += cost;
    priced += 1;
  }
  return priced ? total : null;
}

module.exports = {
  PRICES,
  PRICE_TABLE_DATE,
  PRICE_TABLE_SOURCES,
  estimateCostUsd,
  estimateModelCostUsd
};
