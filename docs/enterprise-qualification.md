# Controlled enterprise evidence qualification

This tool prepares an isolated synthetic producer batch. It makes no model calls and performs no Azure writes. The explicit `verify` command makes read-only Azure identity, DCR, workspace and bounded Log Analytics queries. Existing upload tooling remains the separate write authority boundary.

```text
existing demo/native/product producers -> typed DCR projection -> local JSONL
                   authorized uploader -> API acceptance receipt
                       bounded queries -> all-field observation receipt
```

## Local preparation

Create a private target JSON with exactly these identifiers from the intended existing deployment:

```json
{
  "subscriptionId": "<subscription UUID>",
  "resourceGroup": "<resource group>",
  "workspaceName": "<workspace resource name>",
  "workspaceId": "<workspace customer UUID>",
  "dcrName": "<metadata DCR name>",
  "dcrImmutableId": "<metadata DCR immutable ID>",
  "endpoint": "https://<DCE host>.ingest.monitor.azure.com"
}
```

Pass the actual JSON response from the existing metadata DCR `show` command as `--dcr-file`. Local preparation checks its subscription, resource identity, destination workspace, each maintained noncontent stream's exact columns and transform before writing. It fails closed on incompatible schemas. The snapshot remains an assertion about current state until `verify` reads the live DCR again.

```sh
node scripts/qualify-enterprise-evidence.js prepare --target=/private/target.json --dcr-file=/private/metadata-dcr.json --out=/private/new-qualification
node --test scripts/test/qualify-enterprise-evidence.test.js
```

Output includes `qualification-batch.json`, `manifest.json`, and per-table JSONL. The complete artifact set is bounded to 1 MiB. Permissions are private. Each invocation uses a fresh UUID namespace for run, event, span and finding identities. Do not upload the same prepared directory twice; retry decisions need the uploader's duplicate-delivery handling. The payload excludes the content stream and endpoint fields. No credential, ingestion token or endpoint grant is requested or stored.

## Producer coverage and limits

The batch uses the existing demo producer for synthetic run, event, tool, MCP, privacy, evaluation, GitHub and health rows. It calls the actual native event projector with synthetic native records and the actual span projector with a synthetic OTel span. It calls `buildProductEvidenceBundle` with those projected events and a joined synthetic architecture finding to produce run summaries, events, insights and recommendations. These qualify data contracts; they do not qualify live model execution, real GitHub outcomes, task success, feature adoption or capture completeness. The product run's ungraded outcome remains unknown. Demo evaluation values are synthetic assertions; they are not independently graded quality.

Zero-row streams are explicitly `schema-only-no-produced-rows` and are never reported as a qualified feature. Saved views have no maintained metadata DCR contract and are excluded. Fractional demo costs use the maintained real cost field where available; incompatible legacy long cost fields become null. Empty demo datetime strings become null. Health endpoint fields are dropped. These adaptations happen before typed projection and are included in the resulting payload hash.

A secret-like synthetic canary is placed in the native fixture prompt. The actual event projector excludes it. Readback checks its absence in every returned projected row. This is bounded qualification-row absence; it does not prove absence in all tables or the entire workspace.

## Separate upload and readback

The parent/operator must independently verify the intended subscription and billing protection before authorizing ingestion. This script has no upload mode. Use the existing reviewed uploader only after its approved-target guard, spending protection and authority requirements have passed. Retain the uploader's exact per-stream API acceptance receipts separately. API acceptance alone does not prove ingestion.

```sh
node scripts/qualify-enterprise-evidence.js verify --target=/private/target.json --bundle=/private/new-qualification --out=/private/new-readback
```

`verify` checks the active subscription against the target, reads the live metadata DCR, and confirms the workspace customer UUID. It requires the complete unique set of 11 maintained noncontent streams, checks the original prepared manifest's stream hashes and counts, rejects rows outside the prepared UUID namespace, and requires at least one produced row. Explicit zero-row schema-only entries remain valid. It checks the maintained schema hash and replays its expected projections again before any cloud command. Queries are restricted by time and exact RunId lists, or exact unique Component lists for health rows, with an expected-count-plus-one row cap. Every schema column is projected. Comparison preserves types and nulls, normalizes equivalent UTC datetime representations, sorts dynamic-object keys, checks exact row multiplicity and rejects missing projected columns. Live verification uses `az rest` against the read-only Logs query API and checks its table/column type descriptors. Azure CLI `monitor log-analytics query` flattens numbers, booleans and nulls into strings, so its output is unsuitable for exact typed proof and is not used for live verification. Partial/error responses fail closed. The POST requests execute bounded queries; they do not mutate cloud resources.

The private readback receipt retains the original prepared batch/manifest hashes and every prepared stream hash, query text and hash, response hash, exact expected/observed count and typed-row hashes, query latency, canary result and observation status. `accepted` remains null because only the uploader can supply that evidence. An absent or mismatched row makes `observed` false and the command exit nonzero. No synthetic query response is used as cloud proof. No polling loop is built in; retain the first receipt and, after ingestion latency, run a new bounded readback into a new directory if needed.

The Azure Logs query API response shape and error semantics are documented in [Azure Monitor Logs query API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format). The ingestion source columns and transform contracts come from this repository's maintained `infra/bicep/v2-ingestion.bicep` and product evidence projection helper.
