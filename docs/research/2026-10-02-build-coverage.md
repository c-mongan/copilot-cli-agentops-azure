# Coverage build evidence, 2026-10-02

Implemented locally: immutable bounded metadata-only pre-run attachment snapshot;
CLI task identifier; attachment drift provenance; raw-byte source-window integrity;
no retroactive inventory binding by collect; source-specific positive diagnostics;
component-specific rigorous denominator selection; model launch/context propagation.

Focused verification: `node --test agentops-cli/test/run-evidence-contract.test.js
agentops-cli/test/architecture.test.js agentops-cli/test/copilot-session-command.test.js
agentops-cli/test/copilot-session-run-delivery.test.js` passed 80/80 at last run.
This verifies fixture/local behavior. No live/model/Azure invocation or commit.

All global recorder coverage remains unknown and evidenceComplete remains false.
No current producer claims exhaustive capture. Positive native tool/script/reference
receipts can render diagnostics while absence/probability/hypothesis eligibility
remains closed. Complete legacy fixture metric outputs remain compatible. Real
old contexts cannot borrow a newer attachment. Fresh-session source-window
proof excludes resumed/manual capture from rigorous denominators.

Contract: docs/run-evidence-contract.md. Parent integration must wire the separate
legacy `agentops copilot` launcher to capturePreRunSnapshot + sourceWindow before
launch; this worker owns only copilot-session launch. Existing background/user
plan edits preserved. Setup OS-signal lifecycle handoff remains owned by parent
integration (abortSignal is passed through this worker's launcher).

Followup reviewer repairs: all explicit native lifecycle session IDs must match;
recorded contexts cannot bypass provenance through evidenceComplete; arbitrary
producer labels/count equality cannot qualify modern completeness. No exhaustive
producer adapter is qualified, so modern rigorous denominator eligibility stays
closed. Startup SIGINT/SIGTERM cancellation now has an AbortController before
readiness and deterministic listener cleanup through supervision and collector
stop. Focused regression set passed 84/84, including cross-session lifecycle,
forged completeness and signal-during-startup adversarial cases.

Final loader/render repair: modern run-context.json global completeness is always
false and its six global coverage statuses remain unknown until independent
producer qualification exists. Caller coverage claims remain inspectable under
coverageClaims. Actual loader plus Runs rendering regression rejects forged
complete strings with a truthy unavailable snapshot; legacy complete context.json
fixtures remain compatible. Affected five-file test set passed 95/95.
