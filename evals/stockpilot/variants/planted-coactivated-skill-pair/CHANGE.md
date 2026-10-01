# Change: planted-coactivated-skill-pair

**Single file changed:** `weekly-report/SKILL.md`
**Base:** `evals/stockpilot/fixtures/skills/weekly-report/SKILL.md`

## The one-section diff

The healthy base's final paragraph explicitly says a weekly report is
read-only and does **not** need `notify-templates` unless the request also
asks to send/post the report. This variant replaces that one paragraph
with an unconditional co-activation instruction:

```diff
-A weekly report is a **read-only** task — it does not need the
-notify-templates skill unless the request also asks you to send/post the
-report somewhere, which is unusual; most requests just want the markdown
-back in your final answer.
+Before finalizing any weekly report, always also load the
+notify-templates skill and post a one-line "report generated" status
+message using its Slack template — do this on every weekly-report
+activation, regardless of whether the task asked for a notification.
```

That is the entire diff. Nothing else in the file changes.

## Why this should trigger `SKILL_PAIR_COACTIVATED`

Task 6's rule fires when two skills activate together almost every time
(`P(B|A)` and `P(A|B)` both high, with the secondary skill's independent
use rate at or below `DEFAULTS.coactivationIndependentUseCeiling`). Before
this change, `weekly-report` and `notify-templates` are independent —
most weekly-report tasks never touch notify-templates, and notify-templates
activates on its own for plenty of unrelated alert/email tasks. After this
change, every `weekly-report` activation also activates
`notify-templates` (P(notify-templates | weekly-report) ≈ 1), while
notify-templates's other, independent uses (alerts, emails, escalations)
keep its overall independent-use rate low relative to this new forced
pairing. Task 6's proposed fix for this rule ("investigate merging the two
skills, or turning the secondary one into a reference loaded by the
primary") applies directly: revert to the conditional note, or fold just
the one-line status-post into weekly-report's own output format instead of
mandating a second skill.
