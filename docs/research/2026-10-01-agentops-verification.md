# AgentOps implementation and verification — 2026-10-01

## Result

The local capture repairs and linked Runs / Architecture / Compare product are
implemented. Additive synthetic Azure schema deployment and field-level readback
are verified. Full live acceptance remains incomplete: the native test exceeded
its authorized model budget and no Vally execution or protected experiment result
was completed. Do not treat this report as approval to run more model calls.

```text
Launched native process → scoped collector → local run ledger → linked HTML
Synthetic fixture rows → existing v2 DCR → exact-ID Azure query
```

## Local changes and proof

- Asynchronous launch supervision detects collector death during execution,
  forwards signals to the owned process group, preserves child exit status, and
  escalates cancellation after a bounded grace period. A cooperative zero exit
  after cancellation remains unsuccessful. Regressions exercise collector death,
  signal forwarding, abort, spawn failure, and an ignoring descendant surviving
  its launcher until group cleanup.
- New sessions pin an ID; changed-session selection uses that ID rather than
  unrelated session modification times. Resume/connect arguments are preserved.
- Ledger coverage requires affirmative `complete` evidence for all six component
  categories and valid event rows. Historical, partial, and malformed records
  cannot establish absence. Fresh native runs deliberately remain unknown.
- Runs exposes lifecycle, coverage, architecture version, ordered event metadata,
  requested/actual models, and null-versus-zero usage. Architecture reuses the
  engine's hypothesis reports and evidence links. Compare reads stored outcome
  records with configuration compatibility and evidence provenance.
- Product exports remain metadata-only, escape selected values, use private files,
  and refuse to overwrite existing reports. Missing usage is not coerced to zero.
- StockPilot's 43 fixture/grader tests pass, including four isolated planted
  positives and a healthy negative. These are fixture results, not live trials.
- CLI full-suite evidence and final check details are below. Static checks,
  packaging dry run, ten-dashboard generator drift checks, the deployed events
  schema validator, and direct v2 Bicep compilation pass.

## Browser proof

Chrome exercised desktop navigation, run search, ordered-event disclosure,
Architecture hypothesis search and evidence links, Compare outcome filters using
explicit synthetic accepted/rejected/inconclusive records, and native timeline
failure filtering. Mobile checks used 390 × 844. A long architecture hash caused
horizontal overflow; wrapping was repaired and the final Architecture and Runs
pages measured a 390-pixel document width. Compare's synthetic populated mobile
view and the real empty view were exercised. No actual experiment results exist.

Console collection encountered repeated `FILE_ERROR_NO_SPACE` errors from the
installed AdBlock extension (`gighmmpiobklfepjocnamgkkbiglidom`), also attributed
by Chrome to the local page URL. Product interactions worked; a completely clean
browser-console claim is not supported. The in-app browser was unavailable.
No browser extension or user storage settings were changed.

Final HTML artifact directory:
`<agent-workspace>/scratch/agentops-product-verified-20261001/`.
Its native replay uses the current session file, with original stored span
receipts. The UI warns that later events may lack corresponding captured spans.

## Live native execution and budget incident

Included Copilot Enterprise access was verified before launching the synthetic
fixture with `gpt-5.4-mini`. Three sequential CLI launches produced **23 distinct
model request IDs**, exceeding the authorized maximum of **20**:

| Run | Requests | Local ledger | Result |
| --- | ---: | --- | --- |
| `agentops_live_smoke_20261001` | 1 | 4 events, 6 spans | Compatibility and measured usage observed |
| `agentops_live_failed_20261001` | 11 | 44 events, 49 spans | Deliberate failure; setup also prevented skills/delegation |
| `agentops_live_repaired_20261001` | 11 | 32 events, 11 spans | Skills/delegation observed; capture cancelled before all later events |

The ad hoc budget guard signalled the launcher rather than reliably stopping its
subprocess tree. Model work continued after cancellation. All further model
calls stopped when this was identified. The product's cancellation path now
kills its owned process group, including a descendant that ignores SIGTERM;
that repair has local process tests but no additional live model verification.
There is no claim that the product now enforces a request-count budget itself.
Future live work needs a new explicit budget and a tested, conservative request
guard wired to supervised cancellation before execution.

The first failed run preserved ordered completed reference reads A → B → A,
MCP success/failure, and Node/Python script spans (Python deliberately exited 7).
Its rendered replay showed 11 measured model requests, 137447 input tokens,
1316 output tokens, 22 exact-session native spans, two run-linked script spans,
and ten exact tool-call joins. A successful CLI exit is separate from the
fixture's deliberate task failure.

