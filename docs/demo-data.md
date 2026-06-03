# Demo Data

Dashboards should be useful before a user has live Copilot traffic.

Generate metadata-only custom-table rows with:

```bash
agentops demo generate --runs 50 --with-failures --with-privacy-drops --with-github-outcomes --json
```

The current command writes JSONL files to `.agentops/demo/latest` by default:

```bash
agentops demo generate --runs 50 --json
```

Use `--out <dir>` to choose another directory. The positive scenario flags are explicit aliases for the default rich demo set; use `--without-failures`, `--without-privacy-drops`, or `--without-github-outcomes` when you need quieter fixtures. The output has one file per conceptual Log Analytics table:

- `AgentOpsRunSummary_CL.jsonl`
- `AgentOpsEvents_CL.jsonl`
- `AgentOpsToolCalls_CL.jsonl`
- `AgentOpsMcpCalls_CL.jsonl`
- `AgentOpsPrivacy_CL.jsonl`
- `AgentOpsEval_CL.jsonl`
- `AgentOpsGithubOutcomes_CL.jsonl`
- `AgentOpsInsights_CL.jsonl`
- `AgentOpsRecommendations_CL.jsonl`
- `AgentOpsCollectorHealth_CL.jsonl`
- `AgentOpsContent_CL.jsonl`

Inspect the generated data with the same local CLI flows used for real exports:

```bash
agentops latest --file .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl
agentops replay latest --file .agentops/demo/latest/AgentOpsEvents_CL.jsonl
```

Verify the full local V2 control-room path with:

```bash
agentops demo verify --runs 50 --json
```

This runs demo generation, deterministic eval/insight generation, V2 explanation, V2 open-link generation, one evidence-backed recommendation, dashboard validation, and dashboard link checks.

To persist the recommendation as a first-class dashboard artifact:

```bash
agentops recommend latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl --benchmark-run pass-run --out .agentops/demo/latest
```

Synthetic scenarios:

- successful test-writing run;
- expensive failed run;
- policy-denied secret read;
- MCP tool failure;
- edited files but no tests;
- PR opened and CI failed;
- PR opened and merged;
- model cost regression;
- instruction hash regression;
- privacy drop success;
- collector export issue.

Demo payloads are metadata-only by default. They include hashes, counts, model names, statuses, risk labels, durations, token totals, costs, eval scores, and GitHub outcome states. They do not include fake prompts, responses, tool arguments, tool results, source code, file contents, full URLs, or secrets.

To preview the optional Run Replay prompt/response viewer with safe synthetic text:

```bash
agentops demo generate --runs 10 --with-content --json
agentops content status --dir .agentops/demo/latest
agentops azure-ingest plan --dir .agentops/demo/latest --allow-content --json
```

Real content capture should use a separate restricted workspace and short retention.
