# AgentOps actual deployment and delivery audit — 2 October 2026

The existing Azure synthetic pilot is working as a telemetry store. Fresh exact-run typed REST queries recovered all 390 retained event/span rows and matched all 14,639 source fields. This verifies delivery and preservation for those nine synthetic run IDs. It does not prove continuous production ingestion, model-quality improvement, or a hosted AgentOps product.

This audit performed read-only Azure and GitHub operations. It made no deployments, telemetry uploads, model calls, RBAC changes, commits, pushes, or billing changes. It preserved existing work. Small local evidence copies are in `<agent-workspace>/scratch/agentops-deployment-audit-20261002/`; the SanDisk UUID was verified before retaining them.

## Exact environment

| Property | Fresh verified value |
| --- | --- |
| Subscription | Visual Studio Enterprise Subscription, `<subscription-id>` |
| Subscription state and spending policy | `Enabled`, `subscriptionPolicies.spendingLimit=On`, quota `MSDN_2014-09-01` |
| Azure CLI current subscription | Same Visual Studio Enterprise subscription; the old deployment-plan warning that the default is Pay-As-You-Go is stale |
| Synthetic pilot resource group | `rg-copilot-agentops-synthetic-pilot-20260930`, North Europe |
| Pilot workspace | `law-copilot-agentops-eval-eval930`, customer ID `<workspace-customer-id>` |
| Pilot workspace retention/cap | 30-day workspace default; `dailyQuotaGb=1`; `PerGB2018` |
| Pilot public query and ingestion | Both `Enabled`; this is not proof of anonymous access |
| Metadata DCR | `dcr-copilot-agentops-eval930-v2`, immutable ID `dcr-1b45ce3240c3473893972da44a2c2383`, `Succeeded` |
| Metadata DCR destination | Exactly the pilot workspace above |
| Pilot Application Insights | `appi-copilot-agentops-eval-eval930`, linked to the pilot workspace, public ingestion/query enabled, component retention property 90 days |
| Fresh remaining credit | Not queried or inferred. The previously captured EUR 121.76 is historical, not a refreshed balance |
| Pilot resource-group budget | Budget-list API returned an empty list |
| Subscription budgets | One unrelated `docsentinel-foundry-eu-75eur` monthly budget for 75; this is not an AgentOps budget |

Direct subscription-scope role inventory still contains one User Owner and one User Contributor. Inherited access means the pilot is not an isolated private tenant boundary. Only synthetic/public data has been qualified here; RBAC listing alone does not verify every effective permission.

The original managed dev workspace, `managed-appi-copilot-agentops-dev-ws`, still has 30-day default retention and `dailyQuotaGb=-1` with public ingestion/query enabled. The pilot cap does not cap that separate workspace. Spending-limit On is a subscription property; no claim is made that GitHub/Copilot overage is disabled. No current Copilot budget/entitlement refresh or paid model operation was required for this audit.

## What actually exists

Subscription inventory was inspected by resource type; unrelated project resources are omitted from this report.

| Area | Deployed resources | Limit |
| --- | --- | --- |
| Original dev telemetry | `appi-copilot-agentops-dev`; automatically managed workspace, DCE, DCR and Azure Monitor account; Application Insights Smart Detection action group | The managed Azure Monitor account is not the optional enterprise AgentOps monitor/Grafana deployment |
| Earlier isolated EVAL | `law-copilot-agentops-eval-dev`, its DCE/content DCR, and `dcr-copilot-agentops-dev-spans` | Separate retained environment; not the current nine-run readback target |
| Current synthetic pilot | One LAW, one Application Insights component, two DCEs and two DCRs | Azure data layer exists; there is no deployed cloud product frontend |
| Grafana, Workbooks, portal dashboard | None found in this subscription inventory | Repository dashboard JSON/KQL is packaged/configured, not deployed visual proof |
| AgentOps Function actioner or hosted judge | None found | Bicep and code availability do not establish runtime delivery |
| AgentOps shared Azure storage or Key Vault | None found in AgentOps groups | Unrelated subscription storage/vault resources are not AgentOps deployments |
| AgentOps scheduled query alert rules | None found | A retained attempted alert deployment failed; no active alert is inferred |

