# Additional AgentOps agents and rendered Azure proof — 2026-10-02

## Scope and outcome

Three existing repository agents were exercised as fresh serial Copilot CLI sessions: `agentops-ci-pattern-smoke`, `agentops-eval-gate-smoke`, and `agentops-review-pattern-smoke`. Their synthetic metadata reached the strict collector, local ledger, rendered product, and approved Azure staging workspace. This does not establish exhaustive capture or a complete cloud dashboard product.

The current Azure resource inventory contains the approved Log Analytics workspace, Application Insights, DCEs, and DCRs. No Azure Managed Grafana resource, Workbook, or portal dashboard resource was found in the subscription. Screenshots show the actual Azure Logs frontend and the separately generated local product.

## Launch and stimulus proof

Original agent definitions are under `plugin/agents/`. Copies in an isolated disposable repository retained their synthetic event contracts. The initial direct shell flow attempted to use an OpenTelemetry environment variable that the agent's shell did not reliably receive, then attempted a script endpoint already containing `/v1/traces`; custom emit appends that path itself. Diagnostic attempts and initial records are preserved, not represented as successful stimulus proof. An interrupt was sent to stop further uncontrolled diagnosis.

The fresh bounded adaptation runs one owned Node script per agent. Each script uses the inherited `AGENTOPS_SCRIPT_OTLP_ENDPOINT` with its `/v1/traces` suffix removed, attaches the exact run ID, executes the original metadata event sequence once, and stops on failure. No production source or global agent configuration was modified. Each of the three final sessions completed one successful shell tool call. Capture retained all 14 native source events per session.

| Agent | Run ID | Custom receipts | Exported events | Exported spans |
| --- | --- | --- | --- | --- |
| CI pattern | agentops_e2e_20261002_v2_agentops-ci-pattern-smoke | 4 | 9 | 13 |
| Evaluation gate | agentops_e2e_20261002_v2_agentops-eval-gate-smoke | 3 | 9 | 12 |
| Review pattern | agentops_e2e_20261002_v2_agentops-review-pattern-smoke | 3 | 9 | 12 |

Final native session IDs were respectively `e3c9859f-ad9c-4074-a4c0-b63d4775390d`, `ad25c0a1-1ecd-412c-8110-b0e55653d84e`, and `87c18331-03ab-4845-9acc-f28311efc966`. Copilot CLI used the independently verified 1.0.85 npm-loader path, gpt-5.4-mini, no automatic update, metadata-only capture, and one worker. GitHub Enterprise allowance was freshly observed at 8,454 / 2,000,000 AI credits before execution; CLI and the model were enabled.

## Azure proof

Subscription `0222a208-955a-45fd-b6d8-ca4704421bf0` was Enabled, with spending limit On. The portal showed EUR 121.76 credit remaining. No spending protection was changed.

The DCR was freshly resolved to immutable ID `dcr-1b45ce3240c3473893972da44a2c2383`, targeting workspace `f556e73c-530a-4e5d-abe1-4de1407a8a11` in `rg-copilot-agentops-synthetic-pilot-20260930`. The DCE endpoint was independently resolved. No infrastructure deployment occurred.

A separate explicitly targeted bundle contained 27 event rows and 37 span rows, totaling 58,666 bytes, below 1 MiB. Each stream was uploaded once and accepted. Exact run-prefix queries returned 27 and 37 rows. Typed REST results were compared as multisets across every source field, with timestamps normalized, preserving distinct span-event rows that share span IDs. All 64 rows matched; no privacy canary appeared. An initial comparison using Azure CLI's stringified values (`None`, numeric strings, and boolean strings) is preserved separately; typed API readback resolved that representation mismatch without resending data.

The Azure Logs interface independently displayed all three run IDs with nine event rows each and zero native failed-status rows. A second portal query displayed 4 / 3 / 3 run-linked custom receipts attributed to the correct agents. Zero native failed-status rows is not a semantic quality verdict.

Original local outboxes remain pending. Their exports were copied into the explicit staging bundle; acceptance/readback is retained separately rather than falsely stamping local delivery state.

## Rendered verification and screenshots

Desktop Runs search selected the three fresh runs. The CI evidence link reached the native replay, showing two measured gpt-5.4-mini model requests, 12,031 input tokens, and 378 output tokens. Script OTel filtering exposed the four captured step receipts. Architecture displayed the three-agent inventory with insufficient evidence and no absence finding. Compare search and outcome filtering retained the existing six-trial inconclusive result; no new architecture experiment was run here.

