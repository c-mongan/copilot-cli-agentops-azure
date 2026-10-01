# Azure additive schema migration: prerequisites, cost, and recovery

This doc covers the operational envelope for applying the additive
`AgentOpsInsights_CL` column migration in `infra/bicep/v2-ingestion.bicep`
(`Rule`, `ArchitectureVersion`, `Numerator`, `Denominator`, `CoverageRuns`,
`Status`, `ComponentRefs`, `Evidence`), and generalizes to any future additive
column added to the v2 ingestion schema. It does not cover applying the
change — that remains a separate target-authorized step (see
"Applying the migration" below). It is distinct from the unrelated
"recommendation rollback condition" concept in the product-audit tooling
(when to roll back an agent/skill/model/instruction change based on eval
regressions); this doc is only about the Log Analytics/DCR schema itself.

## Prerequisites to apply this additive migration

Reuse the same environment variables and guard already enforced by
`scripts/azure-what-if.sh` and `scripts/lib/azure-subscription-guard.sh` —
do not invent new ones:

- `AGENTOPS_AZURE_SUBSCRIPTION_ID`: the subscription the deployment targets.
  The guard refuses to run if this is unset.
- `AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS`: comma-separated allow-list; the
  target subscription must appear here or the guard exits closed (exit code
  2) before any Azure call is made.
- An active `az login` session whose `az account show` subscription ID
  matches `AGENTOPS_AZURE_SUBSCRIPTION_ID` exactly (the guard calls
  `az account set --subscription` explicitly rather than trusting whatever
  subscription happens to be active).
- `AZURE_RESOURCE_GROUP` (defaults to `rg-copilot-agentops-dev`) must already
  exist — `scripts/azure-what-if.sh` checks `az group exists` and tells you
  to run `scripts/azure-prereqs.sh` first if it does not.
- RBAC: the identity running the deployment needs write access to the
  Log Analytics workspace, its Data Collection Rule(s)/Endpoint, and the
  resource group (Contributor or an equivalent custom role scoped to those
  resource types) — additive table/column changes are applied as part of
  the normal `main.bicep` deployment group, not a separate permission tier.

## Produce the preview/what-if command

`scripts/azure-what-if.sh` already runs `az deployment group what-if` against
`infra/bicep/main.bicep` (which includes `v2-ingestion.bicep`) with the full
parameter set, so the additive architecture columns are previewed
automatically — no new script is needed. With the prerequisites above met,
preview the change with:

```sh
AGENTOPS_AZURE_SUBSCRIPTION_ID=<sub-id> \
AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS=<sub-id> \
./scripts/azure-what-if.sh
```

Without those two variables set, the script fails closed before making any
Azure call:

```
$ ./scripts/azure-what-if.sh
ERROR: set AGENTOPS_AZURE_SUBSCRIPTION_ID before any Azure write or privileged lookup.
```

(exit code 2). This was verified locally with no credentials configured —
see `.superpowers/sdd/2026-09-30-agentops-overnight-build/task-8-report.md`
for the captured output. No live Azure call was attempted as part of this
task.

## Cost notes

- Additive columns increase per-row ingestion size only marginally: `Rule`,
  `ArchitectureVersion`, and `Status` are short string enums; `Numerator`,
  `Denominator`, and `CoverageRuns` are `long` counters. None of these add
  meaningfully to Log Analytics ingestion volume or retention cost compared
  to the existing per-row insight columns (`InsightType`, `Severity`,
  `Summary`, etc.).
- `ComponentRefs` and `Evidence` are `dynamic` (JSON) columns. Per the
  architecture engine's own row-shaping contract
  (`agentops-cli/src/lib/architecture/report.js`), `ComponentRefs` is a
  bounded list of `{kind, name/path}` component references and `Evidence` is
  a small bounded object (`interval`, `rate`, `subStatus`,
  `representativeRunIds`, `coverageLimits`, `rejectionTest`, `specSection`) —
  metadata only, never raw prompt/response content. This mirrors the
  bounded-size reasoning already established for Task 1's span fields
  (`ModelRequested`/`Provider`/`CacheReadTokens`/`CacheWriteTokens`, all
  short scalars) and Task 6's hypothesis cards (line 155 of
  `docs/plans/2026-09-30-agentops-overnight-build.md`: "bounded example
  runs, numerator/denominator/coverage/uncertainty... status and evidence
  links"). Because both dynamic columns are capped in shape and never carry
  user content, their ingestion/retention cost impact stays in the same
  marginal-increase band as the scalar columns, not the unbounded-payload
  band that would apply to raw transcript storage.
- No new table is created — these are additive columns on the existing
  `AgentOpsInsights_CL` table, so there is no additional per-table Log
  Analytics commitment-tier or Data Collection Rule cost; only the marginal
  per-row bytes described above.

## Recovery / rollback procedure

Quoting the plan's own reasoning (`task-8-brief.md`): "Azure rollback need
not delete additive columns; stop new-field writes and restore readers
first." Concretely, if an additive schema apply fails partway or a later
problem is traced back to it:

1. **Stop new-field writes first.** Revert or disable whichever writer
   (collector export config, DCR transform, or the `agentops architecture`
   command path) emits the new columns, so no further rows reference them.
   Do not attempt to delete the columns from the live table as a first
   step — Log Analytics table schema changes are additive-safe precisely
   because nothing downstream needs the columns to exist for old rows to
   keep working.
2. **Restore readers next.** Roll the KQL/dashboard consumers
   (`grafana/kql/insights.kql`, the "Latest insights" panel in
   `grafana/dashboards/v2/09-insights-regressions.json`, and
   `scripts/build-grafana-v2-dashboard-pack.js`'s `insightsNormalize()`
   helper) back to the previous committed revision if the new columns are
   causing reader-side failures. Because every reader path uses
   `column_ifexists(...)` with explicit typed defaults, older rows without
   the new columns continue to project cleanly either way — this is what
   "preserve older rows with nulls and backward-compatible unions" means in
   practice for this schema.
3. **Never delete the additive columns as the rollback step.** Removing a
   column from `AgentOpsInsights_CL` is a destructive, non-additive change
   that could break historical row reads (including rows already backfilled
   with the new fields) and is explicitly out of scope for a rollback of an
   additive migration. If a column genuinely must be removed, that is a
   separate, explicitly authorized destructive migration — not a rollback.
4. **Re-verify, don't assume.** Before declaring recovery complete, rerun
   `agentops dashboard kql-check --last 24h --json` and the schema-safety
   test suite (`node --test test/v2-ingestion-schema-safety.test.js` from
   `agentops-cli/`) locally, and only treat a live deployment/readback as
   verified after an explicit readback query confirms the expected state —
   per the plan: "deployed/readback status stays false until actually
   verified. Never treat an ingestion acknowledgment as row proof."

## Applying the migration (out of scope for this doc)

Applying the change and uploading new test data is a separate,
target-authorized step requiring real Azure credentials against an approved
subscription. After authorization: run the what-if preview above, confirm
the diff is additive-only, apply via the normal deployment path, then verify
exact unique synthetic IDs, field values, and canary absence by readback
after propagation. Do not resend uncertain accepted batches blindly.
