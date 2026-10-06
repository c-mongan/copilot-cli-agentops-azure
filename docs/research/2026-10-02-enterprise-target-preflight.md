# Enterprise target preflight — 2 October 2026

Fresh read-only checks at approximately 14:44–14:50 UTC confirm the existing Visual Studio synthetic pilot, its schemas, subscription spending limit, and deployer control-plane authority. **The parent verified a positive current-period Visual Studio benefit credit balance in the authenticated Azure portal at approximately 14:51 UTC.** The API checks below did not establish that balance. The Pay-As-You-Go subscription has spending protection Off and no existing AgentOps-named resource group. This report selects neither subscription and authorizes no deployment.

No Azure writes, model calls, telemetry uploads, provider registrations, notifications, default-subscription changes, commits, or pushes were performed. Existing dirty work was preserved. The only repository file owned by this task is this report. Small sanitized command receipts are owner-only under `<agent-workspace>/scratch/agentops-enterprise-target-preflight-20261002/`; the external volume UUID was verified before writing them. Receipts contain IDs and resource configuration but no tokens, email addresses, prompts, or private project inventory.

## Target and protection comparison

| Property | Existing synthetic pilot | Pay-As-You-Go candidate |
| --- | --- | --- |
| Subscription | `<subscription-id>` | `<other-subscription-id>` |
| Tenant | `<tenant-id>` | Same tenant |
| State | Enabled | Enabled |
| Default Azure CLI account | Yes; unchanged | No |
| ARM quota/offer family | `MSDN_2014-09-01` | `PayAsYouGo_2014-09-01` |
| ARM `spendingLimit` | **On** | **Off** |
| Billing agreement | Microsoft Online Services Program | Microsoft Customer Agreement |
| Existing AgentOps group | `rg-copilot-agentops-synthetic-pilot-20260930` | None matching `agentops` among one total RG; unrelated name omitted |
| Fresh Visual Studio benefit credit | Positive current-period balance verified by parent portal readback; private amount omitted | Not applicable to this offer |
| Payment-on-account balance | EUR 0; not benefit credit | EUR 0; not benefit credit |
| Pilot RG budget | GET succeeds; zero budgets | No AgentOps RG to query |

