# Change: planted-mechanical-llm-step

**Single file changed:** `supplier-selection/SKILL.md`
**Base:** `evals/stockpilot/fixtures/skills/supplier-selection/SKILL.md`

## The one-section diff

The healthy base's "Do this in code" section instructs the model to write
and run a short script to compute the weighted score. This variant
replaces that instruction with a prose-reasoning instruction, while still
declaring the same deterministic script in the task contract (so the
engine sees a designated script that is never invoked):

```diff
-## Do this in code
-
-Write and run a short script via `bash` — don't call a tool per supplier,
-and don't compare quotes by describing them in prose. Example shape:
-
-```python
-import csv
-sku = "SKU-0057"
-catalog = [r for r in csv.DictReader(open("fixtures/data/supplier_catalog.csv")) if r["sku"] == sku]
-suppliers = {r["supplier_id"]: r for r in csv.DictReader(open("fixtures/data/suppliers.csv"))}
-# join, normalize, score, sort — print the winner as JSON
-```
-
-This skill declares its scoring step as a **designated deterministic
-script** in the task contract (`scriptName: supplier_score.py`,
-`skillName: supplier-selection`) — there is one correct way to compute this
-number, and it should be computed, not estimated by the model.
+## Weigh the candidates yourself
+
+Read the supplier_catalog.csv and suppliers.csv rows for the SKU, then
+reason about price, lead time, and reliability in your own words to decide
+which supplier is best. You don't need to run a script for this — a
+confident judgment call based on reading the numbers is fine. This skill
+still declares its scoring step as a designated deterministic script in the
+task contract (`scriptName: supplier_score.py`, `skillName:
+supplier-selection`) for reference, but you don't have to invoke it.
```

That is the entire diff. Nothing else in the file changes.

## Why this should trigger `MECHANICAL_LLM_STEP`

Task 6's rule fires when task-contract-tagged runs show several model
calls on the designated skill while the declared deterministic script is
never invoked, under "declared complete script coverage" (i.e. the task
contract says this step has one correct, computable answer). Before this
change, the skill both declares and actually directs execution to the
script — the healthy ledger should show `script.span` events, no repeated
`assistant.turn_end` reasoning events, on this skill. After this change,
the skill still declares the script in its task contract (so
`scriptCoverage: complete` still holds) but instructs the model to reason
about the weighted score in prose instead — producing multiple
`assistant.turn_end` events on `supplier-selection` with the script never
invoked, which is exactly the rule's `pilot-hypothesis` trigger condition.
Task 6's proposed fix ("Replace the model-driven step with a direct call
to the designated script; confirm with a Vally single-change experiment
before refactoring") is the literal corrective action: revert this one
section.
