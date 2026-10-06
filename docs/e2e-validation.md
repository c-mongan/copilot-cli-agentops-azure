# E2E Validation

Use E2E validation to prove the loop with real Copilot CLI telemetry.

## Native capture walkthrough (VS Code, 2026-10-06)

These screenshots come from a single run of the
[AgentOps Native Capture extension](../extensions/agentops-native/README.md).
It ran in an isolated, signed-in VS Code Insiders test profile, and computer use
drove each step through the Command Palette. The account avatar is masked. The
publish path sends only the approved metadata projection: span names, timings,
token counts, trace and event IDs, and hashed run, session and repository
identifiers. Prompts, responses, code and tool arguments are not sent.

| Step | Command | Result |
|---|---|---|
| 1 | Copilot Chat: "Reply with just: pong e2e" | Reply received; status bar shows `AgentOps: Collector ready` |
| 2 | `AgentOps: Capture status` | Collector ready; 6 native spans received; Azure stages not yet attempted |
| 3 | `AgentOps: Publish native metadata to Azure` | Azure accepted 6 metadata events; refused 0 |
| 4 | `AgentOps: Verify Azure cloud readback` | Verified: 6 of 6 published events found with the expected typed fields |
| 5 | `az monitor log-analytics query` on `AgentOpsEvents_CL` | 6 rows; the `chat` span's tokens match the Chat response details |

**1. Chat with capture connected.** Connect ran automatically at startup.

![Copilot Chat reply with the AgentOps status bar showing Collector ready](images/e2e-01-chat.png)

**2. Capture status.** Each stage is listed separately, so a stage that has not
happened never reads as passing. Here the upload is `not-attempted`, readback is
`unverified` and the project-script receipt is `none`.

![Capture status notification listing the Collector, native receipt and Azure stages](images/e2e-02-status.png)

**3. Publish to Azure.** Acceptance is not proof of storage, so the message points to
the readback command.

![Publish notification: Azure accepted 6 metadata events, refused 0](images/e2e-03-publish.png)

**4. Cloud readback.** The extension queries Log Analytics for the exact event IDs
it published.

![Readback notification: verified, 6 of 6 published events found](images/e2e-04-readback.png)

**5. Independent Log Analytics check.** This image is rendered from the rows that
`az monitor log-analytics query` returned. Workspace and resource IDs are omitted.
The `chat` span reports 28,656 input and 8 output tokens, which matches the
response details in VS Code.

![AgentOpsEvents_CL rows for the run, with the chat span highlighted](images/e2e-05-log-analytics.png)

**6. Azure Monitor Workbook.** The saved Workbook "AgentOps Diagnostic Pilot" opened
in the user's existing signed-in browser session; the agent did not enter any
credentials. Images are cropped below the portal header, so no account,
subscription or resource ID is shown. Overview counts 4 native runs and 12 events.
The Spans tile reads 0 span-table rows and says that 12 native span events are
counted in Events.

![Workbook Overview tiles and telemetry chart](images/e2e-06-workbook-overview.png)

The Observed streams table lists each native run, its source table and readback
row count. Upload acknowledgment and capture completeness stay "unknown" because
row presence does not prove coverage.

![Workbook Observed streams table with four native runs](images/e2e-07-workbook-streams.png)

**7. Trace lineage.** Native capture writes span observations to
`AgentOpsEvents_CL` as `native.span.observed` events, not to `AgentOpsSpans_CL`.
This walkthrough found that Trace lineage read only the span table and wrongly
told users to start capture. It now unions both sources. Native rows show their
operation (`invoke_agent`, `chat` or `unknown`) and say that span and parent IDs
are not exported.

![Trace lineage listing native span events per run](images/e2e-08-workbook-trace-lineage.png)

Coverage and task outcome stay unverified by design. This run proves capture,
delivery and readback; it does not prove that every span was captured.

## CLI live E2E

```bash
agentops e2e run --live --browser-report --last 2h --json
agentops e2e report --last 2h --out .agentops/e2e/latest/report.html
agentops e2e browser-check --report .agentops/e2e/latest/report.html --json
```

The run should:

- capture a redacted environment summary
- force `AGENTOPS_PRIVACY_MODE=strict` and content capture off for live E2E commands
- run `doctor`
- start or verify the local collector
- run strict poison smoke
- run a safe `copilot -p` prompt
- query latest Azure telemetry
- generate a local HTML report
- print Grafana URLs
- validate the local report for PASS state, evidence links, Grafana links, and secret-looking strings

Do not commit `.agentops/e2e/` live evidence unless it is intentionally redacted fixture data.

Codex browser validation is deterministic for the local report. When Playwright is available, `browser-check --playwright` can capture a local report screenshot. Add `--grafana` to attempt dashboard screenshots; authenticated Azure Managed Grafana may still require a normal signed-in browser. If Grafana redirects to Microsoft sign-in, the check records `auth-blocked` and does not copy those sign-in screenshots into `docs/screenshots/v2/`.

To refresh the V2 dashboard-tour screenshots from an authenticated browser profile:

```bash
AGENTOPS_E2E_PLAYWRIGHT=1 \
  agentops e2e browser-check \
    --report .agentops/e2e/latest/report.html \
    --playwright \
    --grafana \
    --grafana-v2-only \
    --require-grafana-visible \
    --v2-docs-screenshots \
    --json
```

When the browser profile is authenticated and the dashboards render, that command writes stable V2 filenames under `docs/screenshots/v2/`:

- `agentops-v2-home-live.png`
- `agentops-v2-runs-explorer-live.png`
- `agentops-v2-run-replay-live.png`

Without `--require-grafana-visible`, auth-blocked Grafana pages are recorded as `auth-blocked` without failing the local report QA. With `--require-grafana-visible`, the command fails until the V2 dashboards actually render in the browser profile.

When strict visual QA is auth-blocked, `browser-check` writes an **Auth Remediation** section to `.agentops/e2e/latest/browser-notes.md` with the exact sign-in command and the exact rerun command for the same report.

For repeatable authenticated QA, pass either a signed-in persistent browser profile or a saved Playwright storage state:

```bash
agentops e2e auth-profile \
  --report .agentops/e2e/latest/report.html \
  --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --browser-user-data-dir "$HOME/.agentops/browser/grafana-profile"
```

That prints the one-time sign-in command and the strict visual rerun command.

```bash
agentops e2e browser-check \
  --report .agentops/e2e/latest/report.html \
  --playwright \
  --grafana \
  --grafana-v2-only \
  --require-grafana-visible \
  --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --browser-user-data-dir "$HOME/.agentops/browser/grafana-profile" \
  --headed \
  --json
```

Use `--storage-state <path>` instead of `--browser-user-data-dir` if you export cookies/local storage from another Playwright run.

The final product-level gate can include this same visual proof:

```bash
agentops product audit \
  --live \
  --last 2h \
  --require-rows \
  --require-visual \
  --report .agentops/e2e/latest/report.html \
  --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --browser-user-data-dir "$HOME/.agentops/browser/grafana-profile" \
  --json
```

This gate requires real rendered dashboard pages. Static report links alone do not count. If the report file is missing, the visual product audit returns the recovery commands to regenerate live E2E evidence before rerunning the visual gate. If Grafana redirects to Microsoft sign-in, run `agentops e2e auth-profile` and sign in once with the printed browser profile before rerunning the visual gate. If screenshots come from another authenticated browser harness, pass the generated evidence JSON with `--visual-evidence <json>`; every V2 dashboard must be visible, unblocked, and backed by a screenshot file.
