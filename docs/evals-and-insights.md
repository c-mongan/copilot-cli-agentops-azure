# Evals and Insights

`agentops insights generate` creates deterministic quality scores and actionable insight rows from V2 AgentOps tables.

```bash
agentops insights generate \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl \
  --privacy .agentops/demo/latest/AgentOpsPrivacy_CL.jsonl \
  --github .agentops/demo/latest/AgentOpsGithubOutcomes_CL.jsonl \
  --json
```

Output:

```text
.agentops/insights/latest/AgentOpsEval_CL.jsonl
.agentops/insights/latest/AgentOpsInsights_CL.jsonl
```

The evaluator is deterministic and metadata-only. It scores:

- test discipline;
- tool efficiency;
- context/cache efficiency;
- security/privacy;
- reliability;
- code outcome.

It emits insight rows for patterns such as edited files without tests, failed tools, context pressure, policy denies, privacy drops, CI failures, and high estimated cost. It also emits recurring-pattern rows when multiple runs share the same metadata-only shape, such as repeated failures by task/model/outcome, repeated edits without tests by repo/task/agent, repeated policy denies by repo/task/privacy mode, or repeated high-cost model/task runs.

List the recurring patterns directly from the generated insight rows:

```bash
agentops insights patterns --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl
```

The Insights & Regressions dashboard exposes the same rows with `OpenPattern` and `PatternKey` drilldowns.

Explain the latest run with the generated evidence:

```bash
agentops explain latest \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl \
  --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl
```

Recommend one next action with dashboard drilldowns:

```bash
agentops recommend latest \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl \
  --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl \
  --benchmark-run pass-run \
  --out .agentops/demo/latest
```

The recommendation is metadata-only. It links to Run Replay, Tools & MCP Risk, Models/Cost, Safety/Privacy, Code Outcomes, or Insights based on the run and top insight. If the selected run has no direct insight but matches a recurring metadata pattern, the recommendation falls back to that pattern and links Insights & Regressions with `$pattern_key`.

When `--out` is provided, AgentOps appends an `AgentOpsRecommendations_CL.jsonl` row containing the action, severity, observed pattern, next action, pattern id/key, eval bucket, benchmark-gate summary, validation steps, dashboard count, and metadata-only change-target refs. It does not store prompt text, model responses, tool arguments, tool results, source code, or file contents.

Create a privacy-safe bundle for Copilot/Codex or a telemetry investigator:

```bash
agentops ask-context latest \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --events .agentops/demo/latest/AgentOpsEvents_CL.jsonl \
  --tools .agentops/demo/latest/AgentOpsToolCalls_CL.jsonl \
  --privacy .agentops/demo/latest/AgentOpsPrivacy_CL.jsonl \
  --github .agentops/demo/latest/AgentOpsGithubOutcomes_CL.jsonl \
  --evals .agentops/insights/latest/AgentOpsEval_CL.jsonl \
  --insights .agentops/insights/latest/AgentOpsInsights_CL.jsonl
```

The bundle includes run metadata, timeline events, failed/denied tools, privacy signals, GitHub outcomes, evals, insights, and Run Replay links. It explicitly tells the investigator not to request or enable prompt/response/tool-argument/file-content capture.
