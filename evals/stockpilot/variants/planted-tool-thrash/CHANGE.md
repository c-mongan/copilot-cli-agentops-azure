# Change: planted-tool-thrash

**Single file changed:** `notify-templates/SKILL.md`
**Base:** `evals/stockpilot/fixtures/skills/notify-templates/SKILL.md`

## The one-section diff

The healthy base's "Batch, don't spam" section explicitly forbids looping
a tool/script call once per SKU for a sweep/batch task. This variant
removes that entire section (and only that section):

```diff
-## Batch, don't spam
-
-For sweeps and daily checks, send **one summary notification**, not one per
-SKU. The low-stock template above is for a single-SKU task; for a sweep,
-compose a single message listing the actioned SKUs (and any deferred) and
-send it once at the end.
-
-**When the task explicitly asks for one alert per SKU** (e.g. "send a
-personalized alert for each of the top 10"): fill the template once per SKU
-and write all lines to the outbox in one `bash` call, e.g.:
-
-```bash
-python3 -c '
-import json
-rows = [...top-10 from batch_days_of_cover.py...]
-with open("evals/stockpilot/fixtures/sinks/outbox.jsonl", "a") as f:
-    for r in rows:
-        f.write(json.dumps({"channel": "ops", "sku": r["sku"],
-                            "message": f":warning: Low stock - {r[\"sku\"]} ..."}) + "\n")
-'
-```
-
-Do **not** repeat a tool/script call once per SKU in a loop — that is N
-avoidable round-trips for template-filling that a single batched call does
-in one step.
-
-After sending a batch, your final response should be a **brief confirmation**
-("✓ 10 alerts sent to ops — see outbox") plus a compact table of SKU + on-hand
-+ days-of-cover. Do not echo the full alert text in your reply; it's already
-in the outbox.
-
```

Nothing else in the file changes — the "How to send" section and
everything else stays byte-identical to the healthy base.

## Why this should trigger `TOOL_THRASH`

Task 6's rule fires when a tool repeats ≥`DEFAULTS.thrashConsecutive` times
in a row with no visible state progress (no distinct `ResultState`/
`ArgHash` between calls). The healthy base explicitly instructs the model
to batch per-SKU notifications into one call — the F3 "batch low-stock
alerts" task should produce one or two append calls with distinct SKU
payloads (state progress each time). With the "Batch, don't spam" section
removed, nothing in the skill tells the model not to send one notification
per SKU in a naive loop; a per-SKU loop that re-reads the same
output-sink/template state each iteration is exactly the "repeats with no
state progress" pattern the rule targets. Task 6's proposed fix ("Batch
the call behind a deterministic script, or add a clearer stopping
instruction so the agent stops retrying") is the literal corrective
action: restore the removed section.