Mobile Runs was exercised at 390 × 844 and its document width remained 390 pixels. The canary was absent from the rendered body. The viewport override was reset. Browser errors were the previously observed AdBlock `FILE_ERROR_NO_SPACE` errors, including injected copies attributed to local URLs; this turn does not assert a completely clean browser console.

Screenshots and the [local gallery](</Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-e2e-20261002/screenshots.html>) are preserved under `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-e2e-20261002/`. The gallery contains Azure attribution/results/workspace/credit and local Runs/replay/Architecture/Compare/mobile captures. Screenshots are real browser captures, not mockups.

## Gaps exposed

- Portable smoke commands need a documented scoped endpoint and exact run attribution. This test used an isolated runner adaptation; original definitions were preserved.
- The current exported span schema has no score, risk, or workflow columns. Agent attribution and transport are proved, but evaluation-score and policy dashboard contracts are not proved end to end. A schema/privacy/export design and additive migration would be required for those fields.
- One owned scoped collector remained after interruption of the initial batch and was explicitly terminated. Cancellation during setup warrants a focused lifecycle reproduction; this observation does not establish its precise root cause.
- No dedicated cloud product frontend is deployed. Azure Logs is the verified Azure frontend; Runs, Architecture, and Compare are local HTML views.
- Global completeness stays unknown. Review/optimization recommendations remain hypotheses.

## Retained receipts and cleanup

Evidence root: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-e2e-20261002/`.

`launch-results-v2.json`, `capture-audit.json`, `upload-plans.json`, `upload-results.json`, `field-readback-audit.json`, both typed readbacks, native receipt exports, generated product pages, adapted agent definitions, and the bounded runner scripts are retained. Seven focused component/UI tests passed. Product source was unchanged, so the preceding full local suite results were reused rather than rerun. All owned model jobs completed; the owned HTTP server and leftover collector were stopped. Unrelated dirty documents and existing processes were preserved. Only this reviewed verification document was committed locally; no push or publication occurred.

## Additional read-only reviewers

A subsequent user request extended execution to `skill-doctor` and `hook-policy-reviewer`, bringing this investigation to five agent types. Isolated copies removed edit and Azure MCP tools; original definitions remained unchanged. Both inspected a synthetic `review-evidence.json` with unknown coverage, zero observed skill calls, and a preToolUse network operation lasting 2,400 ms against a 500 ms timeout. Each completed one `view` call, retained all 15 native events, and supplied the six required recommendation fields. Both explicitly avoided inferring unused skills from zero observations and identified the timeout. Neither edited files nor invoked network/MCP tools. Recommendations were not applied. The selected runtime model remained gpt-5.4-mini, explicitly overriding the definitions' gpt-5.5 preference for this bounded compatibility test.

Run IDs were `agentops_e2e_20261002_review_skill-doctor` (session `8f031a57-2163-4559-942e-07041ceaec23`) and `agentops_e2e_20261002_review_hook-policy-reviewer` (session `27d51469-ab3e-477a-923e-af3d6f1e0132`). Each exported ten event rows and eight span rows. A new 32,472-byte metadata bundle was uploaded once per stream to the same approved staging target after rechecking spending limit On. Typed exact-ID readback returned all 20 events and 16 spans. Every exported field matched, with zero privacy-canary rows. Combined with the three prior agents, these two separately audited bundles contain 47 event rows and 53 span rows. Original outboxes remain untouched.

Receipts: `launch-results-review.json`, `review-acceptance.json`, `review-upload-results.json`, `review-field-readback-audit.json`, `azure-review-bundle/`, and `product-review/` under the same artifact root. Reviewer launches reused the original three-agent attachment, so its static inventory does not establish reviewer architecture coverage. They prove read-only behavior, capture, and cloud readback, not a fully joined architecture finding.

Browser control and its inventory recovery both timed out. No fresh rendered screenshot of these two reviewers is claimed. Their product HTML was generated, but its browser verification remains blocked. The existing gallery's Azure and local screenshots prove the first three agents and their views; they must not be labelled as screenshots of the new reviewer runs. All owned model jobs completed. No product source, Azure infrastructure, public publication, or experiment outcome was changed.
