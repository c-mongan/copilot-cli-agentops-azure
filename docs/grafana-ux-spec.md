# Grafana UX Spec

The V2 dashboards live in the `AgentOps for Azure` folder and are designed as a control room, not generic trace charts.

## Dashboard Set

1. AgentOps Home
2. Runs Explorer
3. Agent Run Replay
4. Models, Cost & Tokens
5. Tools & MCP Risk
6. Safety, Privacy & Policy
7. Code Outcomes
8. Evals & Quality
9. Insights & Regressions
10. Collector Health

## Global Variables

Every V2 dashboard uses:

- `$datasource`
- `$workspace`
- `$timeRange`
- `$run_id`
- `$session_id`
- `$trace_id`
- `$surface`
- `$repo_hash`
- `$branch_hash`
- `$model`
- `$agent_name`
- `$skill_name`
- `$mcp_server`
- `$sub_agent`
- `$task_type`
- `$tool_name`
- `$tool_risk`
- `$pattern_key`
- `$privacy_mode`
- `$outcome_status`
- `$eval_bucket`

## UX Rules

- Top strip answers “What happened?”
- Tables answer “Why?”
- Data links answer “What should I check next?”
- Runs Explorer exposes `OpenReplay`, `OpenTrace`, and `OpenGithub` action cells.
- Agent, skill, MCP server, and sub-agent cells drill into filtered dashboards.
- Recurring pattern rows expose `OpenPattern` and preserve `$pattern_key` for Datadog/Lapdog-style triage.
- Evals & Quality exposes a **Benchmark artifact diff review** table with artifact diff counts, review action, benchmark decision, and change-target references.
- Evals & Quality exposes a **Benchmark artifact files** table with task ID, change type, and artifact path rows. It must stay metadata-only and avoid file contents.
- Evals & Quality exposes a **Benchmark promotion approvals** table with approval status, required/observed approval counts, ticket, and review action.
- Run Replay exposes an **Ask AgentOps context** panel with a metadata-only prompt and `agentops triage` command.
- Empty states point to the smallest command that generates data.
- Raw content never appears in dashboards by default.
- Prompt/response text appears only in the opt-in `AgentOpsContent_CL` Run Replay panel. The viewer must present a transcript-style `MessageText` column with role, turn, content kind, capture mode, redaction status, content hash, and content length so operators can read a conversation without losing privacy context.
- Dashboards and evals are evidence aids, not correctness, compliance, or security guarantees. They should guide investigation and review, not replace code review, threat modeling, approval workflows, or production change controls.

## Validation

```bash
agentops dashboard validate
agentops dashboard links-check
agentops dashboard ux-check
agentops dashboard verify
agentops dashboard import
```

`links-check` verifies V2 nav targets, Run Replay links, tool/model/repo drilldowns, and time-range preservation.
`ux-check` verifies the operator flow: Home top strip, Runs action cells, Run Replay story panels, Ask AgentOps context, transcript safety column order, tool risk correlation, Code Outcomes delivery timing, benchmark artifact diff/file review, and promotion approval review.
`verify` runs the static dashboard gates together. Add `--live --last 24h` to include Azure KQL checks.

`import` is a dry-run by default. Use `agentops dashboard import --yes --resource-group <rg> --grafana-name <name>` to import the V2 pack into the `AgentOps for Azure` folder.
The V2 pack is the default product experience. Legacy raw-OTel dashboards under `grafana/agentops-*.json` are debug views and are imported only with `agentops dashboard import --all` or `AGENTOPS_INCLUDE_LEGACY=true`.
