# Native Azure proof preflight — 3 October 2026

TL;DR — The initial read-only preflight confirmed the existing synthetic pilot and prepared a 473-byte request. The subsequent authorized proof accepted that one request and returned an exact typed row match across all 63 maintained fields. No resource change or Microsoft sign-in prompt occurred. See the executed proof below.

```text
Synthetic native-shaped receipt -> new event projection -> bounded embedded uploader
                                                      -> existing metadata DCR
                                                      -> AgentOpsEvents_CL
                                                      -> exact-ID typed readback
```

## Exact target and fresh reads

ARM reads completed at approximately 18:29 UTC on 3 October 2026. The active CLI subscription matches the intended target. No default subscription was changed.

| Item | Verified value |
| --- | --- |
| Subscription | `<subscription-id>` |
| Tenant | `cf17fc39-219d-4d2b-9cd5-a49dc7ad0898` |
| Subscription state / spending limit | Enabled / On |
| Resource group | `rg-copilot-agentops-synthetic-pilot-20260930` |
| Region | `northeurope` |
| Metadata DCR | `dcr-copilot-agentops-eval930-v2` |
| Immutable DCR ID | `dcr-1b45ce3240c3473893972da44a2c2383` |
| DCE | `dce-copilot-agentops-eval930` |
| Ingestion endpoint | `https://dce-copilot-agentops-eval930-28nj.northeurope-1.ingest.monitor.azure.com` |
| Workspace | `law-copilot-agentops-eval-eval930` |
| Workspace ID | `<workspace-customer-id>` |
| Table / stream | `AgentOpsEvents_CL` / `Custom-AgentOpsEvents_CL` |
| Table plan / retention | Analytics / seven days |

The metadata DCR accepts eleven metadata streams and routes them to this workspace. It has no `Custom-AgentOpsContent_CL` declaration or data flow. The separate content DCR is outside this proof. Public ingestion and public query access are enabled. Workspace resource-context access is also enabled; this owner-based preflight does not qualify restricted team access.

The current CLI identity obtained an Azure Monitor token without a sign-in prompt. Only expiry, subscription and tenant were displayed. No token was displayed or saved. The DCR effective-permissions API returned `Microsoft.Insights/Telemetry/Write` and `Microsoft.Insights/Metrics/Write`, plus broader control-plane permissions. The live built-in **Monitoring Metrics Publisher** definition contains those same two data actions. This supports a publisher preflight; it does not prove least privilege or successful ingestion by the VS Code identity. Microsoft requires that role on the DCR for an authorized ingestion identity. [Logs Ingestion API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview)

## Prepared minimum proof

Owner-only disposable artifacts are in `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/native-build-20261003/azure-proof-preflight/`. The external storage helper verified the expected SanDisk UUID before artifact preparation. These files contain resource IDs and synthetic data only.

`synthetic-receipt.jsonl` contains one native-shaped OTLP chat span. It is a synthetic fixture, not a Copilot-generated span. `synthetic-upload-plan.json` contains its exact projected row, target and 16,384-byte daily allowance. The JSON request body is **473 bytes**. Every projected field exists in the deployed event stream. `OutputTokens` is absent because it was not measured. The synthetic label canary is absent from the projection. Session identity is hashed; no arbitrary tool, model or span label is forwarded.

The local delivery module was exercised with a mock token and a mock HTTP sender. The first mock comparison used JSON text equality, which incorrectly treated different object-key order as a field mismatch. It was corrected to deep typed equality. The retained queue was then drained successfully: one row acknowledged, no pending rows, one admission marker retained. Neither attempt contacted Azure. `local-preflight-proof.json` records this distinction.

An authenticated typed Logs query returned a `long` count of **zero** for the exact prepared RunId. That query was read-only. This establishes an empty baseline and valid query access; it is not upload proof. The full typed response is retained in `typed-baseline-query.json`.

Parent execution should use a new disposable synthetic-proof storage directory. It must not reuse the mock storage directory, which already contains an admission marker for this row. Call `createNativeAzureDelivery` with the exact target above, `publishingApproved: true`, the explicit one-item subscription allowlist, an approved token provider, and `maxPublishBytesPerDay: 16384`. The module selects `authenticationMode: 'embedded'` internally. No `az account show` occurs in that uploader path. An injected CLI token provider is still a legacy authentication substitute; it does not prove the supported VS Code sign-in path.

## Acceptance and recovery

1. Reconfirm the carried-forward synthetic-pilot authorization and current benefit credit before the write. Preserve this exact fixture, row and target.
2. Publish the single prepared receipt through the latest delivery module. Record the HTTP result, admission, acknowledgement and remaining queue separately. Do not change resources or grant roles.
3. Query `AgentOpsEvents_CL` through the typed Logs API by the exact prepared RunId and EventId. Compare every projected field and row multiplicity. Normalize only the documented datetime representation. Verify that the omitted `OutputTokens` field remains null in the table.
4. Check `_BilledSize` and `_IsBillable` for the exact row. Retain the response. The wire-byte count is not the billable-byte count.
5. Poll query visibility within a bounded window. Do not re-upload an acknowledged row to address query latency. A pending transport row may be retried through the original queue and its admission markers. Delivery remains at least once: an ambiguous network result can still cause a duplicate, so verify multiplicity and use the deterministic EventId for analysis.