The repaired run proved both skill activations and general-purpose delegation.
Its current native session eventually contains MCP/script results, but those
later results are outside the original captured ledger window. Combining it with
the first run does not establish one fully captured run satisfying every live
acceptance requirement. Vally 0.17.0 remains pinned; local lint/fixture proof does
not establish runtime compatibility or a completed baseline/candidate trial.
The Vally lint warning about a regression without a baseline remains unresolved
by live evidence.

Native source files are isolated under the recorded Copilot home in
`scratch/agentops-live-20261001/budget.json`; ephemeral authentication was not
copied into source or reports. That file counts CLI launches, not model requests;
the request audit above is the correct budget accounting.

## Synthetic Azure proof

Target subscription: Visual Studio Enterprise,
`<subscription-id>`. Subscription metadata showed spending limit
`On`; the portal displayed €121.81 remaining credit before deployment. No paid
overage, production target, or additional access assignment was authorized.

Existing resources: `rg-copilot-agentops-synthetic-pilot-20260930`, workspace
`law-copilot-agentops-eval-eval930`, DCE `dce-copilot-agentops-eval930`, DCR
`dcr-copilot-agentops-eval930-v2`. Direct `v2-ingestion.bicep` was compiled and its
what-if reviewed. The initial preview proposed tag/retention changes and was
not applied. The corrected preview preserved five tags, seven-day table
retention, and all existing column names/types; it added Events 6 / Spans 5 /
Insights 8 columns without resource creation/deletion. The workspace-moving
`main.bicep` was never applied.

Deployment `agentops-additive-observability-20261001` succeeded. DCR/table schema
readback matched; DCE immutable ID remained
`dce-f26884f0e0204b498458379295aa5a53`. Existing workspace thirty-day default
retention and 1-GB daily quota remained unchanged.

The initial 43552-byte upload was accepted once. Exact-ID queries returned 44
synthetic event rows, five failures, and zero privacy-canary rows. Three span
rows and one insight arrived, but their newly added fields were empty. This is
consistent with schema propagation; initial field-level acceptance failed.
Those accepted rows were not resent or represented as repaired.

A new 3493-byte batch used unique ID
`synthetic_schema_propagated_20261001_1790889716099`. Exact-ID readback returned:

- Three spans with `fixture-requested`, `fixture-actual`, and `fixture-provider`.
  Input tokens were 123 / 0 / null; output tokens 45 / 45 / null. First-row cache
  read/write tokens were 7 / 3, with later missing cache values remaining null.
- One explicitly fixture-only inconclusive insight with `TOOL_THRASH`,
  `fixture-v1`, numerator 3, denominator/coverage 12, component references, and
  its rejection-test evidence. It is not a real architecture finding.
- The private payload canary was excluded by the serializer before upload.
  Both batches stayed below the existing 1-MiB limit.

Artifacts, acknowledgments, exact-ID queries, and schema readback are in external
scratch directories `agentops-azure-schema-20261001/` and
`agentops-azure-schema-propagated-20261001/`. Azure acceptance/readback does not
change the native run's local outbox status: the event fixture upload was a
separate operation, and original run spans were not all uploaded.

## Remaining acceptance gates

A new authorized and conservatively enforced model budget is required for a
single fresh, fully captured native/Vally run and actual experiment comparison.
Browser console isolation also remains unproved because of the extension's
storage error. Coverage collection intentionally remains conservative; no live
absence findings or automatic refactoring decisions are supported.

## Final verification receipts

- `agentops-final-reviewed-suite.log`: 920 CLI tests, 919 passed, one Windows-only
  skip, zero failures. Includes the final loader and cancellation regressions.
- StockPilot `npm run proof`: 43 passed, zero failures.
- `agentops-final-contract-tests.log`: 34 focused tests passed.
- `scripts/static-check.js`: 903 files checked, passed.
- CLI `publish:check`: local package dry run passed; nothing published.
- `build-grafana-v2-dashboard-pack.js --check`: ten dashboards passed.
- Events schema safety against the final deployed table: passed, no violations.
- Direct `az bicep build --file infra/bicep/v2-ingestion.bicep`: passed.
- `agentops-azure-schema-propagated-20261001/field-assertions.json`: exact-ID
  field assertions passed for three spans and one insight.
- `git diff --check`: passed. The local Graphify code-only index refreshed to
  4814 nodes and 11692 edges without model extraction.

All named logs/artifacts are under
`<agent-workspace>/scratch/`. Unrelated pre-existing dirty
plans and research files were preserved and excluded from the local commit.

## Subsequent live follow-up

The [live follow-up](2026-10-01-agentops-live-followup.md) records later user
authorization removing the model-invocation cap, repaired Python outcomes, actual
Vally execution, successful native stimulus capture and synthetic Azure readback.
This report remains the historical record of the initial verification.
