# E2E Validation

Use E2E validation to prove the loop with real Copilot CLI telemetry.

```bash
agentops e2e run --live --browser-report --last 2h --json
agentops e2e report --last 2h --out .agentops/e2e/latest/report.html
agentops e2e browser-check --report .agentops/e2e/latest/report.html --json
```

The run should:

- capture a redacted environment summary
- run `doctor`
- start or verify the local collector
- run strict poison smoke
- run a safe `copilot -p` prompt
- query latest Azure telemetry
- generate a local HTML report
- print Grafana URLs
- validate the local report for PASS state, evidence links, Grafana links, and secret-looking strings

Do not commit `.agentops/e2e/` live evidence unless it is intentionally redacted fixture data.

Codex browser validation is deterministic for the local report. When Playwright is available, `browser-check --playwright` can capture a local report screenshot. Add `--grafana` to attempt dashboard screenshots; authenticated Azure Managed Grafana may still require a normal signed-in browser.
