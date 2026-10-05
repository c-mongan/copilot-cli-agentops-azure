# AgentOps live follow-up — 2026-10-01

This follows the [initial verification](2026-10-01-agentops-verification.md).
The user explicitly removed the original 20 model-invocation ceiling for this
follow-up. Concurrency remained one. Included Copilot Enterprise model access was
verified in GitHub settings before execution; paid overage was not enabled.
Azure remained in the approved Visual Studio Enterprise subscription with its
spending limit on. No production deployment, publication, push, experiment merge,
or automatic architecture refactor occurred.

## Implementation and local proof

- Automatic Python startup observation now reports an unknown root outcome.
  CPython does not call `sys.excepthook` for `SystemExit`, so an atexit hook cannot
  reliably distinguish `sys.exit(7)` from successful exit. The shell exit remains
  authoritative. Uncaught ordinary exceptions still report failure. Explicit
  `observe_script` contexts retain their existing behavior.
- Unknown outcome survives OTLP parsing, span export, reload, and replay. It is
  visibly incomplete evidence rather than a false success.
- Runs shows the evidence tier and per-event provider. Older records remain
  unknown. A bounded Vally trajectory importer exports only selected metadata;
  prompts, tool arguments/results, and final answers remain excluded. Existing
  ledger directories are never overwritten.
- The F2 confidence grader incorrectly rejected `confidence was **0.41**`.
  Regression coverage now accepts ordinary prose and Markdown while rejecting
  unrelated numbers and qualitative confidence. Vally stages the full fixture,
  including scripts required by skills.
- Final CLI suite: 921 tests, 920 passed, one Windows-only skip, zero failures.
  StockPilot suite: 46 passed. Focused final script/UI regressions: 14 passed.
  Final static check passed across 909 files; 14 schema regressions passed;
  dashboard drift check passed for 10 dashboards; CLI package dry-run passed.
  Bicep was unchanged in this follow-up. The local code graph was refreshed.

## Fresh native execution

The installed native Copilot CLI reported **1.0.91**, with automatic update
explicitly disabled during owned launches. Vally remained 0.17.0, its Copilot SDK
1.0.14 and CLI dependency 1.0.85. The SDK's actual embedded runtime path was
observed, but its executable does not support `--version`; package provenance
must not be confused with an independently reported runtime version.

The successful deliberate failure run is `agentops_live_pinned_20261001`, session
`cf82f791-55a6-4562-9b24-e040d0e0a501`:

| Evidence | Result |
| --- | --- |
| Native source versus captured events | 84 versus 84 |
| Exported event / span rows | 61 / 57 |
| Completed ordered references | A → B → A |
| Skills | forecasting and reorder-policy observed |
| Delegation | start and completion observed |
| MCP | success and deliberate failure observed |
| Owned scripts | Node exit 0; Python exit 7; Python root outcome unknown |
| Parent model requests | 14 measured; gpt-5.4-mini, GitHub |
| Parent input / output tokens | 219538 / 2689 |
| Rendered failures | MCP failure and Python shell failure |

These counts prove this stimulus, not complete observation of every possible
component. Coverage remains unknown without an affirmative component manifest.
Architecture correctly emitted no absence hypotheses for these incomplete runs.

**Remaining external limitation:** native Copilot skill lookup is intermittent.
Registering the synthetic skills directory and disabling dynamic skill retrieval
produced the successful run above, but a later identically configured staging
run returned skill lookup failures. `skill list` still listed both skills. This
is observed instability, not a demonstrated root cause or a stable fix. Those
failures were captured rather than hidden. Further blind retries are not proof.

## Actual StockPilot / Vally execution

Two smoke tasks ran with gpt-5.4-mini and one worker, without retries. R1 passed.
F2 produced the correct numeric confidence and escalation but the old regex
failed. The original failed result is preserved. After repairing the grader,
`vally grade --require-pass` regraded the existing output with **zero new model
calls**, and both passed. This is regrading proof, not a new execution after the
fixture-staging change. The complete 12-task live corpus was not rerun.

