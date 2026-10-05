# Pre-run provenance and scoped evidence

`copilot-session launch --task-id <bounded-id> -- …` retains a frozen pre-run
attachment snapshot before the process starts. It contains only component
names, safe relative paths and content hashes, the attachment hash, architecture
hash, partial launch-configuration identity and optional task identifier. It
contains no file contents or command payloads. The snapshot has a SHA-256 digest,
is recursively frozen in memory, and is persisted in the owner-only,
create-exclusive `run-context.json`. Snapshot reads reject symlinks, files over
2 MiB and inventories over 10,000 metadata entries.

```
pre-run attachment → frozen metadata + hash → run context
post-run attachment → unchanged / changed / unavailable provenance
native bytes → boundary and lifecycle integrity → positive diagnostics
```

Post-run collection does not construct a pre-run identity. `collect` therefore
keeps architecture identity unknown unless a real pre-run capture was supplied
by the launch path. Current inventory is never retroactively substituted.

`sourceIntegrity` hashes the same bounded bytes it validates. It reports native
row count, malformed rows, session start/shutdown counts, tool start/terminal
counts and pending tool IDs. Multiple boundaries, unmatched/duplicate terminals,
terminal-before-start, malformed records and any explicit cross-session lifecycle ID invalidate
that source. A missing shutdown or pending tool yields partial integrity.
Delivery checks the source digest before and after export; changes invalidate
eligibility. The fresh-session launch window is affirmative only when that exact
session event file did not exist before launch. Resume/collect has no fresh-run
window proof.

Global coverage remains unknown. Stimulus expectations describe an expected
subset and cannot establish entire-run coverage. No current native producer
asserts independent completeness across agents, skills, references, scripts,
tools and models.

Rigorous component metrics require an independently qualified exhaustive producer adapter, affirmative relevant coverage and denominator
provenance (`componentDenominators`), frozen matching architecture/config/task,
a fresh session, valid terminal source, completed process/collector and unchanged
attachment. A denominator records status, entire-run scope, producer, source
SHA-256, expected and observed counts. A count equality alone does not prove that
the producer supports exhaustive observation: do not manufacture these records
from stimulus expectations. No current adapter qualifies exhaustive capture, so all modern rigorous component denominators remain ineligible regardless of caller counts or producer labels. Unsupported surfaces remain unknown. Explicit
complete legacy fixtures retain their original metric behavior; old real
contexts with unknown coverage do not qualify.

`metrics.observedDiagnostics` separately exposes captured positive terminal tool
receipts, script outcomes and affirmative reference reads. These are lower-bound
observations, never absence claims, activation probabilities or optimization
cards. Exact event/tool identity is retained; inferred reference ownership stays
labelled. Missing task/config identity does not suppress valid positive receipts,
but cannot support rigorous cohort findings. Drift, malformed source and invalid
snapshot identity suppress these diagnostics. No model/cloud calls are involved.
