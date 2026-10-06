#!/usr/bin/env node
// Copyright 2026-present. Not derived from the workshop's data/seed.py code
// (that file uses Python + random.gauss and was not executed — see
// evals/stockpilot/PROVENANCE.md). This generator independently reproduces
// the *column schema* and the *engineered SKU* pattern described in the
// workshop's seed.py (SKU-0042 known on-hand, SKU-0183 top-seller/stockout,
// SKU-0091 promo-next-month/erratic, SKU-0012 trivial, SKU-0057 steady,
// SKU-0116 promo-history), scaled down to a small, hand-auditable dataset.
//
// Deterministic (seeded PRNG, fixed `SEED` below) — rerunning this script
// regenerates byte-identical CSVs. Run: `node generate.js`
'use strict';
const fs = require('fs');
const path = require('path');

const SEED = 42;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function randint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }

const SNAPSHOT_DATE = '2026-06-15';
const DAYS = 14; // small, auditable history window (workshop uses 90)
const WAREHOUSES = ['WH-EAST', 'WH-WEST', 'WH-CENTRAL'];

function isoDate(base, offsetDays) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// --- products -------------------------------------------------------------
// 15 SKUs: 6 engineered (matching the workshop's task anchors) + 9 filler.
const PRODUCTS = [
  { sku: 'SKU-0042', name: 'Trailhead 65L Pack', category: 'Packs', unit_cost: 185.0, reorder_point: 60, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0183', name: 'Summit Down Jacket M', category: 'Apparel', unit_cost: 210.0, reorder_point: 150, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0091', name: 'Alpine Bivy Solo', category: 'Tents & Shelter', unit_cost: 165.0, reorder_point: 70, is_seasonal: 0, promo_next_month: 1 },
  { sku: 'SKU-0012', name: 'Chain Lube Wet', category: 'Bike', unit_cost: 9.5, reorder_point: 80, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0057', name: 'CloudRest Pad R', category: 'Sleeping', unit_cost: 95.0, reorder_point: 120, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0116', name: 'Stratus Rain Jacket L', category: 'Apparel', unit_cost: 140.0, reorder_point: 90, is_seasonal: 1, promo_next_month: 0 },
  { sku: 'SKU-0201', name: 'Ridgeline 10x12 Tarp', category: 'Tents & Shelter', unit_cost: 72.0, reorder_point: 50, is_seasonal: 1, promo_next_month: 0 },
  { sku: 'SKU-0202', name: 'Daybreak 24L Pack', category: 'Packs', unit_cost: 88.0, reorder_point: 55, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0203', name: 'Thermal Base Top M', category: 'Apparel', unit_cost: 48.0, reorder_point: 100, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0204', name: 'Hydro Filter Straw', category: 'Water', unit_cost: 22.0, reorder_point: 65, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0205', name: 'Compact Camp Stove', category: 'Cooking', unit_cost: 58.0, reorder_point: 45, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0206', name: 'Bike Light Combo', category: 'Bike', unit_cost: 35.0, reorder_point: 70, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0207', name: 'Headlamp 300lm', category: 'Electronics', unit_cost: 29.0, reorder_point: 85, is_seasonal: 0, promo_next_month: 0 },
  { sku: 'SKU-0208', name: 'Drift Synthetic Bag 20F', category: 'Sleeping', unit_cost: 110.0, reorder_point: 60, is_seasonal: 1, promo_next_month: 0 },
  { sku: 'SKU-0209', name: 'Trail Pant 32', category: 'Apparel', unit_cost: 68.0, reorder_point: 75, is_seasonal: 0, promo_next_month: 0 },
];

// --- suppliers (names + overrides match supplier-selection SKILL.md) ------
const SUPPLIERS = [
  { supplier_id: 'SUP-01', name: 'Cascade Distribution', lead_time_days: 7, reliability: 0.95 },
  { supplier_id: 'SUP-02', name: 'Alpine Wholesale', lead_time_days: 10, reliability: 0.92 },
  { supplier_id: 'SUP-03', name: 'Backcountry Supply Co', lead_time_days: 5, reliability: 0.88 },
  { supplier_id: 'SUP-04', name: 'Sierra Outfitters', lead_time_days: 14, reliability: 0.97 },
  { supplier_id: 'SUP-05', name: 'Granite Gear Partners', lead_time_days: 7, reliability: 0.9 },
];

// --- supplier_catalog: 2-3 suppliers per SKU -------------------------------
const supplierCatalog = [];
for (const p of PRODUCTS) {
  const n = randint(2, 3);
  const pool = [...SUPPLIERS];
  for (let i = 0; i < n; i += 1) {
    const idx = randint(0, pool.length - 1);
    const s = pool.splice(idx, 1)[0];
    supplierCatalog.push({
      sku: p.sku,
      supplier_id: s.supplier_id,
      unit_price: Math.round(p.unit_cost * (1.05 + rand() * 0.45) * 100) / 100,
      min_order_qty: choice([10, 25, 50, 100]),
    });
  }
}

// --- sales_history: DAYS rows per SKU --------------------------------------
const baseVelocity = {
  'SKU-0183': 95, // top seller (F1)
  'SKU-0057': 18, // steady (R7)
  'SKU-0116': 12, // promo-history (R8)
  'SKU-0091': 14, // promo-next-month (F2) - erratic
  'SKU-0012': 6, // trivial (F3)
};
const salesHistory = [];
for (const p of PRODUCTS) {
  const mu = baseVelocity[p.sku] ?? randint(3, 25);
  for (let d = 0; d < DAYS; d += 1) {
    const date = isoDate(SNAPSHOT_DATE, d - (DAYS - 1));
    let m = mu;
    if (p.is_seasonal) m *= 1 + 0.3 * (Math.sin(d / 3) - 0.3);
    if (p.sku === 'SKU-0091') m *= 0.6 + rand() * 0.9; // erratic -> low forecast confidence
    const qty = Math.max(0, Math.round(m + (rand() - 0.5) * m * 0.3));
    salesHistory.push({ date, sku: p.sku, units_sold: qty });
  }
}

// --- stock_levels: DAYS x SKU x warehouse ----------------------------------
const stockLevels = [];
const currentOnHand = {};
for (const p of PRODUCTS) {
  for (const wh of WAREHOUSES) {
    currentOnHand[`${p.sku}|${wh}`] = rand() < 0.55
      ? randint(5, Math.max(6, p.reorder_point - 1))
      : randint(p.reorder_point + 20, p.reorder_point + 150);
  }
}
// Engineered overrides matching the task anchors:
currentOnHand['SKU-0183|WH-EAST'] = 0; // F1 stockout
currentOnHand['SKU-0183|WH-WEST'] = 4;
currentOnHand['SKU-0183|WH-CENTRAL'] = 8;
currentOnHand['SKU-0012|WH-EAST'] = 22; // F3: aggregate below rp=80
currentOnHand['SKU-0012|WH-WEST'] = 8;
currentOnHand['SKU-0012|WH-CENTRAL'] = 12;
currentOnHand['SKU-0091|WH-EAST'] = 4;
currentOnHand['SKU-0091|WH-WEST'] = 8;
currentOnHand['SKU-0091|WH-CENTRAL'] = 20; // aggregate below rp=70
currentOnHand['SKU-0042|WH-EAST'] = 312; // R1 known answer, above rp=60

for (let d = 0; d < DAYS; d += 1) {
  const date = isoDate(SNAPSHOT_DATE, d - (DAYS - 1));
  for (const p of PRODUCTS) {
    for (const wh of WAREHOUSES) {
      const key = `${p.sku}|${wh}`;
      const target = currentOnHand[key];
      const onHand = d === DAYS - 1 ? target : Math.max(0, target + randint(-10, 25));
      stockLevels.push({ date, sku: p.sku, warehouse: wh, on_hand: onHand });
    }
  }
}

// --- CSV writer -------------------------------------------------------------
function writeCsv(file, rows) {
  if (!rows.length) { fs.writeFileSync(file, ''); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => String(r[h])).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

const HERE = __dirname;
writeCsv(path.join(HERE, 'promo_history.csv'), [{ sku: 'SKU-0116', period: '2025-07', baseline_units: 200, promo_units: 400, comparable_next_month: 1 }]);
writeCsv(path.join(HERE, 'products.csv'), PRODUCTS);
writeCsv(path.join(HERE, 'suppliers.csv'), SUPPLIERS);
writeCsv(path.join(HERE, 'supplier_catalog.csv'), supplierCatalog);
writeCsv(path.join(HERE, 'sales_history.csv'), salesHistory);
writeCsv(path.join(HERE, 'stock_levels.csv'), stockLevels);

console.log(JSON.stringify({
  generated: {
    'products.csv': PRODUCTS.length,
    'suppliers.csv': SUPPLIERS.length,
    'supplier_catalog.csv': supplierCatalog.length,
    'sales_history.csv': salesHistory.length,
    'stock_levels.csv': stockLevels.length,
  },
  engineered_skus: {
    R1_known_on_hand: 'SKU-0042',
    F1_stockout: 'SKU-0183',
    F2_promo: 'SKU-0091',
    F3_trivial: 'SKU-0012',
    R7_steady: 'SKU-0057',
    R8_promo_history: 'SKU-0116',
  },
}, null, 2));
