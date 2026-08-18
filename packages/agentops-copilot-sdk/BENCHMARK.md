# Local metadata performance benchmark

Run the reproducible SDK benchmark with:

```bash
npm run benchmark
```

It measures two local paths separately:

- capture: normalization, privacy-safe field selection, hashing, ordering, and the application callback;
- export: OTLP JSON construction, enqueue latency, flush completion, and an in-process successful HTTP mock.

The report includes p50 and p95 enqueue/capture latency, elapsed time, throughput, request counts, and precisely scoped exporter counters:

- `queuedInMemory`: events admitted to this process's bounded memory queue;
- `collectorAccepted`: requests for which the configured OTLP HTTP endpoint returned a successful response;
- `retryAttempts`, `terminalFailures`, `queueOverflowed`, and `pendingInMemory`: local exporter lifecycle state.

`collectorAccepted` does not prove that a collector exported the event downstream, that Azure ingested it, or that it is queryable. In this benchmark the endpoint is an in-process successful HTTP mock, so the counter proves only mock-endpoint acceptance. The benchmark performs no external network calls or Azure writes, and all generated events are synthetic metadata with `ContentCaptureMode=off`.

The default workload is 100 warm-up events followed by 1,000 measured events. Both values are bounded at 10,000:

```bash
AGENTOPS_BENCH_WARMUP=250 AGENTOPS_BENCH_EVENTS=5000 npm run benchmark
```

Results are descriptive. This project does not currently define or claim an approved performance threshold. Compare runs only on equivalent hardware, Node.js versions, workload sizes, and power conditions. The transport mock isolates adapter/serialization overhead; it does not represent collector, network, Azure ingestion, or dashboard latency.
