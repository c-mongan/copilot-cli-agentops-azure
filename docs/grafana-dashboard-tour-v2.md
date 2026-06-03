# Grafana Dashboard Tour V2

The V2 dashboards are the AgentOps control room. Use them like a Datadog trace product: start broad, click into one run, then follow model/tool/privacy/outcome drilldowns.

## 1. AgentOps Home

Start here when you want the answer in one screen.

It shows:

- a first-row action strip for opening the latest Run Replay, generating one recommendation, and building an Ask AgentOps context bundle with prompt-template guidance;
- runs, success rate, failed runs, policy blocks, privacy drops, estimated cost, input/output tokens, p95 duration, tests ran percent, PRs opened, and collector health;
- Session Health table with status, risk, root agent, model, tool failures, policy denials, privacy signal, context pressure, eval score, benchmark linkage, and recommended next action;
- recommended next actions from insight rows;
- expensive runs;
- GitHub outcome summary;
- shared saved investigations exported from `agentops saved-view export` or created in the hosted `/api/shared-store/editor` page.

Click a `RunId` to open Run Replay. Click a model, repo hash, tool, skill, or sub-agent to keep drilling with the same time range.

## 2. Runs Explorer

This is the trace-list equivalent.

Use it to find:

- expensive failed runs;
- slow successful runs;
- no-tests-after-edit runs;
- policy-blocked runs;
- privacy-drop runs;
- PR-producing runs.

The table keeps the fields operators need most: run/session/trace IDs, surface, repo hash, agent, skill, sub-agent, model, outcome, duration, tokens, cache, context pressure, permission wait, cost, tests, PR state, eval, and risk.

Use the explicit `OpenReplay`, `OpenTrace`, and `OpenGithub` action cells when you want the shortest Datadog-style drilldown path from the trace list.

## 3. Agent Run Replay

This is the main debugging screen.

It tells the story of one run using metadata that remains useful in strict privacy mode:

- run summary;
- replay timeline;
- agent, skill, sub-agent, delegation, MCP, and tool lineage;
- model/tool/test/policy/privacy events;
- context/cache posture;
- why the run likely failed and the next check to make;
- latest recommendation artifact with copyable `agentops recommend` and `agentops ask-context` commands;
- Ask AgentOps context with a copyable metadata-only investigator prompt and `agentops triage` command;
- GitHub outcome;
- eval verdicts;
- optional transcript availability.

Prompt and response text appears only in `AgentOpsContent_CL`, which is explicit opt-in. In strict mode, the transcript panel stays empty and does not error. When content rows exist, the viewer renders them as a transcript with role, turn, content kind, message text, capture mode, redaction status, content hash, and content length.

From the CLI, `agentops open latest --runs <AgentOpsRunSummary_CL.jsonl>` prints both the normal Run Replay URL and a dedicated prompt/response viewer URL for panel 26. That link is a drilldown target, not permission to collect content.

Inside Grafana, the **Transcript availability** panel has an `OpenTranscript` cell that jumps to the same prompt/response viewer while preserving the dashboard time range.

## 4. Models, Cost & Tokens

Use this for model ROI.

It answers:

- which model is expensive for this task type;
- which model fails more often;
- which model wastes context or benefits from cache;
- cost per successful run;
- cost per PR or passing test when outcome rows exist.

## 5. Tools & MCP Risk

Use this for tool governance.

It shows:

- tool call volume;
- failure rate;
- denied rate;
- p95 latency;
- MCP server;
- risk class;
- bad-outcome correlation from failed or high-risk runs.

Risk labels are metadata only: `read-only`, `write-file`, `shell`, `network`, `secret-access`, `browser-control`, `destructive`, and `privileged`.

## 6. Safety, Privacy & Policy

Use this as the trust screen.

It shows:

- strict runs;
- content-like fields dropped;
- secret-like drops;
- unsafe attempts;
- policy blocks;
- poison-test health when emitted.

Healthy strict-mode dashboards may be quiet here except for expected content-drop signals.

## 7. Code Outcomes

Use this to prove the agent affected software delivery, not just text generation.

It shows:

- PR opened/merged/closed/reverted;
- CI status;
- review comments;
- commit count;
- files changed;
- time from agent run to PR;
- time from agent run to merge;
- edited files with no tests.

## 8. Evals & Quality

Use this for deterministic quality scoring.

Scores cover:

- overall quality;
- test discipline;
- tool efficiency;
- security;
- reliability;
- code outcome.

Low-score runs link back into Run Replay.

The **Eval scorecard by repo, model, and task** panel groups eval rows into scorecards with overall, test discipline, tool efficiency, security, reliability, and code outcome averages. It also counts poor and review-bucket runs so weak slices are visible without opening every run.

