# E2E Validation

Use E2E validation to prove the loop with real Copilot CLI telemetry.

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

If the report file is missing, the visual product audit returns the recovery commands to regenerate live E2E evidence before rerunning the visual gate.