The Visual Studio benefit is development/test only and has no financially backed SLA. A regular subscription and an accepted organizational access boundary are needed for production. [Visual Studio Azure FAQ](https://learn.microsoft.com/en-us/visualstudio/subscriptions/faq/subscriber/azure/)

A budget is an alert threshold, not a hard spending cap; it does not stop consumption. Pay-As-You-Go has no supported credit spending-limit switch. Neither a 10-unit budget nor a LAW daily cap proves the standing no-paid-overage requirement. [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets), [Spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit)

## Existing pilot resources and schemas

All six selected RG resources are in North Europe: LAW `law-copilot-agentops-eval-eval930`, Application Insights `appi-copilot-agentops-eval-eval930`, DCEs `dce-copilot-agentops-eval-eval930` and `dce-copilot-agentops-eval930`, and DCRs `dcr-copilot-agentops-eval-eval930` and `dcr-copilot-agentops-eval930-v2`. Exact resource IDs are in `pilot-resources.json`.

The LAW is `PerGB2018`, default retention 30 days, daily quota 1 GB, public ingestion/query Enabled, and `enableLogAccessUsingOnlyResourcePermissions=true`. These are configuration readbacks, not proof of anonymous access, network isolation, current usage, or a precise billing cap.

Metadata DCR `dcr-copilot-agentops-eval930-v2` has immutable ID `dcr-1b45ce3240c3473893972da44a2c2383`, references the `dce-copilot-agentops-eval930` endpoint and exactly the selected LAW, and declares eleven metadata streams. It excludes the content stream. The LAW also has a separate content table; narrow new read grants cannot remove inherited broad access to it.

| Custom table | Columns | Interactive/total retention |
| --- | ---: | --- |
| AgentOpsEvents_CL | 63 | 7 / 7 days |
| AgentOpsSpans_CL | 37 | 7 / 7 days |
| AgentOpsRunSummary_CL | 37 | 7 / 7 days |
| AgentOpsToolCalls_CL | 16 | 7 / 7 days |
| AgentOpsMcpCalls_CL | 20 | 7 / 7 days |
| AgentOpsPrivacy_CL | 11 | 7 / 7 days |
| AgentOpsEval_CL | 15 | 7 / 7 days |
| AgentOpsGithubOutcomes_CL | 19 | 7 / 7 days |
| AgentOpsInsights_CL | 18 | 7 / 7 days |
| AgentOpsRecommendations_CL | 25 | 7 / 7 days |
| AgentOpsCollectorHealth_CL | 19 | 7 / 7 days |
| AgentOpsContent_CL | 18 | 7 / 7 days |

Full typed columns, stream declarations, and transforms are retained in `tables.json` and `metadata-dcr.json`. Schema existence does not qualify producer delivery or Workbook queries. This preflight did not repeat data queries.

## Identity, inherited access, and deployment constraints

The signed-in user object ID is `1e822670-52ce-41e9-923c-607a4f2fa556`. Its effective group-aware pilot-scope role query returned inherited subscription Owner, unconditional. An independent inherited role query returned one subscription User Owner and one User Contributor. Names and email addresses were excluded. The pilot-scope permissions API reports `actions=["*"]`, no `notActions`, and no `dataActions` for the broad control-plane entry. This supports RBAC/workbook/budget control-plane authority; it does not prove delegated data-plane access or justify exercising it.

The pilot deny-assignment query returned zero. Subscription listing found one deny assignment scoped to the original managed dev telemetry RG, with protected write/delete operations. This is another reason to leave that RG untouched.

Inherited management-group policies include `sys.mfa-write` with effect **Deny**, `sys.mfa-delete` with **DenyAction**, and `sys.blockwesteurope` with a deny rule for West Europe. The MFA write policy checks user authentication claims. Successful read-only requests do not prove the current cached token satisfies write MFA. Do not expose tokens to check it; use the normal approved interactive MFA flow if selected-target ARM validation returns the relevant policy/auth error. North Europe avoids the regional deny. `SecurityCenterBuiltIn` also applies; its full initiative was not evaluated. ARM validation/what-if remains necessary before cloud mutation.

The exact built-in role definitions and permissions were read from this subscription:

| Role | Built-in role definition GUID |
| --- | --- |
| Contributor | `b24988ac-6180-42a0-ab88-20f7382dd24c` |
| Cost Management Reader | `72fafb9e-0641-4937-9268-a91bfd8191a3` |
| Monitoring Reader | `43d0d8ad-25c7-4714-9337-8ba259a9fe05` |
| Owner | `8e3af657-a8ff-443c-a75c-2fe8c4bcb635` |
| Workbook Contributor | `e8ddcd69-c73f-4f9f-9844-4100522f16ad` |
| Workbook Reader | `b279062a-9be3-42a0-92ae-8b3cf002ec4d` |
| Monitoring Metrics Publisher | `3913510d-42f4-4e42-8a64-420c390055eb` |
| Role Based Access Control Administrator | `f58310d9-a9f6-439a-9e8d-f62e7b41a168` |
| Log Analytics Data Reader | `3b03c2da-16b3-4a49-8834-0f8130efdd3b` |

Workbook Reader/Contributor and Log Analytics Data Reader are separate permissions. The current user's Owner session cannot prove observer/editor/publisher negative tests. The fresh Log Analytics Data Reader definition allows workspace `read` and `query/read` control-plane actions plus `tables/data/read`; assignable scopes are `/` and exclusions are empty. A role scoped only to a nested table does not grant upward workspace permissions. Microsoft recommends workspace-scoped granular RBAC with conditions, or a dual-role method supplying workspace query/read and table Reader permissions. A current Owner query hides this limitation. [Table-level access](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-table-access)

No group IDs, membership, approved notification recipient, or independent test identities were supplied to this task. Do not invent them or create identities as part of preflight.

## Providers and budget API

Both candidates have Insights, OperationalInsights, Authorization, and Consumption registered. In returned metadata, the Insights namespace is lower-case `microsoft.insights`; filtering it case-sensitively as `Microsoft.Insights` incorrectly hides it. Planned Workbook `2022-04-01`, scheduled-query rule `2023-12-01`, and action-group `2023-01-01` API versions are advertised. Workbook and scheduled-query rules advertise North Europe. Action groups advertise their own locations, not North Europe; use a supported action-group location such as global after inspecting the exact provider receipt and template. The provider metadata is not an ARM validation result.

Consumption's provider metadata did not enumerate budgets. However, the exact pilot resource-group GET `Microsoft.Consumption/budgets?api-version=2024-08-01` returned HTTP success and `value=[]`. This proves read API acceptance on this offer/scope; it does not prove a new budget PUT with its proposed contact/currency/settings will pass. Both offer support and reviewed ARM validation remain relevant. No unsupported generic Consumption credit URL was guessed.

## Credit API result and exact remaining gate

Billing property reads bind the Visual Studio subscription to MOSP with no billing profile; PAYG binds to an MCA profile. The supported Billing `availableBalance/default?api-version=2024-04-01` endpoint succeeds on the VS billing account and the PAYG billing profile, but both return **only** `paymentsOnAccount=[]` and `totalPaymentsOnAccount={currency:EUR,value:0}`. They return no Visual Studio monthly benefit balance. The API documents MOSP support for payment-on-account balance; credit balance support is for MCA. Therefore EUR 0 is **not** a fresh VS credit result. [Billing available balance API](https://learn.microsoft.com/en-us/rest/api/billing/available-balances/get-by-billing-account?view=rest-billing-2024-04-01)

The MCA credit-lots/credit-balance API is a different billing agreement path; a PAYG profile response cannot establish VS credit remaining. [MCA credit balance](https://learn.microsoft.com/en-us/azure/cost-management-billing/benefits/credits/mca-check-azure-credits-balance)

The parent subsequently refreshed the exact VS subscription overview in the authenticated native Chrome portal and verified a positive balance for the current benefit period, 8 September–7 October 2026, with a seconds-old refresh notification. This is parent UI evidence, separately from this task’s API receipts. The private amount is deliberately omitted from maintained documentation. Together with the independent ARM `spendingLimit=On` readback, it resolves the fresh Azure included-credit/protection check for the bounded synthetic qualification batch. It does not establish GitHub/Copilot model billing or unrestricted future spend. PAYG deployment would materially change the spending boundary and requires the parent to resolve target authorization and acceptable charges. No budget can replace that decision.

## Validated read commands and remaining acceptance

These command shapes ran successfully; each retained receipt includes the exact command, UTC time, exit code, and projected output:

```sh
az ad signed-in-user show --query '{id:id,userType:userType}' -o json
az rest --method get --url 'https://management.azure.com/subscriptions/<subscription-id>?api-version=2022-12-01' --query '{id:id,state:state,subscriptionPolicies:subscriptionPolicies}' -o json
az role assignment list --subscription <subscription-id> --scope /subscriptions/<subscription-id>/resourceGroups/rg-copilot-agentops-synthetic-pilot-20260930 --include-inherited --query '[].{scope:scope,roleDefinitionId:roleDefinitionId,principalId:principalId,principalType:principalType,condition:condition}' -o json
az rest --method get --url 'https://management.azure.com/subscriptions/<subscription-id>/resourceGroups/rg-copilot-agentops-synthetic-pilot-20260930/providers/Microsoft.Consumption/budgets?api-version=2024-08-01' --query '{count:length(value)}' -o json
az billing property show --subscription <subscription-id> --query '{billingAccountId:billingAccountId,billingProfileId:billingProfileId}' -o json
```

One corrected local CLI attempt combined `--all` with `--scope`, which Azure CLI rejects. Removing `--all` produced the scoped inherited-role result above; no service write occurred.

Remaining: parent-owned target choice; accepted effective inherited access boundary; immutable authorized group/test-identity IDs and notification recipient; selected-target policy/MFA-aware ARM validation and what-if; independent permission tests; budget currency/settings readback after any authorized write; rendered Workbook and exact typed synthetic readback. None is inferred from this preflight.
