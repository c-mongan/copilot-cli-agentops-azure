# StockPilot fixture data (synthetic)

Generated deterministically by `generate.js` (`node generate.js`, fixed seed
`42`). Rerunning it regenerates byte-identical CSVs. **No real financial,
customer, or company data** — this is a small, hand-auditable synthetic
dataset using the same column schema as the workshop's `data/seed.py` (see
`../../PROVENANCE.md`), scaled down from ~250 SKUs/~67k rows to 15 SKUs/14
days so every row can be inspected by a human reviewer.

## Files and schema

| File | Columns | Rows |
|---|---|---|
| `products.csv` | `sku, name, category, unit_cost, reorder_point, is_seasonal, promo_next_month` | 15 |
| `suppliers.csv` | `supplier_id, name, lead_time_days, reliability` | 5 |
| `supplier_catalog.csv` | `sku, supplier_id, unit_price, min_order_qty` | 39 |
| `sales_history.csv` | `date, sku, units_sold` (14 days, 2026-06-02..2026-06-15) | 210 |
| `stock_levels.csv` | `date, sku, warehouse, on_hand` (14 days × 15 SKUs × 3 warehouses) | 630 |

## Engineered SKUs (task anchors, mirroring the workshop's own anchors)

| SKU | Role |
|---|---|
| `SKU-0042` | R1 — known on-hand answer: 312 units at `WH-EAST` on the latest date (2026-06-15) |
| `SKU-0183` | F1 — top seller, 0 on hand at `WH-EAST` (stockout) |
| `SKU-0091` | F2 — `promo_next_month=1`, erratic sales history (low forecast confidence) |
| `SKU-0012` | F3 — trivial/low-velocity SKU, below reorder point |
| `SKU-0057` | R7 — steady seller for a plain 14-day rolling-mean forecast |
| `SKU-0116` | R8 — `is_seasonal=1`, used for the promo/seasonal forecast task |

Sinks (`purchase_orders.jsonl`, `outbox.jsonl`, `erp_writes.jsonl`) are not
included here — they are created under `../sinks/` only when a run appends
to them. Do not pre-create empty sink files; a grader checking "no artifact
produced" should see them absent until a real run writes to them.
