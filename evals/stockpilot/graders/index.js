// Deterministic outcome graders for the StockPilot eval tasks (Task 9,
// bullet 5). Ported from the workshop's `evals/graders.py`
// (commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8 — see
// evals/stockpilot/PROVENANCE.md) with the same grader names, pass/fail
// semantics, and composite/efficiency behavior, adapted to this fixture's
// smaller synthetic dataset and to plain JS (no Python runtime needed to
// grade a result).
//
// Every grader here is a pure function over an already-produced `result`
// object — no model call, no network call. The one grader the workshop
// had that DOES call a model (`llm_judge`, used for task R9) is
// deliberately NOT ported; see ATTRIBUTION.md. R9 here uses a deterministic
// structural approximation instead (see `structuralReportCheck` below).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'fixtures', 'data');
const SKU_RE = /SKU-\d{4}/g;
const SUP_RE = /SUP-\d{2}/g;
const NUM_RE = /(\d[\d,]*\.?\d*)/g;

const PASS = 'pass';
const FAIL = 'fail';
const SLOW = 'pass-slow';

function nums(text) {
  const out = [];
  for (const m of String(text || '').matchAll(NUM_RE)) {
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

// --- tiny CSV reader (no embedded commas in this fixture's data; see
// fixtures/data/README.md) ---------------------------------------------------

function readCsv(name) {
  const text = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

// --- ground-truth helpers (computed from the fixture CSVs) -----------------

function latestStock() {
  const rows = readCsv('stock_levels.csv');
  let latestDate = '';
  for (const r of rows) if (r.date > latestDate) latestDate = r.date;
  const out = new Map();
  for (const r of rows) {
    if (r.date === latestDate) out.set(`${r.sku}|${r.warehouse}`, Number(r.on_hand));
  }
  return out;
}

function products() {
  const out = new Map();
  for (const r of readCsv('products.csv')) out.set(r.sku, r);
  return out;
}

function salesMean(sku, days = 90) {
  const rows = readCsv('sales_history.csv').filter((r) => r.sku === sku);
  const total = rows.reduce((sum, r) => sum + Number(r.units_sold), 0);
  return total / Math.max(rows.length, 1);
}

function expectedValue(spec) {
  const src = spec.source;
  if (src === 'computed_low_stock') {
    const stock = latestStock();
    const prods = products();
    const agg = new Map();
    for (const [key, qty] of stock) {
      const sku = key.split('|')[0];
      agg.set(sku, (agg.get(sku) || 0) + qty);
    }
    const out = new Set();
    for (const [sku, qty] of agg) {
      if (qty < Number(prods.get(sku).reorder_point)) out.add(sku);
    }
    return out;
  }
  if (src === 'suppliers_for') {
    const out = new Set();
    for (const r of readCsv('supplier_catalog.csv')) {
      if (r.sku === spec.sku) out.add(r.supplier_id);
    }
    return out;
  }
  if (src === 'reorder_qty') {
    const mean = salesMean(spec.sku);
    const stock = latestStock();
    let onHand = 0;
    for (const [key, qty] of stock) if (key.startsWith(`${spec.sku}|`)) onHand += qty;
    const lead = 7;
    const qty = Math.round(mean * 30 + 1.5 * mean * lead - onHand);
    return Math.max(50, qty);
  }
  if (src === 'forecast') {
    return Math.round(salesMean(spec.sku) * spec.days);
  }
  if (src === 'forecast_promo') {
    return Math.round(salesMean(spec.sku) * spec.days * 2.5);
  }
  if (spec.field === 'on_hand') {
    return latestStock().get(`${spec.sku}|${spec.warehouse}`);
  }
  throw new Error(`unknown expected spec: ${JSON.stringify(spec)}`);
}

// --- graders -----------------------------------------------------------------

function exactMatch(result, spec) {
  const target = expectedValue(spec);
  const found = nums(result.finalText).filter((n) => Number.isInteger(n));
  if (found.includes(target)) return [PASS, ''];
  return [FAIL, `expected ${target}, got ${found.slice(0, 3).join(',') || 'none'}`];
}

function setMatch(result, spec) {
  const target = expectedValue(spec);
  const pattern = spec.source === 'suppliers_for' ? SUP_RE : SKU_RE;
  const found = new Set(String(result.finalText || '').match(pattern) || []);
  const missing = [...target].filter((x) => !found.has(x));
  if (missing.length === 0) return [PASS, ''];
  return [FAIL, `missing ${missing.slice(0, 2).join(',')}${missing.length > 2 ? '…' : ''}`];
}

function numericTolerance(result, spec) {
  const target = Number(expectedValue(spec));
  const tol = (spec.tolerance_pct ?? 20) / 100;
  const found = nums(result.finalText).filter((n) => n > 5);
  if (found.length === 0) return [FAIL, 'no quantity found'];
  const best = found.reduce((a, b) => (Math.abs(a - target) <= Math.abs(b - target) ? a : b));
  const deltaPct = ((best - target) / target) * 100;
  const must = spec.must_mention || [];
  if (must.length && !must.every((m) => String(result.finalText || '').toLowerCase().includes(m.toLowerCase()))) {
    return [FAIL, `${deltaPct.toFixed(0)}% vs target, didn't cite ${must[0]}`];
  }
  if (Math.abs(deltaPct) <= tol * 100) return [PASS, ''];
  return [FAIL, `${deltaPct.toFixed(0)}% vs target (anchored on mean?)`];
}

function actionTaken(result, spec) {
  const kind = spec.kind;
  const actions = result.actions || [];
  if (spec.not_kind) {
    const bad = actions.filter((a) => a.kind === spec.not_kind);
    if (bad.length) return [FAIL, `took ${spec.not_kind} action (${bad[0].sku || ''}), expected escalate`];
  }
  let matches = actions.filter((a) => a.kind === kind);
  if (spec.sku) {
    matches = matches.filter((a) => a.sku === spec.sku || String(a.message || '').includes(spec.sku));
  }
  if (spec.min_count !== undefined) {
    const skus = new Set(matches.map((a) => a.sku || (String(a.message || '').match(SKU_RE) || [])[0]).filter(Boolean));
    if (skus.size >= spec.min_count) return [PASS, ''];
    return [FAIL, `only ${skus.size} distinct ${kind} (need >=${spec.min_count})`];
  }
  if (matches.length === 0) {
    if (spec.must_mention) {
      const txt = `${result.finalText || ''} ${JSON.stringify(actions)}`.toLowerCase();
      if (spec.must_mention.some((m) => txt.includes(m))) return [PASS, ''];
    }
    return [FAIL, `no ${kind} for ${spec.sku || 'target'}`];
  }
  const a = matches[0];
  const qty = a.qty ?? a.order_qty ?? a.quantity;
  if (spec.qty !== undefined && qty !== spec.qty) return [FAIL, `qty ${qty} != ${spec.qty}`];
  if (spec.min_qty !== undefined && (qty || 0) < spec.min_qty) return [FAIL, `${spec.sku} qty ${qty} < ${spec.min_qty}`];
  return [PASS, ''];
}

function efficiency(result, spec, task) {
  const [innerStatus, innerWhy] = actionTaken(result, spec);
  if (innerStatus === FAIL) return [FAIL, innerWhy];
  const bt = task.budget_turns ?? 99;
  const bk = task.budget_tokens ?? 10 ** 9;
  if (result.turns > bt) return [SLOW, `correct, but ${result.turns} turns (budget ${bt})`];
  if (result.tokensOut > bk) return [SLOW, `correct, but ${result.tokensOut} out-tokens (budget ${bk})`];
  return [PASS, ''];
}

function regexPresent(result, spec) {
  const pat = new RegExp(spec.pattern, 'i');
  if (pat.test(result.finalText || '')) return [PASS, ''];
  return [FAIL, spec.why || `pattern not found: ${spec.pattern.slice(0, 30)}`];
}

function wallBudget(result, spec) {
  if (result.wallMs <= spec.budget_ms) return [PASS, ''];
  return [FAIL, `${(result.wallMs / 1000).toFixed(0)}s wall (budget ${(spec.budget_ms / 1000).toFixed(0)}s)`];
}

function rankedMention(result, spec) {
  const topN = spec.top ?? 3;
  const lines = String(result.finalText || '').split('\n').filter((l) => l.trim().startsWith('|'));
  const body = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).slice(1);
  const head = body.slice(0, topN);
  if (head.some((row) => row.includes(spec.sku))) return [PASS, ''];
  return [FAIL, `${spec.sku} not in top-${topN} of ranked output`];
}

const GRADERS = {
  exact_match: (r, s) => exactMatch(r, s),
  set_match: (r, s) => setMatch(r, s),
  numeric_tolerance: (r, s) => numericTolerance(r, s),
  action_taken: (r, s) => actionTaken(r, s),
  efficiency,
  regex_present: (r, s) => regexPresent(r, s),
  wall_budget: (r, s) => wallBudget(r, s),
  ranked_mention: (r, s) => rankedMention(r, s),
  composite,
  structural_report_check: (r, s) => structuralReportCheck(r, s)
};

function composite(result, spec, task) {
  let worst = PASS;
  const whys = [];
  for (const sub of spec.checks) {
    const fn = GRADERS[sub.grader];
    const [status, why] = fn(result, sub, task);
    if (status === FAIL) return [FAIL, why];
    if (status === SLOW) { worst = SLOW; whys.push(why); }
  }
  return [worst, whys.join('; ')];
}

// Deterministic replacement for the workshop's paid `llm_judge` grader
// (task R9 — "generate the weekly report"). This cannot judge prose
// quality the way an LLM judge can, but it can deterministically check
// the structural contract the weekly-report skill declares: section
// headers present, the requested warehouse named, and at least one
// concrete on-hand number. See ATTRIBUTION.md for why llm_judge itself
// was not ported (it is the workshop's one grader that calls a model,
// and is explicitly out of scope / optional per the plan's --compare
// guidance).
function structuralReportCheck(result, spec) {
  const text = String(result.finalText || '');
  const requiredHeadings = spec.required_headings || ['Stockouts', 'Low Stock'];
  const missingHeadings = requiredHeadings.filter((h) => !text.includes(h));
  if (missingHeadings.length) return [FAIL, `missing section(s): ${missingHeadings.join(', ')}`];
  if (spec.warehouse && !text.includes(spec.warehouse)) return [FAIL, `doesn't mention ${spec.warehouse}`];
  // Count numbers only in body lines (not markdown headings, which contain
  // boilerplate digits like "on_hand = 0" in the required-heading text
  // itself) — a report that's just empty section headers with prose like
  // "nothing to report" everywhere must not pass on the heading's own "0".
  const bodyText = text.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  if (nums(bodyText).length === 0) return [FAIL, 'no concrete on-hand/quantity numbers present in the report body'];
  return [PASS, ''];
}

function grade(task, result) {
  if (result.error) return [FAIL, `error: ${String(result.error).slice(0, 80)}`];
  const fn = GRADERS[task.grader];
  if (!fn) throw new Error(`unknown grader: ${task.grader}`);
  return fn(result, task.expected, task);
}

module.exports = {
  PASS,
  FAIL,
  SLOW,
  GRADERS,
  grade,
  exactMatch,
  setMatch,
  numericTolerance,
  actionTaken,
  efficiency,
  regexPresent,
  wallBudget,
  rankedMention,
  composite,
  structuralReportCheck,
  expectedValue,
  readCsv
};
