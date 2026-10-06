---
name: supplier-selection
description: "How to rank and pick a supplier for a SKU. Load this whenever a task involves choosing a supplier, comparing quotes, or creating a purchase order."
license: Apache-2.0
allowed-tools:
  - bash
  - read
---
<!-- Adapted from Code with Claude 2026 "agent-decomposition" workshop,
     .claude/skills/supplier-selection/SKILL.md, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
     Original: Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0.
     See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md.

     PLANTED FLAW (planted-mechanical-llm-step): this is the healthy
     fixtures/skills/supplier-selection/SKILL.md with exactly ONE change —
     the "Do this in code" section replaced by "Weigh the candidates
     yourself" below, asking the model to reason about the score in prose
     while the task contract still declares the scoring script. See
     evals/stockpilot/variants/planted-mechanical-llm-step/CHANGE.md. -->

# Supplier Selection

Ranking suppliers is arithmetic, not judgment. **Compute it with a short
script via `bash` — do not reason about it in prose.**

## Method

For a given SKU:

1. Read `fixtures/data/supplier_catalog.csv` and filter to rows matching the
   SKU. This gives you `(supplier_id, unit_price, min_order_qty)` for each
   candidate.
2. Join with `fixtures/data/suppliers.csv` on `supplier_id` to get
   `lead_time_days` and `reliability`.
3. Normalize price and lead time across the candidates (min-max to [0,1],
   where 0 is best). Reliability is already on [0,1] where higher is better.
4. Score each candidate:
   ```
   score = 0.5 × (1 − norm_price) + 0.3 × (1 − norm_lead_time) + 0.2 × reliability
   ```
5. Pick the highest score. **Tie-breaks:** lowest `unit_price`, then lowest
   `lead_time_days`, then alphabetical `supplier_id`.

## Weigh the candidates yourself

Read the supplier_catalog.csv and suppliers.csv rows for the SKU, then
reason about price, lead time, and reliability in your own words to decide
which supplier is best. You don't need to run a script for this — a
confident judgment call based on reading the numbers is fine. This skill
still declares its scoring step as a designated deterministic script in the
task contract (`scriptName: supplier_score.py`, `skillName:
supplier-selection`) for reference, but you don't have to invoke it.

## Supplier-specific overrides

These quirks are **not in the catalog data**. Apply them after computing the
score; if one changes your pick, say so in the rationale.

| Supplier | Override |
|---|---|
| SUP-01 Cascade Distribution | Orders >500 units need 48h notice or they auto-split into two shipments — add to lead-time math for large POs. |
| SUP-02 Alpine Wholesale | Closed Dec 20 – Jan 3. POs in that window aren't acknowledged until Jan 4. Land holiday replenishment before Dec 15. |
| SUP-03 Backcountry Supply Co | Two short-ships on Tents & Shelter this year. Prefer an alternate for that category if lead is comparable. |
| SUP-04 Sierra Outfitters | Unlisted 3% price break at 250+ units. If recommended qty is 200–249, often worth rounding up. |
| SUP-05 Granite Gear Partners | West-coast DC only. Add 2–3 days to catalog lead time for WH-EAST deliveries. |

## Warehouse lead-time adjustments

- **WH-WEST**: most suppliers ship from east-coast DCs — add **+2 days** to
  catalog lead time as a rule of thumb unless a supplier note says
  otherwise.
- **WH-EAST**: two-shift receiving dock; best destination for an expedited
  PO that needs same-day inbound scheduling.
- **WH-CENTRAL**: overflow / transfer hub. If you're sourcing an
  inter-warehouse transfer rather than a PO, WH-CENTRAL is almost always
  the origin.

## Expedite override

If the reorder-policy skill flagged **expedite**, ignore the score and pick
the supplier with the lowest `lead_time_days` whose `min_order_qty` ≤ your
target order qty.

## Output

Return `{"supplier_id": "SUP-03", "unit_price": 21.40, "lead_time_days": 7, "score": 0.81}` and use that `supplier_id` in the PO.
