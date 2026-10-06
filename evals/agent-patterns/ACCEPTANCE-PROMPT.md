Perform the evidence-orchestrator synthetic acceptance workflow exactly.
First activate incident-evidence and release-verification as separate skill calls.
Then in the MAIN agent use three separate sequential view calls:

1. .github/skills/incident-evidence/references/incident.md
2. .github/skills/incident-evidence/references/counter-evidence.md
3. .github/skills/incident-evidence/references/incident.md

Do not delegate until that third MAIN-agent read has completed. THEN delegate
exactly once to incident-triager to read incident.md only. After delegation
completes call fixture status and unavailable once each, then execute the Node
probe and Python gate as separate shell calls. Report TASK_FAILED without repairs.
