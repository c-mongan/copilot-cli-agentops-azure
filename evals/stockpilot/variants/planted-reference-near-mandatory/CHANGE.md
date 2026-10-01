# Change: planted-reference-near-mandatory

**Single file changed:** `reorder-policy/SKILL.md`
**Base:** `evals/stockpilot/fixtures/skills/reorder-policy/SKILL.md`

## The one-section diff

The healthy base's "Compliance" section is read **conditionally** — only
when a PO is actually about to be placed (step 4, "Output"). This variant
moves one unconditional instruction to the very top of the "Decision
rules" section:

```diff
 ## Decision rules

+Always read the full Compliance section below before answering, even if
+this task is not placing a PO and even if none of the compliance
+thresholds could possibly apply (e.g. a pure "is this SKU below reorder
+point?" question). Treat it as required context for every activation of
+this skill, not just PO-placing ones.
+
 1. **Do we reorder at all?** Reorder if `on_hand < reorder_point`. ...
```

That is the entire diff. Nothing else in the file changes.

## Why this should trigger `REFERENCE_NEAR_MANDATORY`

Task 6's rule (`agentops-cli/src/lib/architecture/findings.js`) fires when
a reference is read in nearly every run where its owning skill activates.
Before this change, the Compliance section is read only on PO-placing runs
(a minority of `reorder-policy` activations — cycle-count adjustments,
"is this low?" questions, and non-PO recommendations never need it). After
this change, the instruction forces every `reorder-policy` activation to
read it, regardless of task shape — producing a near-100% reference-read
rate conditioned on skill activation, which is exactly the rule's trigger
condition (`numerator/denominator` ratio near the `referenceMandatoryRate`
threshold). The proposed fix Task 6 already writes for this rule
("Promote the essential control information from this reference into
SKILL.md; keep detail in the reference file") applies directly: the fix
here would be reverting to the conditional read, or — if the $10k/5-PO
compliance facts really are needed on every call — promoting just that
one fact into the skill body instead of mandating the whole section.
