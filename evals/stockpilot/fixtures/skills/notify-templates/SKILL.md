---
name: notify-templates
description: "Fixed-format templates for Slack alerts, supplier emails, and escalations. Load this whenever the task is \"notify\", \"alert\", \"email\", or \"tell ops\"."
license: Apache-2.0
allowed-tools:
  - bash
---
<!-- Adapted from Code with Claude 2026 "agent-decomposition" workshop,
     .claude/skills/notify-templates/SKILL.md, commit 0b445c70eccfe3814f7cbdcec59d5a8102e391f8.
     Original: Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0.
     See evals/stockpilot/PROVENANCE.md and ATTRIBUTION.md.

     HEALTHY BASE: this file keeps the "Batch, don't spam" section below.
     The planted-tool-thrash variant removes exactly that section (see
     evals/stockpilot/variants/planted-tool-thrash/CHANGE.md) — that single
     removal is the entire diff for that variant. -->

# Notification Templates

Notifications are template fills, not creative writing. Fill the slots from
data you already have, then append the result to the outbox.

## Low-stock Slack alert

```
:warning: *Low stock* — {{sku}} ({{product_name}})
On hand: {{on_hand}} · Reorder point: {{reorder_point}} · Days of cover: {{days_cover}}
{{action_line}}
```

`action_line` is either `PO {{po_id}} placed for {{qty}} units (ETA {{eta}})`
or `Awaiting review — {{reason}}`.

## Supplier email

```
Subject: PO {{po_id}} — {{qty}} × {{sku}}

Hi {{supplier_name}},

Please confirm PO {{po_id}} for {{qty}} units of {{sku}} ({{product_name}}) at ${{unit_price}}/unit.
Requested delivery: {{requested_date}}. {{expedite_note}}

Thanks,
StockPilot
```

## Escalation (human review needed)

```
:octagonal_sign: *Review needed* — {{sku}}
Recommended qty: {{qty}} (confidence {{confidence}})
Flags: {{flags_csv}}
Reason: {{reason}}
```

## Routing (who gets what)

| Audience | When | Example |
|---|---|---|
| `ops` channel (default) | Low-stock alerts, reorder recs, cycle-count adjustments, weekly reports. | Almost everything. |
| `ops` with `@here` | Active or imminent stockout on a top-100 SKU, or a supplier delay that causes a stockout within 7 days. | "0 on hand at WH-EAST, network out in <1d" |
| Purchasing lead (DM/email, not channel) | Single PO > $25k, deviation from the scored supplier, or new-supplier consideration. | |
| Finance | Only if open-PO balance for one supplier would exceed $100k, or suspected duplicate POs. Nothing routine. | |

When you escalate beyond the default channel, add one line saying which
threshold was crossed.

## Batch, don't spam

For sweeps and daily checks, send **one summary notification**, not one per
SKU. The low-stock template above is for a single-SKU task; for a sweep,
compose a single message listing the actioned SKUs (and any deferred) and
send it once at the end.

**When the task explicitly asks for one alert per SKU** (e.g. "send a
personalized alert for each of the top 10"): fill the template once per SKU
and write all lines to the outbox in one `bash` call, e.g.:

```bash
python3 -c '
import json
rows = [...top-10 from batch_days_of_cover.py...]
with open("evals/stockpilot/fixtures/sinks/outbox.jsonl", "a") as f:
    for r in rows:
        f.write(json.dumps({"channel": "ops", "sku": r["sku"],
                            "message": f":warning: Low stock - {r[\"sku\"]} ..."}) + "\n")
'
```

Do **not** repeat a tool/script call once per SKU in a loop — that is N
avoidable round-trips for template-filling that a single batched call does
in one step.

After sending a batch, your final response should be a **brief confirmation**
("✓ 10 alerts sent to ops — see outbox") plus a compact table of SKU + on-hand
+ days-of-cover. Do not echo the full alert text in your reply; it's already
in the outbox.

## How to send

Append directly to `evals/stockpilot/fixtures/sinks/outbox.jsonl` via
`bash` — one JSON object per line, e.g.:

```bash
mkdir -p evals/stockpilot/fixtures/sinks
python3 -c 'import json; print(json.dumps({"channel": "ops", "sku": "SKU-0012", "message": "..."}))' \
  >> evals/stockpilot/fixtures/sinks/outbox.jsonl
```

Use `json.dumps` so newlines in the message are escaped. That's the whole
job: one read for the data you need (if you don't have it), one append. If
you're making more than two calls to send a notification, you've
over-engineered it.
