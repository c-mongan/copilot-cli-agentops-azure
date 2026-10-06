# Lean enterprise Azure deployment plan — 2 October 2026

**Status: approved for the additive synthetic pilot implementation. The pilot Workbook and budget are deployed and read back; the 97-row synthetic batch has exact typed REST readback and the native portal proof is complete. This plan remains a design and boundary document, not production authorization. No production onboarding, model spend, publication, or team access grant is implied.**

Use Azure Monitor as the shared cloud data layer, an Azure Workbook as the authenticated team view, and the existing local AgentOps CLI for capture, privacy, evidence, and detailed replay. This is the smallest complete internal diagnostic service. It requires no hosted AgentOps application, container cluster, Grafana instance, database, or model judge. Enterprise readiness comes from qualified data contracts, owned operations, identity, access, privacy, and recoverability; a larger service list does not supply those properties.

The existing Visual Studio Enterprise subscription is a development/test qualification target. Microsoft restricts this benefit to development and testing and excludes a financially backed SLA. A production fleet needs a regular organization-owned subscription and an approved tenant/access boundary. Reuse the architecture and tested schema there; do not turn the synthetic subscription into production by changing its tags. [Visual Studio Enterprise offer](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0063p/)

The additive pilot deployment is recorded in [enterprise deployment verification](../research/2026-10-02-enterprise-deployment-verification.md). It created Workbook `0c9ff309-52d7-5203-a194-ba64fae76a13` (`AgentOps Diagnostic Pilot`) and a resource-group budget of 10 billing-currency units/month with no notification contacts. The existing North Europe workspace, DCR, DCE, and Application Insights binding were preserved. The final ARM deployment succeeded, Workbook content readback matched the maintained JSON after workspace injection, and the native portal proof completed without browser errors.

## 1. Current environment versus proposed service

The [earlier fresh deployment audit](../research/2026-10-02-deployment-audit.md) is the historical source for the pre-pilot Azure state; the [enterprise deployment verification](../research/2026-10-02-enterprise-deployment-verification.md) records the current pilot resources and readback. This plan did not independently re-query the subscription. The [deep audit](../research/2026-10-02-project-deep-audit.md) and [platform comparison](../research/2026-10-02-current-platform-research.md) describe product gaps and native overlaps. Local source head when planning began: `0b91a3671376f9bc655aa955094d995ac711254c`; branch `feat/enterprise-flight-recorder`, with substantial existing dirty work preserved. New work during this session must be validated at its final candidate, not this earlier SHA.

| Area | Verified current state in audit | Proposed incremental behavior |
| --- | --- | --- |
| Qualification target | Subscription `<subscription-id>`, North Europe, `rg-copilot-agentops-synthetic-pilot-20260930` | Retain synthetic/public qualification only; explicitly pass subscription on every future command |
| Cloud store | `law-copilot-agentops-eval-eval930`, `PerGB2018`, 30-day workspace default, 1 GB/day emergency cap | Reuse this workspace for qualification; keep existing twelve custom tables at seven-day interactive/total retention initially; this reference was preserved by the pilot deployment |
| Metadata ingress | `dcr-copilot-agentops-eval930-v2`, immutable ID `dcr-1b45ce3240c3473893972da44a2c2383`, existing DCE and eleven streams | Reuse provisioned endpoint; qualify every enabled stream independently; no content publisher grant |
| Proof | Earlier audit: nine synthetic runs, 200 event and 190 span rows, 14,639 fields matched | The current qualification bundle contains 97 synthetic rows across eleven metadata streams. Exact typed REST readback matched every maintained field, with the privacy canary absent; the first readback failure was retained and no batch was re-uploaded. Native portal proof covered all twelve panels, filters, linked panels, and honest empty/unknown states |
| Team UI | Workbook was absent in the earlier audit | Saved Workbook `0c9ff309-52d7-5203-a194-ba64fae76a13` is deployed with the selected LAW injected. Native default/all-runs proof showed all twelve panels without query/resource errors; Last Hour filtering refreshed the run list and single-run panels. Retain local Runs/Architecture/Compare for detailed evidence |
| Access | Subscription User Owner and Contributor inherit access; no dedicated team principals are approved | No new observer/editor/publisher groups were granted. The inherited owner qualification is sufficient for the pilot deployment but does not establish team or content isolation |
| Operations and cost | Earlier audit had no AgentOps budget or active query alert | Resource-group budget is deployed at 10 billing-currency units/month with an empty notification set. No action group or health rule is enabled; current portal credit was positively verified, with the private amount omitted here |
| Original dev workspace | Separate managed workspace remains uncapped | Leave untouched. Its usage is outside the pilot cap and proposed pilot budget |

