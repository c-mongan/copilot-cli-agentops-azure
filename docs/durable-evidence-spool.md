# Durable Evidence Spool

Status: durable wrapper-lifecycle receipts are wired into normal `agentops copilot` runs. The opted-in CLI wrapper also exports native Copilot session Events and Spans into owner-only per-run JSONL and records a private per-table delivery checkpoint. `agentops delivery drain` resumes pending session batches through the existing batch uploader, skips streams already accepted, and takes an exclusive per-run claim so a second process cannot upload the same run concurrently. Dead-process claims are recovered. `agentops delivery review` lists held lifecycle records and per-run session stream status without payloads. A hard process kill after actual Azure Events acceptance has now been exercised: the outbox retained `in_flight`, a later drain recovered it, and Kusto confirmed the expected duplicate physical row for the same stable event ID. Logs Ingestion remains at-least-once. This is recovery support, not exactly-once delivery.

`agentops-cli/src/lib/azure/durable-evidence-spool.js` is the first production-oriented delivery boundary for critical AgentOps evidence. It is deliberately separate from the OpenTelemetry Collector's Azure Monitor exporter because that exporter acknowledges its persistent queue before the inner Application Insights sender receives an Azure response.

The spool accepts only allowlisted scalar wrapper lifecycle metadata. It rejects unknown fields and nested values, forces strict privacy/content-off markers, and requires a run ID and positive sequence. Every segment carries an event ID and SHA-256 hash of the canonical row.

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
- `agentops delivery review` lists expired and quarantined lifecycle records using identifiers and status only; it never prints row payloads.
- `agentops delivery requeue --event-id <id> --yes` returns one valid, non-expired quarantined lifecycle record to the local pending queue after revalidating its allowlisted row and integrity hashes. It makes no Azure request; use the separately configured `delivery drain` command to upload it.
- expired, corrupted, invalid-envelope, ambiguous, and conflicting records cannot be requeued automatically and remain held for investigation or retention handling.
- `agentops delivery prune` previews removal of expired/quarantined lifecycle segments and completed session exports older than 30 days; `--older-than` accepts 30–365 days and `--yes` applies the local deletion.
- pruning never removes pending or in-flight evidence, active claims, unrecognized files, or Azure data. It removes only named AgentOps export files from terminal session runs; folders containing other files are preserved.
- concurrent writers use a short atomic admission lock; concurrent drainers atomically claim segments with a heartbeat and bounded stale-claim recovery;
- identical pending lifecycle evidence deduplicates by table, event ID, and canonical row hash.

Session-stream outboxes are protected by an owner-only per-run claim file. A live owner blocks another drain; a claim left by an exited process is reclaimed, and `in_flight` streams resume as pending work. Local subprocess tests cover concurrent claims and a simulated exit after remote acceptance but before checkpoint persistence. The latter confirms the expected duplicate risk; it does not simulate an actual Azure process interruption.

The interactive receipt deliberately separates these scopes:

- `Delivery` describes the durable wrapper lifecycle receipt and separately reports session Events/Spans batches;
- the per-run session receipt reports Events and Spans export/upload independently; API acceptance is not Azure query readback;
- `Coverage` reports observed producer/runtime coverage and gaps.

A local lifecycle receipt may say `Run receipt saved locally · waiting for Azure` while
session Events or Spans have a different delivery state. Do not treat one stream's
acceptance as proof that the other stream was accepted or query-visible.

Delivery is **at least once**. If Azure accepts a request and the process stops before the local atomic acknowledgement, the same event ID and hash are sent again. Consumers must deduplicate by `EventId` (and may verify `RunId`, `Sequence`, and the row hash). Exactly-once delivery is not claimed.

Enqueue deduplicates an already pending or uploading segment only when table, event ID, and canonical row hash all match. This prevents repeated local admission from multiplying identical work, including after a process restart. It does not change the at-least-once crash window after remote acceptance.

The spool is bounded, so it cannot promise recovery from an unlimited outage. Queue capacity and TTL must be sized from measured event volume. Overflow, expiry, and quarantine are explicit failure states, not successful observation.

`agentops delivery review [--run-id <id>]` also lists per-run session Events/Spans stream states and row counts. It does not read or render the JSONL payloads. An `in_flight` stream after a dead process is recovered by the next explicitly authorized drain; because Azure has already accepted the first request in that crash window, the retry can create a duplicate physical row.

Local retention is separate from Azure workspace/table retention. The default `agentops delivery prune` operation is preview-only and uses a 30-day minimum hold. `--yes` deletes eligible local records only; it never deletes Azure rows. Session exports are pruned only after all observed streams are marked accepted (or not observed), the run is at least the requested age, no active sender owns its claim, and the folder contains only recognized AgentOps files. Unknown files, symlinks, invalid state, and pending/in-flight streams are preserved. Expired/quarantined spool segments are measured from when they entered their held state.

Before treating this as full durable delivery:

1. add bounded per-record review for pending lifecycle records and validate retention behavior under larger local queues;
2. extend operational interruption tests across Events-only, Spans-only, transient API failures, and indexing-delay cases; current proof covers a hard process kill after actual Azure Events acceptance followed by recovery and Kusto readback;
3. add a post-`transform/privacy_strict` Collector tee before extending durability to other detailed native Copilot signals;
4. prove live `2xx`, `408`, `429`, `5xx`, token expiry, schema `4xx`, disk-full, corruption, restart, and duplicate delivery behavior;
5. measure disk growth, delivery latency, recovery time, and Azure ingestion cost.

Until those gates pass, the wired lifecycle receipt is reliable local groundwork rather than proof that the complete native Copilot event stream has durable Azure delivery.
