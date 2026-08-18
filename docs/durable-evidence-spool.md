# Durable Evidence Spool

Status: durable wrapper-lifecycle receipts are wired into normal `agentops copilot` runs and the existing dev DCE/DCR destination is configured locally. Four strict/off receipts were accepted and became query-visible on 2026-08-03. The live V2 table currently drops `EventId`, `Sequence`, and other newer receipt columns, so exact ordered Azure correlation remains blocked on an additive schema update. Detailed native Copilot telemetry remains on the best-effort Collector path.

`agentops-cli/src/lib/azure/durable-evidence-spool.js` is the first production-oriented delivery boundary for critical AgentOps evidence. It is deliberately separate from the OpenTelemetry Collector's Azure Monitor exporter because that exporter acknowledges its persistent queue before the inner Application Insights sender receives an Azure response.

The spool accepts only allowlisted scalar metadata. It rejects unknown fields and nested values, forces strict privacy/content-off markers, and requires a run ID and positive sequence. Every segment carries an event ID and SHA-256 hash of the canonical row.

Local guarantees:

- spool directories are mode `0700` and files are `0600` on POSIX;
- each pending segment is written through an exclusive temporary file, flushed, and atomically renamed;
- enqueue capacity checks, overflow counters, and pending-event deduplication use a short cross-process admission lock that is never held during upload work;
- drainers atomically rename `pending` segments to `uploading`, so concurrent processes cannot normally send the same claimed segment;
- active upload claims refresh a bounded lease; a later drainer recovers a stale claim after process failure;
- pending storage has a byte limit and TTL;
- network errors and HTTP `408`, `429`, and `5xx` responses retry, including `Retry-After`;
- a segment is acknowledged and removed only after an injected uploader returns `2xx`;
- permanent `4xx`, malformed, and hash-mismatched segments are quarantined;
- only the DCR-compatible `AgentOpsEvents_CL` lifecycle schema is accepted, including after restart;
- the uploader fails closed unless the exact approved subscription is active, uses HTTPS and canonical DCR stream names, and refreshes its Entra token once after `401` or `403`;
- process restart preserves pending work;
- status reports pending, acknowledged, overflow, expired, and quarantined counts.
- concurrent writers use a short atomic admission lock; concurrent drainers atomically claim segments with a heartbeat and bounded stale-claim recovery;
- identical pending lifecycle evidence deduplicates by table, event ID, and canonical row hash.

The interactive receipt deliberately separates the two scopes:

- `Delivery` describes only the durable wrapper lifecycle receipt;
- `Coverage` says native Copilot detail still uses best-effort Collector delivery.

A local receipt may therefore say `Run receipt saved locally · waiting for Azure`
while the detailed native session is already visible through Application Insights.
Neither state is promoted to `Visible in Azure` without a query-back proof.

Delivery is **at least once**. If Azure accepts a request and the process stops before the local atomic acknowledgement, the same event ID and hash are sent again. Consumers must deduplicate by `EventId` (and may verify `RunId`, `Sequence`, and the row hash). Exactly-once delivery is not claimed.

Enqueue deduplicates an already pending or uploading segment only when table, event ID, and canonical row hash all match. This prevents repeated local admission from multiplying identical work, including after a process restart. It does not change the at-least-once crash window after remote acceptance.

The spool is bounded, so it cannot promise recovery from an unlimited outage. Queue capacity and TTL must be sized from measured event volume. Overflow, expiry, and quarantine are explicit failure states, not successful observation.

Before treating this as full durable delivery:

1. expose explicit operator drain/review/requeue lifecycle commands for pending and held records;
2. apply a reviewed additive table/DCR schema update that preserves the legacy `EstimatedCostUsd:long`, adds `EstimatedCostUsdReal:real`, `EventId`, and `Sequence`, then live-correlate exact wrapper event IDs;
3. add a post-`transform/privacy_strict` Collector tee before extending durability to detailed native Copilot events;
4. prove live `2xx`, `408`, `429`, `5xx`, token expiry, schema `4xx`, disk-full, corruption, restart, and duplicate delivery behavior;
5. measure disk growth, delivery latency, recovery time, and Azure ingestion cost.

Until those gates pass, the wired lifecycle receipt is reliable local groundwork rather than proof that the complete native Copilot event stream has durable Azure delivery.