No existing Application Insights workspace binding changes. `infra/bicep/main.bicep` would create a new LAW and rebind the original dev component; it remains unsuitable as an in-place upgrade. `azure.yaml` has a postprovision import hook, so `azd provision` is not an approved shortcut. Existing packaged dashboards are not deployed UI evidence.

## 2. Architecture and boundaries

```text
Developer/runner (owned process, supported pinned runtime)
    |
    +--> local evidence ledger and detailed HTML replay
    |
    +--> strict metadata projection + privacy receipt
              |
              +--> target-bound local outbox, byte limit, retry policy
                          |
                    Entra token + TLS >= 1.2
                          |
                  existing regional DCE / metadata DCR
                          |
                Analytics custom tables in selected LAW
                          |
              Entra-authenticated Azure Logs + Workbook
                          |
                 operator / diagnosis / human decision

Content DCR/table: outside the enterprise metadata route; no writer grant.
Cloud actioner / hosted judge / automatic refactor: outside this plan.
```

The selected first route is the proven custom-table Logs Ingestion API. Application Insights already exists and can continue to serve qualified native traces; no duplicated native inference span producer is proposed. Azure native OTLP and Agents views remain separate acceptance lanes because current official native ingress is preview, and custom-table readback does not prove agent discovery or metric compatibility. [Current platform research](../research/2026-10-02-current-platform-research.md)

Use the existing DCE because the current DCR uses it. A new DCR with `kind: Direct` can omit the DCE for public authenticated ingress, but changing endpoint topology brings no immediate diagnostic value and requires a new DCR and client migration. DCR, LAW, and DCE must use matching regions. Read endpoints and immutable IDs from outputs/readback; never construct them from guessed domain suffixes. [Logs Ingestion API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview)

## 3. Selected resources and implementation boundaries

| Resource | ARM type / planned API | Mode and reason |
| --- | --- | --- |
| Existing workspace | `Microsoft.OperationalInsights/workspaces@2023-09-01` | Reference by exact resource ID; future reviewed hardening is a narrow patch, not replacement |
| Existing custom tables | `Microsoft.OperationalInsights/workspaces/tables@2022-10-01` | Preserve qualified schemas; match actual deployed schema and current producer contract before changes |
| Existing metadata DCR / DCE | `Microsoft.Insights/dataCollectionRules@2022-06-01`; `dataCollectionEndpoints@2022-06-01` | Reference exact existing resources; preserve content route separately |
| Existing Application Insights | `Microsoft.Insights/components@2020-02-02` | Preserve existing LAW binding; no new component required for the custom-table view |
| New Workbook | `Microsoft.Insights/workbooks@2022-04-01` | `kind: shared`, deterministic GUID ARM name, display name `AgentOps Diagnostic Pilot`; bound to selected LAW |
| Resource-scoped role assignments | `Microsoft.Authorization/roleAssignments@2022-04-01` | Stable scope/principal/role GUIDs; existing Entra groups or approved new groups, no secrets in parameters |
| New resource-group budget | `Microsoft.Consumption/budgets@2024-08-01` | `budget-agentops-diagnostic-pilot`; proposed 10 units/month in confirmed billing currency for low-volume qualification |
| New action group | `Microsoft.Insights/actionGroups@2023-01-01` | `ag-agentops-diagnostic-pilot`, short name `AgentOps`; approved team email only, no SMS/voice/webhook/remediation |
| Optional first health rule | `Microsoft.Insights/scheduledQueryRules@2023-12-01` | `alert-agentops-ingestion-health`; disabled until synthetic fault and notification test pass; 15-minute cadence, one series |

The Workbook must be built from the actual custom-table query library, with run/time filters, coverage and delivery status, privacy status, actual/requested model, tool/MCP/script failures, collector health, and measured outcomes. `workbooks/agentops-workbook.json` exists, but it is not assumed to cover the V2 product contract. Preserve null/unknown labels; do not display unknown scores, costs, models, or missing outcomes as zero/success. An authenticated shareable Workbook is the cloud team UI; it will not reproduce every local interactive replay feature. [Workbooks and permissions](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-overview)

