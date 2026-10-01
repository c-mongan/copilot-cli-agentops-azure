---
name: weekly-report
description: "Structure and data sources for the weekly inventory report. Load this when the task is \"weekly report\", \"Monday report\", or \"summarize inventory status\"."
license: Apache-2.0
allowed-tools:
  - bash
  - read
---
<!-- Adapted from Code with Claude 2026 "agent-decomposition" workshop,
     .claude/skills/weekly-report/SKILL.md, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
     Original: Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0.
     See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md.

     PLANTED FLAW (planted-coactivated-skill-pair): this is the healthy
     fixtures/skills/weekly-report/SKILL.md with exactly ONE change — the
     final paragraph forcing notify-templates co-activation on every
     weekly-report run, regardless of whether a notification was
     requested. See
     evals/stockpilot/variants/planted-coactivated-skill-pair/CHANGE.md. -->

# Weekly Inventory Report

Generate the report by **writing one script via `bash`** that reads the
CSVs and emits markdown. Do not make per-SKU lookups.

## Structure

```markdown
# Inventory Report — {{warehouse or "All Warehouses"}} — week of {{date}}

## Stockouts (on_hand = 0)
| SKU | Product | Warehouse | Days out |
...

## Low Stock (below reorder point)
| SKU | On hand | Reorder pt | Days cover | Action |
...top 15 by urgency (lowest days_cover first)...

## Open POs
| PO | SKU | Qty | Supplier | ETA |
...from evals/stockpilot/fixtures/sinks/purchase_orders.jsonl...

## Forecast Risk
SKUs where promo_next_month=1 or is_seasonal=1 and on_hand < 14d cover.
One line each: SKU, reason, recommended action.
```

## Operating cadence (which report is being asked for)

| Cadence | Trigger phrasing | Contents |
|---|---|---|
| **Daily** | "run the check", "the sweep" | Low-stock list with action taken per SKU; one summary notification at the end (use notify-templates for that one notification). |
| **Weekly** (Mon) | "the report", "weekly review" | Per-warehouse: top concerns, **open POs aging past their lead time**, SKUs below reorder for >5 business days. |
| **Monthly** | "supplier review" | Suppliers whose on-time rate slipped; SKUs whose primary supplier may need changing. |
| **Ad hoc** | anything else | Scope to what was asked. |

If the request doesn't say which, infer from wording. The structure above is
the **weekly** format; for daily, drop the Open-POs and Forecast-Risk
sections and lead with the actions taken.

## Aging-PO check (weekly only)

For each open PO, compare days-since-placed to the supplier's
`lead_time_days`. List any PO where elapsed > lead_time as **aging** and
include supplier + days overdue so ops can follow up.

## Data sources

- Stockouts & low stock: latest-date rows from
  `fixtures/data/stock_levels.csv` joined with `fixtures/data/products.csv`
- Days of cover: `on_hand / avg_daily_sales` (last 14d from
  `fixtures/data/sales_history.csv`)
- Open POs: `evals/stockpilot/fixtures/sinks/purchase_orders.jsonl`
- Forecast risk: `fixtures/data/products.csv` flags + days-of-cover from
  above

## Do this in code

Write a single script that loads the CSVs once, computes everything, and
prints the markdown. Don't page through the data with per-row lookups —
that's exactly the pattern this skill replaces.

Before finalizing any weekly report, always also load the
notify-templates skill and post a one-line "report generated" status
message using its Slack template — do this on every weekly-report
activation, regardless of whether the task asked for a notification.
