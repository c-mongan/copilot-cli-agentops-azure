# Release Checklist V2

## Offline

```bash
npm --prefix agentops-cli test
npm --prefix agentops-cli run coverage:check
npm --prefix agentops-cli run static:check
node agentops-cli/src/index.js security audit --json
node agentops-cli/src/index.js setup --json
node agentops-cli/src/index.js init --dry-run --json
node agentops-cli/src/index.js init --dry-run --provision-cloud --json
node --test --test-name-pattern "init provision-cloud" agentops-cli/test/index.test.js
node agentops-cli/src/index.js smoke --real-copilot --dry-run --json
node agentops-cli/src/index.js doctor --json
node agentops-cli/src/index.js validate-enterprise --json
node agentops-cli/src/index.js schema validate
node agentops-cli/src/index.js collector validate --mode auto --privacy strict --json
node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
node --test --test-name-pattern "collector privacy processor" agentops-cli/test/index.test.js
node agentops-cli/src/index.js demo generate --runs 50 --with-failures --with-privacy-drops --with-github-outcomes --json
node agentops-cli/src/index.js demo verify --runs 50 --json
node agentops-cli/src/index.js product audit --json
node agentops-cli/src/index.js azure-ingest plan --dir .agentops/demo/latest --json
node agentops-cli/src/index.js demo generate --runs 10 --with-content --out .agentops/demo/content-preview --json
node agentops-cli/src/index.js content status --dir .agentops/demo/content-preview --allow-content --json
node agentops-cli/src/index.js content opt-in --json
node agentops-cli/src/index.js azure-ingest plan --dir .agentops/demo/content-preview --allow-content --json
node agentops-cli/src/index.js run-summary generate --file tests/sample-otel/tool-failure.jsonl --json
node agentops-cli/src/index.js insights generate --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl --privacy .agentops/demo/latest/AgentOpsPrivacy_CL.jsonl --github .agentops/demo/latest/AgentOpsGithubOutcomes_CL.jsonl --json
node agentops-cli/src/index.js insights patterns --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl --json
node agentops-cli/src/index.js explain latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl
node agentops-cli/src/index.js open latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl
node agentops-cli/src/index.js recommend latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl --benchmark-run pass-run --out .agentops/demo/latest
node agentops-cli/src/index.js triage latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl --out .agentops/demo/latest --json
node agentops-cli/src/index.js ask-context latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl --json
node agentops-cli/src/index.js github-enrich --limit 30 --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --json
npm --prefix packages/agentops-copilot-sdk test
node --test --test-name-pattern github agentops-cli/test/index.test.js
node --test --test-name-pattern mcp-proxy agentops-cli/test/index.test.js
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"demo"}}}' | node agentops-cli/src/index.js mcp-proxy --server-name demo -- node examples/mcp-proxy/demo-server.js
node agentops-cli/src/index.js dashboard validate
node agentops-cli/src/index.js dashboard links-check
node agentops-cli/src/index.js dashboard ux-check
node agentops-cli/src/index.js dashboard verify
node agentops-cli/src/index.js dashboard kql-check --last 24h
node agentops-cli/src/index.js dashboard import --json
node agentops-cli/src/index.js validate-azure --import-dashboards --last 24h --json
```

## Live Local

```bash
node agentops-cli/src/index.js collector start --mode auto --privacy strict
node agentops-cli/src/index.js collector smoke --privacy strict --poison --json
node agentops-cli/src/index.js smoke --real-copilot --wait 2m --poll 10s --json
copilot --no-ask-user --no-remote --add-dir . --allow-tool='shell(pwd)' --allow-tool='shell(ls:*)' -p 'Do not edit files. Run pwd and ls docs | head, then summarize.'
node agentops-cli/src/index.js latest --last 2h
node agentops-cli/src/index.js replay latest --last 2h
node agentops-cli/src/index.js explain latest --last 2h
node agentops-cli/src/index.js open
```

## Azure/Grafana

```bash
az login
azd provision
node agentops-cli/src/index.js configure import-azd
node agentops-cli/src/index.js azure-ingest plan --dir .agentops/demo/latest --json
node agentops-cli/src/index.js dashboard import --resource-group <rg> --grafana-name <grafana> --yes
node agentops-cli/src/index.js dashboard kql-check --last 24h --require-rows --json
node agentops-cli/src/index.js dashboard verify --live --last 24h --json
node agentops-cli/src/index.js product audit --live --last 24h --require-rows --json
node agentops-cli/src/index.js validate-azure --last 24h
node agentops-cli/src/index.js open
```

## Browser

```bash
node agentops-cli/src/index.js e2e run --live --browser-report --last 2h --json
node agentops-cli/src/index.js e2e report --last 2h --out .agentops/e2e/latest/report.html
node agentops-cli/src/index.js e2e browser-check --report .agentops/e2e/latest/report.html --json
node agentops-cli/src/index.js e2e auth-profile
node agentops-cli/src/index.js e2e browser-check --report .agentops/e2e/latest/report.html --playwright --grafana --grafana-v2-only --require-grafana-visible --json
node agentops-cli/src/index.js e2e browser-check --report .agentops/e2e/latest/report.html --playwright --grafana --grafana-v2-only --require-grafana-visible --browser-user-data-dir "$HOME/.agentops/browser/grafana-profile" --headed --json
node agentops-cli/src/index.js product audit --live --last 2h --require-rows --require-visual --report .agentops/e2e/latest/report.html --browser-user-data-dir "$HOME/.agentops/browser/grafana-profile" --json
node agentops-cli/src/index.js product audit --live --last 2h --require-rows --require-visual --visual-evidence .agentops/e2e/latest/iab-visual-evidence/visual-evidence.json --json
node agentops-cli/src/index.js dashboard verify --live --last 2h --require-rows --json
```