Naming was checked against ARM reference and naming guidance. Existing names are preserved. LAW names must be 4–63 characters, alphanumeric/hyphen and start/end alphanumeric. New Workbook names use a GUID rather than the display name. Action-group names are resource-group unique, 1–260 characters; the chosen name and eight-character short name avoid punctuation restrictions. Scheduled-query rule names are resource-group unique, 1–260 characters; chosen name uses letters/hyphens. Role-assignment names use GUIDs. DCR/DCE names remain existing, and future copies must pass selected API validation. The pilot target passed provider, policy, regional, and budget validation; those checks must be repeated for any production target. Documentation is not a live deployment guarantee. [Naming rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules), [Workbook schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/2022-04-01/workbooks), [LAW schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.operationalinsights/2023-09-01/workspaces)

## 4. Access and privacy contract

| Principal | Role / scope | Allowed responsibility |
| --- | --- | --- |
| `AgentOps-Observers` group | Workbook Reader on saved Workbook; Log Analytics Data Reader on selected metadata tables/workspace | Read the Workbook and permitted metadata; no uploads/settings/role changes |
| `AgentOps-WorkbookEditors` group | Workbook Contributor on Workbook; same permitted metadata read grants | Edit visualizations only; no broad Monitoring Contributor needed |
| Authorized local uploader group or runner identity | Monitoring Metrics Publisher on metadata DCR only | Upload metadata; cannot query or publish content through this grant |
| Operator group | Monitoring Reader on owned resource group; Workbook permissions as needed | Observe resource health and operations; configuration writes use reviewed deployer path |
| Reviewed deployment identity | Contributor on owned resource group; separate narrowly delegated RBAC administrator | Deploy approved resources; role writes require explicit correct scope and role authority |
| Billing operator | Cost Management Reader on selected budget scope | Review charges and benefits; cannot change spending limit |

Built-in role IDs and their effective permissions must be read back at the selected target before assignment. Fine-grained Log Analytics Data Reader access is supported in current role documentation, but effective allowed/denied queries must be tested, including all Workbook tables. If the organization selects workspace-level access for a dedicated metadata-only LAW, that is an explicit access decision. No observer receives subscription Reader/Contributor merely to make portal navigation work. Groups use immutable object IDs; group display names are not permission targets. [Monitor built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/monitor)

Interactive developers use the existing Entra/Azure CLI login and token flow. Existing Azure runners can use managed identity; CI can use federated credentials after target authorization. Do not put client secrets, tokens, or connection strings in Git, reports, Workbook parameters, or deployment output. No Key Vault is needed for a route with no newly stored secret. A managed identity on a developer laptop cannot simply be assumed; unattended laptop publishing needs a separately qualified supported identity/credential design.

For production, require MFA and the organization's existing Conditional Access/security policy. PIM and paid Entra features depend on existing licenses; do not buy P1/P2 to satisfy a generic checklist. Enumerate inherited subscription/management-group access and deny private-data onboarding until the owners accept the effective boundary. RBAC is additive: a narrow resource grant cannot cancel inherited Owner/Contributor access.

Public HTTPS endpoints are proposed for a metadata-only internal diagnostic pilot because users publish from developer networks. They are authenticated, not anonymous. This explicitly accepts public network reachability and token/endpoint abuse risk. Require a sanitized allowlist before queuing, least-privilege grants, modern TLS, token hygiene, and ingress/usage monitoring. If policy requires network isolation or regulated/confidential content, the public option fails acceptance: use AMPLS, DCE, private endpoint, private DNS, and an existing connected VNet/VPN/ExpressRoute path, then prove both ingestion and portal query DNS paths before disabling public access. Private endpoints without a connected developer network do not work. [Azure Monitor Private Link design](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/private-link-design)

Cloud rows contain schema/version, opaque run/session/correlation IDs, approved model/tool names, timing, usage with unknowns preserved, statuses, controlled hashes, and deterministic evidence grades. Strip prompts/responses, tool arguments/results, raw logs, source code, filenames/absolute paths, private URLs, user identities, credentials, arbitrary exception text, and uncontrolled attributes. Hashes and opaque IDs may still be personal/linkable data; metadata is not automatically anonymous. Maintain a documented local-to-cloud projection and canary tests for each carrier and rendering surface.

