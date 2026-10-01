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

## Prerequisites and safe preview

Use an explicit approved subscription, resource group, existing workspace,
DCE/DCR names, and the existing retention and tags. Verify the subscription's
remaining credit and spending protection before writes. Save the current table
schemas and DCR definition for recovery.

**Do not use `scripts/azure-what-if.sh` or deploy `main.bicep` for this migration.**
That script previews the full infrastructure template, which can move the
existing Application Insights component to another workspace. Deploy
`v2-ingestion.bicep` directly against the existing synthetic resource group.

The verified 1 October 2026 target is subscription
`0222a208-955a-45fd-b6d8-ca4704421bf0`, resource group
`rg-copilot-agentops-synthetic-pilot-20260930`, workspace
`law-copilot-agentops-eval-eval930`, DCE `dce-copilot-agentops-eval930`, and
DCR `dcr-copilot-agentops-eval930-v2`. Its custom tables retain seven days;
the workspace default is thirty days. Preserve these separate settings.

Prepare a Bicep parameter JSON file containing the current DCR/endpoint tags.
Then preview with the exact target and unchanged retention:

```sh
az deployment group what-if \
  --subscription 0222a208-955a-45fd-b6d8-ca4704421bf0 \
  --resource-group rg-copilot-agentops-synthetic-pilot-20260930 \
  --template-file infra/bicep/v2-ingestion.bicep \
  --parameters workspaceName=law-copilot-agentops-eval-eval930 \
    environmentName=eval930 baseName=copilot-agentops retentionInDays=7 \
    @preserved-tags.parameters.json
```

Review columns **by name and type**, not array position. Existing names/types,
retention, tags, destinations and networking must remain unchanged. Reject
resource deletion or unexpected creation. Azure what-if can report omission of
the service-generated DCE `immutableId`; verify its value remains unchanged
after deployment. Do not add role assignments when existing access suffices.

For an authorized apply, use the reviewed command with `create` replacing
`what-if`, and a unique deployment name. Read back the DCR and table schemas.
New ingestion fields may not propagate immediately: the first accepted batch
can arrive with new fields absent. Never resend an accepted or uncertain batch.
After propagation, use a new, explicitly labelled small canary batch with new
IDs and assert each field by exact-ID query. Deployment success and upload
acceptance do not establish field-level readback.

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