The **Eval regression follow-up** panel shows poor/review eval recommendations and regression actions with Run Replay and pattern drilldowns.

The **Before/after run comparison** panel compares each run with the previous run in the same repo, model, and task slice. It highlights eval, cost, token, tool-failure, and risk deltas so before/after changes can be reviewed without opening every run.

The **Benchmark artifact diff review** panel shows benchmark gate recommendations with added, modified, deleted, and total changed artifact counts so reviewers can spot unexpected fixture output changes before promotion. It stays metadata-only and does not show file contents.

The **Benchmark artifact files** panel expands the same benchmark evidence into task ID, change type, and artifact path rows. Use it to see which expected artifacts changed without exposing file contents.

The **Benchmark hidden check packs** panel shows hidden check pass/fail counts plus masked pack IDs, titles, task IDs, and command counts. It confirms hidden checks were attached without revealing hidden command text.

The **Benchmark policy review** panel shows each benchmark task's permission profile, policy block count, configured blocked risk categories, and observed violation risk categories. It keeps tool arguments and hidden check commands out of the dashboard.

The **Benchmark semantic checks** panel shows semantic check IDs, adapters, files, pass/fail state, scores, and failure detail. It does not show expected strings, regex patterns, or judge commands.

The **Benchmark promotion approvals** panel shows promotion approval status, required/observed approval counts, approved-at time, ticket, and evidence source so teams can see whether a candidate is missing approval evidence before promotion.

Use `agentops triage latest --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>` to package links, evidence counts, a safe investigator prompt, and one recommendation.

Use `agentops ask-context latest --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --privacy <AgentOpsPrivacy_CL.jsonl> --github <AgentOpsGitHubOutcome_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl> --recommendations <AgentOpsRecommendations_CL.jsonl>` when you only need the investigator prompt.

Use `agentops recommend latest --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>` when you want one evidence-backed next action with direct dashboard links and config-change annotation refs.

## 9. Insights & Regressions

Use this for Watchdog/Lapdog-style surfacing.

It shows anomalies and regressions for:

- failures;
- cost;
- recurring metadata-only patterns;
- latency;
- tool behavior;
- privacy/policy signals;
- eval drops;
- model/config/instruction changes when available.

The **Eval regression queue** panel combines eval-related insights and recommendations so operators can review score drops and regression next actions in one table.

The **Config change annotations** panel shows metadata-only `agentops.config.changed` events for skill, hook, MCP, model, deployment, or benchmark changes. Use it to line up a regression with the change that may have caused it. Recommendation rows include matching annotations when `agentops recommend` receives the events file.

Recurring pattern rows include `OpenPattern`, `OpenReplay`, and `PatternKey` so operators can keep drilling into one repeated behavior without learning KQL.

## 10. Collector Health

Use this when the dashboards look wrong.

It shows:

- last span received;
- export success;
- export errors;
- dropped content count;
- collector mode;
- privacy mode;
- OTLP endpoint;
- Azure/Grafana/schema/dashboard version.

## Recommended Path

```text
Home
  -> click failed RunId
  -> Run Replay
  -> click failed ToolName
  -> Tools & MCP Risk
  -> click ModelActual
  -> Models, Cost & Tokens
  -> click PrNumberHash or CiStatus
  -> Code Outcomes
```

Open the same path from local V2 table files:

```bash
agentops open latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl
```

## Content Viewer

Default strict mode:

- prompts are not stored;
- responses are not stored;
- tool arguments/results are not stored;
- source code and file contents are not stored;
- the transcript panel is empty by design.

Explicit content mode:

- generate or ingest `AgentOpsContent_CL`;
- check it with `agentops content status --dir <dir>`;
- review `agentops content opt-in`;
- run `agentops azure-ingest plan --dir <dir> --allow-content --json`;
- use a restricted workspace, restricted Grafana permissions, and short retention.

Synthetic preview:

```bash
agentops demo generate --runs 10 --with-content --json
agentops content status --dir .agentops/demo/latest --allow-content
agentops azure-ingest plan --dir .agentops/demo/latest --allow-content --json
```

## Validation

```bash
agentops dashboard validate
agentops dashboard links-check
agentops dashboard ux-check
agentops dashboard verify
agentops dashboard kql-check --last 24h
```

For a live Azure workspace with recent telemetry:

```bash
agentops dashboard kql-check --last 24h --require-rows --json
agentops dashboard verify --live --last 24h --json
agentops validate-azure --last 24h --json
```

Refresh the V2 screenshots after signing into Azure Managed Grafana in the Playwright browser profile:

```bash
AGENTOPS_E2E_PLAYWRIGHT=1 agentops e2e browser-check \
  --report .agentops/e2e/latest/report.html \
  --playwright \
  --grafana \
  --grafana-v2-only \
  --v2-docs-screenshots \
  --json
```