Keep workspace default 30 days and explicitly retain pilot custom tables for seven days, as already deployed. Proposed production default is 30-day metadata table retention after policy approval; do not accept the repository enterprise preset's 90 days automatically. There is no cloud content lane in this baseline. Retention is not an immediate erasure guarantee: maintain incident containment, authorized purge procedure, and local queue/ledger cleanup policy separately. Proposed local transport queue policy: owner-only permissions, OS encrypted disk, maximum 48 hours or 256 MiB, then explicit expiry/loss receipt; those limits require implementation/verification before unattended publishing. Do not place live private queue/state on removable experimental storage. [Retention configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure)

## 5. Cost model and limits

Rates below were fetched live from the Microsoft Retail Prices API on 2 October 2026 using `armRegionName eq 'northeurope'`, services `Log Analytics` and `Azure Monitor`, currency USD, Consumption meters. A bounded meter snapshot is retained in `.azure/enterprise-plan/pricing-snapshot.json`. Rates are public retail estimates, exclude VAT, discounts, support, identity licenses, and existing unrelated resources, and are not a EUR invoice quote. Confirm actual billing currency and subscription offer in Cost Management before approval. [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/)

| Meter | North Europe public rate | Use |
| --- | ---: | --- |
| Analytics Logs Data Ingestion | USD 2.76 / billable GB | Main variable cost; measure `_BilledSize`, not compressed upload bytes |
| Analytics Logs Data Retention | USD 0.12 / GB-month | Additional paid retention; baseline custom tables stay within 31-day included retention window |
| System Log alert at 15-minute frequency | USD 0.50 / series-month | Illustrative first rule; confirm actual metering/dimensions before enabling |

For a 30-day month, let `G` be total billable ingested GB, `F` be remaining applicable ingestion allowance, `E` be additional retained GB-month, and `A` be actual alert/notification charges. Estimate `C_USD = 2.76 × max(0, G − F) + 0.12 × E + A`. Use `F=0` for conservative planning because a five-GB free tier appears in retail meters but its remaining subscription allowance was not read. Analytics interactive queries have no separate query charge; Basic/Auxiliary/long-term search have different query contracts and costs. Keep Analytics for the joins needed here. No fixed cloud compute/Grafana service charge is introduced by this topology. [Azure Monitor cost model](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/cost-usage)

| Scenario | Assumed fleet volume | Monthly ingestion estimate, F=0 | With one illustrative 15-minute alert |
| --- | ---: | ---: | ---: |
| Low qualification | 0.01 GB/day = 0.30 GB/month | USD 0.83 | USD 1.33 |
| Medium internal team | 0.167 GB/day ≈ 5 GB/month | USD 13.80 | USD 14.30 |
| High pilot ceiling case | 1 GB/day = 30 GB/month | USD 82.80 | USD 83.30 |

These are aggregate billable volumes, not measured users/runs or forecasts. Convert observed samples using `runs/day × mean billable bytes/run × days / 10^9`; include retries, native telemetry, health/audit data, and duplicate ingestion. Test a retained sample before sizing. A 90-day custom-table Analytics policy with uniform 1 GB/day ingestion would add roughly 59 GB of paid retained steady-state data beyond the included 31 days, approximately USD 7.08/month under this model. Application Insights tables can have different included retention; do not apply the same calculation indiscriminately.

Proposed low-volume qualification budget is 10 billing-currency units/month with 50/80/100% actual and 80% forecast notifications. This amount is a proposal, not authority to consume. If the actual target is EUR, use EUR 10 only after confirming currency/offer; USD estimates above remain USD. Medium/high volume needs an approved larger envelope. Keep the existing 1 GB/day workspace cap as a last-resort brake, not a USD/EUR 10 guarantee. Add a fleet aggregate publishing ceiling before unattended ingress; per-device ceilings multiply with fleet size.

