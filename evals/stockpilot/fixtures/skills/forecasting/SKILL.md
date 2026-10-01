---
name: forecasting
description: "How to produce a demand forecast for a SKU: when to compute it yourself with a script and when the task needs the forecasting skill's documented escalation path instead. Load this for any task involving \"forecast\", \"how much will we sell\", \"next month\", promos, or seasonal SKUs."
license: Apache-2.0
allowed-tools:
  - bash
  - read
---
<!-- Adapted from Code with Claude 2026 "agent-decomposition" workshop,
     .claude/skills/forecasting/SKILL.md, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
     Original: Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0.
     See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md for the Claude->Copilot
     CLI adaptation notes (in particular: no live subagent delegation here). -->

# Demand Forecasting

Forecasting has two paths. Using the slow path when you don't need it wastes
turns; skipping it when you do need it gives you a bad number.

## Path A — compute it yourself (deterministic script)

Use this when **all** of the following hold:
- horizon ≤ 14 days
- the product's `is_seasonal` flag is 0
- the product's `promo_next_month` flag is 0
- the task doesn't mention a promo, holiday, or trend change

Then the forecast is just a rolling mean. This skill ships a script for it:

```bash
python3 evals/stockpilot/fixtures/skills/forecasting/scripts/rolling_mean.py SKU-0057 14
```

That's it — one `bash` call, no deeper analysis needed. Read the script if
you want to adapt it (it's ~20 lines).

**Batch variant for sweeps:** if you need days-of-cover for *many* SKUs at
once (e.g. the daily low-stock check), don't loop tool calls — run the
batch script:

```bash
python3 evals/stockpilot/fixtures/skills/forecasting/scripts/batch_days_of_cover.py 20
```

Returns the most urgent SKUs as JSON, ranked by days-of-cover. This replaces
many individual stock-level / sales-velocity lookups for a sweep task.

## Path B — escalate for full-history analysis

Use this when **any** of the following hold:
- horizon > 14 days
- `is_seasonal` is 1
- `promo_next_month` is 1, or the task mentions a promo
- recent sales show a visible trend break

**Why not just the rolling mean:** these cases need the full 90-day history
to spot seasonality and promo effects, plus a documented confidence number —
a plain rolling mean silently understates promo/seasonal demand.

**How:** read the full `sales_history.csv` for the SKU yourself (via
`bash`/`read`; it's one SKU's worth of rows, not the whole table) and apply
the seasonal calendar and promotional-handling guidance below. Produce
`{forecast_qty, confidence, method, flags}` as your own computed JSON —
**do not state the number only in prose**; a confidence stated only in
words like "fairly confident" is not acceptable, it must be a number in
`[0, 1]`.

If you cannot produce a confident number this way, set `confidence ≤ 0.55`
so the reorder-policy skill escalates to human review instead of
auto-ordering on a number you couldn't validate.

## Seasonal calendar (sanity-check your numbers)

Outdoor gear is highly seasonal. When the horizon crosses a boundary, the
rolling mean lags the turn — lean on Path B and mention the season.

| Window | Categories that lift | Expect vs baseline |
|---|---|---|
| Mar–May | Footwear, packs, rain shells, trekking poles | 1.3–1.6× |
| Jun–Aug | Tents, sleeping, stoves, water filtration | 1.5–2.0× (peak quarter) |
| Sep–Oct | Insulated apparel, optics, headlamps | lift; tents/footwear taper |
| Nov–Dec | Giftable price points; heaviest promo | confirm promo flags |
| Jan–Feb | Reset — lowest volume | good for cycle counts |

## Promotional handling

Promos are the most common cause of under-ordering. When `promo_next_month=1`
or the task mentions a promo:

- **Do not** rely on rolling-mean alone — that's pre-promo demand.
- Look for a historical analog (same SKU, comparable promo in the last 12
  months) and use *that* uplift. If none exists, set
  `flags: ["promo_uplift_uncertain"]` and a confidence well under 0.6.
- Default to flag-for-review over auto-order when lift is uncertain.
  Over-ordering on a promo is recoverable; under-ordering is a stockout
  during peak attention.
- If the promo end date is known, account for the post-promo dip — don't
  leave the channel overstocked the week after.

**The failure mode to avoid:** stating the lift in prose ("could be ~3×")
while the `forecast_qty` you return is still the un-lifted baseline mean.
Anchor the *number*, not just the narrative.

## What to do with the result

Feed `{forecast_qty, confidence, flags}` into the reorder-policy skill. In
particular: **if `confidence < 0.6`, reorder-policy says escalate, don't
auto-order.** Do not drop the confidence or flags on the floor — they're
part of the contract.

## Worked example (Path B)

Task: "Reorder SKU-0091 for next month's promo." → `promo_next_month=1`,
horizon=30 → Path B.

Computed: `{"forecast_qty": 210, "confidence": 0.41, "method": "baseline_mean_no_comparable_promo", "flags": ["promo_uplift_uncertain"]}`

confidence 0.41 < 0.6 → per reorder-policy, **do not** create a PO. Escalate
via notify-templates with the flags, recommend the baseline estimate plus a
note that promo uplift could be 2–3× and needs a human call.