Stop publishing for recovery. Keep the queue, synthetic fixture, acknowledgement receipt and query response. No DCR, DCE, workspace, table, budget or grant changes are required, so there is no infrastructure rollback. Do not delete or purge cloud evidence as routine cleanup. The seven-day table retention is not an immediate erasure guarantee.

## Cost and authorization boundary

Fresh budget readback shows `budget-agentops-diagnostic-pilot`, monthly amount 10, and no notification recipients. The prior deployment report identifies the billing currency as EUR. This budget is not a hard cap. Spending limit On does not establish the current remaining benefit credit or cover every possible charge.

The maintained [cost plan](../plans/2026-10-02-lean-enterprise-deployment.md) records a 2 October North Europe retail ingestion estimate of USD 2.76 per billable GB. That rate was not refreshed in this preflight. For scale only, 16,384 billable bytes at that prior rate would be approximately USD 0.000045. This is not a quote or an invoice ceiling: actual `_BilledSize`, allowances, currency and billing rules govern the charge. No compute, model call, alert, dashboard deployment or new paid service is proposed.

The [previous deployment verification](2026-10-02-enterprise-deployment-verification.md) records an approved bounded synthetic batch on this exact pilot and successful typed readback. The current user instructed the parent to continue the build. Those records establish the prior target and scope; a document does not create new authority. The parent owns the decision that carried-forward session approval covers this new single-row proof. This subtask prepared the result and made no external write.

## Remaining Microsoft-provider proof

The VS Code Microsoft adapter was checked against the official API and provider source and has mock tests. Its fixed scope is `https://monitor.azure.com//.default`, with `VSCODE_TENANT:<tenant-guid>`. Actual account selection, extension permission consent, tenant policy, token renewal and accepted ingestion have not been exercised through that provider. [VS Code authentication API](https://code.visualstudio.com/api/references/vscode-api#authentication.getSession), [Microsoft provider scope handling](https://github.com/microsoft/vscode/blob/45373f06ff77cc97a7754a376548d8937fb3af54/extensions/microsoft-authentication/src/common/scopeData.ts)

An existing CLI token can qualify the embedded uploader and Azure row contract. It cannot close the **user needs no Azure CLI** authentication acceptance gate. A separate approved GUI sign-in and exact typed readback with the Microsoft provider are still required. The initial preflight did not open that prompt, modify a normal VS Code profile, assign roles, or upload a row.

## Executed proof — 18:37–18:38 UTC

The parent authorized one exact prepared synthetic row on the existing pilot, with a 16,384-byte attempted-publishing ceiling. Execution used the unchanged plan and receipt hashes, a fresh private `synthetic-cloud-proof-storage` directory, and the latest embedded delivery module. The active subscription and spending limit On were read again immediately before execution. A cached Azure CLI token was injected as the test credential provider; it was never printed or saved. No resource, role, default-account, policy or normal-profile change occurred.

| Evidence stage | Actual result |
| --- | --- |
| Empty baseline | Typed exact-RunId query returned zero rows |
| Admission | One row admitted, zero duplicates or refusals |
| HTTP acceptance | One request, HTTP 204 at `2026-10-03T18:37:07.272Z` |
| Attempted request bytes | 473, within the explicit 16,384-byte ceiling |
| Durable result | One acknowledged row, zero pending or quarantined rows |
| Typed observation | First query at `2026-10-03T18:38:16.105112+00:00` returned exactly one row |
| Schema comparison | All 63 maintained fields matched, with no type or multiplicity differences |
| Unknown preservation | Unmeasured `OutputTokens` remained null; it was not changed to zero |
| Privacy canary | Absent from every projected field |
| Billable size | `_BilledSize = 237`; `_IsBillable = "True"` |

No second upload was used to address readback latency. The prepared RunId is `native_e07d7bd1fa778cc3562104ab135a88a8`; EventId is `native_7d9c131c2d46fb1e3d1fb2112b7176dd`. The comparison used every deployed stream field, including empty string/null values for omitted fields, and normalized only the datetime representation. `_BilledSize` is distinct from the 473-byte wire body. At the prior plan's retail rate, 237 billable bytes correspond to approximately USD 0.00000065 before allowances and billing adjustments; this is an estimate, not an observed invoice amount.

The execution helper is `upload-exact-proof.cjs`; it requires an explicit approved-execution flag, validates both prepared hashes and the exact destination, and refuses a pre-existing proof storage directory. `actual-upload-receipt.json` records acceptance. `typed-readback-poll-1.json` records the separate typed observation. `readback-exact-proof.py` permits at most six numbered polls and does not upload data. Only the first poll was needed. All artifacts remain in the private proof directory identified above.

This closes the **embedded core transport and synthetic event-schema** proof. It does not prove actual VS Code Microsoft authentication, least-privilege isolation, live Copilot capture, Python/JS auto-instrumentation, full cloud waterfalls, held-out model quality, or human diagnostic benefit. No Microsoft-provider GUI sign-in was attempted.
