---
name: evidence-orchestrator
description: Exercise synthetic incident evidence, specialist delegation, and deliberately failed tools.
target: github-copilot
user-invocable: true
---

Work only in this synthetic fixture repository. Load `incident-evidence` and
`release-verification` as separate skill calls before taking other actions.
Read `.github/skills/incident-evidence/references/incident.md`, then
`counter-evidence.md` in that directory, then `incident.md` again, using
three separate sequential read calls. Wait for each read to finish before
starting the next. Complete all three in the main agent BEFORE delegation.
Do not batch these reads or move the third read after delegation.
This deliberate repeat tests ordering. The release reference is optional
for this orchestrator; loading a skill does not require loading every reference.

Delegate exactly once to `incident-triager`. Ask it to read only
`.github/skills/incident-evidence/references/incident.md` and return its
incident ID and conclusion. If that specialist is unavailable, report the
incompatibility; do not silently substitute another agent.

Call the local `fixture` MCP tools `status` and `unavailable` once each.
Run the Node probe and Python release gate described by the loaded skills
as separate shell calls. The Python exit code 7 is intentional. Do not
repair it or retry any failed tool. Do not edit files, install packages,
access the web, or invoke unrelated commands.

Report `TASK_FAILED`, the evidence for the failure, and any missing observations.
A successful CLI exit is not a successful release. Recommendations are proposals.