The pilot has twelve Analytics custom tables, each with seven-day interactive and total retention:

| Table | Columns | Fresh evidence in this audit |
| --- | ---: | --- |
| `AgentOpsContent_CL` | 18 | Schema/retention only; historical content readback was not repeated |
| `AgentOpsEvents_CL` | 63 | 200 exact-run rows and every source field matched |
| `AgentOpsSpans_CL` | 37 | 190 exact-run rows and every source field matched |
| `AgentOpsRunSummary_CL` | 37 | Schema/retention only |
| `AgentOpsToolCalls_CL` | 16 | Schema/retention only |
| `AgentOpsMcpCalls_CL` | 20 | Schema/retention only |
| `AgentOpsPrivacy_CL` | 11 | Schema/retention only |
| `AgentOpsEval_CL` | 15 | Schema/retention only |
| `AgentOpsGithubOutcomes_CL` | 19 | Schema/retention only |
| `AgentOpsInsights_CL` | 18 | Schema/retention only |
| `AgentOpsRecommendations_CL` | 25 | Schema/retention only |
| `AgentOpsCollectorHealth_CL` | 19 | Schema/retention only |

The metadata DCR declares eleven streams corresponding to the metadata tables. Its span transform explicitly projects the four script runtime/loader fields and casts them to strings. Table/stream presence is not score, recommendation, outcome, privacy or collector-health delivery proof. The spans table has no score/risk/workflow columns; separate Eval/ToolCalls/McpCalls contracts exist and need their own producer-to-query qualification.

Fresh resource-group deployment history includes successful `agentops-additive-observability-20261001`, `runtime-transform-cast`, `script-runtime-schema-eval930`, `agentops-eval-appinsights-20260930`, `agentops-script-link-evidence-20260930`, `agentops-session-event-schema-20260930`, and the two pilot metadata/content deployments. The failed `Failure-Anomalies-Alert-Rule-Deployment-12cea5fe` has `DeploymentFailed` with `MissingSubscriptionRegistration`. Successful deployment history establishes resources/schema, not every telemetry path.

## Fresh field-level readback

Six Logs REST queries were scoped to exact retained synthetic run IDs and `TimeGenerated` between `2026-10-01` and `2026-10-04`, with `take 1000` per query. Source JSONL and Azure typed values were compared as full source-field multisets; datetime strings were normalized and null string fields respected Azure's empty-string representation. Multiple lifecycle rows sharing a span ID remain distinct. No upload was retried or repeated.

| Retained bundle | Event rows | Span rows | Source-field comparisons | Result |
| --- | ---: | ---: | ---: | --- |
| Four agent-pattern runs | 153 | 137 | 10,889 | All matched |
| Three agent smoke runs | 27 | 37 | 2,398 | All matched |
| Two read-only reviewers | 20 | 16 | 1,352 | All matched |
| Total | 200 | 190 | 14,639 | No missing/extra rows or privacy canaries |

Exact run IDs are retained in `fresh-field-readback-audit.json` and query artifacts. Original evidence roots remain unchanged:

1. `<agent-workspace>/scratch/agentops-patterns-20261002/azure-patterns-bundle/`.
2. `<agent-workspace>/artifacts/agentops-e2e-20261002/azure-bundle/`.
3. `<agent-workspace>/artifacts/agentops-e2e-20261002/azure-review-bundle/`.

**Verified documentation discrepancy:** The multi-agent completion document says the two reviewer runs selected `gpt-5.4-mini` instead of their definitions' `gpt-5.5`. Both retained source bundles and fresh Azure readback instead report `ModelActual=gpt-5.5` in reviewer event rows and `ModelRequested=ModelActual=Model=gpt-5.5` in their model-bearing span rows (four per reviewer). This audit credits the recorded model as `gpt-5.5`; an asserted mini override is not model execution proof.

The final StockPilot MCP/delegation run is separate local proof and is not among these uploaded nine run IDs. Fresh readback does not expand historical capture coverage or change any local outbox's pending-delivery state.

## Bicep topology versus deployment

