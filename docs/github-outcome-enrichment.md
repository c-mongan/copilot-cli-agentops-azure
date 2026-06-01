# GitHub Outcome Enrichment

`agentops github-enrich` turns local `gh` CLI PR metadata into privacy-safe Code Outcomes rows.

```bash
agentops github-enrich --limit 30 --json
```

If you have V2 run summary rows, pass them so PR branch hashes can map back to the AgentOps run that produced the branch:

```bash
agentops github-enrich \
  --limit 30 \
  --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl \
  --json
```

Output:

```text
.agentops/github-outcomes/latest/AgentOpsGithubOutcomes_CL.jsonl
```

Captured:

- repo hash;
- branch hash;
- PR number hash;
- opened/merged/closed/reverted flags;
- CI status;
- review comment count;
- commit count;
- files changed count.
- run start, PR creation, and merge timestamps when available;
- time from agent run to PR and time from agent run to merge.

When `--runs` is provided, enrichment matches `RepoHash + BranchHash` and writes the matching `RunId` into `AgentOpsGithubOutcomes_CL`. The match is hash-only; branch names and repo names are not exported.

Not captured:

- repo name;
- branch name;
- PR title/body text;
- comments;
- commit messages;
- file paths or diffs.

This is outcome telemetry. It shows whether agent-assisted work led to PRs, passing CI, merges, closes, or reverts without exporting source content.
