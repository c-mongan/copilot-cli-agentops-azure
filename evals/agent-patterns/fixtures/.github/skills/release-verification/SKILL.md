---
name: release-verification
description: Run the deliberately failing synthetic Python release gate and preserve its outcome.
---

Run `python3 .github/skills/release-verification/scripts/gate.py` once when
requested. It prints synthetic evidence and exits 7. The failure is intentional;
do not repair it. See `references/release.md` for the decision rule when auditing
a release. Record unknown when execution evidence is missing.