**Control limitations:** budgets notify and do not stop consumption; costs can lag 8–24 hours and budget evaluation is daily. Workspace daily caps can overshoot, blind monitoring when hit, and only cover that workspace/eligible table plans. Azure spending limit On protects eligible subscription credit consumption but does not enforce a custom cap or prevent all separate Marketplace/license/support charges. It does not control GitHub Copilot overage. Remaining Azure credit and Copilot entitlement/overage must be verified independently before any paid model trial or cloud write. Never remove a spending limit as an error-recovery step. [Budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets), [Daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap), [Spending-limit exceptions](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit)

## 6. Services deliberately omitted

| Alternative | Reason omitted / trigger to add |
| --- | --- |
| Managed Grafana / Azure Monitor Workspace / Prometheus | Workbook and Analytics satisfy this diagnostic view. Add only for a proved Grafana/metrics requirement and separately priced identity/network configuration |
| Hosted frontend / Functions / Container Apps / AKS / ACR | Existing local CLI and Azure portal supply capture and team viewing. A central ingestion relay or standalone authenticated UX is separate product scope with security, hosting and operating costs |
| Key Vault / CMK / dedicated LAW cluster | No new secret to store; use service encryption and TLS. Add for an actual credential or mandated key-control policy, not because the word enterprise appears |
| VNet / AMPLS / private endpoints / VPN gateway / Firewall | Public authenticated metadata ingress is the stated pilot tradeoff. Add the connected private network only when policy requires it, with hourly endpoint/gateway/DNS costs and operator access design |
| Shared blob exports / Event Hub / database / archive | LAW is the shared metadata store, local sanitized ledger is replay evidence. Add archive/export only for a retention/recovery requirement and price its operations, storage, transfer and deletion lifecycle |
| Multi-region replicas / enterprise 90-day default / premium identity purchases | Internal diagnostics can pause while local evidence persists. Add only against approved RTO/RPO, retention and access policy; existing corporate licenses may already cover identity controls |
| Hosted model judge / automatic remediation | Deterministic evidence and human-reviewed proposals remain the contract. Paid judging and changes to agents are separate authorization and acceptance lanes |

This is WAF-aligned planning with explicit reliability/security/cost tradeoffs, not a claim of compliance certification. Single-region cloud-query outage is accepted for this diagnostic pilot; no cross-region failover is promised. Proposed local outage buffer is 48 hours with explicit loss at expiry, and cloud-query recovery follows Azure service restoration. The queue is not proof of lossless durability. Qualify crash/retry/idempotency/duplicate behavior before setting a business RPO/SLO. [Log Analytics WAF guide](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-log-analytics)

## 7. Implementation status and remaining gaps

1. The additive existing-workspace entrypoint is implemented, compiled, validated with what-if, and deployed. It references the exact LAW/DCR/DCE/App Insights resources, deploys the Workbook and budget independently, and never upgrades the original `main.bicep`. The deployment created only the new Workbook and budget; no existing service was modified or deleted.
2. Workbook query contracts are implemented and 23 bounded Azure queries passed actual qualification, including all panels and single-run checks. The final deployment injects the selected workspace and repairs the run selector's safe single-parameter interpolation. Native portal proof passed default/all-runs and Last Hour single-run paths, named AgentOps tables, linked panels, workspace-wide health, and five honest empty/unknown panels across the available time choices. Local dashboard packaging alone remains insufficient evidence.
3. Aggregate publishing and queue limits are implemented and independently reviewed: publishing defaults to zero unless an explicit allowance is supplied; each queue is capped at 128 MiB, combined eligible queue capacity is 256 MiB, retries expire after 48 hours, and the daily budget is bound to target and policy. The accepted pilot request was bounded by the explicit 1 MiB allowance.
4. The qualification tool produced 97 synthetic rows across eleven metadata streams. Exact typed REST readback matched every maintained field, and the privacy canary was absent; the initial readback failure remains retained as evidence and was not followed by a re-upload. Native Workbook rendering and filter behavior are now verified. Do not promote schema-only tables into delivered features.
5. Entra-only ingestion/local-auth hardening remains unperformed. The LAW API supports `features.disableLocalAuth`; App Insights supports `DisableLocalAuth`, but current templates do not set them. Do not flip them until each active producer is shown to use Entra, and preserve component workspace binding. [LAW schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.operationalinsights/2023-09-01/workspaces)
6. No team principals, notification contacts, or production grants were supplied. Effective team access, approved owner/on-call identity, and any alert notification test remain production gates. The deployed budget has no contacts and no enabled action group or health rule.
7. The current candidate passes 1,027 of 1,028 CLI checks, with one Windows-only skip and zero failures; line coverage is 90.51%. Static checks cover 1,027 files, full enterprise scripts pass 12 tests, and package installation plus enterprise IaC/workbook/qualification checks pass. Linux/Windows exact-candidate CI, live model spend, and measured human diagnostic usefulness remain unproved.