A real experiment executed healthy-base and planted-tool-thrash once each using
its pinned gpt-5.5 configuration, one worker, without a model judge:

| Measurement | Healthy | Candidate |
| --- | --- | --- |
| Output grader | passed | passed |
| Duration ms | 35995 | 28129 |
| Input / output tokens | 100813 / 2526 | 131136 / 2129 |
| Tool calls | 11 | 11 |
| Token usage events | 7 | 7 |

The [experiment record](../../experiments/inconclusive/stockpilot-live-tool-thrash-20261001.json)
is **inconclusive**. One trial does not establish an efficiency improvement,
planted tool thrash, or semantic correctness of every sink action. No change was
accepted or merged. Imported trajectories are explicitly marked
`live-synthetic-vally-trajectory-derived`, with unknown coverage and architecture
compatibility. The original F2 grading failure remains in its imported context;
the corrected regrade is retained separately.

## Synthetic Azure proof

The target remained subscription `<subscription-id>`, workspace
customer ID `f556e73c-530a-4e5d-abe1-4de1407a8a11`, staging immutable DCR
`dcr-1b45ce3240c3473893972da44a2c2383`. Subscription state was Enabled and
`spendingLimitOn` was freshly checked. The earlier portal balance was EUR 121.81;
that balance was not refreshed after these small uploads. No infrastructure
change was made in this follow-up; earlier additive migration and what-if proof
remain in the initial report. Workspace-moving `main.bicep` was not applied.

The successful native run's original outbox inherited a different DCR. The
explicit staging drain rejected it: zero acknowledgements, two pending streams,
two target mismatches. The original outbox was preserved. A separate explicitly
bound synthetic staging bundle used the same 61 event / 57 span exports and
identities, totaling **107748 bytes**, below 1 MiB. Both streams were accepted
once, then queried by exact RunId. All 61 events and 57 spans returned. Every
returned field present in the source was compared by EventId or SpanId, including
model/provider, tokens/cache, session identity, and unknown Python outcome.
Datetime normalization and Azure null serialization were accounted for. The
privacy canary was absent. Span readback selected the provenance/outcome fields;
event readback returned the complete event rows.

The separate `agentops_live_staging_20261001` run used the correct cloud target
from launch. Its normal outbox path acknowledged both streams once (54 events,
54 spans). Exact-ID event and span readback each returned 54 rows and zero privacy
canaries.
Its skill failures mean it does not replace the successful stimulus proof above.
The rendered replay showed 2/2 delivery streams accepted, correctly retaining
“readback unverified” because external queries are not persisted into outbox
state. Accepted streams were not resent.

## Rendered UI and retained evidence

Desktop and 390 × 844 mobile inspection exercised Runs, Architecture, Compare,
search, outcome filtering, linked trial runs, session replay, failure filtering,
and evidence anchors. Mobile document width stayed 390 pixels. Inconclusive
outcomes, incompatible/unknown versions, usage provenance, coverage gaps, and
Azure acceptance were visible. No privacy canary appeared in the rendered DOM.
No product-attributable console error was observed. AdBlock emitted
`FILE_ERROR_NO_SPACE`, including an identical injected error on the local page;
therefore this is not an assertion that the entire browser console was clean.
The viewport override was reset after verification.

Evidence stays outside Git under the verified external scratch root:

- `agentops-live-20261001/`: native runs, acceptance audit, private local ledger,
  owned fixture, target-guard result, staging upload receipt.
- `agentops-vally-live-20261001/`: original smoke/experiment results, resolved
  plans, local trajectories, strict smoke span receipt and ledger import map.
- `agentops-vally-smoke-regraded.jsonl`: corrected deterministic regrade.
- `agentops-native-azure-20261001/`: bounded bundle, upload acknowledgement,
  exact-ID event/span readback and `field-readback-audit.json`.
- `agentops-product-delivered-live-20261001/`: generated local product pages.

All owned live model jobs finished. Unrelated sessions and dirty user documents
were preserved. Remaining proof gaps are stable native skill discovery, a fresh
full live task corpus, repeated statistically useful comparisons, and complete
component coverage. Recommendations remain hypotheses.