`infra/bicep/pilot-subscription.bicep` matches the smallest isolated synthetic slice: owned EVAL group, content workspace/table/DCE/DCR, Application Insights and metadata V2 ingestion. The deployed pilot also has subsequent additive schema updates. It is not an enterprise deployment of `main.bicep`.

`main.bicep` defaults to profile `team`, 30-day retention and 2 GB/day cap. `dev` defaults to 1 GB/day; `enterprise` defaults to 90 days and 5 GB/day. Advanced Monitor/Grafana/Key Vault, actioner, shared store, V2 ingestion, alerts, RBAC and budget are individually conditional. Alerts default disabled. Budget deployment additionally requires a nonempty contact list. Optional services are not required to call the existing pilot's delivery loop complete.

The old migration hazard remains relevant: applying `main.bicep` in `rg-copilot-agentops-dev` creates `law-copilot-agentops-dev` and rebinds the existing `appi-copilot-agentops-dev` to that new workspace. Current inventory still has the managed workspace and no `law-copilot-agentops-dev`. Prior what-if evidence identified that rebind. A fresh what-if was not necessary for this read-only audit; the template must not be treated as a safe upgrade without a selected target and migration design. `azure.yaml` also retains postprovision behavior; using azd is not a read-only shortcut.

## GitHub versus local delivery

Fresh GitHub API inspection confirms the origin is the public repository [c-mongan/copilot-cli-agentops-azure](https://github.com/c-mongan/copilot-cli-agentops-azure), default branch `main`, not archived.

| Target | SHA | Evidence |
| --- | --- | --- |
| Local audited head | `0b91a3671376f9bc655aa955094d995ac711254c` | Local Git, `fix: accept MCP request metadata and verify live staging end to end` |
| Remote `main` | `090d337d4226d7f8a3ebadc2228e9cb4c8e326b5` | GitHub API; commit dated 18 August 2026 |
| Remote `cmongan/agentops-v2-control-room` | `abe088a3d31707fc96a5599270fcb8c57248b4d6` | GitHub branches API |
| Remote `feat/enterprise-flight-recorder` | `d516a6328f02f68fa789b50795481b35ece6a00f` | GitHub branches API |

The latest eight CI runs returned by GitHub are completed successes. The latest is [CI run 32156013073](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/32156013073), created `2026-08-18T15:41:50Z`, for remote main `090d337...`. GitHub commit lookup for the local exact head returns HTTP 422, `No commit found for SHA`. These old CI successes do not qualify the October local implementation. The public repository's `pushed_at` value is `2026-09-29T21:12:05Z`; this is repository activity, not evidence that main or the local head was released.

The local CI workflow defines offline Ubuntu and Windows checks, including CLI tests, static checks, package/distribution/install/Homebrew readiness, coverage, security and schema/script checks. This audit did not start hosted CI or publish any local change. Parent audit results establish current local checks separately.

## Remaining deployment work

1. **Finish the existing pilot's useful contracts first.** Qualify run-summary, eval, recommendation, architecture insight, outcome and health producers with synthetic fixtures, exact typed readback and the selected UI queries. Existing table definitions are preparation, not that qualification.
2. **Choose the operator surface.** Azure Logs works; local Runs/replay/Architecture/Compare exist. A cloud frontend, Workbook or Grafana installation needs an explicit product decision, its real query contracts and a deployment target. A Grafana service is optional, not an automatic completion prerequisite.
3. **Define delivery operations.** Establish ownership of continuous ingestion, bounded batches, fail/retry/deduplication behavior, retention/deletion, health alerts, and access. This audit proves selected manual reviewed delivery, not continuous operations.
4. **Resolve public release separately.** Current local code is not remote main and lacks exact-head hosted Linux/Windows proof. Review the release candidate and required checks before any authorized publication. No push is included in this audit.
5. **Treat enterprise as separate scope.** Private tenant/access requirements, monitored spend, retention policy, optional services and migration recovery need qualification before extending beyond synthetic pilot use.

No infrastructure redeployment is needed merely to recover the verified 390 rows. The useful completed part is a local evidence-led debugger plus an Azure synthetic data layer. The missing part is a qualified operational product with reliable quality/outcome contracts and evidence of repeated benefit.
