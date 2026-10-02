---
name: incident-evidence
description: Read synthetic incident evidence and run its bounded local Node probe.
---

Use only for this synthetic incident fixture. The references are
`references/incident.md` and `references/counter-evidence.md`. Read them
on demand; do not infer activation from their presence on disk.

Run `node .github/skills/incident-evidence/scripts/probe.js` once when
requested. It has no network or file writes. The `fixture` MCP server has
`status` (success) and `unavailable` (a deliberate tool error). Neither
contacts an external service. Keep those outcomes separate from release health.