## 8. Rollout, acceptance, and recovery

The synthetic pilot has completed the additive IaC compile, target preflight, ARM validation, what-if, deployment, exact typed REST readback, resource readback, and native Workbook browser proof. Production rollout still requires a separate target subscription/tenant, approved principals and classification, and a new reviewed what-if.

| Step | Work after explicit rollout authorization | Acceptance evidence |
| --- | --- | --- |
| 1 | Confirm exact tenant/subscription/classification/currency/credit; inventory policies, inherited access, providers, quotas and selected resource IDs | Bounded read-only snapshot; accepted effective principals; unchanged App Insights binding |
| 2 | Generate additive IaC/parameters and compile locally; review diff; freeze selected schema/query/producer versions | Clean Bicep build, only owned task hunks, no embedded credential, local producer/privacy/query contract tests |
| 3 | ARM validate and what-if against explicit synthetic target | Exact reviewed Create/Modify list; no Delete, replacement, original-dev rebind, unexpected content grant or premium service |
| 4 | Deploy budget, least-privilege assignments and Workbook; leave health rule disabled initially | Resource/role/budget/query-target readback; budget actually present with accepted currency/contacts |
| 5 | Send one approved bounded synthetic canary batch, at most 1 MiB total, through each intended route | Exact run IDs/full typed field comparison, no secret/privacy canary, no repeated upload after ambiguous acknowledgment without recovery policy |
| 6 | Sign in as observer, editor, publisher and unauthorized identity; open Workbook and exercise run/time/failure/coverage filters | Browser-rendered proof and failed forbidden read/write/content tests; missing data stays explicitly unknown |
| 7 | Induce local outage/retry/crash and synthetic stale health; test accepted action-group notification | Recoverable queue receipts, bounded duplicates/loss, visible health gap, one delivered notification, documented alert meter/frequency |
| 8 | Run a small measured diagnostic pilot; review actual `_BilledSize` and invoice meter usage weekly | Captured benefit/false positives/setup effort/volume; acceptable cost and support ownership; no inferred ROI |
| 9 | Only if production scope is approved: reproduce in chosen regular organization subscription/tenant, using approved classification/network/retention controls | New target validation and readback; separate data boundary; no migration/rebind of synthetic resources |

Rollback starts by stopping the local publisher, revoking only the new metadata publisher grant if needed, and disabling newly enabled rules. Preserve sanitized receipts and source fixtures so pending/lost/readback states remain explainable. Restore reviewed prior Workbook JSON/DCR projection/access settings where changed; export the exact prior nonsecret resource configurations before any mutation. Keep the LAW and existing tables in place. Do not delete cloud evidence, resource groups, inherited role assignments, or original dev resources as routine rollback. Deletion/purge requires explicit target authorization and an accepted evidence/recovery path. For privacy incidents, stop ingestion and use the organization's incident process and separately authorized purge; short retention alone is inadequate containment.

## 9. Production approval items

The synthetic pilot implementation is approved and deployed. A later production rollout approval must identify: regular organization-owned subscription/tenant; accepted inherited principals; approved uploader/observer/editor IDs and owner/contact; permitted data classification and public-endpoint tradeoff; seven/30-day table retention and local queue expiry; budget currency/amount and publishing volume; any alert notification and model spend; exact additive what-if and rollback. Required organization policy or a private-only requirement changes the network/resource plan and cost before deployment.

The plan remains a design ledger and does not authorize production. `.azure/enterprise-plan/plan.json` remains a historical draft artifact; the reviewed enterprise template and pilot deployment evidence are recorded separately. Azure WAF/insights MCP tools were unavailable; official Learn search/fetch plus fresh target preflight and deployment readback supplied the current planning facts. Graphify was refreshed after the enterprise source changes; its counts are navigation evidence, not deployment proof.
